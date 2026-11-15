/**
 * Natural language understanding for the assistant.
 *
 * Pure JavaScript, no model and no network call:
 *   1. score intents with weighted keyword/regex patterns,
 *   2. tag the sentence with compromise for part-of-speech hints,
 *   3. extract entities (amount, accounts, category, merchant, time range).
 *
 * The result is a plain object the action layer can execute directly.
 */

import nlp from '../../vendor/compromise.js';
import { parseMoney, parseWordsNumber } from '../util/money.js';
import { escapeHtml } from '../util/format.js';
import {
  ACTION_VERBS,
  CATEGORY_TERMS,
  INTENT_PATTERNS,
  MERCHANT_ALIASES,
} from './lexicon.js';
import { defaultRange, extractRange, periodRange, PERIOD } from './dates.js';

const CURRENCY_RE = /(?:\$|usd\s*|us\$)\s*([\d,]+(?:\.\d+)?)/i;
const SCALED_RE = /\b([\d,]+(?:\.\d+)?)\s*(k|m|thousand|million|grand)\b/i;
const CURRENCY_WORD_RE = /\b([\d,]+(?:\.\d+)?)\s*(?:dollars?|bucks?|quid)\b/i;
const DECIMAL_RE = /\b(\d+\.\d{1,2})\b/;
const BARE_NUMBER_RE = /\b(\d{2,7})\b/;

function clean(text) {
  return String(text || '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Weighted intent classification. */
export function detectIntent(text) {
  const q = ` ${text.toLowerCase()} `;
  const scores = new Map();
  const hits = [];

  for (const entry of INTENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(q.trim()) || pattern.test(text.toLowerCase())) {
        scores.set(entry.intent, (scores.get(entry.intent) || 0) + entry.weight);
        hits.push({ intent: entry.intent, pattern: String(pattern), weight: entry.weight });
        break;
      }
    }
  }

  const doc = nlp(text);
  const verbs = doc.verbs().out('array').map((v) => v.toLowerCase());
  const nouns = doc.nouns().out('array').map((n) => n.toLowerCase());

  for (const [intent, list] of Object.entries(ACTION_VERBS)) {
    for (const verb of list) {
      if (verbs.some((v) => v.startsWith(verb))) {
        scores.set(intent, (scores.get(intent) || 0) + 1.5);
        break;
      }
    }
  }

  // "how much" + "have" without a noun is almost always a balance question.
  if (/\bhow much\b/.test(q) && /\b(do i have|is left|remaining|available)\b/.test(q)) {
    scores.set('balance', (scores.get('balance') || 0) + 4);
  }
  if (/\bwhat (did|have) i\b/.test(q) && !/\bspend|spent|buy|bought|pay|paid\b/.test(q)) {
    scores.set('list_transactions', (scores.get('list_transactions') || 0) + 2);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((acc, [, v]) => acc + v, 0) || 1;
  const [intent, top] = ranked[0] || ['unknown', 0];

  return {
    intent,
    confidence: Number((top / total).toFixed(2)),
    scores: Object.fromEntries(ranked),
    verbs,
    nouns,
    hits,
  };
}

/**
 * Find accounts referenced in the text, in order of appearance.
 * @param {string} text
 * @param {Array<object>} accounts
 */
export function detectAccounts(text, accounts = []) {
  const lower = text.toLowerCase();
  const matches = [];

  for (const account of accounts) {
    const terms = new Set(
      [account.name, account.nickname, ...(account.aliases || [])]
        .filter(Boolean)
        .map((t) => t.toLowerCase()),
    );
    for (const term of terms) {
      const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g');
      let m;
      while ((m = re.exec(lower)) !== null) {
        matches.push({ accountId: account.id, term, index: m.index, length: m[0].length });
      }
    }
    if (account.number) {
      const re = new RegExp(`(?:\\*{2,}|x{2,}|ending (?:in )?|account (?:number )?)?\\b${account.number}\\b`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ accountId: account.id, term: m[0], index: m.index, length: m[0].length });
      }
    }
  }

  // Longest term wins when two accounts are named at the same position, and
  // duplicate/overlapping hits are collapsed.
  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  const deduped = [];
  for (const m of matches) {
    const overlaps = deduped.find(
      (d) => m.index < d.index + d.length && d.index < m.index + m.length,
    );
    if (overlaps) {
      if (m.length > overlaps.length) {
        Object.assign(overlaps, m);
      }
      continue;
    }
    deduped.push(m);
  }
  return deduped;
}

