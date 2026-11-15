# Meridian — a local-first ledger you can talk to

Meridian is an account dashboard with a chat and voice assistant. You type or
speak a request in plain English — *"how much did I spend on dining last
month?"*, *"transfer $200 to savings"* — and it answers from a ledger that lives
entirely in your browser.

There is no backend, no database server, no account, and **no AI API key**. The
language understanding is a rule-based parser that ships with the page, and the
data is seeded into IndexedDB on first load.

**Live demo:** https://nomoshkar.github.io/NLP_hackathon/

> The demo data is synthetic. Every session starts from the same seeded ledger
> and changes you make stay in your browser only.

---

## What it does

| You can ask | It answers with |
| --- | --- |
| *"What are my balances?"* | Each account and the total cash position |
| *"How much did I spend last month?"* | A total, a category breakdown, and a comparison |
| *"How much did I spend on dining in October?"* | A per-category figure with the matching charges |
| *"What subscriptions do I have?"* | Detected recurring charges and their monthly cost |
| *"Am I over budget?"* | Per-category budget progress and what is over |
| *"What is my cash flow?"* | Money in versus money out, month by month |
| *"Compare this month to last month"* | Category-level deltas |
| *"Show me my recent transactions"* | The matching rows in the ledger table |
| *"Transfer $200 from checking to savings"* | A confirmed transfer, with balances updated |
| *"Deposit $500 into savings"* | A confirmed deposit |
| *"Withdraw $80"* | A confirmed withdrawal |
| *"Pay off my credit card"* | A card payment that clears the balance |
| *"Undo that"* | Reverses the last money movement |

Ask something it does not understand and it says so rather than guessing. Ask
for a movement without an amount (*"deposit"*) and it asks for the amount, then
accepts a bare number (*"$75"*) as the follow-up.

The dashboard updates live as you talk to it: the panels below re-render
whenever the ledger changes.

## The dashboard

- **Cash position hero** — total across deposit accounts, this month's movement,
  net worth, month spend and income, and a runway estimate.
- **Account cards** — one per account, with a balance meter; click to scope the
  panels to that account.
- **Balance trend** — a 3/6/12-month cash-position chart.
- **Where it goes** — spend by category for the selected window.
- **Monthly cash flow** — in versus out for the last six months.
- **Budget watch** — per-category progress against budgeted amounts.
- **Ledger** — a searchable, filterable, sortable transaction table grouped by
  day, with running balances and pending flags.

## How the language layer works

It is a deterministic parser, not a model, which is why the app needs no API key
and behaves identically offline.

1. **Lexicon** (`docs/src/nlu/lexicon.js`) — the vocabulary: accounts, aliases,
   categories, merchants, intent trigger phrases.
2. **Dates** (`docs/src/nlu/dates.js`) — resolves *today*, *last week*, *last
   month*, *last 30 days*, month names and *last 12 months* into concrete ranges
   against a supplied "now".
3. **Parse** (`docs/src/nlu/parse.js`) — classifies the intent and extracts the
   amount, accounts, category, merchant and date range. Amounts accept
   `$1,204.50`, `1204`, `1.2k`, `2 grand`, `two hundred and fifty` and
   `twelve fifty`.
4. **Assistant** (`docs/src/nlu/assistant.js`) — turns a parsed request into a
   reply: prose plus structured blocks (KPIs, bars, rows, budgets) that the chat
   renderer draws. Also owns the confirmation flow for money movements.

`compromise` (vendored) is used as a light tokenizer and part-of-speech helper.
The intent routing itself is explicit rules, so the behaviour is inspectable and
testable.

## Running it locally

Any static file server works; the app has no build step.

```bash
python3 -m http.server 12000 --directory docs
# then open http://localhost:12000
```

Because the app is served from a subpath on GitHub Pages
(`/NLP_hackathon/`), every asset reference is relative.

## Tests

**Language, ledger and analytics checks** — these import the real browser
modules directly and run them against `fake-indexeddb`:

```bash
npm install          # installs fake-indexeddb only
npm run check
```

Covers money parsing, date-range resolution, intent classification, entity
extraction, ledger reconciliation, overdraft rejection, undo, card payments,
budget/analytics consistency, recurring-charge detection and end-to-end
assistant turns.

**Browser smoke test** — drives the real UI in headless Chromium over the
DevTools Protocol, replays a scripted conversation, asserts the replies, fails on
any console error or uncaught exception, and writes screenshots:

```bash
chromium --headless=new --remote-debugging-port=9222 --no-sandbox about:blank &
python3 -m http.server 12000 --directory docs &
npm run test:browser
```

Screenshots land in `.test-output/`. Both suites pass with zero console errors.

## Layout

```
docs/                     the deployed site (GitHub Pages serves this folder)
  index.html
  .nojekyll               serve files as-is, no Jekyll processing
  assets/
    styles.css
    fonts.css
    fonts/                self-hosted Fraunces, IBM Plex Mono, Public Sans
  vendor/                 compromise + Dexie, with their licences
  src/
    db/                   Dexie schema and the seeded demo ledger
    nlu/                  lexicon, dates, parser, assistant
    actions/              ledger mutations and read queries
    ui/                   dashboard panels, chat renderer, charts, voice
    util/                 money and formatting helpers
tools/
  check-nlu.mjs           language/ledger/analytics checks
  browser-test.mjs        headless browser smoke test
```

## Data and privacy

- Balances and transactions are generated in `docs/src/db/seed.js` and written
  to IndexedDB under a per-session key on first load.
- Nothing is uploaded. The app makes no network request other than fetching its
  own static assets — verified in the browser test by recording every request.
- **Reset session** regenerates the ledger from scratch and discards your edits.

## Voice input

The microphone button uses the browser's Web Speech API. Chrome, Edge and Safari
implement it; where it is missing the button is disabled and typing still works.
Speech recognition may use the browser vendor's own service, which is a browser
capability rather than something this app configures — and it still needs no API
key. Everything else works fully offline.

## Tech choices

Plain ES modules, no framework and no build step, so the deployed page is the
source you can read. `Dexie` wraps IndexedDB for the ledger; `compromise` helps
with tokenising. Charts are hand-drawn SVG. Both runtime dependencies are
vendored into `docs/vendor/` with their licences so the page has no third-party
CDN dependency.

## Licence

MIT for the application code. Vendored dependencies keep their own licences —
see `docs/vendor/LICENSE-compromise.txt` and `docs/vendor/LICENSE-dexie.txt`.
The bundled fonts are licensed under the SIL Open Font License.

---

### `OpenNLP/`

The repository also contains an unrelated `OpenNLP/` directory (a Java project
with its jar dependencies). It is untouched by this work.
