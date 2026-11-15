/**
 * Time expression parsing for the assistant.
 *
 * Handles relative windows ("last month"), named months ("in march"),
 * explicit years, and single days ("yesterday"). Returns an inclusive range of
 * epoch millisecond boundaries plus a human label for the reply.
 */

import { addDays, addMonths, endOfDay, formatMonth, monthKey, startOfDay } from '../util/format.js';
import { MONTH_NAMES } from './lexicon.js';

const PERIOD = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  THIS_WEEK: 'this_week',
  LAST_WEEK: 'last_week',
  THIS_MONTH: 'this_month',
  LAST_MONTH: 'last_month',
  THIS_QUARTER: 'this_quarter',
  LAST_QUARTER: 'last_quarter',
  THIS_YEAR: 'this_year',
  LAST_YEAR: 'last_year',
  LAST_7: 'last_7_days',
  LAST_30: 'last_30_days',
  LAST_90: 'last_90_days',
  LAST_12_MONTHS: 'last_12_months',
  ALL: 'all_time',
};

export const PERIOD_LABELS = {
  [PERIOD.TODAY]: 'today',
  [PERIOD.YESTERDAY]: 'yesterday',
  [PERIOD.THIS_WEEK]: 'this week',
  [PERIOD.LAST_WEEK]: 'last week',
  [PERIOD.THIS_MONTH]: 'this month',
  [PERIOD.LAST_MONTH]: 'last month',
  [PERIOD.THIS_QUARTER]: 'this quarter',
  [PERIOD.LAST_QUARTER]: 'last quarter',
  [PERIOD.THIS_YEAR]: 'this year',
  [PERIOD.LAST_YEAR]: 'last year',
  [PERIOD.LAST_7]: 'the last 7 days',
  [PERIOD.LAST_30]: 'the last 30 days',
  [PERIOD.LAST_90]: 'the last 90 days',
  [PERIOD.LAST_12_MONTHS]: 'the last 12 months',
  [PERIOD.ALL]: 'all time',
};

function quarterRange(now, offset) {
  const d = new Date(now);
  const q = Math.floor(d.getMonth() / 3) + offset;
  const start = new Date(d.getFullYear(), q * 3, 1);
  const end = new Date(d.getFullYear(), q * 3 + 3, 0);
  return { start: start.getTime(), end: endOfDay(end.getTime()) };
}

/** Resolve a named period into a concrete range. */
export function periodRange(period, now = Date.now()) {
  const d = new Date(now);
  const year = d.getFullYear();
  switch (period) {
    case PERIOD.TODAY:
      return { start: startOfDay(now), end: now, label: 'today' };
    case PERIOD.YESTERDAY: {
      const y = addDays(now, -1);
      return { start: startOfDay(y), end: endOfDay(y), label: 'yesterday' };
    }
    case PERIOD.THIS_WEEK: {
      const day = d.getDay();
      const monday = addDays(now, -((day + 6) % 7));
      return { start: startOfDay(monday), end: now, label: 'this week' };
    }
    case PERIOD.LAST_WEEK: {
      const day = d.getDay();
      const monday = addDays(now, -((day + 6) % 7) - 7);
      return { start: startOfDay(monday), end: endOfDay(addDays(monday, 6)), label: 'last week' };
    }
    case PERIOD.THIS_MONTH:
      return { start: new Date(year, d.getMonth(), 1).getTime(), end: now, label: 'this month' };
    case PERIOD.LAST_MONTH: {
      const start = new Date(year, d.getMonth() - 1, 1);
      const end = new Date(year, d.getMonth(), 0);
      return { start: start.getTime(), end: endOfDay(end.getTime()), label: 'last month' };
    }
    case 'month_before_last': {
      const start = new Date(year, d.getMonth() - 2, 1);
      const end = new Date(year, d.getMonth() - 1, 0);
      return { start: start.getTime(), end: endOfDay(end.getTime()), label: 'the month before' };
    }
    case 'year_before_last':
      return {
        start: new Date(year - 2, 0, 1).getTime(),
        end: endOfDay(new Date(year - 2, 11, 31).getTime()),
        label: 'the year before',
      };
    case PERIOD.THIS_QUARTER: {
      const q = quarterRange(now, 0);
      return { ...q, end: now, label: 'this quarter' };
    }
    case PERIOD.LAST_QUARTER:
      return { ...quarterRange(now, -1), label: 'last quarter' };
    case PERIOD.THIS_YEAR:
      return { start: new Date(year, 0, 1).getTime(), end: now, label: 'this year' };
    case PERIOD.LAST_YEAR:
      return {
        start: new Date(year - 1, 0, 1).getTime(),
        end: endOfDay(new Date(year - 1, 11, 31).getTime()),
        label: 'last year',
      };
    case PERIOD.LAST_7:
      return { start: startOfDay(addDays(now, -6)), end: now, label: 'the last 7 days' };
    case PERIOD.LAST_30:
      return { start: startOfDay(addDays(now, -29)), end: now, label: 'the last 30 days' };
    case PERIOD.LAST_90:
      return { start: startOfDay(addDays(now, -89)), end: now, label: 'the last 90 days' };
    case PERIOD.LAST_12_MONTHS:
      return { start: new Date(year - 1, d.getMonth(), 1).getTime(), end: now, label: 'the last 12 months' };
    default:
      return { start: 0, end: now, label: 'all time' };
  }
}

