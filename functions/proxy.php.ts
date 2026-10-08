// Cloudflare Pages Function: the hosted site's stand-in for public/proxy.php,
// served at the same `./proxy.php?url=` address so the app needs no change.
//
// It lets the podcast feature read feeds and episodes from hosts that don't
// send CORS headers. Transcription still happens entirely in the browser — this
// only moves podcast bytes. Because it's on the public internet it is narrower
// than a general proxy:
//   • only GET, only http(s), never local or private-looking hosts;
//   • only requests from this site's own pages (Sec-Fetch-Site: same-origin);
//   • only feeds and media come back — an HTML page is refused, so it can't be
//     used to browse the web through us.

const ALLOWED_TYPES = [
  /^application\/(rss\+xml|atom\+xml|xml)\b/i,
  /^text\/xml\b/i,
  /^audio\//i,
  /^video\//i,
  /^application\/(octet-stream|ogg|x-mpegurl)\b/i,
];

const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
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
  // Some podcast hosts send no type at all; let those through, as proxy.php does.
  if (type && !ALLOWED_TYPES.some((re) => re.test(type))) {
    return refuse(415, "Only podcast feeds and media are proxied.");
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (type) headers.set("Content-Type", type);
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { status: 200, headers });
};
