import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { PhoneNotice } from "./components/PhoneNotice";
import { continuedOnPhone, isPhone, rememberContinueOnPhone } from "./lib/device";
import { countVisit } from "./lib/analytics";
import "./index.css";

/** Phones see a "use a computer" page first; the app (and its worker) only starts past it. */
function Root() {
  const [notice, setNotice] = useState(() => isPhone() && !continuedOnPhone());
  if (notice) {
    return (
      <PhoneNotice
        onContinue={() => {
          rememberContinueOnPhone();
          setNotice(false);
        }}
      />
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// One anonymous page view, on the public site only (see src/lib/analytics.ts).
countVisit();

// Installable app + opening offline (see public/sw.js). Production builds only:
// in `npm run dev` a service worker would serve stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* not critical: the app works without it */
    });
  });
}

// An installed app asks to keep its storage, so browsers don't evict cached
// models (and kept transcripts) under storage pressure. Chrome decides without
// a prompt; a plain tab doesn't ask, as Firefox would show a dialog.
if (window.matchMedia("(display-mode: standalone)").matches) {
  void navigator.storage?.persist?.();
}

