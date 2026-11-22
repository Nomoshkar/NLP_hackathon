/**
 * Small, dependency-free SVG chart helpers.
 *
 * Hand-rolled rather than pulled from a charting library: the shapes needed
 * here are simple, and this keeps the whole app to two vendored dependencies.
 */

import { formatMoney } from '../util/money.js';
import { escapeHtml, formatMonth } from '../util/format.js';

function niceStep(range, targetTicks = 4) {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Area + line chart of a monthly balance series.
 * @param {Array<{key:string, ts:number, balanceMinor:number}>} series
 */
export function balanceTrend(series, { width = 860, height = 260 } = {}) {
  if (!series.length) return '<p class="empty">No balance history yet.</p>';

  const pad = { top: 22, right: 20, bottom: 30, left: 62 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = series.map((s) => s.balanceMinor);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const step = niceStep(max - min || Math.abs(max) || 1);
  const top = Math.ceil(max / step) * step + step * 0.25;
  const bottom = Math.min(0, Math.floor(min / step) * step);

  const x = (i) => pad.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - ((v - bottom) / (top - bottom || 1)) * innerH;

  const points = series.map((s, i) => [x(i), y(s.balanceMinor)]);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${(pad.top + innerH).toFixed(1)} L${points[0][0].toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  // Horizontal gridlines with currency labels.
  let grid = '';
  for (let v = bottom; v <= top; v += step) {
    const gy = y(v);
    grid += `<line class="chart__grid" x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${(pad.left + innerW).toFixed(1)}" y2="${gy.toFixed(1)}" />`;
    grid += `<text class="chart__axis" x="${pad.left - 10}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(formatMoney(v, { compact: true, showCents: false }))}</text>`;
  }

  const zeroLine = bottom < 0 && top > 0
    ? `<line class="chart__zero" x1="${pad.left}" y1="${y(0).toFixed(1)}" x2="${(pad.left + innerW).toFixed(1)}" y2="${y(0).toFixed(1)}" />`
    : '';

  const xLabels = series
    .map((s, i) => {
      if (series.length > 8 && i % 2 !== 0) return '';
      const label = formatMonth(s.ts).split(' ')[0];
      return `<text class="chart__axis" x="${x(i).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(label)}</text>`;
    })
    .join('');

  const dots = points
    .map(([px, py], i) => `<circle class="chart__dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" data-index="${i}" data-x="${px.toFixed(1)}" data-y="${py.toFixed(1)}" data-month="${escapeHtml(formatMonth(series[i].ts))}" data-amount="${escapeHtml(formatMoney(series[i].balanceMinor))}" style="animation-delay:${(0.55 + i * 0.06).toFixed(2)}s"><title>${escapeHtml(`${formatMonth(series[i].ts)}: ${formatMoney(series[i].balanceMinor)}`)}</title></circle>`)
    .join('');

  const pathLen = Math.round(points.reduce((acc, [px, py], i) => {
    if (i === 0) return 0;
    const [qx, qy] = points[i - 1];
    return acc + Math.hypot(px - qx, py - qy);
  }, 0) * 1.08) || 1000;

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="presentation">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1c6a58" stop-opacity="0.30" />
          <stop offset="100%" stop-color="#1c6a58" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${grid}
      ${zeroLine}
      <path class="chart__area" d="${area}" />
      <path class="chart__line" style="--len:${pathLen}" d="${line}" />
      <line class="chart__scrubber" id="trend-scrubber" x1="0" y1="${pad.top}" x2="0" y2="${pad.top + innerH}" />
      <circle class="chart__scrubber-dot" id="trend-scrubber-dot" cx="0" cy="0" r="5.5" />
      ${dots}
      ${xLabels}
      <rect class="chart__overlay" id="trend-overlay" x="0" y="0" width="${width}" height="${height}" fill="transparent" />
    </svg>
    <div class="chart__tooltip" id="trend-tooltip" aria-hidden="true"></div>`;
}

/** Compact in-bubble sparkline of monthly totals. */
export function sparkline(values, { width = 220, height = 46, color = '#1c6a58' } = {}) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * stepX, height - ((v - min) / span) * (height - 8) - 4]);
  const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="presentation" style="max-width:100%">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3" fill="${color}" />
    </svg>`;
}
