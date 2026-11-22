/**
 * Dashboard rendering.
 *
 * Each render function takes the current view state and paints one region of
 * the page. Rendering is explicit and idempotent so the assistant can drive it
 * by emitting a new view state.
 */

import { accountById, categoryById, store } from '../db/database.js';
import { formatMoney, formatMinorParts } from '../util/money.js';
import {
  escapeHtml,
  formatDate,
  formatMonth,
  monthKey,
  pluralize,
  relativeTime,
} from '../util/format.js';
import {
  averageMonthlySpend,
  balanceSeries,
  byCategory,
  byMonth,
  inRange,
  lastNMonths,
  postedTransactions,
  recurringCharges,
  runwayMonths,
  spendTransactions,
  summarize,
  totalBalanceAt,
} from '../actions/queries.js';
import { balanceTrend, sparkline } from './charts.js';
import { haptic } from '../util/haptics.js';

const ACCOUNT_TYPE_LABEL = { checking: 'Checking', savings: 'Savings', credit: 'Credit' };

function q(id) {
  return document.getElementById(id);
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* --------------------------------------------------------------------------
   Hero
   -------------------------------------------------------------------------- */
export function renderHero(now = Date.now()) {
  const liquid = store.accounts.filter((a) => a.type !== 'credit').reduce((acc, a) => acc + a.balanceMinor, 0);
  const parts = formatMinorParts(liquid);
  const whole = q('total-balance')?.querySelector('.balance__whole');
  const cents = q('total-balance')?.querySelector('.balance__cents');
  const sign = q('total-balance')?.querySelector('.balance__sign');
  if (sign) sign.textContent = parts.negative ? '−$' : '$';
  if (whole) whole.textContent = parts.whole;
  if (cents) cents.textContent = `.${parts.cents}`;

  const thisMonthStart = new Date(now);
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);
  const monthRows = inRange({ start: thisMonthStart.getTime(), end: now });
  const monthSummary = summarize(monthRows);
  const monthSpend = spendTransactions(monthRows).reduce((acc, t) => acc + t.amountMinor, 0);
  const monthIncome = monthRows.filter((t) => t.direction === 'credit').reduce((acc, t) => acc + t.amountMinor, 0);

  const prior = totalBalanceAt(new Date(thisMonthStart.getTime() - 1).getTime());
  const delta = liquid - prior;
  const pct = prior ? Math.round((delta / prior) * 100) : 0;
  const deltaEl = q('total-delta');
  if (deltaEl) {
    const cls = delta >= 0 ? 'up' : 'down';
    const arrow = delta >= 0 ? '▲' : '▼';
    deltaEl.innerHTML = `<span class="${cls}">${arrow} ${escapeHtml(formatMoney(Math.abs(delta), { showCents: true }))}</span> this month (${pct >= 0 ? '+' : ''}${pct}%) · ${escapeHtml(pluralize(monthRows.length, 'entry', 'entries'))}`;
  }

  const assets = liquid;
  const debt = store.accounts.filter((a) => a.type === 'credit').reduce((acc, a) => acc + Math.min(0, a.balanceMinor), 0);
  setText(q('stat-networth'), formatMoney(assets + debt, { showCents: false }));
  setText(q('stat-spent'), formatMoney(monthSpend, { showCents: false }));
  setText(q('stat-income'), formatMoney(monthIncome, { showCents: false }));

  const runway = runwayMonths({ now });
  const burn = averageMonthlySpend({ now });
  setText(q('stat-runway'), runway === null ? '—' : `${runway.toFixed(1)} months`);
  const runwayEl = q('stat-runway');
  if (runwayEl) {
    runwayEl.title = burn ? `Average monthly spend ${formatMoney(burn)}` : '';
  }
}

/* --------------------------------------------------------------------------
   Accounts
   -------------------------------------------------------------------------- */
