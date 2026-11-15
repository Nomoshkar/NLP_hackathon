/** Date, text and identifier formatting helpers. */

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function addDays(ts, days) {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addMonths(ts, months) {
  const d = new Date(ts);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateYearFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function formatDate(ts, { withYear = false, weekday = false } = {}) {
  if (!ts) return '—';
  if (weekday) return weekdayFmt.format(new Date(ts));
  return (withYear ? dateYearFmt : dateFmt).format(new Date(ts));
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  return `${dateFmt.format(new Date(ts))} · ${timeFmt.format(new Date(ts))}`;
}

export function formatMonth(ts) {
  return monthFmt.format(new Date(ts));
}

export function formatTime(ts) {
  return timeFmt.format(new Date(ts));
}

export function relativeTime(ts, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['week', 604800000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  const fmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function initials(text) {
  return String(text || '?')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}

export function truncate(text, max = 60) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
