/**
 * The assistant: turns a parsed utterance into a ledger action or an answer.
 *
 * This is the "brain" of the chat/voice interface. It is deterministic and
 * offline: no model, no API key. Each handler returns a reply object the UI
 * renders as a chat bubble, together with an optional `view` directive that
 * syncs the dashboard to whatever was just discussed.
 */

import { accountById, categoryById, resetSession, store } from '../db/database.js';
import { deposit, payCard, transfer, undoLast, withdraw, LedgerError, canUndo } from '../actions/ledger.js';
import {
  byCategory,
  byMerchant,
  byMonth,
  incomeTransactions,
  inRange,
  keywordMatches,
  merchantMatches,
  postedTransactions,
  recurringCharges,
  runwayMonths,
  spendTransactions,
  summarize,
  averageMonthlySpend,
  lastNMonths,
} from '../actions/queries.js';
import { formatMoney } from '../util/money.js';
import { addDays, endOfDay, formatDate, formatMonth, monthKey, pluralize } from '../util/format.js';
import { MONTH_NAMES } from './lexicon.js';
import { parse } from './parse.js';
import { monthRange, periodRange, PERIOD } from './dates.js';

const MAX_ROWS = 8;

function reply(text, extra = {}) {
  return { role: 'assistant', text, blocks: [], actions: [], view: null, ...extra };
}

function accountLabel(account) {
  return `${account.name} ••${account.number}`;
}

function liquidAccounts() {
  return store.accounts.filter((a) => a.type !== 'credit');
}

function defaultSourceAccount() {
  return accountById('acc_checking') || liquidAccounts()[0] || store.accounts[0];
}

function defaultDestinationAccount(excludeId = null) {
  return (
    liquidAccounts().find((a) => a.id !== excludeId && a.type === 'savings')
    || liquidAccounts().find((a) => a.id !== excludeId)
    || store.accounts.find((a) => a.id !== excludeId)
  );
}

function rowsBlock(transactions, { limit = MAX_ROWS, showAccount = true } = {}) {
  return {
    type: 'rows',
    items: transactions.slice(0, limit).map((t) => ({
      id: t.id,
      label: t.merchant || t.description,
      sub: [
        formatDate(t.ts, { withYear: true }),
        showAccount ? (accountById(t.accountId)?.nickname || '') : '',
        t.status === 'pending' ? 'pending' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      amountMinor: t.direction === 'credit' ? t.amountMinor : -t.amountMinor,
      categoryId: t.category,
      direction: t.direction,
    })),
    total: transactions.length,
  };
}

function kpiBlock(items) {
  return { type: 'kpis', items };
}

function barsBlock(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return {
    type: 'bars',
    items: items.map((i) => ({ ...i, pct: Math.round((i.value / max) * 100) })),
  };
}

function sparkBlock(points) {
  return { type: 'spark', points };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

function handleGreeting(parsed) {
  const name = store.settings.profile?.name?.split(' ')[0] || 'there';
  const total = store.accounts.filter((a) => a.type !== 'credit').reduce((acc, a) => acc + a.balanceMinor, 0);
  const range = periodRange(PERIOD.THIS_MONTH, parsed.now);
  const spent = spendTransactions(inRange(range)).reduce((acc, t) => acc + t.amountMinor, 0);
  return reply(
    `Hi ${name}. You're holding ${formatMoney(total)} across your accounts, and you've spent ${formatMoney(spent)} so far this month.`,
    {
      blocks: [accountOverviewBlock()],
      actions: ['How much did I spend last month?', 'Show recent transactions', 'Am I over budget?'],
      view: { kind: 'overview' },
    },
  );
}

function accountOverviewBlock() {
  return {
    type: 'accounts',
    items: store.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      number: a.number,
      type: a.type,
      balanceMinor: a.balanceMinor,
      color: a.color,
      creditLimitMinor: a.creditLimitMinor || null,
    })),
  };
}

function handleHelp() {
  const examples = [
    'What are my balances?',
    'How much did I spend on dining last month?',
    'Show my recent transactions',
    'Deposit $250 into checking',
    'Transfer $500 from checking to savings',
    'Withdraw $100 from savings',
    'Pay off my credit card',
    'What subscriptions do I have?',
    'Compare this month to last month',
    'Am I over budget?',
    'Undo that',
  ];
  return reply('I can read your local ledger and move money between these accounts. Try one of these:', {
    blocks: [{ type: 'examples', items: examples }],
    actions: examples.slice(0, 4),
    view: null,
  });
}

