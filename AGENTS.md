# AGENTS.md

Repository notes for agents working in this repo.

## What is here

- `docs/` — the Meridian app: a browser-only ledger dashboard with a chat/voice
  assistant. This folder is the GitHub Pages site root. Plain ES modules, no
  build step, no framework.
- `tools/` — test harnesses (Node + headless Chromium).
- `OpenNLP/` — an unrelated pre-existing Java project. Leave it alone.

## Commands

```bash
npm install                 # dev dep: fake-indexeddb
npm run check               # 18 language/ledger/analytics checks (Node)
python3 -m http.server 12000 --directory docs &   # serve the app
npm run test:browser        # headless Chromium smoke test; needs port 9222 + a server
```

`npm run test:browser` honours `BASE_URL`, so it can be pointed at a
Pages-style subpath (`http://localhost:12099/NLP_hackathon/index.html`) to check
that relative asset paths still resolve.

## Conventions and gotchas

- **No network calls, no API keys.** The app must make zero external requests.
  Language understanding is a rule-based parser in `docs/src/nlu/`; do not
  introduce a model or a hosted API. The browser test records every request and
  will show any external traffic.
- **Relative asset paths only.** The site is served from a subpath
  (`/NLP_hackathon/`), so no leading-slash references.
- **Runtime deps are vendored** into `docs/vendor/` with their licences; do not
  switch to a CDN.
- **`tools/check-nlu.mjs` runs checks in declaration order, not concurrently.**
  Several checks mutate the same ledger. Keep the sequential queue in place.
- Money is stored as integer minor units everywhere. Parse with
  `docs/src/util/money.js`; the dollars-and-cents shorthand (`twelve fifty`) is
  intentionally narrow (cents word must be a multiple of ten, no scale word) so
  that `two hundred and fifty` reads as $250, not $200.50.

## Deployment

GitHub Pages serves `docs/` from `main` (Settings → Pages → Deploy from a
branch → `main` / `/docs`). `docs/.nojekyll` is committed so files are served
as-is.

## Environment limitation

The OpenHands `GITHUB_TOKEN` is a GitHub App **installation token**. It carries
`contents: write`, so `git push` and `POST /pulls` work. It does **not** carry
the Pages administration permission, so `POST /repos/{owner}/{repo}/pages`
returns `403 Resource not accessible by integration`, as does
`actions/configure-pages` with `enablement: true`. Enable or reconfigure the
Pages site from the repository settings UI instead.
