// Anonymous visit counting with Prompt Agency's own Plausible (self-hosted on
// Hetzner in Finland). One page view per page load, sent from here rather than
// by Plausible's script, so no outside code runs on the page and it's plain
// what is sent: the page address (with only utm_* tags kept), the referring
// page, and the site's name. Plausible works out country, browser and device
// type from the request itself, stores no IP address and sets no cookies.
// Audio, text, file names and what you do in the app are never sent.
//
// The CSP's connect-src must allow PLAUSIBLE (public/_headers), and the FAQ
// describes this — keep both in step with any change here.

const PLAUSIBLE = "https://plausible.app.promptagency.se";
/** The site's name in Plausible, and the only address that is counted. */
const SITE = "vemsavad.promptagency.se";

/** The visitor has asked not to be tracked (Global Privacy Control or Do Not Track). */
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** This page's address with every query parameter dropped except utm_* (link sources). */
function pageAddress(): string {
  const url = new URL(location.href);
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith("utm_")) kept.append(key, value);
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/**
 * Count this page load. Only on the public site — never on previews, localhost
 * or someone else's copy of the app — and never for automated browsers.
 */
export function countVisit(): void {
  if (location.hostname !== SITE || optedOut() || navigator.webdriver) return;
  void fetch(`${PLAUSIBLE}/api/event`, {
    method: "POST",
    // text/plain keeps it a simple request (no CORS preflight).
    headers: { "Content-Type": "text/plain" },
    keepalive: true,
    body: JSON.stringify({ n: "pageview", u: pageAddress(), d: SITE, r: document.referrer || null }),
  }).catch(() => {
    /* offline, blocked by an ad blocker, or the server is down — never matters */
  });
}
