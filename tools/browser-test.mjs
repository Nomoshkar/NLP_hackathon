/**
 * Headless browser smoke test.
 *
 * Drives the app through a scripted conversation against a real Chromium over
 * the Chrome DevTools Protocol, fails on any console error or uncaught
 * exception, and writes screenshots. No test framework and no npm dependency:
 * Node's built-in fetch and WebSocket are enough.
 *
 * Usage:
 *   chromium --headless=new --remote-debugging-port=9222 --no-sandbox about:blank &
 *   python3 -m http.server 12000 --directory docs &
 *   node tools/browser-test.mjs
 *
 * Optional env: BASE_URL, CDP_PORT, OUT_DIR, VIEWPORT_WIDTH, VIEWPORT_HEIGHT.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUT_DIR || join(HERE, '..', '.test-output');
const BASE_URL = process.env.BASE_URL || 'http://localhost:12000/index.html';
const CDP_PORT = process.env.CDP_PORT || '9222';
const WIDTH = Number(process.env.VIEWPORT_WIDTH || 1440);
const HEIGHT = Number(process.env.VIEWPORT_HEIGHT || 1000);

/** The conversation the test replays. */
const SCRIPT = [
  { shot: '01-dashboard' },
  { say: 'what are my balances?', expect: /accounts hold/i, shot: '02-balances' },
  { say: 'how much did I spend on dining last month?', expect: /dining/i, shot: '03-dining' },
  { say: 'what subscriptions do I have?', expect: /subscription|recurring/i, shot: '04-subscriptions' },
  { say: 'am I over budget?', expect: /budget/i, shot: '05-budget' },
  { say: 'what is my cash flow?', expect: /cash flow/i, shot: '06-cashflow' },
  { say: 'deposit $1,500 into savings', expect: /deposited/i, shot: '07-deposit' },
  { say: 'transfer $250 from checking to savings', expect: /moved/i, shot: '08-transfer' },
  { say: 'undo that', expect: /undone/i, shot: '09-undo' },
  { say: 'show me my recent transactions', expect: /transaction/i, shot: '10-transactions' },
  { say: 'withdraw $999,999 from savings', expect: /only has|can't/i, shot: '11-insufficient' },
  { say: 'asdfghjkl', expect: /not sure how to handle/i, shot: '12-unknown' },
  // Regression coverage for the phrasing gaps found in the UI audit.
  { say: 'what did I spend on shopping', expect: /shopping/i, shot: '13-spend-on-category' },
  { say: 'groceries last week', expect: /groceries/i, shot: '14-category-window' },
  { say: 'show me transactions over $100', expect: /over \$100\.00/i, shot: '15-amount-filter' },
  { say: 'what is my average spend', expect: /averaged/i, shot: '16-average-spend' },
  { say: 'do I have any pending transactions', expect: /pending|transaction/i, shot: '17-pending' },
  { say: 'set my dining budget to 400', expect: /dining budget to \$400\.00/i, shot: '18-budget-set' },
];

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
  });

  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }
    if (data.method) for (const listener of listeners) listener(data);
  };

  return {
    on: (fn) => listeners.add(fn),
    close: () => ws.close(),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    }),
  };
}

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target; is Chromium running with --remote-debugging-port?');

  const client = await connect(page.webSocketDebuggerUrl);
  const problems = [];

  client.on((event) => {
    if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)) {
      problems.push(`console.${event.params.type}: ${event.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
    }
    if (event.method === 'Runtime.exceptionThrown') {
      const d = event.params.exceptionDetails;
      problems.push(`exception: ${d.text} ${d.exception?.description || ''}`);
    }
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      problems.push(`log.error: ${event.params.entry.text} ${event.params.entry.url || ''}`);
    }
  });

  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Page.enable');
  // Always exercise the files on disk: a stale ES-module cache makes the test
  // report results for code that is no longer there.
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: WIDTH < 700,
  });

  await client.send('Page.navigate', { url: BASE_URL });
  await new Promise((r) => setTimeout(r, 3000));

  const evaluate = async (expression) => {
    const res = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    return res.result.value;
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const failures = [];

  const ready = await evaluate('document.body.dataset.ready');
  if (ready !== 'true') failures.push(`app never became ready (dataset.ready=${ready})`);
  console.log(`app ready: ${ready}`);

  for (const step of SCRIPT) {
    if (step.say) {
      await evaluate(`window.__testSubmit(${JSON.stringify(step.say)})`);
      await new Promise((r) => setTimeout(r, 1200));
      const reply = await evaluate(
        "[...document.querySelectorAll('.bubble--assistant .bubble__text')].pop()?.textContent || ''",
      );
      const ok = step.expect ? step.expect.test(reply) : Boolean(reply);
      console.log(`${ok ? 'PASS' : 'FAIL'}  "${step.say}" -> ${reply.slice(0, 96)}`);
      if (!ok) failures.push(`unexpected reply to "${step.say}": ${reply.slice(0, 160)}`);
    }
    if (step.shot) {
      const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(OUT_DIR, `${step.shot}.png`), Buffer.from(data, 'base64'));
    }
  }

  const audit = JSON.parse(await evaluate(`JSON.stringify({
    ledgerRows: document.querySelectorAll('.tx-row').length,
    panels: document.querySelectorAll('.panel').length,
    trendPaths: document.querySelectorAll('.chart__line').length,
    accountCards: document.querySelectorAll('.acct').length,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    unlabeledControls: [...document.querySelectorAll('button,input,select,textarea')]
      .filter(e => !e.textContent.trim() && !e.getAttribute('aria-label') && !e.labels?.length && !e.querySelector('.sr-only')).length,
  })`));

  console.log('\n--- audit ---');
  console.log(audit);

  if (audit.pageOverflowX) failures.push('page overflows horizontally');
  if (audit.ledgerRows === 0) failures.push('ledger rendered no rows');
  if (audit.trendPaths === 0) failures.push('trend chart did not render');
  if (audit.accountCards !== 4) failures.push(`expected 4 account cards, saw ${audit.accountCards}`);
  if (audit.unlabeledControls > 0) failures.push(`${audit.unlabeledControls} control(s) without an accessible name`);

  console.log('\n--- console problems ---');
  if (!problems.length) console.log('none');
  for (const p of problems) console.log(p);

  client.close();

  if (failures.length || problems.length) {
    console.error('\nFAILURES:');
    for (const f of [...failures, ...problems]) console.error(` - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll checks passed. Screenshots in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