export function renderAccounts(state, onSelect) {
  const root = q('accounts');
  if (!root) return;
  const max = Math.max(...store.accounts.map((a) => Math.abs(a.balanceMinor)), 1);

  root.innerHTML = store.accounts
    .map((account, i) => {
      const util = account.type === 'credit'
        ? Math.min(100, Math.round((Math.abs(account.balanceMinor) / (account.creditLimitMinor || 1)) * 100))
        : Math.round((Math.abs(account.balanceMinor) / max) * 100);
      const negative = account.balanceMinor < 0;
      const foot = account.type === 'credit'
        ? `Limit ${formatMoney(account.creditLimitMinor, { showCents: false })} · ${util}% used`
        : `APY ${account.apy.toFixed(2)}% · ••${account.number}`;
      return `
        <button type="button" class="acct reveal ${state.accountId === account.id ? 'is-active' : ''}"
                style="--acct-color:${account.color}; animation-delay:${(0.05 + i * 0.06).toFixed(2)}s"
                data-account="${account.id}" aria-pressed="${state.accountId === account.id}">
          <span class="acct__top">
            <span class="acct__name">${escapeHtml(account.name)}</span>
            <span class="acct__type">${escapeHtml(ACCOUNT_TYPE_LABEL[account.type] || account.type)}</span>
          </span>
          <span class="acct__amount ${negative ? 'is-negative' : ''}">${escapeHtml(formatMoney(account.balanceMinor))}</span>
          <span class="acct__meter"><i style="width:0" data-width="${util}"></i></span>
          <span class="acct__foot"><span>${escapeHtml(foot)}</span></span>
        </button>`;
    })
    .join('');

  for (const el of root.querySelectorAll('.acct__meter i')) {
    requestAnimationFrame(() => { el.style.width = `${el.dataset.width}%`; });
  }

  // Account pagination dots for mobile carousel
  const dotsEl = q('accounts-dots');
  if (dotsEl) {
    dotsEl.innerHTML = store.accounts
      .map((a, i) => `<button type="button" class="accounts__dot ${i === 0 ? 'is-active' : ''}" data-dot="${i}" aria-label="Go to ${escapeHtml(a.name)}"></button>`)
      .join('');
    dotsEl.querySelectorAll('[data-dot]').forEach((dot) => {
      dot.addEventListener('click', () => {
        haptic.tap();
        const idx = Number(dot.dataset.dot);
        const card = root.children[idx];
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
      });
    });

    root.addEventListener('scroll', () => {
      if (!dotsEl.children.length) return;
      const cardWidth = root.children[0]?.offsetWidth || 260;
      const idx = Math.min(Math.round(root.scrollLeft / cardWidth), store.accounts.length - 1);
      dotsEl.querySelectorAll('.accounts__dot').forEach((d, i) => {
        d.classList.toggle('is-active', i === idx);
      });
    }, { passive: true });
  }

  root.querySelectorAll('[data-account]').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic.toggle();
      onSelect(btn.dataset.account);
    });
  });
}

/* --------------------------------------------------------------------------
   Trend
   -------------------------------------------------------------------------- */
