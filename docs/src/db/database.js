/**
 * Local, session-scoped persistence built on IndexedDB via Dexie.
 *
 * There is no server and no external database: the ledger lives in the browser.
 * A session id namespaces every row, so "Reset session" can wipe the data and
 * regenerate a fresh demo ledger without touching anything outside this tab's
 * storage. The store keeps a small cached snapshot in memory so the UI and the
 * action layer never read through IndexedDB during a render.
 */

import { Dexie } from '../../vendor/dexie.js';
import { buildSeedData, buildSettings, CATEGORY_DEFS } from './seed.js';
import { uid } from '../util/format.js';

export const DB_NAME = 'meridian-ledger';

export const db = new Dexie(DB_NAME);

db.version(1).stores({
  sessions: 'id, createdAt',
  accounts: 'id, sessionId, type, [sessionId+type]',
  transactions: 'id, sessionId, accountId, ts, category, status, [sessionId+ts], [accountId+ts]',
  categories: 'id, sessionId',
  settings: 'id, sessionId, key',
});

const SESSION_KEY = 'meridian.sessionId';

function readSessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
  } catch {
    /* storage may be unavailable in private mode; fall back to an in-memory id */
  }
  const id = uid('sess');
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export const sessionId = readSessionId();

/** In-memory mirror of the persisted rows for the active session. */
export const store = {
  sessionId,
  accounts: [],
  transactions: [],
  categories: [],
  settings: {},
  loaded: false,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event = { type: 'change' }) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('listener failed', err);
    }
  }
}

async function seedSession(now = Date.now()) {
  const { accounts, transactions, categories } = buildSeedData({ now });
  const settings = buildSettings(now);

  const accountRows = accounts.map((a) => ({ ...a, sessionId }));
  const txRows = transactions.map((t) => ({ ...t, sessionId }));
  const categoryRows = categories.map((c) => ({ ...c, sessionId }));
  const settingRows = settings.map((s) => ({ ...s, id: `${sessionId}:${s.key}`, sessionId }));

  await db.transaction('rw', db.sessions, db.accounts, db.transactions, db.categories, db.settings, async () => {
    await db.sessions.put({ id: sessionId, createdAt: now, label: 'Local session' });
    await db.accounts.bulkPut(accountRows);
    await db.transactions.bulkPut(txRows);
    await db.categories.bulkPut(categoryRows);
    await db.settings.bulkPut(settingRows);
  });

  return { accounts: accountRows, transactions: txRows, categories: categoryRows, settings };
}

function indexSettings(rows) {
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function init() {
  const existing = await db.accounts.where('sessionId').equals(sessionId).count();
  const rows = existing === 0
    ? await seedSession()
    : {
        accounts: await db.accounts.where('sessionId').equals(sessionId).toArray(),
        transactions: await db.transactions.where('sessionId').equals(sessionId).toArray(),
        categories: await db.categories.where('sessionId').equals(sessionId).toArray(),
        settings: await db.settings.where('sessionId').equals(sessionId).toArray(),
      };

  store.accounts = sortAccounts(rows.accounts);
  store.transactions = rows.transactions;
  store.categories = rows.categories.length ? rows.categories : CATEGORY_DEFS.map((c) => ({ ...c }));
  store.settings = indexSettings(rows.settings);
  store.loaded = true;
  return store;
}

export async function resetSession({ now = Date.now() } = {}) {
  await db.transaction('rw', db.sessions, db.accounts, db.transactions, db.categories, db.settings, async () => {
    await db.accounts.where('sessionId').equals(sessionId).delete();
    await db.transactions.where('sessionId').equals(sessionId).delete();
    await db.categories.where('sessionId').equals(sessionId).delete();
    await db.settings.where('sessionId').equals(sessionId).delete();
  });
  store.loaded = false;
  await seedSession(now);
  await init();
  emit({ type: 'reset' });
  return store;
}

export async function clearAllData() {
  await db.delete();
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Display order is explicit: IndexedDB returns rows in key order, not insertion order. */
function sortAccounts(accounts) {
  return accounts.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name));
}

export function accountById(id) {
  return store.accounts.find((a) => a.id === id) || null;
}

export function categoryById(id) {
  return store.categories.find((c) => c.id === id) || { id, label: id || 'Uncategorized', color: '#6b6b6b', icon: '•', kind: 'expense' };
}

export function settingValue(key, fallback = null) {
  return key in store.settings ? store.settings[key] : fallback;
}

export async function persistAccount(account) {
  const row = { ...account, sessionId };
  await db.accounts.put(row);
  const idx = store.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) store.accounts[idx] = row;
  else store.accounts.push(row);
  return row;
}

export async function persistAccounts(accounts) {
  const rows = accounts.map((a) => ({ ...a, sessionId }));
  await db.accounts.bulkPut(rows);
  for (const row of rows) {
    const idx = store.accounts.findIndex((a) => a.id === row.id);
    if (idx >= 0) store.accounts[idx] = row;
    else store.accounts.push(row);
  }
  return rows;
}

export async function persistTransactions(transactions) {
  if (!transactions.length) return [];
  const rows = transactions.map((t) => ({ ...t, sessionId }));
  await db.transactions.bulkPut(rows);
  for (const row of rows) {
    const idx = store.transactions.findIndex((t) => t.id === row.id);
    if (idx >= 0) store.transactions[idx] = row;
    else store.transactions.push(row);
  }
  return rows;
}

export async function persistSetting(key, value) {
  const row = { id: `${sessionId}:${key}`, sessionId, key, value };
  await db.settings.put(row);
  store.settings[key] = value;
  return row;
}

export async function deleteTransaction(id) {
  await db.transactions.delete(id);
  const idx = store.transactions.findIndex((t) => t.id === id);
  if (idx >= 0) store.transactions.splice(idx, 1);
}

export function allTransactions({ accountId = null, newestFirst = true } = {}) {
  let rows = accountId ? store.transactions.filter((t) => t.accountId === accountId) : store.transactions.slice();
  rows.sort((a, b) => (newestFirst ? b.ts - a.ts : a.ts - b.ts));
  return rows;
}

export function totalBalanceMinor() {
  return store.accounts
    .filter((a) => a.type !== 'credit')
    .reduce((acc, a) => acc + a.balanceMinor, 0);
}

export function cardBalanceMinor() {
  return store.accounts
    .filter((a) => a.type === 'credit')
    .reduce((acc, a) => acc + a.balanceMinor, 0);
}
