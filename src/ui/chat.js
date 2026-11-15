/**
 * Chat transcript rendering.
 *
 * The assistant replies with structured blocks (kpis, bars, rows, budgets…)
 * rather than markup, so all HTML generation lives here and stays escaped.
 */

import { categoryById } from '../db/database.js';
import { formatMoney } from '../util/money.js';
import { escapeHtml, formatDate, formatTime, pluralize } from '../util/format.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/* --------------------------------------------------------------------------
   Block renderers
   -------------------------------------------------------------------------- */
const BLOCK_RENDERERS = {
  subhead: (block) => el('p', 'blk__subhead', escapeHtml(block.text)),

  note: (block) => el('p', 'note', escapeHtml(block.text)),

  kpis: (block) => el(
    'div',
    'blk kpis',
    block.items
      .map((i) => `
        <div class="kpi ${i.tone ? `is-${i.tone}` : ''}">
          <div class="kpi__label">${escapeHtml(i.label)}</div>
          <div class="kpi__value">${escapeHtml(i.value)}</div>
        </div>`)
      .join(''),
  ),

  rows: (block) => {
    const items = block.items
      .map((r) => {
        const category = categoryById(r.categoryId);
        return `
          <div class="mini-row">
            <span class="mini-row__label">
              ${escapeHtml(r.label)}
              <span class="mini-row__sub">${escapeHtml(r.sub || '')}</span>
            </span>
            <span class="mini-row__amt ${r.amountMinor > 0 ? 'is-credit' : ''}">${escapeHtml(formatMoney(r.amountMinor, { signed: true }))}</span>
          </div>`;
      })
      .join('');
    const more = block.total && block.total > block.items.length
      ? `<p class="note">${escapeHtml(`+ ${block.total - block.items.length} more`)}</p>`
      : '';
    return el('div', 'blk mini-rows', items + more);
  },

  bars: (block) => el(
    'div',
    'blk bars',
    block.items
      .map((i) => `
        <div class="bar">
          <span class="bar__label" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</span>
          <span class="bar__track"><i style="--c:${i.color || 'var(--accent)'}; --w:${i.pct}%"></i></span>
          <span class="bar__value">${escapeHtml(i.display || formatMoney(i.value))}</span>
        </div>`)
      .join(''),
  ),

  spark: (block) => el('div', 'blk', `<div class="chart">${block.html || ''}</div>`),

  flow: (block) => {
    const max = Math.max(...block.items.flatMap((i) => [i.inMinor, i.outMinor]), 1);
    return el(
      'div',
      'blk flow-mini',
      block.items
        .map((i) => {
          const inW = Math.max(2, Math.round((i.inMinor / max) * 100));
          const outW = Math.max(2, Math.round((i.outMinor / max) * 100));
          return `
            <div class="flow-mini__row">
              <span>${escapeHtml(i.label)}</span>
              <span class="flow-mini__bars">
                <i class="in" style="--w:${inW}%"></i>
                <i class="out" style="--w:${outW}%"></i>
              </span>
              <span class="flow-mini__net">${escapeHtml(formatMoney(i.netMinor, { signed: true, showCents: false }))}</span>
            </div>`;
        })
        .join(''),
    );
  },

  budget: (block) => el(
    'div',
    'blk budget-mini',
    block.items
      .map((i) => `
        <div class="budget-mini__row">
          <div class="budget-mini__top">
            <span>${escapeHtml(i.label)}</span>
            <span>${escapeHtml(formatMoney(i.spentMinor))} / ${escapeHtml(formatMoney(i.budgetMinor, { showCents: false }))} · ${i.pct}%</span>
          </div>
          <div class="budget-mini__track ${i.pct > 100 ? 'is-over' : ''}">
            <i style="--c:${i.color}; --w:${Math.min(i.pct, 100)}%"></i>
          </div>
        </div>`)
      .join(''),
  ),

  delta: (block) => {
    const max = Math.max(...block.items.map((i) => Math.abs(i.deltaMinor)), 1);
    return el(
      'div',
      'blk deltas',
      block.items
        .map((i) => {
          const pctWidth = (Math.abs(i.deltaMinor) / max) * 50;
          const up = i.deltaMinor > 0;
          const left = up ? 50 : 50 - pctWidth;
          return `
            <div class="delta">
              <span class="bar__label">${escapeHtml(i.label)}</span>
              <span class="delta__track">
                <i class="delta__bar" style="--c:${i.color}; left:${left}%; width:${Math.max(pctWidth, 1.5)}%"></i>
              </span>
              <span class="delta__value ${up ? 'is-up' : 'is-down'}">${escapeHtml(formatMoney(i.deltaMinor, { signed: true, showCents: false }))}</span>
            </div>`;
        })
        .join(''),
    );
  },

  recurring: (block) => el(
    'div',
    'blk recurring',
    block.items
      .map((i) => `
        <div class="recurring__row">
          <span>${escapeHtml(i.merchant)}<span class="mini-row__sub">${escapeHtml(`${pluralize(i.months, 'month')} · ${i.cadence}`)}</span></span>
          <span class="recurring__amt">${escapeHtml(formatMoney(i.averageMinor))}</span>
          <span class="mini-row__sub">${escapeHtml(formatDate(i.lastCharged, { withYear: true }))}</span>
        </div>`)
      .join(''),
  ),

  accounts: (block) => el(
    'div',
    'blk acct-mini',
    block.items
      .map((a) => `
        <div class="acct-mini__card" style="--c:${a.color}">
          <div class="acct-mini__name">${escapeHtml(`${a.name} ••${a.number}`)}</div>
          <div class="acct-mini__amt ${a.balanceMinor < 0 ? 'is-negative' : ''}">${escapeHtml(formatMoney(a.balanceMinor))}</div>
        </div>`)
      .join(''),
  ),

  examples: (block) => el(
    'div',
    'blk examples',
    block.items.map((e) => `<button type="button" class="chip" data-suggestion="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join(''),
  ),
};

/* --------------------------------------------------------------------------
   Transcript
   -------------------------------------------------------------------------- */
const MAX_BUBBLES = 60;

export function createChat({ logEl, suggestionsEl, onSuggestion }) {
  let typingEl = null;

  function scrollToEnd() {
    requestAnimationFrame(() => {
      logEl.scrollTop = logEl.scrollHeight;
    });
  }

  function trim() {
    while (logEl.children.length > MAX_BUBBLES) logEl.removeChild(logEl.firstElementChild);
  }

  function addUser(text) {
    const bubble = el('div', 'bubble bubble--user', `<p class="bubble__text">${escapeHtml(text)}</p>`);
    logEl.appendChild(bubble);
    trim();
    scrollToEnd();
  }

  function addAssistant(reply) {
    removeTyping();
    const tone = reply.tone === 'warning' ? ' is-warning' : reply.tone === 'success' ? ' is-success' : '';
    const bubble = el('div', `bubble bubble--assistant${tone}`);

    const header = el(
      'p',
      'bubble__tag',
      `<span>Meridian</span><span>·</span><span>${escapeHtml(formatTime(Date.now()))}</span>`,
    );
    bubble.appendChild(header);
    bubble.appendChild(el('p', 'bubble__text', escapeHtml(reply.text)));

    for (const block of reply.blocks || []) {
      const render = BLOCK_RENDERERS[block.type];
      if (render) bubble.appendChild(render(block));
    }

    logEl.appendChild(bubble);
    trim();
    scrollToEnd();
    renderSuggestions(reply.actions || []);
    return bubble;
  }

  function showTyping() {
    removeTyping();
    typingEl = el(
      'div',
      'bubble bubble--assistant',
      '<p class="bubble__tag"><span>Meridian</span><span>·</span><span>thinking</span></p><p class="bubble__text">…</p>',
    );
    logEl.appendChild(typingEl);
    scrollToEnd();
  }

  function removeTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function renderSuggestions(actions) {
    suggestionsEl.innerHTML = actions
      .slice(0, 5)
      .map((a) => `<button type="button" class="chip" data-suggestion="${escapeHtml(a)}">${escapeHtml(a)}</button>`)
      .join('');
  }

  function setDefaultSuggestions(list) {
    if (!suggestionsEl.children.length) renderSuggestions(list);
  }

  // Delegated clicks for every suggestion chip, including those inside bubbles.
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-suggestion]');
    if (!chip) return;
    onSuggestion(chip.dataset.suggestion);
  });

  return { addUser, addAssistant, showTyping, removeTyping, setDefaultSuggestions, renderSuggestions };
}