function handleBalance(parsed) {
  const mentioned = parsed.accountIds.map((id) => accountById(id)).filter(Boolean);
  const targets = mentioned.length ? mentioned : store.accounts;
  const total = targets.filter((a) => a.type !== 'credit').reduce((acc, a) => acc + a.balanceMinor, 0);
  const text = mentioned.length
    ? `${accountLabel(targets[0])} holds ${formatMoney(targets[0].balanceMinor)}.`
    : `Your accounts hold ${formatMoney(total)} in cash.`;

  const blocks = [accountOverviewBlock()];
  if (mentioned.length === 1) {
    const account = targets[0];
    const recent = postedTransactions({ accountId: account.id }).sort((a, b) => b.ts - a.ts).slice(0, 5);
    blocks.push({ type: 'subhead', text: 'Latest activity' }, rowsBlock(recent, { showAccount: false }));
  }

  return reply(text, {
    blocks,
    actions: ['Show all transactions', 'How much did I spend this month?'],
    view: { kind: 'overview', accountId: mentioned.length === 1 ? mentioned[0].id : null },
  });
}

function handleNetWorth() {
  const assets = store.accounts.filter((a) => a.type !== 'credit').reduce((acc, a) => acc + a.balanceMinor, 0);
  const debt = store.accounts.filter((a) => a.type === 'credit').reduce((acc, a) => acc + Math.min(0, a.balanceMinor), 0);
  const net = assets + debt;
  return reply(
    `Net worth is ${formatMoney(net)}: ${formatMoney(assets)} of cash and ${formatMoney(Math.abs(debt))} owed on credit.`,
    {
      blocks: [
        kpiBlock([
          { label: 'Cash', value: formatMoney(assets) },
          { label: 'Card debt', value: formatMoney(Math.abs(debt)) },
          { label: 'Net worth', value: formatMoney(net) },
        ]),
        accountOverviewBlock(),
      ],
      actions: ['Pay off my credit card', 'Show balances'],
      view: { kind: 'overview' },
    },
  );
}

function handleAccountSummary(parsed) {
  const range = parsed.range || periodRange(PERIOD.THIS_MONTH, parsed.now);
  const rows = inRange(range);
  const summary = summarize(rows);
  const spend = spendTransactions(rows);
  const categories = byCategory(spend).slice(0, 5);
  const account = parsed.accountIds.length ? accountById(parsed.accountIds[0]) : null;

  const scope = account ? accountLabel(account) : 'all accounts';
  const text = `Here is your ${range.label} summary for ${scope}: ${pluralize(rows.length, 'transaction')}, ${formatMoney(summary.inflowMinor)} in and ${formatMoney(summary.outflowMinor)} out, for a net of ${formatMoney(summary.netMinor, { signed: true })}.`;

  return reply(text, {
    blocks: [
      kpiBlock([
        { label: 'Money in', value: formatMoney(summary.inflowMinor), tone: 'positive' },
        { label: 'Money out', value: formatMoney(summary.outflowMinor) },
        { label: 'Net', value: formatMoney(summary.netMinor, { signed: true }), tone: summary.netMinor >= 0 ? 'positive' : 'negative' },
        { label: 'Transactions', value: String(summary.count) },
      ]),
      ...(categories.length
        ? [
            { type: 'subhead', text: 'Where it went' },
            barsBlock(categories.map((c) => ({
              label: categoryById(c.categoryId).label,
              value: c.totalMinor,
              display: formatMoney(c.totalMinor),
              color: categoryById(c.categoryId).color,
            }))),
          ]
        : []),
      { type: 'subhead', text: 'Largest movements' },
      rowsBlock([...rows].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 4)),
    ],
    actions: ['Break that down by category', 'Compare to last month', 'Show subscriptions'],
    view: {
      kind: 'transactions',
      accountId: account ? account.id : null,
      range: { start: range.start, end: range.end, label: range.label },
    },
  });
}

