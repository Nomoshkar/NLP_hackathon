/**
 * Application entry point.
 *
 * Wires the local database, the rule-based assistant, the dashboard panels and
 * the chat/voice dock together. Everything runs in the browser: there is no
 * backend, no AI API and no network call anywhere in this app.
 */

import { accountById, categoryById, init, persistCategory, resetSession, sessionId, store, subscribe } from './db/database.js';
import { resetUndoStack } from './actions/ledger.js';
import { inRange, postedTransactions } from './actions/queries.js';
import { handle } from './nlu/assistant.js';
import { renderAccounts, renderBudgets, renderCategories, renderFlow, renderHero, renderLedger, renderSessionChip, renderTrend, populateFilters } from './ui/dashboard.js';
import { createChat } from './ui/chat.js';
import { createVoiceInput, isVoiceSupported } from './ui/voice.js';
import { escapeHtml, formatDate, formatTime } from './util/format.js';
import { formatMoney } from './util/money.js';

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
  filters: { accountId: '', categoryId: '', status: '', amountOp: '', amountMinor: null, search: '', sort: 'new', direction: '' },
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
  export: document.getElementById('btn-export'),
  search: document.getElementById('tx-search'),
  accountSelect: document.getElementById('tx-account'),
  categorySelect: document.getElementById('tx-category'),
  statusSelect: document.getElementById('tx-status'),
  opSelect: document.getElementById('tx-op'),
  amountInput: document.getElementById('tx-amount'),
  themeToggle: document.getElementById('btn-theme'),
  themeLabel: document.getElementById('theme-label'),
  drawer: document.getElementById('drawer'),
  drawerScrim: document.getElementById('drawer-scrim'),
  drawerPanel: document.querySelector('.drawer__panel'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerAmount: document.getElementById('drawer-amount'),
  drawerFacts: document.getElementById('drawer-facts'),
  drawerClose: document.getElementById('drawer-close'),
  drawerCopy: document.getElementById('drawer-copy'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalConfirm: document.getElementById('modal-confirm'),
  modalCancel: document.getElementById('modal-cancel'),
  modalScrim: document.getElementById('modal-scrim'),
};

/* --------------------------------------------------------------------------
   Theme — follows the system until the user makes an explicit choice.
   -------------------------------------------------------------------------- */
const THEME_KEY = 'meridian.theme';

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (dom.themeToggle) dom.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  if (dom.themeLabel) dom.themeLabel.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

function setupTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  if (stored === 'dark' || stored === 'light') applyTheme(stored);
  else applyTheme(currentTheme());

  dom.themeToggle?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    toast(`${next === 'dark' ? 'Dark' : 'Light'} theme`);
  });
}

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
    state.filters = { ...state.filters, direction: '', status: '', amountOp: '', amountMinor: null, search: '', categoryId: '' };
  }
  if (view.kind === 'transactions') {
    state.accountId = view.accountId ?? null;
    state.range = view.range || null;
    const amountFilter = view.amountFilter || null;
    state.filters = {
      ...state.filters,
      accountId: view.accountId || '',
      categoryId: view.category || '',
      status: view.status || '',
      amountOp: amountFilter ? amountFilter.op : '',
      amountMinor: amountFilter ? amountFilter.minor : null,
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

  dom.statusSelect?.addEventListener('change', () => {
    state.filters = { ...state.filters, status: dom.statusSelect.value };
    state.limit = 25;
    renderLedger(state);
  });

  const applyAmount = () => {
    const raw = dom.amountInput?.value ?? '';
    const parsed = raw === '' ? NaN : Number(raw);
    state.filters = {
      ...state.filters,
      amountOp: dom.opSelect?.value || '',
      amountMinor: Number.isFinite(parsed) ? Math.round(parsed * 100) : null,
    };
    state.limit = 25;
    renderLedger(state);
  };
  dom.opSelect?.addEventListener('change', applyAmount);
  dom.amountInput?.addEventListener('input', applyAmount);

  dom.export?.addEventListener('click', exportCsv);

  // Rows open the detail drawer, by click or by keyboard.
  document.getElementById('ledger-table')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-tx]');
    if (row) openDrawer(store.transactions.find((t) => t.id === row.dataset.tx));
  });
  document.getElementById('ledger-table')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('[data-tx]');
    if (!row) return;
    event.preventDefault();
    openDrawer(store.transactions.find((t) => t.id === row.dataset.tx));
  });

  // Inline budget editing in the Budget watch panel.
  document.getElementById('budget-list')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-budget-edit]');
    if (!btn) return;
    const id = btn.dataset.budgetEdit;
    const def = store.categories.find((c) => c.id === id);
    if (!def) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'budget__input';
    input.min = '0';
    input.step = '1';
    input.value = String(Math.round((def.budgetMinor || 0) / 100));
    input.setAttribute('aria-label', `${def.label} budget amount`);
    btn.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) {
        await persistCategory({ ...def, budgetMinor: Math.round(value * 100) });
        toast(`${def.label} budget set to ${formatMoney(Math.round(value * 100))}`);
      }
      renderBudgets(state);
    };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = String(Math.round((def.budgetMinor || 0) / 100)); input.blur(); }
    });
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
   Confirmation modal — a promise-based replacement for window.confirm
   -------------------------------------------------------------------------- */
let closeModal = null;