/** Classify each mention as a source or a destination using nearby prepositions. */
export function classifyMentions(text, mentions) {
  const lower = text.toLowerCase();
  return mentions.map((m) => {
    const before = lower.slice(Math.max(0, m.index - 16), m.index);
    let role = 'neutral';
    if (/\b(from|out of|off|outta)\s*$/.test(before)) role = 'source';
    else if (/\b(to|into|towards?|onto)\s*$/.test(before)) role = 'destination';
    return { ...m, role };
  });
}

function maskSpans(text, spans) {
  let out = text;
  const sorted = [...spans].sort((a, b) => b.index - a.index);
  for (const s of sorted) {
    out = `${out.slice(0, s.index)}${' '.repeat(s.length)}${out.slice(s.index + s.length)}`;
  }
  return out;
}

/**
 * Extract a monetary amount, ignoring digits that belong to account numbers or
 * dates. Returns { minor, raw } or null.
 */
export function detectAmount(text, { accountMentions = [], range = null } = {}) {
  const masked = maskSpans(text, accountMentions);

  const currency = masked.match(CURRENCY_RE);
  if (currency) {
    const minor = parseMoney(currency[1]);
    if (minor !== null) return { minor, raw: currency[0].trim() };
  }

  const scaled = masked.match(SCALED_RE);
  if (scaled) {
    const minor = parseMoney(scaled[0]);
    if (minor !== null) return { minor, raw: scaled[0].trim() };
  }

  const currencyWord = masked.match(CURRENCY_WORD_RE);
  if (currencyWord) {
    const minor = parseMoney(currencyWord[0]);
    if (minor !== null) return { minor, raw: currencyWord[0].trim() };
  }

  const decimal = masked.match(DECIMAL_RE);
  if (decimal) {
    const minor = parseMoney(decimal[1]);
    if (minor !== null) return { minor, raw: decimal[1] };
  }

  // Strip ordinal/day references so "on the 5th" is not read as $5.
  const withoutOrdinals = masked
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:last|past|next|previous)\s+\d{1,3}\b/g, ' ');

  if (range && range.period && /^\d{4}-\d{2}$/.test(range.period)) {
    // A month name or ISO date is present; a lone 4-digit number is likely a year.
  }

  const bare = withoutOrdinals.match(BARE_NUMBER_RE);
  if (bare) {
    const value = Number(bare[1].replace(/,/g, ''));
    if (value >= 10) return { minor: parseMoney(bare[1]), raw: bare[1] };
  }

  const doc = nlp(withoutOrdinals);
  const numbers = doc.numbers();
  if (numbers.found) {
    const raw = numbers.out('array')[0];
    const value = parseWordsNumber(raw) ?? numbers.get()[0];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return { minor: Math.round(value * 100), raw };
    }
  }

  return null;
}

/** Map category keywords to a category id. */
export function detectCategory(text) {
  const q = ` ${text.toLowerCase()} `;
  let best = null;
  for (const [categoryId, terms] of Object.entries(CATEGORY_TERMS)) {
    for (const term of terms) {
      if (q.includes(` ${term} `) || q.includes(`${term}s `)) {
        if (!best || term.length > best.term.length) best = { categoryId, term };
      }
    }
  }
  return best ? best.categoryId : null;
}

/**
 * Words that can follow "at/from/to" without naming a merchant. Without this
 * guard phrases like "transactions from last week" look like a merchant.
 */
const MERCHANT_STOPWORDS = new Set([
  'last', 'this', 'next', 'previous', 'past', 'week', 'weeks', 'month', 'months',
  'year', 'years', 'quarter', 'day', 'days', 'today', 'yesterday', 'tomorrow',
  'recently', 'lately', 'now', 'my', 'the', 'a', 'an', 'all', 'any', 'some',
  'account', 'accounts', 'money', 'funds', 'cash', 'savings', 'saving', 'checking',
  'chequing', 'card', 'credit', 'balance', 'everyday', 'main', 'current',
  'date', 'time', 'here', 'there', 'work', 'home', 'start', 'beginning',
]);

