/**
 * Meridian Test Suite
 * Validates formatting, money math, queries, NLU parsing, and assistant handling.
 */

import { formatMoney, formatMinorParts, parseMoney } from '../src/util/money.js';
import {
  formatDate,
  formatMonth,
  formatTime,
  relativeTime,
  pluralize,
  escapeHtml,
} from '../src/util/format.js';
import {
  detectIntent,
  detectAmount,
  detectCategory,
  detectStatus,
  detectKeywords,
  parse,
} from '../src/nlu/parse.js';
import { extractRange } from '../src/nlu/dates.js';
import { haptic, vibrate } from '../src/util/haptics.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

console.log('--- Running Meridian Test Suite ---');

// 1. Money tests
assert(formatMoney(12345) === '$123.45', 'formatMoney formats positive cents');
assert(formatMoney(-5000) === '-$50.00', 'formatMoney formats negative cents');
assert(formatMoney(10000, { showCents: false }) === '$100.00', 'formatMoney format with two decimals');
assert(formatMoney(2500, { signed: true }) === '+$25.00', 'formatMoney signed');
assert(formatMoney(-2500, { signed: true }) === '-$25.00', 'formatMoney negative signed');

const parts = formatMinorParts(12345);
assert(parts.whole === '123' && parts.cents === '45' && !parts.negative, 'formatMinorParts positive');
const negParts = formatMinorParts(-990);
assert(negParts.whole === '9' && negParts.cents === '90' && negParts.negative, 'formatMinorParts negative');

assert(parseMoney('$200') === 20000, 'parseMoney handles $200');
assert(parseMoney('50.25') === 5025, 'parseMoney handles 50.25');
assert(parseMoney('1.5k') === 150000, 'parseMoney handles 1.5k');
assert(parseMoney('100 bucks') === 10000, 'parseMoney handles 100 bucks');

// 2. Format tests
assert(pluralize(1, 'account', 'accounts') === '1 account', 'pluralize singular');
assert(pluralize(3, 'account', 'accounts') === '3 accounts', 'pluralize plural');
assert(escapeHtml('<script>alert("xss")</script>') === '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'escapeHtml escapes tags');
assert(escapeHtml('"quoted" & \'single\'') === '&quot;quoted&quot; &amp; &#39;single&#39;', 'escapeHtml handles quotes & ampersands');

// 3. NLU Parsing tests
const p1 = parse('transfer $200 from checking to savings');
assert(p1.intent === 'transfer', 'detects transfer intent');
assert(p1.amountMinor === 20000, 'detects $200 as 20000 cents');

const p2 = parse('how much did I spend on groceries?');
assert(p2.intent === 'spend_summary', 'detects spend_summary intent');
assert(p2.category === 'groceries', 'detects groceries category with question mark');

const p3 = parse('show recent transactions');
assert(p3.intent === 'list_transactions', 'detects list_transactions intent');

const p4 = parse('what is my balance?');
assert(p4.intent === 'balance', 'detects balance intent');

const p5 = parse('am I over budget?');
assert(p5.intent === 'budget_status', 'detects budget_status intent');

const p6 = parse('show pending transactions.');
assert(p6.status === 'pending', 'detects pending status with period');

const p7 = parse('deposit $500 into checking');
assert(p7.intent === 'deposit', 'detects deposit intent');
assert(p7.amountMinor === 50000, 'detects $500 deposit');

// 4. Date ranges
const now = new Date('2026-11-22T12:00:00Z').getTime();
const r1 = extractRange('spending last month', now);
assert(r1 !== null && r1.label === 'last month', 'extractRange parses last month');

const r2 = extractRange('spending this week', now);
assert(r2 !== null && r2.label === 'this week', 'extractRange parses this week');

// 5. Haptic utility test
assert(typeof vibrate === 'function', 'vibrate is a function');
assert(typeof haptic.tap === 'function', 'haptic.tap is a function');
assert(typeof haptic.selection === 'function', 'haptic.selection is a function');
assert(typeof haptic.toggle === 'function', 'haptic.toggle is a function');
assert(typeof haptic.success === 'function', 'haptic.success is a function');
assert(typeof haptic.warning === 'function', 'haptic.warning is a function');
haptic.tap(); // should not throw in node (graceful no-op)

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