export function renderTrend(months = 6, now = Date.now()) {
  const el = q('trend-chart');
  if (!el) return;
  const series = balanceSeries(months, now);
  el.innerHTML = balanceTrend(series);

  // Wire touch & pointer scrubbing
  const overlay = el.querySelector('#trend-overlay');
  const scrubber = el.querySelector('#trend-scrubber');
  const scrubberDot = el.querySelector('#trend-scrubber-dot');
  const tooltip = el.querySelector('#trend-tooltip');
  const dots = Array.from(el.querySelectorAll('.chart__dot'));

  if (!overlay || !dots.length) return;

  const updateScrubber = (clientX) => {
    const rect = overlay.getBoundingClientRect();
    const xRel = clientX - rect.left;
    const xPct = Math.max(0, Math.min(1, xRel / (rect.width || 1)));

    let closestDot = dots[0];
    let closestDist = Infinity;
    dots.forEach((dot) => {
      const dotX = Number(dot.dataset.x);
      const dotPct = dotX / 860;
      const dist = Math.abs(xPct - dotPct);
      if (dist < closestDist) {
        closestDist = dist;
        closestDot = dot;
      }
    });

    if (closestDot) {
      dots.forEach((d) => d.classList.toggle('is-active', d === closestDot));
      const dotX = Number(closestDot.dataset.x);
      const dotY = Number(closestDot.dataset.y);

      if (scrubber) {
        scrubber.setAttribute('x1', String(dotX));
        scrubber.setAttribute('x2', String(dotX));
        scrubber.style.opacity = '1';
      }
      if (scrubberDot) {
        scrubberDot.setAttribute('cx', String(dotX));
        scrubberDot.setAttribute('cy', String(dotY));
        scrubberDot.style.opacity = '1';
      }
      if (tooltip) {
        tooltip.innerHTML = `<strong>${escapeHtml(closestDot.dataset.month)}</strong>: ${escapeHtml(closestDot.dataset.amount)}`;
        tooltip.style.left = `${(dotX / 860) * 100}%`;
        tooltip.style.top = `${(dotY / 260) * 100}%`;
        tooltip.classList.add('is-visible');
        tooltip.removeAttribute('aria-hidden');
      }
    }
  };

  const hideScrubber = () => {
    if (scrubber) scrubber.style.opacity = '0';
    if (scrubberDot) scrubberDot.style.opacity = '0';
    if (tooltip) {
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }
    dots.forEach((d) => d.classList.remove('is-active'));
  };

  overlay.addEventListener('pointerdown', (e) => {
    haptic.selection();
    updateScrubber(e.clientX);
    overlay.setPointerCapture?.(e.pointerId);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (e.buttons > 0 || e.pointerType === 'mouse') {
      updateScrubber(e.clientX);
    }
  });
  overlay.addEventListener('pointerup', () => {
    setTimeout(hideScrubber, 1400);
  });
  overlay.addEventListener('pointercancel', hideScrubber);
  overlay.addEventListener('pointerleave', () => {
    setTimeout(hideScrubber, 400);
  });
}

/* --------------------------------------------------------------------------
   Categories
   -------------------------------------------------------------------------- */
export function renderCategories(state, now = Date.now(), onCategoryClick = null) {
  const el = q('category-list');
  const note = q('cats-note');
  if (!el) return;

  const range = state.range || thisMonthRange(now);
  const rows = inRange(range).filter((t) => (!state.accountId || t.accountId === state.accountId));
  const spend = spendTransactions(rows);
  const categories = byCategory(spend).slice(0, 7);
  setText(note, range.label);

  if (!categories.length) {
    el.innerHTML = '<p class="empty">No spending in this window.</p>';
    return;
  }

  const max = categories[0].totalMinor || 1;
  el.innerHTML = categories
    .map((c) => {
      const def = categoryById(c.categoryId);
      const isSelected = state.filters?.categoryId === c.categoryId;
      return `
        <div class="cat ${isSelected ? 'is-active' : ''}" data-cat-filter="${def.id}" role="button" tabindex="0" aria-label="Filter transactions by ${escapeHtml(def.label)}">
          <span class="cat__label"><span class="cat__swatch" style="--c:${def.color}"></span>${escapeHtml(def.label)}</span>
          <span class="cat__value">${escapeHtml(formatMoney(c.totalMinor))}</span>
          <span class="cat__track"><i style="--c:${def.color}; width:0" data-width="${Math.round((c.totalMinor / max) * 100)}"></i></span>
        </div>`;
    })
    .join('');

  for (const el2 of el.querySelectorAll('.cat__track i')) {
    requestAnimationFrame(() => { el2.style.width = `${el2.dataset.width}%`; });
  }

  el.querySelectorAll('[data-cat-filter]').forEach((btn) => {
    const handleCat = () => {
      const catId = btn.dataset.catFilter;
      haptic.tap();
      if (onCategoryClick) {
        onCategoryClick(catId);
      } else {
        state.filters = {
          ...state.filters,
          categoryId: state.filters.categoryId === catId ? '' : catId,
        };
        state.limit = 25;
        renderLedger(state);
        populateFilters(state);
        q('ledger')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    btn.addEventListener('click', handleCat);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCat();
      }
    });
  });
}

function thisMonthRange(now) {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end: now, label: 'this month' };
}

/* --------------------------------------------------------------------------
   Cash flow
   -------------------------------------------------------------------------- */
