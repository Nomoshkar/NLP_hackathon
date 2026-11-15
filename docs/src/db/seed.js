/**
 * Demo data generation.
 *
 * Everything here is synthetic. A fixed PRNG seed means the same ledger is
 * produced on every machine, which keeps screenshots and tests stable.
 */

import { addDays, uid } from '../util/format.js';

export const CATEGORY_DEFS = [
  { id: 'income', label: 'Income', kind: 'income', color: '#1f7a5a', icon: '↓' },
  { id: 'housing', label: 'Housing', kind: 'expense', color: '#8c5a3c', icon: '⌂', budgetMinor: 195000 },
  { id: 'groceries', label: 'Groceries', kind: 'expense', color: '#4c7a3f', icon: '❋', budgetMinor: 68000 },
  { id: 'dining', label: 'Dining', kind: 'expense', color: '#b3762a', icon: '☕', budgetMinor: 32000 },
  { id: 'transport', label: 'Transport', kind: 'expense', color: '#3a6ea5', icon: '⇄', budgetMinor: 24000 },
  { id: 'utilities', label: 'Utilities', kind: 'expense', color: '#5c6b8a', icon: '⚡', budgetMinor: 22000 },
  { id: 'subscriptions', label: 'Subscriptions', kind: 'expense', color: '#8a5c9e', icon: '◈', budgetMinor: 8000 },
  { id: 'health', label: 'Health', kind: 'expense', color: '#a8555f', icon: '✚', budgetMinor: 15000 },
  { id: 'shopping', label: 'Shopping', kind: 'expense', color: '#c08a2e', icon: '◧', budgetMinor: 26000 },
  { id: 'travel', label: 'Travel', kind: 'expense', color: '#2f7f8a', icon: '✈', budgetMinor: 40000 },
  { id: 'fees', label: 'Fees & interest', kind: 'expense', color: '#6b6b6b', icon: '%', budgetMinor: 5000 },
  { id: 'transfer', label: 'Transfers', kind: 'transfer', color: '#4a5568', icon: '⇆' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORY_DEFS.map((c) => [c.id, c]));

const MERCHANTS = {
  groceries: ['Verdant Market', 'Corner Grocer', 'Marrow & Sons', 'Tidepool Co-op'],
  dining: ['Sable Coffee', 'Noodle Bar Nine', 'Fable Bakery', 'The Copper Kettle'],
  transport: ['Metro Transit', 'Lyra Rideshare', 'Halcyon Fuel', 'Parkway Garage'],
  shopping: ['Paper Lantern Goods', 'Atlas Outfitters', 'Mono Supply'],
  health: ['Meadow Lane Clinic', 'Northside Pharmacy'],
  travel: ['Harbor Air', 'Bellwether Hotels'],
};

export const DEMO_ACCOUNTS = [
  {
    id: 'acc_checking',
    sortOrder: 0,
    name: 'Everyday Checking',
    nickname: 'Everyday',
    type: 'checking',
    number: '4821',
    routing: '021000021',
    currency: 'USD',
    apy: 0.01,
    color: '#1f4d3d',
    aliases: ['checking', 'current', 'main', 'everyday'],
  },
  {
    id: 'acc_savings',
    sortOrder: 1,
    name: 'High-Yield Savings',
    nickname: 'High-Yield',
    type: 'savings',
    number: '8831',
    routing: '021000021',
    currency: 'USD',
    apy: 4.35,
    color: '#2f6f8f',
    aliases: ['savings', 'high yield', 'high-yield', 'hys'],
  },
  {
    id: 'acc_emergency',
    sortOrder: 2,
    name: 'Rainy Day Savings',
    nickname: 'Rainy Day',
    type: 'savings',
    number: '4410',
    routing: '021000021',
    currency: 'USD',
    apy: 3.9,
    color: '#7a6a2f',
    aliases: ['rainy day', 'emergency', 'emergency fund'],
  },
  {
    id: 'acc_credit',
    sortOrder: 3,
    name: 'Meridian Rewards Card',
    nickname: 'Rewards Card',
    type: 'credit',
    number: '2019',
    routing: null,
    currency: 'USD',
    apy: 19.99,
    creditLimitMinor: 600000,
    color: '#6a2f3c',
    aliases: ['credit', 'credit card', 'card', 'rewards card', 'rewards'],
  },
];

/** Closing balances the generator aims for; opening balances are derived. */
const TARGET_BALANCES = {
  acc_checking: 512340,
  acc_savings: 1842000,
  acc_emergency: 725000,
  acc_credit: -68420,
};

/** mulberry32: small, fast, seedable PRNG. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

function between(random, min, max) {
  return Math.round(min + random() * (max - min));
}

/**
 * Build the full synthetic ledger.
 * @param {{now?: number, months?: number}} [opts]
 */
export function buildSeedData(opts = {}) {
  const now = opts.now ?? Date.now();
  const months = opts.months ?? 8;
  const random = makeRandom(20240611);

  const accounts = DEMO_ACCOUNTS.map((a) => ({
    ...a,
    balanceMinor: 0,
    openingBalanceMinor: 0,
    openedAt: addDays(now, -1 * between(random, 400, 1500)),
    status: 'open',
  }));

  const transactions = [];
  const push = (tx) =>
    transactions.push({ status: 'posted', channel: 'card', note: '', tags: [], ...tx, id: uid('tx') });

  const start = new Date(now);
  start.setDate(1);
  start.setHours(9, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  let previousCardSpend = 28400;

  for (let m = 0; m < months; m += 1) {
    const monthStart = new Date(start);
    monthStart.setMonth(start.getMonth() + m);
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const isCurrentMonth = m === months - 1;
    const lastDay = isCurrentMonth ? new Date(now).getDate() : daysInMonth;
    let cardSpendThisMonth = 0;

    const at = (day, hour = between(random, 7, 21), minute = between(random, 0, 59)) => {
      const d = new Date(monthStart);
      d.setDate(Math.min(Math.max(day, 1), daysInMonth));
      d.setHours(hour, minute, 0, 0);
      return Math.min(d.getTime(), now - 60000);
    };

    for (const day of [1, 15]) {
      if (day > lastDay) continue;
      push({
        accountId: 'acc_checking',
        ts: at(day, 6, 5),
        direction: 'credit',
        amountMinor: 324500 + between(random, -2000, 2000),
        description: 'Payroll deposit — Nomoshkar Labs',
        merchant: 'Nomoshkar Labs',
        category: 'income',
        channel: 'ach',
      });
    }

    push({
      accountId: 'acc_checking',
      ts: at(2, 8, 0),
      direction: 'debit',
      amountMinor: 185000,
      description: 'Rent — Harborview Apartments',
      merchant: 'Harborview Apartments',
      category: 'housing',
      channel: 'ach',
    });
    push({
      accountId: 'acc_checking',
      ts: at(6, 9, 30),
      direction: 'debit',
      amountMinor: between(random, 8200, 16800),
      description: 'Electricity — Cityline Power',
      merchant: 'Cityline Power',
      category: 'utilities',
      channel: 'ach',
    });
    push({
      accountId: 'acc_checking',
      ts: at(7, 10, 15),
      direction: 'debit',
      amountMinor: between(random, 3400, 6200),
      description: 'Internet — Fibrewave',
      merchant: 'Fibrewave Internet',
      category: 'utilities',
      channel: 'ach',
    });

    for (const [merchant, amountMinor] of [
      ['Kestrel Streaming', 1599],
      ['Pulse Music', 1099],
      ['Draftbox Cloud', 1200],
    ]) {
      cardSpendThisMonth += amountMinor;
      push({
        accountId: 'acc_credit',
        ts: at(between(random, 3, 9), 11, 0),
        direction: 'debit',
        amountMinor,
        description: `Subscription — ${merchant}`,
        merchant,
        category: 'subscriptions',
        channel: 'card',
      });
    }

    const variable = [
      ['groceries', 6, 12800],
      ['dining', 8, 6400],
      ['transport', 6, 4200],
      ['shopping', 4, 14500],
      ['health', 1, 11000],
    ];
    for (const [category, count, spread] of variable) {
      for (let i = 0; i < count; i += 1) {
        const accountId = random() > 0.45 ? 'acc_credit' : 'acc_checking';
        const amountMinor = between(random, Math.round(spread * 0.35), spread);
        const merchant = pick(random, MERCHANTS[category]);
        if (accountId === 'acc_credit') cardSpendThisMonth += amountMinor;
        push({
          accountId,
          ts: at(between(random, 1, lastDay)),
          direction: 'debit',
          amountMinor,
          description: merchant,
          merchant,
          category,
          channel: 'card',
        });
      }
    }

    if (random() > 0.6) {
      const merchant = pick(random, MERCHANTS.travel);
      const amountMinor = between(random, 18000, 96000);
      cardSpendThisMonth += amountMinor;
      push({
        accountId: 'acc_credit',
        ts: at(between(random, 5, 24), 14, 20),
        direction: 'debit',
        amountMinor,
        description: merchant,
        merchant,
        category: 'travel',
        channel: 'card',
      });
    }

    const cardPayment = previousCardSpend;
    previousCardSpend = cardSpendThisMonth;
    const payDay = Math.min(27, lastDay);
    push({
      accountId: 'acc_checking',
      ts: at(payDay, 9, 0),
      direction: 'debit',
      amountMinor: cardPayment,
      description: 'Payment to Meridian Rewards Card',
      merchant: 'Meridian Rewards Card',
      category: 'transfer',
      channel: 'transfer',
      counterpartyAccountId: 'acc_credit',
    });
    push({
      accountId: 'acc_credit',
      ts: at(payDay, 9, 0),
      direction: 'credit',
      amountMinor: cardPayment,
      description: 'Payment received — thank you',
      merchant: 'Everyday Checking',
      category: 'transfer',
      channel: 'transfer',
      counterpartyAccountId: 'acc_checking',
    });

    push({
      accountId: 'acc_savings',
      ts: at(3, 7, 45),
      direction: 'credit',
      amountMinor: 50000,
      description: 'Transfer from Everyday Checking',
      merchant: 'Everyday Checking',
      category: 'transfer',
      channel: 'transfer',
      counterpartyAccountId: 'acc_checking',
    });
    push({
      accountId: 'acc_checking',
      ts: at(3, 7, 45),
      direction: 'debit',
      amountMinor: 50000,
      description: 'Transfer to High-Yield Savings',
      merchant: 'High-Yield Savings',
      category: 'transfer',
      channel: 'transfer',
      counterpartyAccountId: 'acc_savings',
    });

    const interestDay = Math.min(28, lastDay);
    push({
      accountId: 'acc_savings',
      ts: at(interestDay, 5, 0),
      direction: 'credit',
      amountMinor: between(random, 5100, 7200),
      description: 'Interest posted',
      merchant: 'Meridian Bank',
      category: 'income',
      channel: 'interest',
    });
    push({
      accountId: 'acc_emergency',
      ts: at(interestDay, 5, 0),
      direction: 'credit',
      amountMinor: between(random, 1900, 3100),
      description: 'Interest posted',
      merchant: 'Meridian Bank',
      category: 'income',
      channel: 'interest',
    });

    if (random() > 0.7) {
      push({
        accountId: 'acc_checking',
        ts: at(between(random, 10, 26), 18, 5),
        direction: 'debit',
        amountMinor: between(random, 4000, 20000),
        description: 'ATM withdrawal',
        merchant: 'Meridian ATM',
        category: 'fees',
        channel: 'atm',
      });
    }
  }

  transactions.push(
    {
      id: uid('tx'),
      accountId: 'acc_credit',
      ts: now - 3 * 3600000,
      direction: 'debit',
      amountMinor: 2840,
      description: 'Sable Coffee',
      merchant: 'Sable Coffee',
      category: 'dining',
      channel: 'card',
      status: 'pending',
      note: '',
      tags: [],
    },
    {
      id: uid('tx'),
      accountId: 'acc_checking',
      ts: now - 26 * 3600000,
      direction: 'debit',
      amountMinor: 12750,
      description: 'Atlas Outfitters',
      merchant: 'Atlas Outfitters',
      category: 'shopping',
      channel: 'card',
      status: 'pending',
      note: '',
      tags: [],
    },
  );

  transactions.sort((a, b) => a.ts - b.ts);

  const net = {};
  for (const tx of transactions) {
    if (tx.status !== 'posted') continue;
    net[tx.accountId] = (net[tx.accountId] ?? 0) + (tx.direction === 'credit' ? tx.amountMinor : -tx.amountMinor);
  }
  for (const account of accounts) {
    account.openingBalanceMinor = (TARGET_BALANCES[account.id] ?? 0) - (net[account.id] ?? 0);
  }

  const running = Object.fromEntries(accounts.map((a) => [a.id, a.openingBalanceMinor]));
  for (const tx of transactions) {
    if (tx.status !== 'posted') {
      tx.balanceAfterMinor = null;
      continue;
    }
    running[tx.accountId] += tx.direction === 'credit' ? tx.amountMinor : -tx.amountMinor;
    tx.balanceAfterMinor = running[tx.accountId];
  }
  for (const account of accounts) {
    account.balanceMinor = running[account.id];
  }

  return {
    accounts,
    transactions,
    categories: CATEGORY_DEFS.map((c) => ({ ...c })),
  };
}

export function buildSettings(now = Date.now()) {
  return [
    {
      key: 'profile',
      value: { name: 'Avery Nomoshkar', email: 'avery@example.com', memberSince: addDays(now, -1600) },
    },
    { key: 'preferences', value: { currency: 'USD', hideBalances: false } },
    { key: 'schemaVersion', value: 1 },
  ];
}
