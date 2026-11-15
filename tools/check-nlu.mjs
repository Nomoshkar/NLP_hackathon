/**
 * Node-side checks for the data layer, the ledger actions and the language
 * parser. Runs against fake-indexeddb so the browser-only modules can be
 * imported directly — no build step and no browser needed.
 *
 * Usage:
 *   npm install --no-save fake-indexeddb
 *   node tools/check-nlu.mjs
 */

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'docs', 'src');
const load = (rel) => import(pathToFileURL(join(SRC, rel)).href);

try {
  await import('fake-indexeddb/auto');
} catch {
  console.error('This check needs fake-indexeddb:  npm install --no-save fake-indexeddb');
  process.exit(2);
}

if (!globalThis.localStorage) {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
    clear: () => memory.clear(),
  };
}

const db = await load('db/database.js');
const ledger = await load('actions/ledger.js');
const queries = await load('actions/queries.js');
const money = await load('util/money.js');
const dates = await load('nlu/dates.js');
const parse = await load('nlu/parse.js');
const assistant = await load('nlu/assistant.js');

const NOW = new Date('2026-11-15T12:00:00').getTime();
/** Wall-clock timestamp used for ledger writes, so they land in the past. */
const OP_TS = Date.now();

const results = [];
// Checks run in declaration order: several of them mutate the same ledger, so
// they must not overlap, and the report must not print before they finish.
let queue = Promise.resolve();
function check(name, fn) {
  queue = queue.then(async () => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, message: err.message });
    }
  });
}

/* ---- money ------------------------------------------------------------- */
check('parseMoney handles currency, shorthand and words', () => {
  assert.equal(money.parseMoney('$1,204.50'), 120450);
  assert.equal(money.parseMoney('1204'), 120400);
  assert.equal(money.parseMoney('1.2k'), 120000);
  assert.equal(money.parseMoney('2 grand'), 200000);
  assert.equal(money.parseMoney('two hundred and fifty dollars'), 25000);
  assert.equal(money.parseMoney('twelve fifty'), 1250);
  assert.equal(money.parseMoney('50 bucks'), 5000);
  assert.equal(money.parseMoney('no amount here'), null);
});

check('formatMoney renders negatives and explicit signs', () => {
  assert.equal(money.formatMoney(123456), '$1,234.56');
  assert.equal(money.formatMoney(-68420), '-$684.20');
  assert.equal(money.formatMoney(5000, { signed: true }), '+$50.00');
});

/* ---- dates ------------------------------------------------------------- */
check('extractRange resolves relative windows', () => {
  assert.equal(dates.extractRange('today', NOW).label, 'today');
  assert.equal(dates.extractRange('last month', NOW).label, 'last month');
  assert.equal(dates.extractRange('this month', NOW).label, 'this month');
  assert.equal(dates.extractRange('last week', NOW).label, 'last week');
  assert.match(dates.extractRange('in march', NOW).label, /March 2026/);
  assert.match(dates.extractRange('last 30 days', NOW).label, /last 30 days/);
  assert.equal(dates.extractRange('hello there', NOW), null);
});

check('last month covers the whole previous calendar month', () => {
  const range = dates.extractRange('last month', NOW);
  assert.equal(new Date(range.start).getMonth(), 9);
  assert.equal(new Date(range.end).getDate(), 31);
});

/* ---- parsing ----------------------------------------------------------- */
const INTENT_CASES = [
  ['what are my balances?', 'balance'],
  ['how much did I spend last month?', 'spend_summary'],
  ['show me recent transactions', 'list_transactions'],
  ['transfer $200 to savings', 'transfer'],
  ['deposit $50', 'deposit'],
  ['withdraw $100', 'withdraw'],
  ['pay off my credit card', 'pay_card'],
  ['what subscriptions do I have?', 'recurring'],
  ['am I over budget?', 'budget_status'],
  ['undo that', 'undo'],
];

check('parse classifies the core intents', () => {
  const ctx = { accounts: [], categories: [], now: NOW };
  for (const [text, expected] of INTENT_CASES) {
    assert.equal(parse.parse(text, ctx).intent, expected, `"${text}"`);
  }
});

