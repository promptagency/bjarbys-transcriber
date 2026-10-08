<?php
/**
 * proxy.php — same-origin proxy for Vem sa vad?'s podcast feature, for
 * self-hosting on Apache/PHP. (The hosted site uses functions/proxy.php.ts,
 * which follows the same rules.)
 *
 * The browser cannot read a cross-origin podcast feed or episode unless the
 * host sends CORS headers (most don't), so this script fetches it server-side
 * and streams it back. Transcription still happens entirely in the browser —
 * this only moves podcast bytes, and nothing else:
 *   - only GET over http(s), and never hosts resolving to private or reserved
 *     addresses (basic SSRF protection);
 *   - only requests from the app's own pages (Sec-Fetch-Site: same-origin —
 *     stops browsers and links from other sites, though not a determined
 *     script, hence the next point);
 *   - the CONTENT is checked, not the label: the first bytes must be a podcast
 *     feed (XML whose root is <rss> or <feed>) or a recognised audio/video
 *     container. Anything else — archives, documents, programs, images, web
 *     pages, other XML — is refused, so it can't fetch arbitrary files;
 *   - what passes gets a fixed, inert content type and headers that stop a
 *     browser from rendering or running it as a page on this site;
 *   - responses are marked X-Vem-Sa-Vad-Proxy, so the app can tell the proxy
 *     apart from a server that just hands out this file's source.
 *
 * Requires PHP with the cURL extension.
 */

const PEEK_BYTES = 4096;

function refuse($status, $message) {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo $message;
    exit;
}

/** 'feed', 'media' or null — judged by the first bytes alone. */
function classify($head) {
    $b0 = strlen($head) > 0 ? ord($head[0]) : -1;
    $b1 = strlen($head) > 1 ? ord($head[1]) : -1;
    if (substr($head, 0, 3) === 'ID3') return 'media';                       // MP3 with ID3 tag
    if ($b0 === 0xFF && ($b1 & 0xE0) === 0xE0) return 'media';               // MPEG audio frame / AAC ADTS
    if (substr($head, 4, 4) === 'ftyp') return 'media';                      // MP4, M4A, MOV, 3GP
    if (substr($head, 0, 4) === 'OggS') return 'media';                      // Ogg Vorbis / Opus
    if (substr($head, 0, 4) === "\x1A\x45\xDF\xA3") return 'media';          // WebM / MKV
    if (substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WAVE') return 'media';
    if (substr($head, 0, 4) === 'fLaC') return 'media';
    if (substr($head, 0, 4) === 'FORM' && preg_match('/^AIF[FC]$/', substr($head, 8, 4))) return 'media';

    // A podcast feed: XML whose root is <rss> or <feed>.
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $head);
    $text = preg_replace('/^\s*<\?xml[^>]*\?>/i', '', $text);
    $text = preg_replace('/<!--.*?-->/s', '', $text);
    $text = preg_replace('/<!DOCTYPE[^>]*>/i', '', $text);
    $text = preg_replace('/<\?xml-stylesheet[^>]*\?>/i', '', $text);
    if (preg_match('/^\s*<(rss|feed)[\s>]/i', $text)) return 'feed';
    return null;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') refuse(405, 'Only GET is allowed');

// Browsers say where a request comes from; only this site's pages may use it.
if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') !== 'same-origin') {
    refuse(403, 'This proxy only serves the Vem sa vad? app itself.');
}

$url = isset($_GET['url']) ? $_GET['url'] : '';
if ($url === '') refuse(400, 'Missing url parameter');

$parts = parse_url($url);
if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) refuse(400, 'Invalid url');

$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') refuse(400, 'Only http/https URLs are allowed');

// --- SSRF guard: refuse hosts that resolve to private/reserved addresses ----
$host = trim($parts['host'], '[]');
$ips = @gethostbynamel($host);
if ($ips === false) {
    $ips = array();
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $ips[] = $host;
    } else {
        $rec = @dns_get_record($host, DNS_AAAA);
        if ($rec) {
            foreach ($rec as $r) {
                if (isset($r['ipv6'])) $ips[] = $r['ipv6'];
            }
        }
    }
}
if (empty($ips)) refuse(502, 'DNS resolution failed');
foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        refuse(403, 'Blocked private/reserved address');
    }
}

// --- Fetch, inspect the first bytes, then stream -----------------------------
while (ob_get_level() > 0) {
    ob_end_flush();
}

$status = 0;         // status of the final response (after redirects)
$upstreamType = '';
$head = '';          // bytes held back until the content has been judged
$decided = false;
$refusal = null;     // [status, message] if the content was refused

$send = function ($kind) use (&$upstreamType) {
    if ($kind === 'feed') {
        $type = 'application/xml';
        if (preg_match('/charset=([^;\s]+)/i', $upstreamType, $m)) $type .= '; charset=' . $m[1];
    } else {
        $bare = strtolower(trim(explode(';', $upstreamType)[0]));
        $type = preg_match('#^(audio|video)/[\w.+-]+$#', $bare) ? $bare : 'application/octet-stream';
    }
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store');
    // Never rendered or run as a page on this site, whatever the bytes are.
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header('X-Content-Type-Options: nosniff');
    // Tells the app this response really comes from the proxy (see src/lib/podcasts.ts).
    header('X-Vem-Sa-Vad-Proxy: 1');
};

$decide = function () use (&$head, &$decided, &$refusal, &$status, $send) {
    $decided = true;
    if ($status < 200 || $status >= 300) {
        $refusal = array($status ?: 502, 'Upstream returned HTTP ' . $status);
        return false;
    }
    $kind = classify($head);
    if ($kind === null) {
        $refusal = array(415, 'Only podcast feeds and audio/video are proxied.');
        return false;
    }
    $send($kind);
    echo $head;
    flush();
    $head = '';
    return true;
};

$ch = curl_init($url);
curl_setopt_array($ch, array(
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT        => 900,
    CURLOPT_ENCODING       => '', // accept + transparently decode compression
    CURLOPT_USERAGENT      => 'VemSaVad-proxy/1.0 (+https://github.com/promptagency/vem-sa-vad)',
    CURLOPT_HTTPHEADER     => array('Accept: */*'),
    CURLOPT_HEADERFUNCTION => function ($ch, $header) use (&$status, &$upstreamType) {
        // A new status line starts each response in a redirect chain.
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $m)) {
            $status = (int) $m[1];
            $upstreamType = '';
        } elseif (stripos($header, 'Content-Type:') === 0) {
            $upstreamType = trim(substr($header, 13));
        }
        return strlen($header);
    },
    CURLOPT_WRITEFUNCTION  => function ($ch, $data) use (&$head, &$decided, &$refusal, $decide) {
        if (!$decided) {
            $head .= $data;
            if (strlen($head) < PEEK_BYTES) return strlen($data);
            if (!$decide()) return 0; // refused: abort the transfer
            return strlen($data);
        }
        echo $data;
        flush();
        return strlen($data);
    },
));

$ok = curl_exec($ch);
$error = curl_error($ch);
curl_close($ch);

// A short body never reached PEEK_BYTES: judge what arrived.
if (!$decided && $refusal === null) {
    if ($ok === false && $head === '') refuse(502, 'Upstream fetch failed: ' . $error);
    $decide();
}
if ($refusal !== null) refuse($refusal[0], $refusal[1]);
