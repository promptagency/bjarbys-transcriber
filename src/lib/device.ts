// Phones get a "use a computer" page instead of the app: transcription needs
// more speed and memory than a phone has (an hour of audio is ~230 MB decoded,
// and iOS closes tabs that use much more), and the tab must stay open and
// visible throughout. Tablets are let through — the better ones manage short files.

/**
 * Whether this is a phone. Not judged by screen width, so a narrow desktop
 * window is never turned away: Chromium says so itself (`userAgentData.mobile`,
 * false on tablets); elsewhere the user agent's phone markers decide (an
 * Android tablet has no "Mobile", an iPad says "iPad" or poses as a Mac).
 */
export function isPhone(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof data?.mobile === "boolean") return data.mobile;
  return /iPhone|iPod|Android.+Mobile|Mobile.+Firefox|Windows Phone/i.test(navigator.userAgent);
}

const CONTINUE_KEY = "vem-sa-vad:phone-continue";

/** "Continue anyway" was chosen earlier in this visit. */
export function continuedOnPhone(): boolean {
  try {
    return sessionStorage.getItem(CONTINUE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberContinueOnPhone(): void {
  try {
    sessionStorage.setItem(CONTINUE_KEY, "1");
  } catch {
    /* not remembered — the notice shows again on the next load */
  }
}