check('parse extracts amount, accounts and category', () => {
  const accounts = [
    { id: 'a', name: 'Everyday Checking', nickname: 'Everyday', aliases: ['checking'], number: '4821', type: 'checking' },
    { id: 'b', name: 'High-Yield Savings', nickname: 'High-Yield', aliases: ['savings'], number: '8831', type: 'savings' },
  ];
  const ctx = { accounts, categories: [{ id: 'dining', label: 'Dining' }], now: NOW };

  const transfer = parse.parse('transfer $500 from checking to savings', ctx);
  assert.equal(transfer.amountMinor, 50000);
  assert.equal(transfer.fromAccountId, 'a');
  assert.equal(transfer.toAccountId, 'b');

  const dining = parse.parse('how much did I spend on dining last month?', ctx);
  assert.equal(dining.category, 'dining');
  assert.equal(dining.range.label, 'last month');

  const words = parse.parse('deposit two hundred and fifty dollars into savings', ctx);
  assert.equal(words.amountMinor, 25000);
  assert.equal(words.accountIds[0], 'b');
});

check('parse does not mistake time phrases for merchants', () => {
  const ctx = { accounts: [], categories: [], now: NOW };
  assert.equal(parse.parse('show me transactions from last week', ctx).merchant, null);
  assert.equal(parse.parse('what did I spend at Sable Coffee?', ctx).merchant, 'Sable Coffee');
});

/* ---- ledger ------------------------------------------------------------ */
await db.init();

check('seed ledger reconciles to its balances', () => {
  const posted = queries.postedTransactions();
  assert.ok(posted.length > 100, `expected a populated ledger, saw ${posted.length}`);
  for (const account of db.store.accounts) {
    const rows = posted.filter((t) => t.accountId === account.id);
    const last = rows[rows.length - 1];
    const reconstructed = last ? last.balanceAfterMinor : account.openingBalanceMinor;
    assert.equal(reconstructed, account.balanceMinor, `${account.name} does not reconcile`);
  }
});

check('accounts come back in display order', () => {
  assert.deepEqual(
    db.store.accounts.map((a) => a.id),
    ['acc_checking', 'acc_savings', 'acc_emergency', 'acc_credit'],
  );
});

check('transfer moves money between both accounts', async () => {
  const from = db.accountById('acc_checking').balanceMinor;
  const to = db.accountById('acc_savings').balanceMinor;
  const result = await ledger.transfer({
    fromAccountId: 'acc_checking',
    toAccountId: 'acc_savings',
    amountMinor: 25000,
    ts: OP_TS,
  });
  assert.equal(result.from.balanceMinor, from - 25000);
  assert.equal(result.to.balanceMinor, to + 25000);
});

check('overdraft is rejected with a helpful error', async () => {
  await assert.rejects(
    () => ledger.withdraw({ accountId: 'acc_savings', amountMinor: 99999999, ts: NOW }),
    (err) => err.code === 'insufficient_funds',
  );
});

check('undo restores the previous balances', async () => {
  const snapshot = db.store.accounts.map((a) => a.balanceMinor);
  await ledger.deposit({ accountId: 'acc_checking', amountMinor: 12345, ts: NOW });
  assert.equal(db.accountById('acc_checking').balanceMinor, snapshot[0] + 12345);
  await ledger.undoLast();
  assert.deepEqual(db.store.accounts.map((a) => a.balanceMinor), snapshot);
});

check('card payment clears the outstanding balance', async () => {
  const card = db.store.accounts.find((a) => a.type === 'credit');
  const owed = -card.balanceMinor;
  assert.ok(owed > 0, 'the demo card should start with a balance owed');
  const result = await ledger.payCard({
    cardAccountId: card.id,
    fromAccountId: 'acc_checking',
    amountMinor: owed,
    ts: OP_TS,
  });
  assert.equal(result.card.balanceMinor, 0);
});

/* ---- analytics --------------------------------------------------------- */
check('summaries and breakdowns are internally consistent', () => {
  const range = dates.extractRange('last month', NOW);
  const rows = queries.inRange(range);
  const summary = queries.summarize(rows);
  const spend = queries.spendTransactions(rows).reduce((a, t) => a + t.amountMinor, 0);
  const byCat = queries.byCategory(queries.spendTransactions(rows)).reduce((a, c) => a + c.totalMinor, 0);
  assert.equal(summary.inflowMinor - summary.outflowMinor, summary.netMinor);
  assert.equal(spend, byCat, 'category totals must equal the spend total');
});

