# Meridian — AI Agent Developer & Architectural Guide

This document is the primary reference for AI coding agents (and human engineers) maintaining, extending, or debugging **Meridian**.

---

## 1. Architectural Philosophy

1. **Zero External Dependencies / Zero Network Calls**:
   - Meridian does not call any third-party APIs, LLM endpoints, or cloud backends.
   - All computation (NLP parsing, intent routing, state management, financial math, and rendering) occurs strictly on the client device.
   - External network calls must **never** be introduced.
2. **Offline-First & Local Persistence**:
   - IndexedDB via `Dexie.js` is the single source of truth.
   - Data is namespaced by `sessionId` (persisted in `localStorage`), allowing instant session reset without interfering with other browser tabs or profiles.
   - In-memory cache `store` mirrors the database state to ensure instantaneous, synchronous dashboard rendering.
3. **Integer Cents / Minor Units**:
   - All financial amounts are stored as integer minor units (`amountMinor`, e.g., `$10.50` is `1050`).
   - Floating-point representations must never be used for storage or arithmetic. Currency formatting is handled solely in `src/util/money.js`.
4. **Letterpress Ledger Aesthetic**:
   - Visual tokens are defined in `assets/styles.css` using warm paper tones (`--paper`, `--ink`, `--brass`, `--oxblood`, `--accent`).
   - Both Light and Dark modes are supported via CSS custom properties on `:root[data-theme='light|dark']`.
   - Avoid generic grey or flat Bootstrap/Material styling; maintain the handcrafted, serif-and-mono letterpress feel.

---

## 2. Directory & Module Breakdown

```text
src/
├── actions/
│   ├── ledger.js       # Core transactional mutations (transfer, deposit, withdraw, payCard, undo)
│   └── queries.js      # Pure analytical queries (summarize, inRange, runwayMonths, balanceSeries)
├── db/
│   ├── database.js     # Dexie instance, table schemas, store cache, pub/sub emitter
│   └── seed.js         # Generator for realistic synthetic accounts, transactions, and budgets
├── nlu/
│   ├── assistant.js    # Intent router; translates parsed utterance into action or structured reply
│   ├── dates.js        # Date window parser (extractRange, monthRange, period bounds)
│   ├── lexicon.js      # Dictionaries for intent regexes, action verbs, categories, and merchant aliases
│   └── parse.js        # Utterance tokenizer (Compromise.js) and entity extractor
├── ui/
│   ├── charts.js       # SVG area chart (with scrubber) and sparklines
│   ├── chat.js         # Chat bubble builder, structured block renderers, suggestions
│   ├── dashboard.js    # View renderer (Hero, Accounts, Trend, Categories, Flow, Budgets, Ledger)
│   └── voice.js        # Web Speech API wrapper for speech recognition
└── util/
    ├── format.js       # Dates, times, titleCase, escapeHtml, and string utilities
    ├── haptics.js      # Vibration API wrapper for mobile tactile feedback
    └── money.js        # Minor unit formatting, parsing, and arithmetic
```

---

## 3. State Management & Flow

### Global Application State (`src/main.js`)
```javascript
const state = {
  accountId: null,     // Currently focused account (or null for all)
  range: null,         // Active temporal range ({ start, end, label })
  trendMonths: 6,      // 3, 6, or 12 month trend chart window
  limit: 25,           // Pagination limit for ledger display
  pending: null,       // Pending multi-turn action awaiting confirmation
  filters: {           // Active ledger filters
    accountId: '',
    categoryId: '',
    status: '',
    amountOp: '',
    amountMinor: null,
    search: '',
    sort: 'new',
    direction: '',
  },
};
```

### Unidirectional Data Flow
1. **User Action**: Triggered via typed text, voice dictation, suggestion click, or UI control (filter, card, sort).
2. **NLU Processing**: `parse(text)` extracts intent and entities in `src/nlu/parse.js`.
3. **Execution**: `handle(message, ctx)` in `src/nlu/assistant.js` executes ledger mutations (via `src/actions/ledger.js`) or queries (via `src/actions/queries.js`).
4. **Data Layer Notification**: Mutations in `ledger.js` persist to IndexedDB via `persistTransaction()` and call `emit({ type: 'change' })`.
5. **Subscription & Re-Render**: `src/main.js` subscribes to DB events and triggers `renderAll()`.
6. **Idempotent UI Paint**: `renderAll()` invokes modular paint functions in `src/ui/dashboard.js`, updating DOM regions idempotently.

---

## 4. Mobile & Touch Guidelines

When adding or modifying UI components, adhere to these rules:

- **Touch Target Dimensions**: Minimum 44×44px hit area for all buttons, chips, and controls (WCAG 2.5.5 / 2.5.8).
- **Tap Highlights & Delays**: Always set `touch-action: manipulation;` and `-webkit-tap-highlight-color: transparent;` on interactive elements.
- **Sticky Hover Elimination**: Ensure hover effects are scoped within `@media (hover: hover) and (pointer: fine)` so mobile taps do not leave permanent hover colors. Use `:active` pseudo-classes for immediate feedback.
- **iOS Font Zoom Rule**: All `<input>`, `<select>`, and `<textarea>` elements must have `font-size: 16px;` or greater on mobile viewports (`<= 768px`) to prevent iOS Safari from automatically zooming into the page on focus.
- **Safe Area Insets**: Fixed and edge-aligned elements must incorporate `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` to support notched displays and navigation bars.
- **Visual Viewport Handling**: When soft keyboards appear on mobile devices, use `window.visualViewport` to dynamically offset fixed bottom containers.
- **Tactile Feedback**: Call `haptic.tap()`, `haptic.selection()`, or `haptic.warning()` from `src/util/haptics.js` on user interactions.

---

## 5. NLU Engine Extension Guide

To add a new intent or command:

1. **Define Intent Regex & Weights** in `src/nlu/lexicon.js`:
   ```javascript
   {
     intent: 'new_intent_name',
     patterns: [/\b(my keyword|phrase pattern)\b/i],
     weight: 6,
   }
   ```
2. **Extract Entities** in `src/nlu/parse.js`:
   If the intent needs special entity extraction (e.g. custom date formats, merchant patterns), add an extractor and expose it in the object returned by `parse()`.
3. **Handle Intent** in `src/nlu/assistant.js`:
   Add a handler function in `HANDLERS`:
   ```javascript
   new_intent_name: async (parsed, ctx) => {
     // Perform read query or action
     return reply('Response text for the assistant bubble', {
       blocks: [/* optional kpis, rows, bars */],
       actions: [/* suggested follow-up chips */],
       view: { kind: 'overview' }, // optional dashboard sync
     });
   }
   ```
4. **Write Unit Tests** in `test/test_all.mjs`:
   Verify intent classification and entity extraction:
   ```javascript
   const res = parse('my keyword query');
   assert(res.intent === 'new_intent_name', 'detects new intent');
   ```

---

## 6. Testing & Quality Verification

Run tests before submitting changes:

```bash
# Run test suite
node test/test_all.mjs

# Syntax check all JS modules
node --check src/main.js
node --check src/nlu/parse.js
node --check sw.js
```