function handleSpendSummary(parsed) {
  // A merchant question ("how much at Sable Coffee") is usually about habit,
  // not a single month, so widen the default window to the last year.
  const range = parsed.range || (parsed.merchant ? periodRange(PERIOD.LAST_12_MONTHS, parsed.now) : requestedRange(parsed));
  let rows = inRange(range);
  if (parsed.accountIds.length === 1) rows = rows.filter((t) => t.accountId === parsed.accountIds[0]);
  const spend = spendTransactions(rows);

  if (parsed.merchant) {
    const matched = merchantMatches(spend, parsed.merchant);
    if (matched.length) {
      const total = matched.reduce((acc, t) => acc + t.amountMinor, 0);
      return reply(
        `You spent ${formatMoney(total)} at ${parsed.merchant} across ${pluralize(matched.length, 'charge')} ${range.label}.`,
        {
          blocks: [rowsBlock(matched.sort((a, b) => b.ts - a.ts))],
          actions: ['Show all transactions', 'What are my subscriptions?'],
          view: { kind: 'transactions', range: { start: range.start, end: range.end, label: range.label }, search: parsed.merchant },
        },
      );
    }
  }

  if (parsed.category) {
    const matched = spend.filter((t) => t.category === parsed.category);
    const total = matched.reduce((acc, t) => acc + t.amountMinor, 0);
    const category = categoryById(parsed.category);
    const months = lastNMonths(4, parsed.now).map((m) => ({
      label: formatMonth(m.ts).split(' ')[0],
      value: spendTransactions(inRange({ start: m.start, end: m.end }))
        .filter((t) => t.category === parsed.category)
        .reduce((acc, t) => acc + t.amountMinor, 0),
    }));
    const average = Math.round(months.reduce((acc, m) => acc + m.value, 0) / (months.filter((m) => m.value).length || 1));
    const delta = total - average;

    return reply(
      `You spent ${formatMoney(total)} on ${category.label.toLowerCase()} ${range.label}, across ${pluralize(matched.length, 'charge')}. That's ${formatMoney(Math.abs(delta))} ${delta >= 0 ? 'above' : 'below'} your recent monthly average of ${formatMoney(average)}.`,
      {
        blocks: [
          kpiBlock([
            { label: `${category.label} ${range.label}`, value: formatMoney(total) },
            { label: 'Monthly average', value: formatMoney(average) },
            { label: 'Charges', value: String(matched.length) },
          ]),
          { type: 'subhead', text: 'Last 4 months' },
          barsBlock(months.map((m) => ({ ...m, display: formatMoney(m.value), color: category.color }))),
          { type: 'subhead', text: 'Charges' },
          rowsBlock(matched.sort((a, b) => b.ts - a.ts)),
        ],
        actions: ['Show all spending', 'Am I over budget?', 'Compare to last month'],
        view: {
          kind: 'transactions',
          category: parsed.category,
          range: { start: range.start, end: range.end, label: range.label },
        },
      },
    );
  }

  const total = spend.reduce((acc, t) => acc + t.amountMinor, 0);
  const categories = byCategory(spend);
  const priorRange = previousRangeFor(range, parsed.now);
  const prior = spendTransactions(inRange(priorRange));
  const priorTotal = prior.reduce((acc, t) => acc + t.amountMinor, 0);
  const delta = total - priorTotal;

  return reply(
    `You spent ${formatMoney(total)} ${range.label} across ${pluralize(spend.length, 'charge')}. Top category: ${categories.length ? categoryById(categories[0].categoryId).label.toLowerCase() : 'n/a'}. That is ${formatMoney(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} than ${priorRange.label}.`,
    {
      blocks: [
        kpiBlock([
          { label: `Spent ${range.label}`, value: formatMoney(total) },
          { label: priorRange.label, value: formatMoney(priorTotal) },
          { label: 'Change', value: formatMoney(delta, { signed: true }), tone: delta <= 0 ? 'positive' : 'negative' },
        ]),
        { type: 'subhead', text: 'By category' },
        barsBlock(categories.slice(0, 6).map((c) => ({
          label: categoryById(c.categoryId).label,
          value: c.totalMinor,
          display: formatMoney(c.totalMinor),
          color: categoryById(c.categoryId).color,
        }))),
        { type: 'subhead', text: 'Biggest charges' },
        rowsBlock([...spend].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5)),
      ],
      actions: ['Break that down by category', 'Show subscriptions', 'Compare to last month'],
      view: { kind: 'transactions', range: { start: range.start, end: range.end, label: range.label } },
    },
  );
}

