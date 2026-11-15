/**
 * Application entry point.
 *
 * Wires the local database, the rule-based assistant, the dashboard panels and
 * the chat/voice dock together. Everything runs in the browser: there is no
 * backend, no AI API and no network call anywhere in this app.
 */

import { init, resetSession, sessionId, store, subscribe } from './db/database.js';
import { resetUndoStack } from './actions/ledger.js';
import { handle } from './nlu/assistant.js';
import { renderAccounts, renderBudgets, renderCategories, renderFlow, renderHero, renderLedger, renderSessionChip, renderTrend, populateFilters } from './ui/dashboard.js';
import { createChat } from './ui/chat.js';
import { createVoiceInput, isVoiceSupported } from './ui/voice.js';

const DEFAULT_SUGGESTIONS = [
  'What are my balances?',
  'How much did I spend last month?',
  'Show recent transactions',
  'Transfer $200 to savings',
  'Am I over budget?',
];

const state = {
  accountId: null,
  range: null,
  trendMonths: 6,
  limit: 25,
  pending: null,
  filters: { accountId: '', categoryId: '', search: '', sort: 'new', direction: '' },
};

const dom = {
  form: document.getElementById('chat-form'),
  input: document.getElementById('chat-input'),
  log: document.getElementById('chat-log'),
  suggestions: document.getElementById('chat-suggestions'),
  mic: document.getElementById('btn-mic'),
  voiceStatus: document.getElementById('voice-status'),
  toast: document.getElementById('toast'),
  dock: document.getElementById('dock'),
  dockToggle: document.getElementById('btn-dock-toggle'),
  reset: document.getElementById('btn-reset'),
  more: document.getElementById('btn-more'),
  search: document.getElementById('tx-search'),
  accountSelect: document.getElementById('tx-account'),
  categorySelect: document.getElementById('tx-category'),
};

/* --------------------------------------------------------------------------
   Toast
   -------------------------------------------------------------------------- */
let toastTimer = null;
function toast(message, { warning = false } = {}) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-warning', warning);
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 3200);
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */
function renderAll() {
  const now = Date.now();
  renderHero(now);
  renderAccounts(state, selectAccount);
  renderTrend(state.trendMonths, now);
  renderCategories(state, now);
  renderFlow(state, now);
  renderBudgets(state, now);
  populateFilters(state);
  renderLedger(state, now);
}

function applyView(view) {
  if (!view) return;
  if (view.kind === 'overview') {
    state.accountId = view.accountId ?? null;
    state.range = null;
    state.filters = { ...state.filters, direction: '' };
  }
  if (view.kind === 'transactions') {
    state.accountId = view.accountId ?? null;
    state.range = view.range || null;
    state.filters = {
      ...state.filters,
      accountId: view.accountId || '',
      categoryId: view.category || '',
      search: view.search || '',
      direction: view.direction || '',
    };
    state.limit = 25;
  }
  if (view.kind === 'trend') {
    state.range = null;
    if (view.months?.length) state.trendMonths = Math.min(Math.max(view.months.length, 3), 12);
  }
  if (view.kind === 'budget') {
    state.range = view.range || null;
  }
  if (view.kind === 'recurring') {
    state.range = null;
  }
  renderAll();
}

function selectAccount(accountId) {
  state.accountId = state.accountId === accountId ? null : accountId;
  state.filters = { ...state.filters, accountId: state.accountId || '' };
  state.range = null;
  state.limit = 25;
  renderAll();
}

/* --------------------------------------------------------------------------
   Assistant turn
   -------------------------------------------------------------------------- */
const chat = createChat({
  logEl: dom.log,
  suggestionsEl: dom.suggestions,
  onSuggestion: (text) => submit(text),
});

let busy = false;

async function submit(text) {
  const message = String(text || '').trim();
  if (!message || busy) return;
  busy = true;

  chat.addUser(message);
  chat.showTyping();
  measureDock();

  try {
    const reply = await handle(message, { pending: state.pending, now: Date.now() });
    chat.removeTyping();
    chat.addAssistant(reply);
    measureDock();

    state.pending = reply.pending || null;
    if (reply.affectsData) {
      resetUndoStackOnReset(reply);
      renderAll();
      if (reply.receipt) toast(`Posted ${reply.receipt.kind.replace('_', ' ')}`, {});
    }
    if (reply.tone === 'warning') toast(reply.text, { warning: true });
    if (reply.view) applyView(reply.view);
  } catch (err) {
    console.error(err);
    chat.removeTyping();
    chat.addAssistant({
      role: 'assistant',
      text: 'Something went wrong handling that. Nothing was changed in your ledger.',
      tone: 'warning',
      blocks: [],
      actions: DEFAULT_SUGGESTIONS,
    });
    toast('Request failed — see the browser console for details.', { warning: true });
  } finally {
    busy = false;
    dom.input.focus();
  }
}

function resetUndoStackOnReset(reply) {
  if (reply.parsed?.intent === 'reset') resetUndoStack();
}

/* --------------------------------------------------------------------------
   Voice
   -------------------------------------------------------------------------- */
function setupVoice() {
  if (!isVoiceSupported()) {
    dom.mic.disabled = true;
    dom.mic.title = 'Voice input is not supported in this browser — use Chrome, Edge or Safari';
    dom.voiceStatus.textContent = '';
    return;
  }

  const voice = createVoiceInput({
    onPartial: (text) => {
      dom.input.value = text;
      autoGrow();
    },
    onFinal: (text) => {
      dom.input.value = '';
      autoGrow();
      setVoiceStatus('');
      submit(text);
    },
    onStateChange: (voiceState) => {
      const listening = voiceState === 'listening';
      dom.mic.classList.toggle('is-listening', listening);
      dom.mic.setAttribute('aria-pressed', String(listening));
      setVoiceStatus(listening ? 'Listening… speak now' : '');
    },
    onError: (message) => {
      setVoiceStatus(message, true);
      dom.mic.classList.remove('is-listening');
      dom.mic.setAttribute('aria-pressed', 'false');
    },
  });

  dom.mic.addEventListener('click', () => voice.toggle());
  dom.mic.title = 'Speak your request';
}

