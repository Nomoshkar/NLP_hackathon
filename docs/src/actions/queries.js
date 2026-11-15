/**
 * Read-only analytics over the ledger snapshot: balances, summaries,
 * category breakdowns, cash-flow and recurring charge detection.
 */

import { store } from '../db/database.js';
import { addMonths, monthKey, pluralize } from '../util/format.js';
import { sumMinor } from '../util/money.js';

export const EXPENSE_CATEGORIES = [
  'housing', 'groceries', 'dining', 'transport', 'utilities',
  'subscriptions', 'health', 'shopping', 'travel', 'fees',
];

export function postedTransactions({ accountId = null, from = null, to = null } = {}) {
  return store.transactions.filter((t) => {
    if (t.status !== 'posted') return false;
    if (accountId && t.accountId !== accountId) return false;
    if (from !== null && t.ts < from) return false;
    if (to !== null && t.ts > to) return false;
    return true;
  });
}

export function inRange(range, opts = {}) {
  return postedTransactions({ from: range?.start ?? null, to: range?.end ?? null, ...opts });
}

export function summarize(transactions) {
  let inflow = 0;
  let outflow = 0;
  let largest = null;
  for (const tx of transactions) {
    if (tx.direction === 'credit') {
      inflow += tx.amountMinor;
      if (!largest || tx.amountMinor > largest.amountMinor) largest = tx;
    } else {
      outflow += tx.amountMinor;
      if (!largest || tx.amountMinor > largest.amountMinor) largest = tx;
    }
  }
  return {
    count: transactions.length,
    inflowMinor: inflow,
    outflowMinor: outflow,
    netMinor: inflow - outflow,
    largest,
  };
}

/** Spending only: excludes transfers and income. */
export function spendTransactions(transactions) {
  return transactions.filter((t) => t.direction === 'debit' && t.category !== 'transfer' && t.category !== 'income');
}

export function incomeTransactions(transactions) {
  return transactions.filter((t) => t.direction === 'credit' && t.category === 'income');
}

