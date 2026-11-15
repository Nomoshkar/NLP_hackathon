/**
 * Money helpers. All amounts are stored as integer minor units (cents) so that
 * arithmetic never accumulates binary floating point error.
 */

export const CURRENCY = 'USD';

const SCALE = 100;

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function toMinor(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.\-]/g, '')) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * SCALE);
}

export function fromMinor(minor) {
  return (Number(minor) || 0) / SCALE;
}

/**
 * @param {number} minor integer cents
 * @param {{signed?: boolean, compact?: boolean, showCents?: boolean}} [opts]
 */
export function formatMoney(minor, opts = {}) {
  const value = fromMinor(minor);
  const { signed = false, compact = false, showCents = true } = opts;
  let text;
  if (compact && Math.abs(value) >= 10000) {
    text = compactFormatter.format(value);
  } else if (!showCents) {
    text = moneyFormatter.format(Math.round(value));
  } else {
    text = moneyFormatter.format(value);
  }
  if (signed && value > 0) return `+${text}`;
  return text;
}

export function formatMinorParts(minor) {
  const value = Math.abs(fromMinor(minor));
  const whole = Math.floor(value);
  const cents = Math.round((value - whole) * 100);
  return {
    whole: new Intl.NumberFormat('en-US').format(whole),
    cents: String(cents).padStart(2, '0'),
    negative: minor < 0,
  };
}

const WORD_SCALE = {
  hundred: 100,
  thousand: 1000,
  million: 1000000,
  billion: 1000000000,
};

const WORD_UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

function parseFraction(tokens) {
  if (!tokens.length) return 0;
  const digits = tokens
    .map((t) => (t in WORD_UNITS ? WORD_UNITS[t] : /^\d+$/.test(t) ? Number(t) : null))
    .filter((v) => v !== null);
  if (!digits.length) return 0;
  return Number(`0.${digits.join('')}`);
}

/** True when the phrase contains a magnitude word (hundred/thousand/…). */
function hasScaleWord(phrase) {
  return /\b(hundred|thousand|million|billion|hundreds|thousands|millions)\b/.test(phrase);
}

/**
 * Turn a spoken or written English number phrase into a value.
 * "two hundred and fifty" -> 250, "one point five" -> 1.5
 */
export function parseWordsNumber(phrase) {
  if (!phrase) return null;
  const tokens = String(phrase)
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'and');

  if (!tokens.length) return null;

  let total = 0;
  let current = 0;
  let seenWord = false;
  let decimal = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === 'point') {
      const rest = tokens.slice(i + 1);
      decimal = /^\d+$/.test(rest.join('')) && rest.length
        ? Number(`0.${rest.join('')}`)
        : parseFraction(rest);
      break;
    }
    if (/^\d+(\.\d+)?$/.test(token)) {
      current += Number(token);
      seenWord = true;
      continue;
    }
    if (token in WORD_UNITS) {
      current += WORD_UNITS[token];
      seenWord = true;
      continue;
    }
    if (token in WORD_SCALE) {
      const scale = WORD_SCALE[token];
      current = (current || 1) * scale;
      if (scale >= 1000) {
        total += current;
        current = 0;
      }
      seenWord = true;
      continue;
    }
    if (token === 'a' || token === 'an') {
      current += 1;
      seenWord = true;
      continue;
    }
    return null;
  }

  if (!seenWord) return null;
  const value = total + current + decimal;
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse a free-form money expression into integer minor units.
 * Understands "$1,204.50", "1204", "1.2k", "2 grand", "two hundred and fifty",
 * "twelve fifty" and "50 bucks". Returns null when no amount is present.
 */
export function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;

  // "grand" is a multiplier (1,000), not a currency word, so it must survive
  // the strip and be read by the scale matcher below.
  const normalized = text
    .replace(/(\d)[,_](?=\d{3}\b)/g, '$1')
    .replace(/[$€£]/g, ' ')
    .replace(/\b(usd|dollars?|bucks?|quid)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const scaleMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(k|m|million|thousand|grand)\b/);
  if (scaleMatch) {
    const mult = { k: 1e3, m: 1e6, million: 1e6, thousand: 1e3, grand: 1e3 }[scaleMatch[2]];
    return Math.round(Number(scaleMatch[1]) * mult * SCALE);
  }

  const plain = normalized.match(/-?\d+(?:\.\d+)?/);
  if (plain) {
    const value = Number(plain[0]);
    if (!Number.isFinite(value)) return null;
    return Math.round(value * SCALE);
  }

  // "twelve fifty" is shorthand for dollars and cents. It only applies when the
  // cents word is a multiple of ten and neither part carries a scale word —
  // otherwise "two hundred and fifty" reads as $200.50 instead of $250, and
  // "twenty five" as $20.05 instead of $25.
  const shorthand = normalized.match(/^([a-z\s]+?)\s+(?:and\s+)?([a-z]+)$/);
  if (shorthand && !hasScaleWord(shorthand[1]) && !hasScaleWord(shorthand[2])) {
    const dollars = parseWordsNumber(shorthand[1]);
    const cents = parseWordsNumber(shorthand[2]);
    if (dollars !== null && cents !== null && dollars < 100 && cents > 0 && cents < 100 && cents % 10 === 0) {
      return dollars * SCALE + cents;
    }
  }

  const words = parseWordsNumber(normalized);
  if (words !== null) return Math.round(words * SCALE);
  return null;
}

export function sumMinor(values) {
  return values.reduce((acc, v) => acc + (Number(v) || 0), 0);
}