function setVoiceStatus(message, isError = false) {
  if (!dom.voiceStatus) return;
  dom.voiceStatus.textContent = message;
  dom.voiceStatus.classList.toggle('is-error', isError);
}

/* --------------------------------------------------------------------------
   Composer
   -------------------------------------------------------------------------- */
function autoGrow() {
  const input = dom.input;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

function setupComposer() {
  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = dom.input.value;
    dom.input.value = '';
    autoGrow();
    submit(text);
  });

  dom.input.addEventListener('input', autoGrow);
  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      dom.form.requestSubmit();
    }
    if (event.key === 'Escape') {
      dom.input.value = '';
      autoGrow();
    }
  });
}

/* --------------------------------------------------------------------------
   Ledger controls
   -------------------------------------------------------------------------- */
function setupLedgerControls() {
  dom.search?.addEventListener('input', () => {
    state.filters = { ...state.filters, search: dom.search.value };
    state.limit = 25;
    renderLedger(state);
  });

  dom.accountSelect?.addEventListener('change', () => {
    state.filters = { ...state.filters, accountId: dom.accountSelect.value };
    state.accountId = dom.accountSelect.value || null;
    state.limit = 25;
    renderAll();
  });

  dom.categorySelect?.addEventListener('change', () => {
    state.filters = { ...state.filters, categoryId: dom.categorySelect.value };
    state.limit = 25;
    renderLedger(state);
  });

  document.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('is-active', b === btn));
      state.filters = { ...state.filters, sort: btn.dataset.sort };
      renderLedger(state);
    });
  });

  document.querySelectorAll('[data-trend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-trend]').forEach((b) => b.classList.toggle('is-active', b === btn));
      state.trendMonths = Number(btn.dataset.trend);
      renderTrend(state.trendMonths);
    });
  });

  dom.more?.addEventListener('click', () => {
    state.limit += 25;
    renderLedger(state);
  });
}

/* --------------------------------------------------------------------------
   Session controls
   -------------------------------------------------------------------------- */
function setupSessionControls() {
  dom.reset?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Reset this session?\n\nThe demo ledger will be regenerated from scratch and any entries you added will be discarded.',
    );
    if (!confirmed) return;
    await resetSession();
    resetUndoStack();
    state.pending = null;
    state.accountId = null;
    state.range = null;
    state.limit = 25;
    state.filters = { accountId: '', categoryId: '', search: '', sort: 'new', direction: '' };
    renderAll();
    chat.addAssistant({
      role: 'assistant',
      text: 'Fresh session created — the demo ledger has been regenerated from scratch.',
      tone: 'success',
      blocks: [],
      actions: DEFAULT_SUGGESTIONS,
    });
    toast('Session reset');
  });

  dom.dockToggle?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('dock-collapsed');
    dom.dockToggle.setAttribute('aria-expanded', String(!collapsed));
    // Let the layout settle before re-measuring.
    requestAnimationFrame(() => {
      const height = collapsed ? 58 : Math.ceil(dom.dock.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--dock-h', `${height}px`);
    });
  });
}

/* --------------------------------------------------------------------------
   Dock geometry
   -------------------------------------------------------------------------- */
/**
 * The dock is fixed, and its height changes as the transcript grows, so the
 * page reserves space from the measured height rather than a fixed guess.
 */
let measureDock = () => {};

function watchDockHeight() {
  if (!dom.dock) return;
  const apply = () => {
    const collapsed = document.body.classList.contains('dock-collapsed');
    const height = collapsed ? 58 : Math.ceil(dom.dock.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--dock-h', `${height}px`);
  };
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(apply);
    observer.observe(dom.dock);
  }
  window.addEventListener('resize', apply);
  measureDock = apply;
  apply();
  return apply;
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function boot() {
  await init();

  renderSessionChip(sessionId);
  renderAll();
  setupComposer();
  setupLedgerControls();
  setupSessionControls();
  setupVoice();
  const syncDock = watchDockHeight();

  // Re-render whenever the data layer changes (actions, reset, another tab).
  subscribe((event) => {
    if (event.type === 'change') renderAll();
  });

  chat.setDefaultSuggestions(DEFAULT_SUGGESTIONS);

  const greeting = await handle('hello', { now: Date.now() });
  chat.addAssistant(greeting);
  syncDock();

  dom.input.focus();
  document.body.dataset.ready = 'true';
}

boot().catch((err) => {
  console.error('Failed to start Meridian', err);
  const message = err?.name === 'InvalidStateError' || /indexeddb|idb/i.test(String(err?.message))
    ? 'This browser blocked local storage (IndexedDB). Meridian keeps your ledger on-device, so it cannot run without it. Try a normal (non-private) window.'
    : 'Meridian failed to start. See the browser console for details.';
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div class="toast is-visible is-warning" style="position:static;transform:none;margin:1rem auto;max-width:640px">${message}</div>`,
  );
});

export { state, submit, renderAll };

// Exposed for the automated browser smoke test (tools/browser-test.mjs). It is
// harmless in production and lets the test drive the same code path the UI uses.
globalThis.__testSubmit = submit;