export function monthRange(year, monthIndex) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return {
    start: start.getTime(),
    end: endOfDay(end.getTime()),
    label: formatMonth(start.getTime()),
  };
}

export function previousMonthKey(now = Date.now()) {
  return monthKey(addMonths(now, -1));
}

/**
 * Find a time range inside free text.
 * @returns {{start:number,end:number,label:string,period:string|null}|null}
 */
export function extractRange(text, now = Date.now()) {
  const q = ` ${String(text).toLowerCase().replace(/[^a-z0-9'\- ]/g, ' ').replace(/\s+/g, ' ')} `;
  const d = new Date(now);

  const has = (...phrases) => phrases.some((p) => q.includes(` ${p} `));

  if (has('year to date', 'ytd')) return { ...periodRange(PERIOD.THIS_YEAR, now), period: PERIOD.THIS_YEAR };
  if (has('to date', 'so far')) return { ...periodRange(PERIOD.THIS_MONTH, now), period: PERIOD.THIS_MONTH };
  if (has('today')) return { ...periodRange(PERIOD.TODAY, now), period: PERIOD.TODAY };
  if (has('yesterday')) return { ...periodRange(PERIOD.YESTERDAY, now), period: PERIOD.YESTERDAY };
  if (has('last week', 'previous week')) return { ...periodRange(PERIOD.LAST_WEEK, now), period: PERIOD.LAST_WEEK };
  if (has('this week', 'current week')) return { ...periodRange(PERIOD.THIS_WEEK, now), period: PERIOD.THIS_WEEK };
  if (has('last month', 'previous month')) return { ...periodRange(PERIOD.LAST_MONTH, now), period: PERIOD.LAST_MONTH };
  if (has('this month', 'current month')) return { ...periodRange(PERIOD.THIS_MONTH, now), period: PERIOD.THIS_MONTH };
  if (has('last quarter', 'previous quarter')) return { ...periodRange(PERIOD.LAST_QUARTER, now), period: PERIOD.LAST_QUARTER };
  if (has('this quarter', 'current quarter')) return { ...periodRange(PERIOD.THIS_QUARTER, now), period: PERIOD.THIS_QUARTER };
  if (has('last year', 'previous year')) return { ...periodRange(PERIOD.LAST_YEAR, now), period: PERIOD.LAST_YEAR };
  if (has('this year', 'current year')) return { ...periodRange(PERIOD.THIS_YEAR, now), period: PERIOD.THIS_YEAR };

  const lastN = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+(day|days|week|weeks|month|months|year|years)\b/);
  if (lastN) {
    const n = Number(lastN[1]);
    const unit = lastN[2];
    let start;
    if (unit.startsWith('day')) start = startOfDay(addDays(now, -(n - 1)));
    else if (unit.startsWith('week')) start = startOfDay(addDays(now, -7 * (n - 1) - 6));
    else if (unit.startsWith('month')) start = startOfDay(addMonths(now, -n) + 86400000);
    else start = startOfDay(addMonths(now, -12 * n) + 86400000);
    return { start, end: now, label: `the last ${n} ${unit}`, period: PERIOD.LAST_30 };
  }

  const namedMonth = q.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4}))?/,
  );
  if (namedMonth) {
    const monthIndex = MONTH_NAMES.indexOf(namedMonth[1]);
    let year = namedMonth[2] ? Number(namedMonth[2]) : d.getFullYear();
    if (!namedMonth[2] && monthIndex > d.getMonth()) year -= 1;
    return { ...monthRange(year, monthIndex), period: `month:${year}-${monthIndex + 1}` };
  }

  const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    if (iso[3]) {
      const ts = new Date(year, month, Number(iso[3])).getTime();
      return { start: startOfDay(ts), end: endOfDay(ts), label: `on ${iso[0]}`, period: `day:${iso[0]}` };
    }
    return { ...monthRange(year, month), period: `month:${year}-${month + 1}` };
  }

  const slashDate = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    let year = slashDate[3] ? Number(slashDate[3]) : d.getFullYear();
    if (year < 100) year += 2000;
    const ts = new Date(year, Number(slashDate[1]) - 1, Number(slashDate[2])).getTime();
    return { start: startOfDay(ts), end: endOfDay(ts), label: `on ${slashDate[0]}`, period: `day:${slashDate[0]}` };
  }

  const dayOfMonth = q.match(/\b(?:on the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    if (day >= 1 && day <= 31) {
      const ts = new Date(d.getFullYear(), d.getMonth(), day).getTime();
      return { start: startOfDay(ts), end: endOfDay(ts), label: `on the ${day}${ordinalSuffix(day)}`, period: `day:${day}` };
    }
  }

  return null;
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

/** Default window for spend/income summaries when the user says nothing. */
export function defaultRange(now = Date.now()) {
  return periodRange(PERIOD.THIS_MONTH, now);
}

export { PERIOD };