export function byCategory(transactions) {
  const totals = new Map();
  for (const tx of transactions) {
    const key = tx.category || 'uncategorized';
    const entry = totals.get(key) || { categoryId: key, totalMinor: 0, count: 0, transactions: [] };
    entry.totalMinor += tx.amountMinor;
    entry.count += 1;
    entry.transactions.push(tx);
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

export function byMonth(transactions) {
  const totals = new Map();
  for (const tx of transactions) {
    const key = monthKey(tx.ts);
    const entry = totals.get(key) || { month: key, inflowMinor: 0, outflowMinor: 0 };
    if (tx.direction === 'credit') entry.inflowMinor += tx.amountMinor;
    else entry.outflowMinor += tx.amountMinor;
    totals.set(key, entry);
  }
  return [...totals.values()]
    .map((e) => ({ ...e, netMinor: e.inflowMinor - e.outflowMinor }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function byDay(transactions) {
  const totals = new Map();
  for (const tx of transactions) {
    const d = new Date(tx.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = totals.get(key) || { day: key, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), outflowMinor: 0, inflowMinor: 0 };
    if (tx.direction === 'credit') entry.inflowMinor += tx.amountMinor;
    else entry.outflowMinor += tx.amountMinor;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => a.ts - b.ts);
}

export function byMerchant(transactions) {
  const totals = new Map();
  for (const tx of transactions) {
    const key = tx.merchant || tx.description || 'Unknown';
    const entry = totals.get(key) || { merchant: key, totalMinor: 0, count: 0 };
    entry.totalMinor += tx.amountMinor;
    entry.count += 1;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) => b.totalMinor - a.totalMinor);
}

/**
 * Recurring charges: a merchant charged in three or more distinct months with a
 * consistent amount. This is how the assistant answers "what am I subscribed to".
 */
export function recurringCharges(transactions = store.transactions) {
  const debits = transactions.filter((t) => t.direction === 'debit' && t.category !== 'transfer');
  const groups = new Map();
  for (const tx of debits) {
    const key = (tx.merchant || tx.description || '').trim();
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(tx);
    groups.set(key, bucket);
  }

  const out = [];
  for (const [merchant, rows] of groups) {
    const months = new Set(rows.map((r) => monthKey(r.ts)));
    if (months.size < 3) continue;
    const amounts = rows.map((r) => r.amountMinor);
    const avg = sumMinor(amounts) / amounts.length;
    const variance = amounts.reduce((acc, a) => acc + (a - avg) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const steady = stdDev / (avg || 1) < 0.08;
    out.push({
      merchant,
      months: months.size,
      occurrences: rows.length,
      averageMinor: Math.round(avg),
      stdDevMinor: Math.round(stdDev),
      steady,
      lastCharged: Math.max(...rows.map((r) => r.ts)),
      category: rows[0].category,
      cadence: cadenceFor(rows),
    });
  }
  return out.sort((a, b) => b.averageMinor - a.averageMinor);
}

function cadenceFor(rows) {
  const days = [...new Set(rows.map((r) => new Date(r.ts).getDate()))].sort((a, b) => a - b);
  if (days.length >= 3) {
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const avgGap = sumMinor(gaps) / gaps.length;
    if (avgGap > 25) return 'monthly';
    if (avgGap > 10) return 'fortnightly';
    if (avgGap > 4) return 'weekly';
  }
  return 'monthly';
}

export function balanceFor(accountId) {
  const account = store.accounts.find((a) => a.id === accountId);
  return account ? account.balanceMinor : 0;
}

export function accountsOfType(type) {
  return store.accounts.filter((a) => a.type === type);
}

/** Average monthly outflow over the last `months` complete months. */
export function averageMonthlySpend({ months = 3, now = Date.now() } = {}) {
  const outflows = [];
  for (let i = 1; i <= months; i += 1) {
    const start = new Date(now);
    start.setDate(1);
    start.setMonth(start.getMonth() - i);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const rows = postedTransactions({ from: start.getTime(), to: end.getTime() + 86399999 });
    const spend = spendTransactions(rows);
    outflows.push(sumMinor(spend.map((t) => t.amountMinor)));
  }
  if (!outflows.length) return 0;
  return Math.round(outflows.reduce((a, b) => a + b, 0) / outflows.length);
}

/** Runway: how many months the liquid balance covers at the average burn rate. */
export function runwayMonths({ now = Date.now() } = {}) {
  const liquid = store.accounts
    .filter((a) => a.type !== 'credit')
    .reduce((acc, a) => acc + Math.max(0, a.balanceMinor), 0);
  const burn = averageMonthlySpend({ now });
  if (!burn) return null;
  return liquid / burn;
}

export function lastNMonths(n, now = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    out.push({
      key: monthKey(d.getTime()),
      ts: d.getTime(),
      start: d.getTime(),
      end: Math.min(end.getTime() + 86399999, now),
    });
  }
  return out;
}

export function monthTotals(now = Date.now()) {
  const thisStart = new Date(now);
  thisStart.setDate(1);
  thisStart.setHours(0, 0, 0, 0);
  const lastStart = addMonths(thisStart.getTime(), -1);
  const lastEnd = thisStart.getTime() - 1;

  const thisMonth = summarize(inRange({ start: thisStart.getTime(), end: now }));
  const lastMonth = summarize(inRange({ start: lastStart, end: lastEnd }));
  return { thisMonth, lastMonth };
}

export function describeCount(transactions) {
  return pluralize(transactions.length, 'transaction');
}

/**
 * Total cash position at a point in time, reconstructed from opening balances
 * plus every posted entry up to that moment. Credit lines are excluded so this
 * reads as "money you have", not "net of debt".
 */
export function totalBalanceAt(ts, { includeCredit = false } = {}) {
  let total = 0;
  for (const account of store.accounts) {
    if (!includeCredit && account.type === 'credit') continue;
    let balance = account.openingBalanceMinor;
    for (const tx of store.transactions) {
      if (tx.accountId !== account.id || tx.status !== 'posted') continue;
      if (tx.ts > ts) continue;
      balance += tx.direction === 'credit' ? tx.amountMinor : -tx.amountMinor;
    }
    total += balance;
  }
  return total;
}

/** Month-end cash position for the last `count` months, oldest first. */
export function balanceSeries(count = 6, now = Date.now()) {
  return lastNMonths(count, now).map((m) => ({
    key: m.key,
    ts: m.end,
    balanceMinor: totalBalanceAt(m.end),
  }));
}

export function merchantMatches(transactions, merchant) {
  const needle = merchant.toLowerCase();
  return transactions.filter((t) => (t.merchant || t.description || '').toLowerCase().includes(needle));
}

export function keywordMatches(transactions, keywords = []) {
  if (!keywords.length) return [];
  return transactions.filter((t) => {
    const haystack = `${t.merchant || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase();
    return keywords.some((k) => haystack.includes(k.toLowerCase()));
  });
}
