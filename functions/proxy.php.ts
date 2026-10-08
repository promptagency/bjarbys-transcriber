// Cloudflare Pages Function: the hosted site's stand-in for public/proxy.php,
// served at the same `./proxy.php?url=` address so the app needs no change.
//
// It lets the podcast feature read feeds and episodes from hosts that don't
// send CORS headers. Transcription still happens entirely in the browser — this
// only moves podcast bytes. Because it's on the public internet it is narrower
// than a general proxy:
//   • only GET, only http(s), never local or private-looking hosts;
//   • only requests from this site's own pages (Sec-Fetch-Site: same-origin);
//   • web pages and scripts are refused (a feed mislabelled as HTML is let
//     through if it starts like XML), so it can't be used to browse the web
//     through us;
//   • responses are marked X-Vem-Sa-Vad-Proxy, so the app can tell the proxy
//     from a static host that merely serves a file called proxy.php.

// Web pages and scripts are refused; everything else (feeds and media come with
// many labels: application/rss+xml, application/x-rss+xml, text/xml, text/plain,
// audio/mpeg, application/mp3, binary/octet-stream, …) is passed through.
const REFUSED_TYPES = /^(text\/(html|javascript|css)|application\/(xhtml\+xml|javascript|json))\b/i;
/** A feed served with an HTML label still starts like XML. */
const LOOKS_LIKE_XML = /^\s*(<\?xml|<rss|<feed)/i;

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The body again, if its first bytes look like XML; null if they don't. Reads
 * just the first chunk, then streams the rest through unchanged.
 */
async function sniffXml(body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.value ? new TextDecoder().decode(first.value.slice(0, 512)) : "";
  if (!LOOKS_LIKE_XML.test(head.replace(/^\uFEFF/, ""))) {
    void reader.cancel();
    return null;
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.value) controller.enqueue(first.value);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  // Browsers say where a request comes from; only this site's pages may use it.
  if (request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    return refuse(403, "This proxy only serves the Vem sa vad? app itself.");
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return refuse(400, "Missing url parameter");
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return refuse(400, "Invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return refuse(400, "Only http/https URLs are allowed");
  }
  if (PRIVATE_HOST.test(url.hostname)) return refuse(403, "Blocked host");

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      redirect: "follow",
      headers: { Accept: "*/*", "User-Agent": "VemSaVad-proxy/1.0 (+https://github.com/promptagency/vem-sa-vad)" },
    });
  } catch (err) {
    return refuse(502, `Upstream fetch failed: ${String((err as Error)?.message ?? err)}`);
  }
  if (!upstream.ok) return refuse(upstream.status, `Upstream returned HTTP ${upstream.status}`);

  const type = upstream.headers.get("Content-Type") ?? "";
  let body: ReadableStream<Uint8Array> | null = upstream.body;
  if (REFUSED_TYPES.test(type)) {
    // Some feeds are mislabelled as HTML; let them through if they start like XML.
    const sniffed = /^text\/html\b/i.test(type) && body ? await sniffXml(body) : null;
    if (!sniffed) return refuse(415, "Only podcast feeds and media are proxied.");
    body = sniffed;
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    // Tells the app this really is the proxy (see src/lib/podcasts.ts).
    "X-Vem-Sa-Vad-Proxy": "1",
  });
  if (type) headers.set("Content-Type", type);
  // fetch() decompresses gzip/brotli bodies; the upstream length would then be
  // the compressed size, so it's only passed on for uncompressed responses.
  const length = upstream.headers.get("Content-Length");
  if (length && !upstream.headers.get("Content-Encoding")) headers.set("Content-Length", length);
  return new Response(body, { status: 200, headers });
};