function previousRangeFor(range, now) {
  if (range.label === 'this month') return periodRange(PERIOD.LAST_MONTH, now);
  if (range.label === 'this week') return periodRange(PERIOD.LAST_WEEK, now);
  if (range.label === 'this quarter') return periodRange(PERIOD.LAST_QUARTER, now);
  if (range.label === 'this year') return periodRange(PERIOD.LAST_YEAR, now);
  if (range.label === 'last month') return periodRange('month_before_last', now);
  if (range.label === 'last week') {
    const monday = addDays(range.start, -7);
    return { start: monday, end: endOfDay(addDays(monday, 6)), label: 'the week before' };
  }
  if (range.label === 'last year') return periodRange('year_before_last', now);
  if (range.label === 'yesterday') {
    const y = addDays(range.start, -1);
    return { start: y, end: endOfDay(y), label: 'the day before' };
  }
  if (/^[A-Z][a-z]+ \d{4}$/.test(range.label)) {
    const [monthName, year] = range.label.split(' ');
    const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
    return monthRange(Number(year), monthIndex - 1);
  }
  const length = range.end - range.start;
  return { start: range.start - length - 1, end: range.start - 1, label: `the previous period` };
}

/**
 * Spend/income questions default to the last complete month: comparing a
 * part-finished month against a full one is misleading, so we only use the
 * current month when the user explicitly asked for it.
 */
function completedMonthRange(now) {
  return periodRange(PERIOD.LAST_MONTH, now);
}

function requestedRange(parsed) {
  if (parsed.range) return parsed.range;
  return completedMonthRange(parsed.now);
}

function handleIncomeSummary(parsed) {
  const range = requestedRange(parsed);
  const rows = inRange(range);
  const income = incomeTransactions(rows);
  const total = income.reduce((acc, t) => acc + t.amountMinor, 0);
  const sources = byMerchant(income).slice(0, 5);
  const months = lastNMonths(4, parsed.now).map((m) => ({
    label: formatMonth(m.ts).split(' ')[0],
    value: incomeTransactions(inRange({ start: m.start, end: m.end })).reduce((acc, t) => acc + t.amountMinor, 0),
  }));

  return reply(
    `You brought in ${formatMoney(total)} ${range.label} from ${pluralize(sources.length, 'source')}.`,
    {
      blocks: [
        kpiBlock([
          { label: `Income ${range.label}`, value: formatMoney(total) },
          { label: 'Deposits', value: String(income.length) },
          { label: 'Top source', value: sources[0] ? sources[0].merchant : '—' },
        ]),
        { type: 'subhead', text: 'Last 4 months' },
        barsBlock(months.map((m) => ({ ...m, display: formatMoney(m.value), color: '#1f7a5a' }))),
        { type: 'subhead', text: 'Deposits' },
        rowsBlock(income.sort((a, b) => b.ts - a.ts)),
      ],
      actions: ['What is my net cash flow?', 'How much did I spend this month?'],
      view: { kind: 'transactions', range: { start: range.start, end: range.end, label: range.label }, direction: 'credit' },
    },
  );
}

function handleCashflow(parsed) {
  const months = lastNMonths(6, parsed.now).map((m) => {
    const rows = inRange({ start: m.start, end: m.end });
    const s = summarize(rows);
    return { label: formatMonth(m.ts).split(' ')[0], inflowMinor: s.inflowMinor, outflowMinor: s.outflowMinor, netMinor: s.netMinor, key: m.key };
  });
  const latest = months[months.length - 1];
  const run = latest.netMinor >= 0 ? 'positive' : 'negative';

  return reply(
    `Net cash flow was ${formatMoney(latest.netMinor, { signed: true })} in ${formatMonth(parsed.now)} — ${run}. Over the last six months you averaged ${formatMoney(Math.round(months.reduce((a, m) => a + m.netMinor, 0) / months.length), { signed: true })} per month.`,
    {
      blocks: [
        kpiBlock([
          { label: 'In', value: formatMoney(latest.inflowMinor), tone: 'positive' },
          { label: 'Out', value: formatMoney(latest.outflowMinor) },
          { label: 'Net', value: formatMoney(latest.netMinor, { signed: true }), tone: latest.netMinor >= 0 ? 'positive' : 'negative' },
        ]),
        { type: 'subhead', text: 'Six-month trend' },
        {
          type: 'flow',
          items: months.map((m) => ({ label: m.label, inMinor: m.inflowMinor, outMinor: m.outflowMinor, netMinor: m.netMinor })),
        },
      ],
      actions: ['Compare this month to last month', 'Am I over budget?'],
      view: { kind: 'trend', months: months.map((m) => m.key) },
    },
  );
}

