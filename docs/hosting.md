# Hosting

Vem sa vad? builds to static files (`npm run build` → `dist/`) with relative paths (`base: './'` in
`vite.config.ts`), so it can be served from any folder. The only server-side part is an optional proxy
for podcasts. Two setups are described here: Cloudflare Pages (what the public site uses) and a plain
Apache/LAMP server.

## Cloudflare Pages

The public site runs on [Cloudflare Pages](https://pages.cloudflare.com/), built from `main` on every
merge (feature branches get preview addresses). Settings live in `wrangler.toml`: build
`npm run build`, output `dist/`. Pages rejects files over 25 MiB; the build leaves out the ONNX Runtime
`.wasm` Vite would otherwise copy in, since the runtime is loaded from jsDelivr.

- **`public/_headers`** sends cross-origin isolation (which makes the CPU fallback multithreaded) and a
  strict **Content-Security-Policy**: the page may only connect to itself, Hugging Face (models),
  jsDelivr (the ONNX runtime), Apple's podcast search and Prompt Agency's Plausible. The browser
  enforces it, so "nothing is uploaded" can be checked, not just trusted. Change it deliberately: any
  new outside host the app talks to must be added there or it is blocked.
- **`functions/proxy.php.ts`** is the Pages version of the [podcast proxy](#the-podcast-proxy).
- **`public/site.webmanifest` + `public/sw.js`** make it installable and let it open offline after one
  visit (the service worker caches the app's own files; models are cached by Transformers.js).
- Check the hosted setup locally with `npm run build && npx wrangler pages dev dist`.
- The custom domain is a CNAME at the domain's DNS provider pointing to the project's `pages.dev`
  address, added in the Pages dashboard *first* — creating the CNAME before that gives a 522 error.

## Apache / LAMP

```bash
npm run build    # outputs static files to dist/
```

Copy the **contents of `dist/`** into your Apache web root (or a subfolder). A ready-to-use
**`.htaccess`** and the podcast **`proxy.php`** are included in `public/` and are emitted into `dist/`
by the build.

- **HTTPS is required** for the microphone (`getUserMedia`) and WebGPU. The `.htaccess`
  force-redirects to HTTPS (localhost is exempt).
- **No COOP/COEP headers needed** for WebGPU or single-threaded WASM — they're left commented out in
  `.htaccess`. Enabling them (as `npm run dev` does) makes the CPU fallback multithreaded, which matters
  for visitors without WebGPU; that setup has not been tested on a deployed server.
- **Serving from a subfolder** needs no rebuild. If Apache's fallback misbehaves there, add a
  `RewriteBase` to `.htaccess`.

## The podcast proxy

Searching uses Apple's iTunes API (CORS-enabled, direct). Most podcast hosts, however, block
cross-origin reads of their RSS/audio, so the app fetches feeds and episodes through a **same-origin
proxy** — `./proxy.php?url=` — which your own server fetches through, and falls back to a direct fetch
where no proxy runs. This keeps it private to your server (no third-party CORS proxy).

Both versions — `public/proxy.php` (PHP with cURL) and `functions/proxy.php.ts` (Cloudflare Pages) —
follow the same rules:

- **Only podcast content.** It checks the first *bytes*, not the label, and passes only an RSS/Atom feed
  or a recognised audio/video container (MP3, AAC, MP4/M4A, Ogg/Opus, WebM, WAV, FLAC, AIFF), so it
  can't be used to fetch arbitrary files through your domain. What passes gets an inert content type
  and headers that stop it from ever running as a page.
- **Only this site's own pages** may call it; requests from other sites' pages are refused.
- **No private or reserved addresses**, re-checked on every redirect (the PHP version also pins the
  connection to the checked address).

Without the proxy, file and microphone transcription still work, and podcasts work for any host that
happens to send CORS headers. In development, `npm run dev` serves a stand-in for `/proxy.php`;
`npm run preview` doesn't.

## Visit counting

`src/lib/analytics.ts` sends one anonymous page view per load to Prompt Agency's self-hosted Plausible
(Hetzner, Finland), using a few lines of our own code rather than Plausible's script. It sends the page
address with only `utm_*` kept, the referring page's origin and path, and the site name; no cookies,
nothing stored. It only runs on `vemsavad.promptagency.se` — never on previews, localhost or your own
copy — and not when the browser sends Global Privacy Control or Do Not Track. To leave your own browser
out, open the site once with `?plausible_ignore=true` (`=false` undoes it).