/** Resolve a merchant name from known aliases or an "at/from X" phrase. */
export function detectMerchant(text, { categories = [], accounts = [] } = {}) {
  const lower = text.toLowerCase();
  const aliasHits = Object.entries(MERCHANT_ALIASES)
    .filter(([key]) => new RegExp(`\\b${escapeRegExp(key)}\\b`).test(lower))
    .sort((a, b) => b[0].length - a[0].length);
  if (aliasHits.length) return { merchant: aliasHits[0][1], exact: true };

  const accountTerms = accounts.flatMap((a) => [a.name, a.nickname, ...(a.aliases || [])])
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const phrase = lower.match(/\b(?:at|from|to|by|for)\s+([a-z][a-z0-9&'.\- ]{2,40})$/);
  if (!phrase) return null;

  const candidate = phrase[1].trim().replace(/[.\s]+$/, '');
  const tokens = candidate.split(/\s+/).slice(0, 4);
  const meaningful = tokens.filter((t) => !MERCHANT_STOPWORDS.has(t) && !/^\d+$/.test(t));
  if (!meaningful.length) return null;

  const words = tokens.join(' ');
  if (accountTerms.includes(words)) return null;
  if (categories.some((c) => c.label.toLowerCase() === words || c.id === words)) return null;
  return { merchant: words, exact: false };
}

/** Generic keyword extraction used for free-text transaction search. */
export function detectKeywords(text, { nouns = [] } = {}) {
  const stop = new Set([
    'show', 'list', 'see', 'view', 'display', 'find', 'search', 'look', 'up', 'my', 'me', 'i',
    'the', 'a', 'an', 'all', 'any', 'did', 'do', 'does', 'was', 'were', 'is', 'are', 'have',
    'has', 'had', 'transaction', 'transactions', 'activity', 'payment', 'payments', 'charge',
    'charges', 'purchase', 'purchases', 'history', 'account', 'accounts', 'money', 'much',
    'how', 'what', 'when', 'where', 'last', 'this', 'month', 'week', 'year', 'today',
    'yesterday', 'and', 'for', 'with', 'about', 'spent', 'spend', 'get', 'got',
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t) && !/^\d+$/.test(t));
  const fromNouns = nouns
    .flatMap((n) => n.split(/\s+/))
    .filter((t) => t.length > 2 && !stop.has(t));
  return [...new Set([...fromNouns, ...tokens])].slice(0, 6);
}

/**
 * Full parse of an utterance.
 * @param {string} text
 * @param {{accounts?: Array<object>, categories?: Array<object>, now?: number}} ctx
 */
export function parse(text, ctx = {}) {
  const raw = clean(text);
  const now = ctx.now ?? Date.now();
  const accounts = ctx.accounts || [];
  const categories = ctx.categories || [];

  const analysis = detectIntent(raw);
  const mentions = classifyMentions(raw, detectAccounts(raw, accounts));
  const range = extractRange(raw, now);
  const amount = detectAmount(raw, { accountMentions: mentions, range });
  const category = detectCategory(raw);
  const merchant = detectMerchant(raw, { categories, accounts });
  const keywords = detectKeywords(raw, { nouns: analysis.nouns });

  const source = mentions.find((m) => m.role === 'source');
  const destination = mentions.find((m) => m.role === 'destination');
  const uniqueIds = [...new Set(mentions.map((m) => m.accountId))];

  const creditAccounts = accounts.filter((a) => a.type === 'credit');
  const wantsCard = /\b(card|credit)\b/.test(raw.toLowerCase());

  let direction = null;
  if (analysis.intent === 'deposit') direction = 'in';
  if (analysis.intent === 'withdraw') direction = 'out';
  if (analysis.intent === 'transfer' || analysis.intent === 'pay_card') direction = 'move';

  const comparison = {
    last: /\b(than|vs\.?|versus|compared? to|more than|less than)\b[^.]*\blast (month|year)\b/.test(raw.toLowerCase())
      || /\blast (month|year)\b/.test(raw.toLowerCase()),
    thisMonth: /\bthis month\b/.test(raw.toLowerCase()),
  };

  return {
    raw,
    text: raw,
    html: escapeHtml(raw),
    ...analysis,
    mentions,
    accountIds: uniqueIds,
    fromAccountId: source ? source.accountId : null,
    toAccountId: destination ? destination.accountId : null,
    creditAccountId: wantsCard && creditAccounts.length ? creditAccounts[0].id : null,
    amountMinor: amount ? amount.minor : null,
    amountRaw: amount ? amount.raw : null,
    category,
    merchant: merchant ? merchant.merchant : null,
    merchantExact: merchant ? merchant.exact : false,
    keywords,
    range,
    period: range ? range.period : null,
    defaultRange: defaultRange(now),
    comparison,
    now,
  };
}

export { periodRange, PERIOD };