function confirmDialog({ title = 'Are you sure?', body = '', confirmLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    if (!dom.modal) { resolve(window.confirm(body || title)); return; }
    dom.modalTitle.textContent = title;
    dom.modalBody.textContent = body;
    dom.modalConfirm.textContent = confirmLabel;
    dom.modal.hidden = false;
    requestAnimationFrame(() => dom.modal.classList.add('is-open'));

    const finish = (value) => {
      dom.modal.classList.remove('is-open');
      setTimeout(() => { dom.modal.hidden = true; }, 200);
      dom.modalConfirm.removeEventListener('click', onYes);
      dom.modalCancel.removeEventListener('click', onNo);
      dom.modalScrim.removeEventListener('click', onNo);
      document.removeEventListener('keydown', onKey);
      closeModal = null;
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onKey = (event) => { if (event.key === 'Escape') onNo(); };

    dom.modalConfirm.addEventListener('click', onYes);
    dom.modalCancel.addEventListener('click', onNo);
    dom.modalScrim.addEventListener('click', onNo);
    document.addEventListener('keydown', onKey);
    closeModal = onNo;
    dom.modalConfirm.focus();
  });
}

/* --------------------------------------------------------------------------
   Transaction detail drawer
   -------------------------------------------------------------------------- */
function openDrawer(tx) {
  if (!dom.drawer || !tx) return;
  const account = accountById(tx.accountId);
  const category = categoryById(tx.category);
  const credit = tx.direction === 'credit';
  const signed = credit ? tx.amountMinor : -tx.amountMinor;

  dom.drawerTitle.textContent = tx.merchant || tx.description || 'Transaction';
  dom.drawerAmount.textContent = formatMoney(signed, { signed: true });
  dom.drawerAmount.classList.toggle('is-credit', credit);

  const facts = [
    ['Category', category.label],
    ['Account', account ? `${account.name} ••${account.number}` : '—'],
    ['Date', formatDate(tx.ts, { withYear: true })],
    ['Time', formatTime(tx.ts)],
    ['Status', tx.status || 'posted'],
    ['Channel', tx.channel ? tx.channel.toUpperCase() : '—'],
    ['Running balance', tx.balanceAfterMinor === null ? '—' : formatMoney(tx.balanceAfterMinor)],
    ['Reference', tx.id],
  ];
  dom.drawerFacts.innerHTML = facts
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
    .join('');

  const lastFocused = document.activeElement;
  dom.drawer.hidden = false;
  requestAnimationFrame(() => dom.drawer.classList.add('is-open'));
  dom.drawerPanel?.focus();

  dom.drawerCopy.onclick = async () => {
    const text = facts.map(([k, v]) => `${k}: ${v}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Transaction details copied');
    } catch {
      toast('Could not copy to the clipboard', { warning: true });
    }
  };

  const close = () => {
    dom.drawer.classList.remove('is-open');
    setTimeout(() => { dom.drawer.hidden = true; }, 320);
    document.removeEventListener('keydown', onKey);
    dom.drawerScrim.removeEventListener('click', close);
    dom.drawerClose.removeEventListener('click', close);
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  dom.drawerScrim.addEventListener('click', close);
  dom.drawerClose.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}

/* --------------------------------------------------------------------------
   CSV export of whatever the ledger currently shows
   -------------------------------------------------------------------------- */
function exportCsv() {
  const { filters } = state;
  let rows = state.range ? inRange(state.range) : postedTransactions();
  if (filters.accountId) rows = rows.filter((t) => t.accountId === filters.accountId);
  if (filters.categoryId) rows = rows.filter((t) => t.category === filters.categoryId);
  if (filters.status) rows = rows.filter((t) => (t.status || 'posted') === filters.status);
  if (filters.amountOp && Number.isFinite(filters.amountMinor)) {
    const { amountOp, amountMinor } = filters;
    rows = rows.filter((t) => (amountOp === 'gt' ? t.amountMinor > amountMinor
      : amountOp === 'lt' ? t.amountMinor < amountMinor
        : t.amountMinor === amountMinor));
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    rows = rows.filter((t) => `${t.merchant || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase().includes(needle));
  }
  rows.sort((a, b) => b.ts - a.ts);

  if (!rows.length) { toast('Nothing to export with these filters', { warning: true }); return; }

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Date', 'Merchant', 'Description', 'Category', 'Account', 'Direction', 'Amount', 'Status', 'Balance after', 'Reference'];
  const lines = [header.join(',')];
  for (const t of rows) {
    const account = accountById(t.accountId);
    lines.push([
      new Date(t.ts).toISOString(),
      t.merchant || '',
      t.description || '',
      categoryById(t.category).label,
      account ? `${account.name} ••${account.number}` : '',
      t.direction,
      (t.direction === 'credit' ? t.amountMinor : -t.amountMinor) / 100,
      t.status || 'posted',
      t.balanceAfterMinor === null || t.balanceAfterMinor === undefined ? '' : t.balanceAfterMinor / 100,
      t.id,
    ].map(esc).join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meridian-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} transactions`);
}

/* --------------------------------------------------------------------------
   Session controls
   -------------------------------------------------------------------------- */
function setupSessionControls() {
  dom.reset?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Reset this session?',
      body: 'The demo ledger will be regenerated from scratch and any entries you added will be discarded.',
      confirmLabel: 'Reset session',
    });
    if (!confirmed) return;
    await resetSession();
    resetUndoStack();
    state.pending = null;
    state.accountId = null;
    state.range = null;
    state.limit = 25;
    state.filters = { accountId: '', categoryId: '', status: '', amountOp: '', amountMinor: null, search: '', sort: 'new', direction: '' };
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
  setupTheme();
  await init();

  // On a phone the dock would cover half the screen, so it starts folded to a
  // labelled pill; the dashboard is the primary view there.
  if (window.matchMedia?.('(max-width: 560px)').matches) {
    document.body.classList.add('dock-collapsed');
    dom.dockToggle?.setAttribute('aria-expanded', 'false');
  }

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