export function renderFlow(state, now = Date.now()) {
  const el = q('flow-chart');
  const detailEl = q('flow-detail');
  if (!el) return;

  const months = lastNMonths(6, now).map((m) => {
    const rows = inRange({ start: m.start, end: m.end }).filter((t) => !state.accountId || t.accountId === state.accountId);
    return { ...m, ...summarize(rows) };
  });
  const max = Math.max(...months.flatMap((m) => [m.inflowMinor, m.outflowMinor]), 1);

  el.innerHTML = months
    .map((m) => {
      const inH = Math.round((m.inflowMinor / max) * 100);
      const outH = Math.round((m.outflowMinor / max) * 100);
      const net = m.netMinor >= 0 ? 'positive' : 'negative';
      return `
        <div class="flow__col" data-flow-month="${m.key}" data-label="${escapeHtml(formatMonth(m.ts))}" data-in="${m.inflowMinor}" data-out="${m.outflowMinor}" data-net="${m.netMinor}" tabindex="0" role="button" aria-label="${escapeHtml(`${formatMonth(m.ts)}: In ${formatMoney(m.inflowMinor)}, Out ${formatMoney(m.outflowMinor)}, Net ${formatMoney(m.netMinor)}`)}">
          <div class="flow__bars">
            <span class="flow__bar flow__bar--in" style="height:0" data-h="${inH}"></span>
            <span class="flow__bar flow__bar--out" style="height:0" data-h="${outH}"></span>
          </div>
          <span class="flow__label ${net}">${escapeHtml(formatMonth(m.ts).split(' ')[0])}</span>
        </div>`;
    })
    .join('');

  for (const bar of el.querySelectorAll('.flow__bar')) {
    requestAnimationFrame(() => { bar.style.height = `${bar.dataset.h}%`; });
  }

  el.querySelectorAll('.flow__col').forEach((col) => {
    const showDetail = () => {
      haptic.selection();
      el.querySelectorAll('.flow__col').forEach((c) => c.classList.toggle('is-selected', c === col));
      if (!detailEl) return;
      const inVal = Number(col.dataset.in);
      const outVal = Number(col.dataset.out);
      const netVal = Number(col.dataset.net);
      detailEl.innerHTML = `
        <span class="flow__detail-tag">${col.dataset.label}</span>
        <div class="flow__detail-metrics">
          <span class="flow__detail-in">In +${escapeHtml(formatMoney(inVal))}</span>
          <span class="flow__detail-out">Out −${escapeHtml(formatMoney(outVal))}</span>
          <span class="flow__detail-net ${netVal >= 0 ? 'is-pos' : 'is-neg'}">Net ${escapeHtml(formatMoney(netVal, { signed: true }))}</span>
        </div>`;
    };
    col.addEventListener('click', showDetail);
    col.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showDetail();
      }
    });
  });

  const lastCol = el.querySelector('.flow__col:last-child');
  if (lastCol && detailEl && !detailEl.children.length) {
    lastCol.click();
  }
}

/* --------------------------------------------------------------------------
   Budgets
   -------------------------------------------------------------------------- */
