// Cloudflare Pages Function: the hosted site's stand-in for public/proxy.php,
// served at the same `./proxy.php?url=` address so the app needs no change.
//
// It lets the podcast feature read feeds and episodes from hosts that don't
// send CORS headers. Transcription still happens entirely in the browser — this
// only moves podcast bytes. Because it's on the public internet it passes
// podcast content and nothing else:
//   • only GET, only http(s), never local or private-looking hosts;
//   • only requests from this site's own pages (Sec-Fetch-Site: same-origin —
//     which stops browsers and links from other sites, though not a determined
//     script, hence the next point);
//   • the CONTENT is checked, not the label: the first bytes must be a podcast
//     feed (XML with an <rss> or <feed> element) or a recognised audio/video
//     container. Anything else — archives, documents, programs, images, web
//     pages, other XML — is refused, so the proxy can't be used to fetch
//     arbitrary files through this domain;
//   • what passes gets a fixed, inert content type and headers that stop a
//     browser from rendering or running it, so nothing fetched can act as a
//     page on this origin;
//   • responses are marked X-Vem-Sa-Vad-Proxy, so the app can tell the proxy
//     from a static host that merely serves a file called proxy.php.

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

/** Bytes inspected before deciding; enough for an XML prolog and a feed's root element. */
const PEEK_BYTES = 4096;

type Kind = "feed" | "media";

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.subarray(from, from + length));

/** What the first bytes are, judged by their content alone. (Exported for testing.) */
export function classify(head: Uint8Array): Kind | null {
  // Audio/video containers, by their signatures.
  if (ascii(head, 0, 3) === "ID3") return "media"; // MP3 with ID3 tag
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "media"; // MPEG audio frame / AAC ADTS
  if (ascii(head, 4, 4) === "ftyp") return "media"; // MP4, M4A, MOV, 3GP
  if (ascii(head, 0, 4) === "OggS") return "media"; // Ogg Vorbis / Opus
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "media"; // WebM / MKV
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return "media";
  if (ascii(head, 0, 4) === "fLaC") return "media";
  if (ascii(head, 0, 4) === "FORM" && /^AIF[FC]$/.test(ascii(head, 8, 4))) return "media";

  // A podcast feed: XML whose root is <rss> or <feed>.
  const text = new TextDecoder("utf-8")
    .decode(head)
    .replace(/^﻿/, "")
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\?xml-stylesheet[^>]*\?>/gi, "")
    .trimStart();
  if (/^<(rss|feed)[\s>]/i.test(text)) return "feed";
  return null;
}

/**
 * Read at least PEEK_BYTES (or the whole body, if shorter), and return those
 * bytes plus a stream that replays them followed by the rest.
 */
async function peek(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  while (size < PEEK_BYTES) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    chunks.push(next.value);
    size += next.value.length;
  }
  const head = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    head.set(chunk, at);
    at += chunk.length;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length) controller.enqueue(head);
      if (done) controller.close();
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
  return { head, stream, cancel: () => reader.cancel() };
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
  if (!upstream.ok || !upstream.body) {
    return refuse(upstream.ok ? 502 : upstream.status, `Upstream returned HTTP ${upstream.status}`);
  }

  const { head, stream, cancel } = await peek(upstream.body);
  const kind = classify(head);
  if (!kind) {
    void cancel();
    return refuse(415, "Only podcast feeds and audio/video are proxied.");
  }

  // A fixed, inert type: never whatever the upstream claimed.
  const upstreamType = upstream.headers.get("Content-Type") ?? "";
  let type: string;
  if (kind === "feed") {
    const charset = /charset=([^;\s]+)/i.exec(upstreamType)?.[1];
    type = charset ? `application/xml; charset=${charset}` : "application/xml";
  } else {
    type = /^(audio|video)\/[\w.+-]+$/i.test(upstreamType.split(";")[0].trim())
      ? upstreamType.split(";")[0].trim()
      : "application/octet-stream";
  }

  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": "no-store",
    // Never rendered or run as a page on this origin, whatever the bytes are.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    // Tells the app this really is the proxy (see src/lib/podcasts.ts).
    "X-Vem-Sa-Vad-Proxy": "1",
  });
  // fetch() decompresses gzip/brotli bodies; the upstream length would then be
  // the compressed size, so it's only passed on for uncompressed responses.
  const length = upstream.headers.get("Content-Length");
  if (length && !upstream.headers.get("Content-Encoding")) headers.set("Content-Length", length);
  return new Response(stream, { status: 200, headers });
};