check('recurring detection finds the seeded subscriptions', () => {
  const names = queries.recurringCharges().map((r) => r.merchant);
  assert.ok(names.includes('Kestrel Streaming'), `expected Kestrel Streaming in ${names.join(', ')}`);
});

check('balance series ends at the live cash position', () => {
  const now = Date.now();
  const series = queries.balanceSeries(6, now);
  const liquid = queries.totalBalanceAt(now);
  assert.equal(series.length, 6);
  assert.equal(series[series.length - 1].balanceMinor, liquid);
});

/* ---- assistant --------------------------------------------------------- */
check('assistant answers and acts end to end', async () => {
  assert.match((await assistant.handle('what are my balances?', { now: NOW })).text, /accounts hold/i);
  assert.match((await assistant.handle('how much did I spend on dining last month?', { now: NOW })).text, /dining/i);

  const deposit = await assistant.handle('deposit $1,000 into checking', { now: NOW });
  assert.match(deposit.text, /deposited/i);
  assert.ok(deposit.affectsData, 'a deposit should mark the view as changed');

  assert.match((await assistant.handle('undo that', { now: NOW })).text, /undone/i);
  assert.match((await assistant.handle('flurble wurble', { now: NOW })).text, /not sure how to handle/i);
});

check('assistant asks for a missing amount, then accepts it', async () => {
  const ask = await assistant.handle('deposit', { now: NOW });
  assert.match(ask.text, /how much/i);
  assert.ok(ask.pending, 'expected a pending slot-fill');

  const follow = await assistant.handle('$75', { now: NOW, pending: ask.pending });
  assert.match(follow.text, /deposited/i);
});

check('category questions with a time window are answered', async () => {
  const bare = await assistant.handle('what did I spend on shopping', { now: NOW });
  assert.match(bare.text, /shopping/i);
  assert.doesNotMatch(bare.text, /not sure how to handle/i);

  const windowed = await assistant.handle('groceries last week', { now: NOW });
  assert.match(windowed.text, /groceries/i);
  assert.match(windowed.text, /last week/i);
  assert.doesNotMatch(windowed.text, /not sure/i);
});

check('amount filters narrow a transaction listing', async () => {
  const over = await assistant.handle('show me transactions over $100', { now: NOW });
  assert.match(over.text, /over \$100\.00/);
  assert.match(over.text, /over \$100\.00 the last 12 months/);

  // Every returned row must actually exceed the threshold.
  const rows = over.blocks.find((b) => b.type === 'rows').items;
  assert.ok(rows.length > 0, 'expected at least one row');
  assert.ok(rows.every((r) => Math.abs(r.amountMinor) > 10000), 'rows must all exceed $100');

  const under = await assistant.handle('charges under $50', { now: NOW });
  assert.match(under.text, /under \$50\.00/);
  const small = under.blocks.find((b) => b.type === 'rows').items;
  assert.ok(small.every((r) => Math.abs(r.amountMinor) < 5000), 'rows must all be under $50');
});

check('average spend and status queries are understood', async () => {
  const avg = await assistant.handle('what is my average spend', { now: NOW });
  assert.match(avg.text, /averaged \$/i);
  assert.match(avg.text, /a month/i);

  const pending = await assistant.handle('do I have any pending transactions', { now: NOW });
  assert.doesNotMatch(pending.text, /not sure how to handle/i);
  assert.doesNotMatch(pending.text, /matches "pending"/i);
});

check('budget can be set through the assistant and persists', async () => {
  const set = await assistant.handle('set my dining budget to 400', { now: NOW });
  assert.match(set.text, /dining budget to \$400\.00/i);
  assert.ok(set.affectsData);
  assert.equal(db.store.categories.find((c) => c.id === 'dining').budgetMinor, 40000);

  // Follow-up flow: no category given, then no amount.
  const askCat = await assistant.handle('set my budget', { now: NOW });
  assert.match(askCat.text, /which category/i);
  const askAmt = await assistant.handle('dining', { now: NOW, pending: askCat.pending });
  assert.match(askAmt.text, /what should the dining budget be/i);
  const done = await assistant.handle('250', { now: NOW, pending: askAmt.pending });
  assert.match(done.text, /dining budget to \$250\.00/i);
  assert.equal(db.store.categories.find((c) => c.id === 'dining').budgetMinor, 25000);
});

/* ---- report ------------------------------------------------------------ */
await queue;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.message}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
