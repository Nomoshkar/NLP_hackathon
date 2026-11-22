# Meridian — Private Local Financial Ledger & Voice Assistant

**Meridian** is a private, client-side financial ledger and voice assistant designed with a warm "letterpress ledger" aesthetic. It runs entirely inside your web browser — **no external server, no cloud AI API, and no tracking**. Your financial records, account balances, and transaction histories live exclusively in your browser’s IndexedDB storage.

---

## 🌟 Key Features & Architecture

- **100% Client-Side Privacy**: Balances, categories, and transactions are stored locally via Dexie (IndexedDB). Data never leaves the device.
- **Rule-Based NLU Engine**: Natural language parsing powered by [Compromise.js](https://compromise.cool/) and deterministic weighted regex classifiers. Recognizes intent, accounts, amounts, categories, and date ranges locally without AI tokens or latency.
- **Native Voice Assistant**: Web Speech API integration allows hands-free voice commands, with tactile feedback and typed fallback.
- **Dual Desktop & Mobile Experience**: Crafted to feel like an artisanal desktop banking dashboard while transforming into an ergonomic mobile app on smartphones.
- **Letterpress Aesthetic**: Distinctive typography combining Fraunces variable serif, IBM Plex Mono tabular figures, and Public Sans body copy, complete with Light and Warm Dark modes.
- **Progressive Web App (PWA)**: Installable to the home screen with complete offline capability powered by a Cache-First Service Worker.

---

## 📱 Mobile & Touch Interface Enhancements

Meridian includes a comprehensive suite of touch-optimized features designed for mobile phones and tablets:

1. **Mobile Bottom Sheet & Collapsed Action Bar**:
   - On mobile devices, the Assistant dock collapses into a sleek bottom bar that hugs the device edge (`safe-area-inset-bottom` compliant).
   - Users can tap the quick-chat bar or tap the voice button directly from the collapsed state without having to open the sheet first.
   - Features a tactile drag handle (`.dock__handle-bar`) supporting swipe-down to fold and swipe-up to expand.
2. **Swipe-to-Dismiss Drawer Gestures**:
   - The transaction detail drawer supports real-time touch drag gestures: swipe right or swipe down to dismiss with elastic feedback and velocity tracking.
   - Includes a visual grab handle at the top of the mobile drawer.
3. **Interactive Touch Chart Scrubbing (Trend Chart)**:
   - Moving or dragging a finger across the balance trend chart activates a vertical tracking line and scrubber dot, revealing an exact date and balance tooltip card.
4. **Touch Inspection on Cash Flow Bars**:
   - Replaces desktop hover tooltips with interactive touch selection: tapping any month column displays an inline summary with exact Inflow, Outflow, and Net figures.
5. **Account Cards Horizontal Carousel**:
   - On screens under 640px, account cards display as a horizontal carousel with CSS scroll snap (`scroll-snap-type: x mandatory`) and pagination indicators.
   - Tapping an indicator dot scrolls smoothly to the corresponding card.
6. **Interactive Category Drilldown**:
   - Tapping any spending category in the "Where it goes" panel instantly filters the ledger to that category and scrolls to the transactions table.
7. **Collapsible Filter Bar & Active Filter Badges**:
   - On mobile screens, the filter controls collapse behind a toggle button with an active filter badge (e.g. `Filters (2)`).
   - Features a one-tap "Clear all filters" button to quickly reset active parameters.
8. **iOS Viewport Auto-Zoom Fix**:
   - Enforces 16px minimum font size on all input fields, select dropdowns, and textareas on mobile, preventing iOS Safari from forcing automatic viewport zoom on focus.
9. **WCAG-Compliant Touch Targets**:
   - All interactive controls (buttons, chips, segmented buttons, icons) maintain at least 44×44px hit areas with `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation` to eliminate double-tap delays.
10. **Tactile Haptic Feedback (Vibration API)**:
    - Subtle vibration pulses accompany button taps, filter selections, voice activation, and drawer dismissals on supported mobile devices.
11. **Mobile-Friendly Budget Editing**:
    - Inline budget editing displays dedicated, high-contrast "✓ Save" and "✕ Cancel" touch buttons alongside a numeric keypad (`inputmode="numeric"`).
12. **Virtual Keyboard (Visual Viewport) Adaptation**:
    - Automatically adjusts the Assistant dock's position and bounds when the virtual keyboard appears, preventing input fields from being obscured.
13. **Safe Area Insets Support**:
    - Full support for `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` across masthead, drawer, modal, and bottom bars for notched screens and home indicators.
14. **PWA Offline Shell (`sw.js`)**:
    - Caches all application code, fonts, and assets locally, allowing full offline usage even with no cellular or Wi-Fi connectivity.

---

## 🖥️ Desktop Experience

- **Keyboard-First Navigation**: Accessible tabindex order, Enter/Space activation of transaction rows, Escape to dismiss drawers/modals, and Shift+Enter support.
- **Detailed Ledger Inspection**: Multi-column ledger with running balances, merchant search, account filter, category filter, status filter, and numeric amount comparison (`over`, `under`, `exactly`).
- **One-Click CSV Export**: Download filtered transaction queries directly to clean CSV files.
- **Theme Switcher**: Instant switching between warm cream letterpress and dark obsidian themes, with automatic system synchronization and local storage persistence.

---

## 🗣️ Voice & Natural Language Commands

Meridian understands conversational financial queries. Try speaking or typing:

| Category | Example Phrases |
|---|---|
| **Balances & Net Worth** | *"What are my balances?"*, *"What is my total net worth?"*, *"How much do I have in savings?"* |
| **Spending & Categories** | *"How much did I spend last month?"*, *"What did I spend on groceries?"*, *"Where does my money go?"* |
| **Transfers & Deposits** | *"Transfer $200 from checking to savings"*, *"Deposit $500 into checking"*, *"Pay $150 towards credit card"* |
| **Budgeting** | *"Am I over budget?"*, *"Set dining budget to $350"*, *"Show budget status"* |
| **Search & Filtering** | *"Show recent transactions"*, *"Show pending charges"*, *"Find transactions over $100"* |
| **Cash Flow & Trends** | *"Show balance trend"*, *"How is my cash flow?"*, *"Compare spending with last month"* |
| **Safety & Control** | *"Undo last action"*, *"Reset session"* |

---

## 📂 Project Structure

```text
├── index.html                   # Application entry point and layout shell
├── manifest.webmanifest         # PWA configuration manifest
├── sw.js                        # Offline caching Service Worker
├── assets/
│   ├── styles.css               # Design system, letterpress tokens, responsive rules
│   ├── fonts.css                # Local web font declarations (@font-face)
│   └── fonts/                   # Fraunces, IBM Plex Mono, and Public Sans WOFF2 fonts
├── src/
│   ├── main.js                  # Application orchestrator, event wiring, gestures
│   ├── actions/
│   │   ├── ledger.js            # Transaction execution (transfer, deposit, withdraw, undo)
│   │   └── queries.js           # Read queries (summaries, balances, categories, trends)
│   ├── db/
│   │   ├── database.js          # Dexie.js IndexedDB schema and session persistence
│   │   └── seed.js              # Synthetic ledger generator with realistic mock data
│   ├── nlu/
│   │   ├── assistant.js         # Intent router and structured response generator
│   │   ├── dates.js             # Temporal range parsing (months, relative windows)
│   │   ├── lexicon.js           # Keyword maps, merchant aliases, intent weights
│   │   └── parse.js             # NLU pipeline (intent detection, entity extraction)
│   ├── ui/
│   │   ├── charts.js            # SVG trend chart and sparkline renderer
│   │   ├── chat.js              # Transcript message bubble renderer
│   │   ├── dashboard.js         # KPI stats, accounts, categories, flow, ledger
│   │   └── voice.js             # Web Speech API wrapper
│   └── util/
│       ├── format.js            # Date, text, and escaping helpers
│       ├── haptics.js           # Mobile tactile vibration helper
│       └── money.js             # Tabular currency formatting and math
├── test/
│   └── test_all.mjs             # Automated unit & integration tests
└── vendor/
    ├── compromise.js            # NLP tokenizer & part-of-speech tagger
    └── dexie.js                 # Minimalist IndexedDB wrapper
```

---

## 🧪 Testing & Development

Run the automated test suite with Node.js:

```bash
node test/test_all.mjs
```

To run Meridian locally, use any static web server:

```bash
# Python
python -m http.server 8000

# Node
npx serve .
```

Open `http://localhost:8000` in your desktop or mobile browser.

---

## 📄 License

MIT License. See individual vendor directories for `compromise` and `dexie` licenses.