export function renderBudgets(state, now = Date.now()) {
  const el = q('budget-list');
  const note = q('budget-note');
  if (!el) return;

  const range = state.range || thisMonthRange(now);
  setText(note, range.label === 'this month' ? 'Month to date' : range.label);

  const rows = spendTransactions(inRange(range));
  const items = byCategory(rows)
    .filter((c) => categoryById(c.categoryId).budgetMinor)
    .map((c) => {
      const def = categoryById(c.categoryId);
      return { def, spent: c.totalMinor, pct: Math.round((c.totalMinor / def.budgetMinor) * 100) };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  if (!items.length) {
    el.innerHTML = '<p class="empty">Nothing budgeted has been charged yet.</p>';
    return;
  }

  el.innerHTML = items
    .map((i) => `
      <div class="budget">
        <div class="budget__top">
          <span class="budget__name">${escapeHtml(i.def.label)}</span>
          <span class="budget__pct ${i.pct > 100 ? 'is-over' : ''}">${i.pct}%</span>
        </div>
        <div class="budget__track ${i.pct > 100 ? 'is-over' : ''}">
          <i style="--c:${i.def.color}; width:0" data-width="${Math.min(i.pct, 100)}"></i>
        </div>
        <div class="budget__top">
          <span class="budget__nums">${escapeHtml(formatMoney(i.spent))} of <b>${escapeHtml(formatMoney(i.def.budgetMinor, { showCents: false }))}</b></span>
          <button class="budget__edit" type="button" data-budget-edit="${i.def.id}"
                  aria-label="Edit the ${escapeHtml(i.def.label)} budget">Edit</button>
        </div>
      </div>`)
    .join('');

  for (const bar of el.querySelectorAll('.budget__track i')) {
    requestAnimationFrame(() => { bar.style.width = `${bar.dataset.width}%`; });
  }
}

/* --------------------------------------------------------------------------
   Ledger
   -------------------------------------------------------------------------- */
function groupKey(ts, now) {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Earlier this week';
  if (day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear()) return formatMonth(day.getTime());
  return formatMonth(day.getTime());
}

export function renderLedger(state, now = Date.now()) {
  const table = q('ledger-table');
  const count = q('ledger-count');
  const scope = q('ledger-scope');
  const more = q('btn-more');
  if (!table) return;

  const { filters } = state;
  let rows = state.range ? inRange(state.range) : postedTransactions();

  if (filters.accountId) rows = rows.filter((t) => t.accountId === filters.accountId);
  if (filters.categoryId) rows = rows.filter((t) => t.category === filters.categoryId);
  if (filters.direction === 'credit') rows = rows.filter((t) => t.direction === 'credit');
  if (filters.status) rows = rows.filter((t) => (t.status || 'posted') === filters.status);
  if (filters.amountOp && Number.isFinite(filters.amountMinor)) {
    const { amountOp, amountMinor } = filters;
    rows = rows.filter((t) => {
      const v = t.amountMinor;
      if (amountOp === 'gt') return v > amountMinor;
      if (amountOp === 'lt') return v < amountMinor;
      if (amountOp === 'eq') return v === amountMinor;
      return true;
    });
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    rows = rows.filter((t) => `${t.merchant || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase().includes(needle));
  }

  rows.sort((a, b) => (filters.sort === 'large' ? b.amountMinor - a.amountMinor : b.ts - a.ts));

  const limit = state.limit ?? 25;
  const visible = rows.slice(0, limit);

  if (scope) {
    const bits = [state.range?.label || 'All activity'];
    if (filters.accountId) bits.push(accountById(filters.accountId)?.name || '');
    if (filters.categoryId) bits.push(categoryById(filters.categoryId).label);
    if (filters.status) bits.push(filters.status);
    if (filters.amountOp && Number.isFinite(filters.amountMinor)) {
      const word = { gt: 'over', lt: 'under', eq: 'exactly' }[filters.amountOp];
      bits.push(`${word} ${formatMoney(filters.amountMinor)}`);
    }
    if (filters.search) bits.push(`“${filters.search}”`);
    scope.textContent = bits.filter(Boolean).join(' · ');
  }

  if (!visible.length) {
    table.innerHTML = `
      <div class="empty">
        <p>No transactions match these filters.</p>
        <button class="btn btn--ghost" id="empty-clear-filters" type="button" style="margin-top:0.75rem">Reset filters</button>
      </div>`;
    q('empty-clear-filters')?.addEventListener('click', () => {
      haptic.tap();
      state.filters = { accountId: '', categoryId: '', status: '', amountOp: '', amountMinor: null, search: '', sort: 'new', direction: '' };
      state.accountId = null;
      state.range = null;
      state.limit = 25;
      renderLedger(state, now);
      populateFilters(state);
    });
  } else {
    let html = '';
    let currentGroup = null;
    for (const tx of visible) {
      const group = groupKey(tx.ts, now);
      if (group !== currentGroup) {
        currentGroup = group;
        html += `<div class="tx-group"><div class="tx-group__head"><span>${escapeHtml(group)}</span></div>`;
      }
      html += transactionRow(tx);
    }
    html += '</div>';
    table.innerHTML = html;
  }

  if (count) {
    const net = visible.reduce((acc, t) => acc + (t.direction === 'credit' ? t.amountMinor : -t.amountMinor), 0);
    count.textContent = `${visible.length} of ${rows.length} entries · net ${formatMoney(net, { signed: true })}`;
  }
  if (more) more.hidden = rows.length <= visible.length;
}

function transactionRow(tx) {
  const account = accountById(tx.accountId);
  const category = categoryById(tx.category);
  const credit = tx.direction === 'credit';
  const meta = [
    formatDate(tx.ts, { withYear: true }),
    account ? account.nickname : '',
    tx.channel ? tx.channel.toUpperCase() : '',
  ].filter(Boolean);

  return `
    <article class="tx-row" data-tx="${escapeHtml(tx.id)}" role="row" tabindex="0"
             aria-label="${escapeHtml(`${tx.merchant || tx.description}, ${formatMoney(credit ? tx.amountMinor : -tx.amountMinor, { signed: true })}, ${formatDate(tx.ts, { withYear: true })}`)}">
      <span class="tx-row__icon" style="--c:${category.color}" aria-hidden="true">${escapeHtml(category.icon || '•')}</span>
      <span class="tx-row__main">
        <span class="tx-row__merchant">${escapeHtml(tx.merchant || tx.description)}</span>
        <span class="tx-row__meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}
          <span class="pill pill--meta">${escapeHtml(category.label)}</span>
          ${tx.status === 'pending' ? '<span class="pill pill--pending">pending</span>' : ''}
        </span>
      </span>
      <span class="tx-row__cat" role="cell"><span class="pill">${escapeHtml(category.label)}</span></span>
      <span class="tx-row__amount ${credit ? 'is-credit' : 'is-debit'}">${escapeHtml(formatMoney(credit ? tx.amountMinor : -tx.amountMinor, { signed: true }))}</span>
      <span class="tx-row__balance">${tx.balanceAfterMinor === null ? '—' : escapeHtml(formatMoney(tx.balanceAfterMinor))}</span>
      <span class="tx-row__chevron" aria-hidden="true">›</span>
    </article>`;
}

/* --------------------------------------------------------------------------
   Filters
   -------------------------------------------------------------------------- */
export function populateFilters(state) {
  const accountSelect = q('tx-account');
  const categorySelect = q('tx-category');
  const statusSelect = q('tx-status');
  const opSelect = q('tx-op');
  const amountInput = q('tx-amount');
  const search = q('tx-search');
  const filterBadge = q('filter-badge');
  const clearBtn = q('btn-clear-filters');

  let activeCount = 0;
  if (state.filters.accountId) activeCount += 1;
  if (state.filters.categoryId) activeCount += 1;
  if (state.filters.status) activeCount += 1;
  if (state.filters.amountOp && Number.isFinite(state.filters.amountMinor)) activeCount += 1;
  if (state.filters.search) activeCount += 1;

  if (filterBadge) {
    if (activeCount > 0) {
      filterBadge.textContent = String(activeCount);
      filterBadge.hidden = false;
    } else {
      filterBadge.hidden = true;
    }
  }

  if (clearBtn) {
    clearBtn.hidden = activeCount === 0;
  }

  if (accountSelect) {
    accountSelect.innerHTML = ['<option value="">All accounts</option>']
      .concat(store.accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
      .join('');
    accountSelect.value = state.filters.accountId || '';
  }
  if (categorySelect) {
    const used = new Set(postedTransactions().map((t) => t.category));
    categorySelect.innerHTML = ['<option value="">All categories</option>']
      .concat(store.categories.filter((c) => used.has(c.id)).map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`))
      .join('');
    categorySelect.value = state.filters.categoryId || '';
  }
  if (statusSelect && statusSelect.value !== (state.filters.status || '')) {
    statusSelect.value = state.filters.status || '';
  }
  if (opSelect && opSelect.value !== (state.filters.amountOp || '')) {
    opSelect.value = state.filters.amountOp || '';
  }
  if (amountInput) {
    const wanted = Number.isFinite(state.filters.amountMinor) ? String(state.filters.amountMinor / 100) : '';
    if (amountInput.value !== wanted && document.activeElement !== amountInput) amountInput.value = wanted;
  }
  if (search && search.value !== (state.filters.search || '') && document.activeElement !== search) {
    search.value = state.filters.search || '';
  }
}

/* --------------------------------------------------------------------------
   Session chip
   -------------------------------------------------------------------------- */
export function renderSessionChip(sessionId) {
  const el = q('session-label');
  if (el) el.textContent = `session ${sessionId.replace('sess_', '').slice(0, 8)}`;
}

export { sparkline, monthKey, recurringCharges, relativeTime };