function handleBudget(parsed) {
  const range = parsed.range || periodRange(PERIOD.THIS_MONTH, parsed.now);
  const rows = spendTransactions(inRange(range));
  const items = byCategory(rows)
    .filter((c) => categoryById(c.categoryId).budgetMinor)
    .map((c) => {
      const def = categoryById(c.categoryId);
      const pct = Math.round((c.totalMinor / def.budgetMinor) * 100);
      return { ...c, def, pct };
    })
    .sort((a, b) => b.pct - a.pct);

  if (!items.length) {
    return reply(`Nothing budgeted has been charged ${range.label} yet.`, { view: { kind: 'budget' } });
  }

  const over = items.filter((i) => i.pct > 100);
  const lead = items[0];
  const when = range.label === 'this month' ? 'month to date' : range.label;
  const text = over.length
    ? `${pluralize(over.length, 'category', 'categories')} over budget ${when}: ${over.map((o) => `${o.def.label} at ${o.pct}%`).join(', ')}.`
    : `You're inside budget in every tracked category ${when}. Closest to the line: ${lead.def.label} at ${lead.pct}% of ${formatMoney(lead.def.budgetMinor)}.`;

  return reply(text, {
    blocks: [
      {
        type: 'budget',
        items: items.map((i) => ({
          label: i.def.label,
          spentMinor: i.totalMinor,
          budgetMinor: i.def.budgetMinor,
          pct: i.pct,
          color: i.def.color,
        })),
      },
    ],
    actions: ['Show subscriptions', 'How much did I spend this month?'],
    view: { kind: 'budget', range: { start: range.start, end: range.end, label: range.label } },
  });
}

