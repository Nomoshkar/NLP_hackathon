/**
 * Lexicon for the rule-based natural language layer.
 *
 * No AI service is involved: intent detection is keyword/regex scoring plus
 * part-of-speech tagging from the bundled compromise library. Keeping the
 * vocabulary in one place makes the assistant easy to audit and extend.
 */

/** Intent patterns. Each match contributes `weight` to that intent's score. */
export const INTENT_PATTERNS = [
  // ---- greetings / meta -------------------------------------------------
  { intent: 'greeting', weight: 3, patterns: [/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/] },
  { intent: 'help', weight: 4, patterns: [/\b(help|what can you do|how do i|commands|examples?)\b/] },
  { intent: 'thanks', weight: 3, patterns: [/\b(thanks|thank you|cheers|appreciate it)\b/] },

  // ---- balances ---------------------------------------------------------
  { intent: 'balance', weight: 5, patterns: [/\b(balance|how much (do i have|is in|left)|funds available|available (funds|balance))\b/] },
  { intent: 'balance', weight: 2, patterns: [/\bwhat'?s in\b/, /\bhow are my accounts\b/] },
  { intent: 'balance', weight: 7, patterns: [/\bwhat (are|r) my balances?\b/, /\bmy balances?\b/, /\bhow much (money )?do i have\b/, /\bbalances?\b/] },
  { intent: 'net_worth', weight: 6, patterns: [/\bnet worth\b/, /\bworth overall\b/, /\btotal (assets|money)\b/] },

  // ---- summaries --------------------------------------------------------
  { intent: 'account_summary', weight: 5, patterns: [/\b(account summary|summary of my account|overview|snapshot|dashboard|how am i doing)\b/] },
  { intent: 'spend_summary', weight: 6, patterns: [/\b(how much (did|have) i (spend|spent)|spending|spent (on|this|last)|where (is|did) my money go|top (categories|spend|expenses))\b/] },
  { intent: 'income_summary', weight: 6, patterns: [/\b(how much (did|have) i (earn|earned|make|made)|income|earnings|salary|paycheck|payroll)\b/] },
  { intent: 'cashflow', weight: 6, patterns: [/\b(cash ?flow|money in and out|income vs|net (income|change)|inflow|outflow)\b/] },
  { intent: 'budget_status', weight: 6, patterns: [/\b(budget|over ?spend(ing)?|within budget|am i (over|under))\b/] },
  { intent: 'compare_months', weight: 7, patterns: [/\b(compare|versus|vs\.?|difference between|than last month|more than (last|this))\b/] },

  // ---- transaction exploration -----------------------------------------
  { intent: 'list_transactions', weight: 5, patterns: [/\b(show|list|see|view|display|what are)\b[^.]*\b(transactions?|activity|charges?|purchases?|payments?|history|statement|ledger)\b/] },
  { intent: 'list_transactions', weight: 4, patterns: [/\b(recent|latest|last) (transactions?|activity|charges?|purchases?)\b/, /\btransaction history\b/] },
  { intent: 'search_transactions', weight: 5, patterns: [/\b(search|find|look ?up|any|did i (buy|pay))\b/] },
  { intent: 'largest_expense', weight: 7, patterns: [/\b(biggest|largest|most expensive|highest) (purchase|expense|payment|charge|transaction)\b/] },
  { intent: 'recurring', weight: 7, patterns: [/\b(subscriptions?|recurring|repeat(ing)? (charge|payment)|monthly (charges?|bills?))\b/] },

  // ---- money movement ---------------------------------------------------
  { intent: 'deposit', weight: 6, patterns: [/\b(deposit|top ?up|add (money|funds|cash)|\bput (money|funds|cash|in)|pay ?in|load)\b/] },
  { intent: 'withdraw', weight: 6, patterns: [/\b(withdraw|take out|cash out|pull out|get cash|retrieve (money|cash|funds))\b/] },
  { intent: 'transfer', weight: 6, patterns: [/\b(transfer|move|shift|send|wire)\b/] },
  { intent: 'pay_card', weight: 7, patterns: [/\b(pay (off|down|the)? ?(my )?(credit )?card|card payment|pay the (card|balance))\b/] },

  // ---- transactions metadata -------------------------------------------
  { intent: 'list_transactions', weight: 2, patterns: [/\btransactions?\b/] },

  // ---- session control --------------------------------------------------
  { intent: 'undo', weight: 9, patterns: [/\bundo\b/, /\breverse (that|it|the last)\b/, /\bput it back\b/, /\bcancel that\b/] },
  { intent: 'reset', weight: 9, patterns: [/\breset\b[^.]*\b(session|demo|data|ledger|everything)\b/, /\bstart over\b/, /\bclear (all|the) (data|transactions|ledger)\b/, /\bwipe\b/] },
];

/** Words that indicate a debit vs a credit when moving money. */
export const DIRECTION_WORDS = {
  in: ['deposit', 'top up', 'add', 'put', 'pay in', 'load', 'credit', 'into', 'in to', 'receive', 'reimburse'],
  out: ['withdraw', 'take out', 'cash out', 'pull out', 'retrieve', 'spend', 'debit', 'out of', 'from'],
};

export const PERIOD_WORDS = [
  'today', 'yesterday', 'tomorrow', 'this week', 'last week', 'next week',
  'this month', 'last month', 'this year', 'last year', 'this quarter',
  'last quarter', 'weekend', 'so far', 'to date', 'year to date', 'ytd',
  'recently', 'lately', 'past', 'last',
];

export const CATEGORY_TERMS = {
  groceries: ['grocer', 'grocery', 'groceries', 'supermarket', 'market', 'food shopping', 'produce'],
  dining: ['restaurant', 'dining', 'dinner', 'lunch', 'breakfast', 'coffee', 'cafe', 'café', 'takeout', 'take-out', 'eat out', 'bar', 'drinks', 'food delivery'],
  housing: ['rent', 'mortgage', 'housing', 'apartment', 'landlord', 'lease'],
  utilities: ['utility', 'utilities', 'electric', 'electricity', 'power bill', 'water bill', 'internet', 'gas bill', 'heating'],
  transport: ['transport', 'transportation', 'gas', 'fuel', 'petrol', 'uber', 'lyft', 'ride', 'rideshare', 'taxi', 'transit', 'subway', 'metro', 'parking', 'toll'],
  subscriptions: ['subscription', 'subscriptions', 'streaming', 'recurring', 'membership', 'software', 'cloud', 'saas'],
  health: ['health', 'medical', 'doctor', 'dentist', 'pharmacy', 'prescription', 'clinic', 'hospital', 'therapy', 'gym'],
  shopping: ['shopping', 'clothes', 'clothing', 'apparel', 'shoes', 'electronics', 'furniture', 'amazon', 'retail'],
  travel: ['travel', 'flight', 'hotel', 'airbnb', 'vacation', 'holiday', 'airline', 'trip', 'luggage'],
  fees: ['fee', 'fees', 'atm', 'interest charge', 'overdraft', 'penalty', 'bank charge'],
  income: ['income', 'salary', 'payroll', 'paycheck', 'wages', 'deposit from work', 'interest earned', 'dividend', 'refund'],
  transfer: ['transfer', 'transfers', 'moved', 'moving money'],
};

/** Merchant spelling variants -> canonical merchant name used in the ledger. */
export const MERCHANT_ALIASES = {
  'verdant market': 'Verdant Market',
  'verdant': 'Verdant Market',
  'corner grocer': 'Corner Grocer',
  'marrow': 'Marrow & Sons',
  'marrow & sons': 'Marrow & Sons',
  'tidepool': 'Tidepool Co-op',
  'sable': 'Sable Coffee',
  'sable coffee': 'Sable Coffee',
  'noodle bar': 'Noodle Bar Nine',
  'noodle bar nine': 'Noodle Bar Nine',
  'fable bakery': 'Fable Bakery',
  'copper kettle': 'The Copper Kettle',
  'metro transit': 'Metro Transit',
  'metro': 'Metro Transit',
  'lyra': 'Lyra Rideshare',
  'halcyon': 'Halcyon Fuel',
  'parkway garage': 'Parkway Garage',
  'cityline': 'Cityline Power',
  'northgate water': 'Northgate Water',
  'fibrewave': 'Fibrewave Internet',
  'kestrel': 'Kestrel Streaming',
  'kestrel streaming': 'Kestrel Streaming',
  'pulse music': 'Pulse Music',
  'draftbox': 'Draftbox Cloud',
  'draftbox cloud': 'Draftbox Cloud',
  'meadow lane': 'Meadow Lane Clinic',
  'northside pharmacy': 'Northside Pharmacy',
  'paper lantern': 'Paper Lantern Goods',
  'atlas outfitters': 'Atlas Outfitters',
  'mono supply': 'Mono Supply',
  'harbor air': 'Harbor Air',
  'bellwether': 'Bellwether Hotels',
  'nomoshkar labs': 'Nomoshkar Labs',
  'harborview': 'Harborview Apartments',
};

/** Verbs that hint at an action, used to weight intent scoring. */
export const ACTION_VERBS = {
  deposit: ['deposit', 'add', 'put', 'top', 'load', 'pay'],
  withdraw: ['withdraw', 'take', 'cash', 'pull', 'retrieve', 'get'],
  transfer: ['transfer', 'move', 'shift', 'send', 'wire'],
  pay_card: ['pay', 'settle', 'clear'],
  show: ['show', 'list', 'see', 'view', 'display', 'print', 'find', 'search'],
};

/** Budgets the demo assistant can reason about, keyed by category id. */
export const BUDGET_CATEGORIES = [
  'housing', 'groceries', 'dining', 'transport', 'utilities',
  'subscriptions', 'health', 'shopping', 'travel', 'fees',
];

export const ACCOUNT_TYPE_WORDS = {
  checking: ['checking', 'chequing', 'current account', 'everyday'],
  savings: ['savings', 'save', 'hys', 'high yield', 'high-yield'],
  credit: ['credit', 'card', 'rewards'],
};

export const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
