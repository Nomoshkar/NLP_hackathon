/**
 * Ledger mutations: deposit, withdraw, transfer and card payment.
 *
 * Every mutation posts balanced double-entry style rows (one per affected
 * account), updates the cached snapshot, persists to IndexedDB and pushes an
 * undo token so the assistant can reverse the last action.
 */

import {
  accountById,
  persistAccounts,
  persistTransactions,
  store,
} from '../db/database.js';
import { formatMoney } from '../util/money.js';
import { uid } from '../util/format.js';

const undoStack = [];

export class LedgerError extends Error {
  constructor(message, code = 'ledger_error') {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export function canUndo() {
  return undoStack.length > 0;
}

export function undoDepth() {
  return undoStack.length;
}

function requireAccount(accountId) {
  const account = accountById(accountId);
  if (!account) throw new LedgerError('I could not find that account.', 'no_account');
  if (account.status !== 'open') throw new LedgerError(`${account.name} is not open.`, 'closed_account');
  return account;
}

function requireAmount(amountMinor) {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new LedgerError('I need a positive amount to do that.', 'bad_amount');
  }
  return Math.round(amountMinor);
}

function applyToBalance(account, direction, amountMinor) {
  account.balanceMinor += direction === 'credit' ? amountMinor : -amountMinor;
}

function makeTx({ accountId, ts, direction, amountMinor, description, merchant, category, channel, status, counterpartyAccountId }) {
  return {
    id: uid('tx'),
    accountId,
    ts,
    direction,
    amountMinor,
    description,
    merchant: merchant || description,
    category: category || 'transfer',
    channel: channel || 'transfer',
    status: status || 'posted',
    counterpartyAccountId: counterpartyAccountId || null,
    note: '',
    tags: [],
    balanceAfterMinor: null,
  };
}

async function commit(txs, accounts, action) {
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  for (const tx of txs) {
    if (tx.status !== 'posted') continue;
    const account = byAccount.get(tx.accountId);
    applyToBalance(account, tx.direction, tx.amountMinor);
    tx.balanceAfterMinor = account.balanceMinor;
  }

  await persistAccounts(accounts);
  await persistTransactions(txs);

  if (action) undoStack.push({ ...action, txIds: txs.map((t) => t.id), accountIds: accounts.map((a) => a.id) });
  if (undoStack.length > 25) undoStack.shift();

  return { txs, accounts };
}

export async function deposit({ accountId, amountMinor, ts = Date.now(), description, category = 'income', channel = 'deposit' }) {
  const account = requireAccount(accountId);
  const amount = requireAmount(amountMinor);
  const label = description || `Deposit to ${account.name}`;
  const tx = makeTx({
    accountId,
    ts,
    direction: 'credit',
    amountMinor: amount,
    description: label,
    merchant: label,
    category,
    channel,
  });
  const { accounts } = await commit([tx], [account], {
    kind: 'deposit',
    accountId,
    amountMinor: amount,
    ts,
    label: `Deposit of ${formatMoney(amount)} to ${account.name}`,
  });
  return { tx, account: accounts[0], kind: 'deposit' };
}

export async function withdraw({ accountId, amountMinor, ts = Date.now(), description, category = 'fees', channel = 'atm' }) {
  const account = requireAccount(accountId);
  const amount = requireAmount(amountMinor);
  if (account.type !== 'credit' && account.balanceMinor < amount) {
    throw new LedgerError(
      `${account.name} only has ${formatMoney(account.balanceMinor)} available, so I can't withdraw ${formatMoney(amount)}.`,
      'insufficient_funds',
    );
  }
  const label = description || `Withdrawal from ${account.name}`;
  const tx = makeTx({
    accountId,
    ts,
    direction: 'debit',
    amountMinor: amount,
    description: label,
    merchant: label,
    category,
    channel,
  });
  const { accounts } = await commit([tx], [account], {
    kind: 'withdraw',
    accountId,
    amountMinor: amount,
    ts,
    label: `Withdrawal of ${formatMoney(amount)} from ${account.name}`,
  });
  return { tx, account: accounts[0], kind: 'withdraw' };
}

export async function transfer({ fromAccountId, toAccountId, amountMinor, ts = Date.now(), description, category = 'transfer' }) {
  const from = requireAccount(fromAccountId);
  const to = requireAccount(toAccountId);
  const amount = requireAmount(amountMinor);
  if (from.id === to.id) throw new LedgerError('The source and destination accounts are the same.', 'same_account');
  if (from.type !== 'credit' && from.balanceMinor < amount) {
    throw new LedgerError(
      `${from.name} only has ${formatMoney(from.balanceMinor)} available, so I can't move ${formatMoney(amount)}.`,
      'insufficient_funds',
    );
  }

  const outbound = makeTx({
    accountId: from.id,
    ts,
    direction: 'debit',
    amountMinor: amount,
    description: description || `Transfer to ${to.name}`,
    merchant: to.name,
    category,
    channel: 'transfer',
    counterpartyAccountId: to.id,
  });
  const inbound = makeTx({
    accountId: to.id,
    ts,
    direction: 'credit',
    amountMinor: amount,
    description: description || `Transfer from ${from.name}`,
    merchant: from.name,
    category,
    channel: 'transfer',
    counterpartyAccountId: from.id,
  });

  const { accounts } = await commit([outbound, inbound], [from, to], {
    kind: 'transfer',
    fromAccountId: from.id,
    toAccountId: to.id,
    amountMinor: amount,
    ts,
    label: `Transfer of ${formatMoney(amount)} from ${from.name} to ${to.name}`,
  });
  return { tx: outbound, counterpart: inbound, from: accounts[0], to: accounts[1], kind: 'transfer' };
}

export async function payCard({ cardAccountId, fromAccountId, amountMinor, ts = Date.now() }) {
  const card = requireAccount(cardAccountId);
  const from = requireAccount(fromAccountId);
  if (card.type !== 'credit') throw new LedgerError(`${card.name} is not a credit account.`, 'not_credit');
  const owed = Math.max(0, -card.balanceMinor);
  const amount = requireAmount(amountMinor ?? owed);
  if (owed === 0) throw new LedgerError(`${card.name} has no outstanding balance.`, 'nothing_owed');
  const payAmount = Math.min(amount, owed);
  if (from.type !== 'credit' && from.balanceMinor < payAmount) {
    throw new LedgerError(
      `${from.name} only has ${formatMoney(from.balanceMinor)} available, so I can't send ${formatMoney(payAmount)}.`,
      'insufficient_funds',
    );
  }

  const outbound = makeTx({
    accountId: from.id,
    ts,
    direction: 'debit',
    amountMinor: payAmount,
    description: `Payment to ${card.name}`,
    merchant: card.name,
    category: 'transfer',
    channel: 'transfer',
    counterpartyAccountId: card.id,
  });
  const inbound = makeTx({
    accountId: card.id,
    ts,
    direction: 'credit',
    amountMinor: payAmount,
    description: 'Payment received — thank you',
    merchant: from.name,
    category: 'transfer',
    channel: 'transfer',
    counterpartyAccountId: from.id,
  });

  const { accounts } = await commit([outbound, inbound], [from, card], {
    kind: 'pay_card',
    fromAccountId: from.id,
    cardAccountId: card.id,
    amountMinor: payAmount,
    ts,
    label: `Payment of ${formatMoney(payAmount)} to ${card.name}`,
  });
  return { tx: outbound, counterpart: inbound, from: accounts[0], card: accounts[1], kind: 'pay_card' };
}

/** Reverse the most recent mutation. */
export async function undoLast() {
  const action = undoStack.pop();
  if (!action) throw new LedgerError('There is nothing to undo.', 'nothing_to_undo');

  const txs = store.transactions.filter((t) => action.txIds.includes(t.id));
  const accounts = action.accountIds.map((id) => accountById(id)).filter(Boolean);
  const byAccount = new Map(accounts.map((a) => [a.id, a]));

  for (const tx of txs) {
    if (tx.status !== 'posted') continue;
    const account = byAccount.get(tx.accountId);
    if (!account) continue;
    applyToBalance(account, tx.direction === 'credit' ? 'debit' : 'credit', tx.amountMinor);
  }

  const { db } = await import('../db/database.js');
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.bulkDelete(action.txIds);
  });
  store.transactions = store.transactions.filter((t) => !action.txIds.includes(t.id));

  await persistAccounts(accounts);
  return action;
}

export function resetUndoStack() {
  undoStack.length = 0;
}