function handleCompare(parsed) {
  const now = parsed.now;
  const thisRange = periodRange(PERIOD.THIS_MONTH, now);
  const lastRange = periodRange(PERIOD.LAST_MONTH, now);
  const thisRows = inRange(thisRange);
  const lastRows = inRange(lastRange);
  const thisSpend = spendTransactions(thisRows).reduce((a, t) => a + t.amountMinor, 0);
  const lastSpend = spendTransactions(lastRows).reduce((a, t) => a + t.amountMinor, 0);
  const delta = thisSpend - lastSpend;
  const pct = lastSpend ? Math.round((delta / lastSpend) * 100) : 0;

  const thisCats = Object.fromEntries(byCategory(spendTransactions(thisRows)).map((c) => [c.categoryId, c.totalMinor]));
  const lastCats = Object.fromEntries(byCategory(spendTransactions(lastRows)).map((c) => [c.categoryId, c.totalMinor]));
  const movers = [...new Set([...Object.keys(thisCats), ...Object.keys(lastCats)])]
    .map((id) => ({ id, delta: (thisCats[id] || 0) - (lastCats[id] || 0), this: thisCats[id] || 0, last: lastCats[id] || 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  return reply(
    `You've spent ${formatMoney(thisSpend)} so far this month versus ${formatMoney(lastSpend)} in the whole of last month — that's ${formatMoney(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} (${pct >= 0 ? '+' : ''}${pct}%).`,
    {
      blocks: [
        kpiBlock([
          { label: 'This month', value: formatMoney(thisSpend) },
          { label: 'Last month', value: formatMoney(lastSpend) },
          { label: 'Change', value: `${pct >= 0 ? '+' : ''}${pct}%`, tone: delta <= 0 ? 'positive' : 'negative' },
        ]),
        { type: 'subhead', text: 'Biggest movers' },
        {
          type: 'delta',
          items: movers.map((m) => ({
            label: categoryById(m.id).label,
            deltaMinor: m.delta,
            thisMinor: m.this,
            lastMinor: m.last,
            color: categoryById(m.id).color,
          })),
        },
      ],
      actions: ['Show this month by category', 'Am I over budget?'],
      view: { kind: 'trend' },
    },
  );
}

function handleListTransactions(parsed) {
  const range = parsed.range || periodRange(PERIOD.THIS_MONTH, parsed.now);
  let rows = inRange(range);
  if (parsed.accountIds.length === 1) rows = rows.filter((t) => t.accountId === parsed.accountIds[0]);
  if (parsed.category) rows = rows.filter((t) => t.category === parsed.category);
  if (parsed.merchant) rows = merchantMatches(rows, parsed.merchant);

  rows.sort((a, b) => b.ts - a.ts);
  const total = rows.reduce((acc, t) => acc + (t.direction === 'credit' ? t.amountMinor : -t.amountMinor), 0);

  if (!rows.length) {
    return reply(`I don't see any transactions matching that ${range.label}.`, {
      actions: ['Show all transactions', 'Show last month'],
      view: { kind: 'transactions', range: { start: range.start, end: range.end, label: range.label } },
    });
  }

  return reply(
    `${pluralize(rows.length, 'transaction')} ${range.label}, worth ${formatMoney(total, { signed: true })} net. Showing the most recent ${Math.min(rows.length, MAX_ROWS)}.`,
    {
      blocks: [rowsBlock(rows), rows.length > MAX_ROWS ? { type: 'note', text: `+ ${rows.length - MAX_ROWS} more in the ledger below.` } : null].filter(Boolean),
      actions: ['Search for a merchant', 'How much did I spend?'],
      view: {
        kind: 'transactions',
        accountId: parsed.accountIds.length === 1 ? parsed.accountIds[0] : null,
        category: parsed.category || null,
        range: { start: range.start, end: range.end, label: range.label },
      },
    },
  );
}

function handleSearch(parsed) {
  const range = parsed.range || periodRange(PERIOD.LAST_12_MONTHS, parsed.now);
  const scope = inRange(range);
  const terms = [];
  if (parsed.merchant) terms.push(parsed.merchant);
  terms.push(...parsed.keywords);

  let rows = terms.length ? keywordMatches(scope, terms) : [];
  if (!rows.length && parsed.category) rows = scope.filter((t) => t.category === parsed.category);
  rows.sort((a, b) => b.ts - a.ts);

  const query = parsed.merchant || parsed.keywords.join(', ');
  if (!rows.length) {
    return reply(
      `Nothing in the ledger matches "${query}". Try a merchant like "Sable Coffee" or a category like "dining".`,
      { actions: ['Show recent transactions', 'Show subscriptions'] },
    );
  }

  const spend = rows.filter((t) => t.direction === 'debit');
  const total = spend.reduce((acc, t) => acc + t.amountMinor, 0);
  return reply(
    `Found ${pluralize(rows.length, 'match', 'matches')} for "${query}" in ${range.label} totalling ${formatMoney(total)}.`,
    {
      blocks: [rowsBlock(rows)],
      actions: ['Show all transactions'],
      view: { kind: 'transactions', search: query, range: { start: range.start, end: range.end, label: range.label } },
    },
  );
}

function handleLargest(parsed) {
  const range = requestedRange(parsed);
  const rows = spendTransactions(inRange(range));
  if (!rows.length) return reply(`No spending ${range.label}.`, {});
  const top = [...rows].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5);
  const biggest = top[0];
  return reply(
    `Your biggest charge ${range.label} was ${formatMoney(biggest.amountMinor)} at ${biggest.merchant} on ${formatDate(biggest.ts, { withYear: true })}.`,
    {
      blocks: [{ type: 'subhead', text: 'Top 5 charges' }, rowsBlock(top)],
      actions: ['Show all transactions', 'What are my subscriptions?'],
      view: { kind: 'transactions', range: { start: range.start, end: range.end, label: range.label } },
    },
  );
}

function handleRecurring(parsed = {}) {
  const onlySubscriptions = parsed.category === 'subscriptions';
  const recurring = recurringCharges().filter((r) =>
    onlySubscriptions ? r.category === 'subscriptions' : r.category === 'subscriptions' || r.steady,
  );
  if (!recurring.length) return reply('I could not find any repeating charges yet.', {});
  const total = recurring.reduce((acc, r) => acc + r.averageMinor, 0);
  const noun = onlySubscriptions ? 'subscription' : 'recurring charge';
  return reply(
    `I found ${pluralize(recurring.length, noun)} totalling about ${formatMoney(total)} a month.`,
    {
      blocks: [
        kpiBlock([
          { label: 'Recurring', value: String(recurring.length) },
          { label: 'Monthly cost', value: formatMoney(total) },
          { label: 'Annualised', value: formatMoney(total * 12) },
        ]),
        {
          type: 'recurring',
          items: recurring.map((r) => ({
            merchant: r.merchant,
            averageMinor: r.averageMinor,
            months: r.months,
            cadence: r.cadence,
            categoryId: r.category,
            lastCharged: r.lastCharged,
          })),
        },
      ],
      actions: onlySubscriptions ? ['Show recent transactions'] : ['What subscriptions do I have?', 'Show recent transactions'],
      view: { kind: 'recurring' },
    },
  );
}

/* ---- money movement ---------------------------------------------------- */

function handleDeposit(parsed) {
  const account = parsed.accountIds.length
    ? accountById(parsed.accountIds[0])
    : defaultSourceAccount();

  if (!account) return reply('I could not find an account to deposit into.', {});
  if (!parsed.amountMinor) {
    return reply(`How much would you like to deposit into ${account.name}?`, {
      actions: ['Deposit $100', 'Deposit $500', 'Deposit $1000'],
      pending: { kind: 'deposit', accountId: account.id },
    });
  }
  return runAction(() => deposit({ accountId: account.id, amountMinor: parsed.amountMinor }), parsed, {
    successText: (res) =>
      `Deposited ${formatMoney(res.tx.amountMinor)} into ${res.account.name}. New balance: ${formatMoney(res.account.balanceMinor)}.`,
    accountId: account.id,
  });
}

function handleWithdraw(parsed) {
  const account = parsed.accountIds.length ? accountById(parsed.accountIds[0]) : defaultSourceAccount();
  if (!account) return reply('I could not find an account to withdraw from.', {});
  if (!parsed.amountMinor) {
    return reply(`How much would you like to withdraw from ${account.name}?`, {
      actions: ['Withdraw $50', 'Withdraw $100', 'Withdraw $200'],
      pending: { kind: 'withdraw', accountId: account.id },
    });
  }
  return runAction(() => withdraw({ accountId: account.id, amountMinor: parsed.amountMinor }), parsed, {
    successText: (res) =>
      `Withdrew ${formatMoney(res.tx.amountMinor)} from ${res.account.name}. New balance: ${formatMoney(res.account.balanceMinor)}.`,
    accountId: account.id,
  });
}

function handleTransfer(parsed) {
  let from = parsed.fromAccountId ? accountById(parsed.fromAccountId) : null;
  let to = parsed.toAccountId ? accountById(parsed.toAccountId) : null;

  if (!from && !to && parsed.accountIds.length === 1) {
    to = accountById(parsed.accountIds[0]);
  }
  if (from && !to) to = defaultDestinationAccount(from.id);
  if (to && !from) from = liquidAccounts().find((a) => a.id !== to.id) || defaultSourceAccount();
  if (!from) from = defaultSourceAccount();
  if (!to) to = defaultDestinationAccount(from.id);

  if (!from || !to) return reply('I could not work out which accounts to move money between.', {});
  if (from.id === to.id) return reply('Those are the same account — which one should the money leave?', {});

  if (!parsed.amountMinor) {
    return reply(`How much would you like to move from ${from.name} to ${to.name}?`, {
      actions: ['Transfer $100', 'Transfer $250', 'Transfer $500'],
      pending: { kind: 'transfer', fromAccountId: from.id, toAccountId: to.id },
    });
  }

  return runAction(
    () => transfer({ fromAccountId: from.id, toAccountId: to.id, amountMinor: parsed.amountMinor }),
    parsed,
    {
      successText: (res) =>
        `Moved ${formatMoney(res.tx.amountMinor)} from ${res.from.name} to ${res.to.name}. ${res.from.name}: ${formatMoney(res.from.balanceMinor)} · ${res.to.name}: ${formatMoney(res.to.balanceMinor)}.`,
      accountId: from.id,
    },
  );
}

function handlePayCard(parsed) {
  const card = store.accounts.find((a) => a.type === 'credit');
  if (!card) return reply('You do not have a credit account here.', {});
  const owed = Math.max(0, -card.balanceMinor);
  if (owed === 0) return reply(`${card.name} is already paid off.`, {});
  const from = parsed.fromAccountId ? accountById(parsed.fromAccountId) : defaultSourceAccount();
  if (!from || from.id === card.id) return reply('Which account should the payment come from?', {});

  const amount = parsed.amountMinor ? Math.min(parsed.amountMinor, owed) : owed;
  return runAction(() => payCard({ cardAccountId: card.id, fromAccountId: from.id, amountMinor: amount }), parsed, {
    successText: (res) =>
      `Paid ${formatMoney(res.tx.amountMinor)} to ${res.card.name} from ${res.from.name}. Card balance is now ${formatMoney(res.card.balanceMinor)}.`,
    accountId: card.id,
  });
}

async function runAction(fn, parsed, { successText }) {
  try {
    const result = await fn();
    return reply(successText(result), {
      tone: 'success',
      receipt: {
        kind: result.kind,
        amountMinor: result.tx.amountMinor,
        ts: result.tx.ts,
        accountId: result.tx.accountId,
      },
      actions: ['Undo that', 'Show recent transactions', 'What are my balances?'],
      view: { kind: 'overview' },
      affectsData: true,
    });
  } catch (err) {
    if (err instanceof LedgerError) {
      return reply(err.message, {
        tone: 'warning',
        actions: ['What are my balances?', 'Show recent transactions'],
      });
    }
    console.error(err);
    return reply('Something went wrong while posting that entry. Nothing was changed.', { tone: 'warning' });
  }
}

async function handleUndo() {
  if (!canUndo()) return reply('There is nothing to undo in this session.', {});
  try {
    const action = await undoLast();
    return reply(`Undone: ${action.label}. The ledger is back to how it was.`, {
      tone: 'success',
      actions: ['Show recent transactions', 'What are my balances?'],
      view: { kind: 'overview' },
      affectsData: true,
    });
  } catch (err) {
    return reply(err.message || 'I could not undo that.', { tone: 'warning' });
  }
}

async function handleReset() {
  await resetSession();
  return reply('Fresh session created — the demo ledger has been regenerated from scratch.', {
    tone: 'success',
    actions: ['What are my balances?', 'How much did I spend this month?'],
    view: { kind: 'overview' },
    affectsData: true,
  });
}

function handleUnknown(parsed) {
  const suggestions = [
    'What are my balances?',
    'How much did I spend last month?',
    'Show recent transactions',
    'Transfer $200 to savings',
  ];
  return reply(
    `I'm not sure how to handle "${parsed.raw}". I can read balances, summarise spending and income, search transactions, and deposit, withdraw or transfer money.`,
    { blocks: [{ type: 'examples', items: suggestions }], actions: suggestions, view: null },
  );
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

const HANDLERS = {
  greeting: handleGreeting,
  help: handleHelp,
  thanks: (parsed) =>
    reply('Anytime. Ask me for a balance, a summary, or to move money whenever you like.', {
      actions: ['What are my balances?', 'Show recent transactions'],
    }),
  balance: handleBalance,
  net_worth: handleNetWorth,
  account_summary: handleAccountSummary,
  spend_summary: handleSpendSummary,
  income_summary: handleIncomeSummary,
  cashflow: handleCashflow,
  budget_status: handleBudget,
  compare_months: handleCompare,
  list_transactions: handleListTransactions,
  search_transactions: handleSearch,
  largest_expense: handleLargest,
  recurring: handleRecurring,
  deposit: handleDeposit,
  withdraw: handleWithdraw,
  transfer: handleTransfer,
  pay_card: handlePayCard,
  undo: handleUndo,
  reset: handleReset,
};

/** Resolve a short follow-up like "$250" or "savings" using the pending action. */
function mergePending(parsed, pending) {
  if (!pending) return parsed;
  const merged = { ...parsed };
  if (!merged.amountMinor && parsed.amountMinor) merged.amountMinor = parsed.amountMinor;
  if (pending.accountId && !merged.accountIds.length) merged.accountIds = [pending.accountId];
  if (pending.fromAccountId) merged.fromAccountId = parsed.fromAccountId || pending.fromAccountId;
  if (pending.toAccountId) merged.toAccountId = parsed.toAccountId || pending.toAccountId;
  if (parsed.accountIds.length && pending.kind === 'transfer') {
    const mentioned = parsed.accountIds[0];
    if (mentioned !== pending.fromAccountId) merged.toAccountId = mentioned;
  }
  return merged;
}

/**
 * Handle one user turn.
 * @param {string} text
 * @param {{pending?: object, now?: number}} [opts]
 * @returns {Promise<object>} reply object
 */
export async function handle(text, opts = {}) {
  const now = opts.now ?? Date.now();
  const parsed = parse(text, { accounts: store.accounts, categories: store.categories, now });

  // A pending slot-filling question is resolved before anything else.
  if (opts.pending && parsed.intent !== 'undo' && parsed.intent !== 'reset') {
    const merged = mergePending(parsed, opts.pending);
    const stillMissing = !merged.amountMinor;
    if (!stillMissing) {
      const handler = HANDLERS[opts.pending.kind];
      const result = await handler({ ...merged, intent: opts.pending.kind });
      return { ...result, parsed: merged, resolvedPending: true };
    }
  }

  const handler = HANDLERS[parsed.intent] || handleUnknown;
  const result = await handler(parsed);
  return { ...result, parsed };
}

export { monthKey, averageMonthlySpend, runwayMonths };
