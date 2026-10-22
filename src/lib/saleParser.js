const CURRENCY = String.raw`(?:GHS|GH₵|₵|Ghana\s+cedis?|cedis?|pesewas?)`;
const DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
  "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "and"
].join("|");
const WORD_AMOUNT = String.raw`(?:${NUMBER_WORDS})(?:[\s-]+(?:${NUMBER_WORDS}))*`;
const AMOUNT = String.raw`(?:${DIGITS}|${WORD_AMOUNT})`;
const CURRENCY_AMOUNT = new RegExp(
  String.raw`(?:${CURRENCY}\s*${AMOUNT}|${AMOUNT}\s*${CURRENCY})`,
  "gi"
);

function numberFromWords(value) {
  const units = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90
  };
  let total = 0;
  let current = 0;
  let foundNumber = false;

  for (const word of value.toLowerCase().replace(/-/g, " ").split(/\s+/)) {
    if (word === "and") continue;
    if (Object.hasOwn(units, word)) {
      current += units[word];
      foundNumber = true;
    } else if (word === "hundred" && current > 0) {
      current *= 100;
    } else if (word === "thousand" && current > 0) {
      total += current * 1000;
      current = 0;
    } else if (word === "million" && current > 0) {
      total += current * 1_000_000;
      current = 0;
    } else {
      return "";
    }
  }

  return foundNumber ? String(total + current) : "";
}

function normalizeAmount(value) {
  if (!/\d/.test(value)) return numberFromWords(value);
  const normalized = value.replace(/\s/g, "");
  if (normalized.includes(".") && normalized.includes(",")) {
    return normalized.replace(/,/g, "");
  }
  if (normalized.includes(",")) {
    return /,\d{1,2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  }
  return normalized;
}

function amountFromCurrencyMatch(match) {
  const amount = match.match(new RegExp(AMOUNT, "i"))?.[0] ?? "";
  const value = normalizeAmount(amount);
  if (!value || !/\bpesewas?\b/i.test(match)) return value;
  return String(Number(value) / 100);
}

function extractAmount(text) {
  CURRENCY_AMOUNT.lastIndex = 0;
  const currencyMatches = [...text.matchAll(CURRENCY_AMOUNT)];
  if (currencyMatches.length) return amountFromCurrencyMatch(currencyMatches[0][0]);

  const forMatch = text.match(new RegExp(String.raw`\bfor\s+(${AMOUNT})`, "i"));
  if (forMatch) return normalizeAmount(forMatch[1]);

  return "";
}

function extractQuantity(text) {
  const match = text.match(/\b(?:bought|buy|sold|sell|selling|got|take|took)\s+(\d+(?:[.,]\d+)?)\b/i)
    ?? text.match(/\b(\d+(?:[.,]\d+)?)\s+(?=[\p{L}])/iu);
  return match?.[1]?.replace(",", ".") ?? "";
}

function extractItem(text) {
  const itemEnd = String.raw`(?=\s+(?:to|for|on\s+(?:credit|cash)|using|via|paid|by|with|credit|cash|momo|mobile\s+money)\b|\s+(?:${AMOUNT})\s*(?:${CURRENCY})?\s*$|\s*[,;.]|$)`;
  const action = text.match(new RegExp(
    String.raw`\b(?:sold|selling|sell|bought|buy|purchased|got|took)\s+(?:(?:${DIGITS}|${WORD_AMOUNT})\s+)?(?:(?:a|an|the)\s+)?(.+?)${itemEnd}`,
    "i"
  ));
  if (action) return cleanItemDescription(action[1]);

  const explicitItem = text.match(
    new RegExp(String.raw`\bitem(?:\s+description)?\s*(?:is|was|:)\s*(.+?)${itemEnd}`, "i")
  );
  if (explicitItem) return cleanItemDescription(explicitItem[1]);

  const saleForCustomer = text.match(
    new RegExp(String.raw`\b(?:sale|transaction)\s+for\s+[^,:]+[:,]\s*(.+?)${itemEnd}`, "i")
  );
  if (saleForCustomer) return cleanItemDescription(saleForCustomer[1]);

  return "";
}

function cleanItemDescription(value) {
  return value
    .replace(/^(?:(?:a|an|the|some)\s+)+/i, "")
    .replace(/\s+(?:on\s+)?(?:credit|cash|momo|mobile money)\b.*$/i, "")
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, "")
    .trim();
}

function extractCustomerName(text) {
  const nameEnd = String.raw`(?=\s+(?:for|on|with|using|by|paid|at|phone|number|bought|buy|purchased|got|took)\b|[:,;.]|$)`;
  const explicit = text.match(
    new RegExp(String.raw`\b(?:customer(?:'s)?(?:\s+name)?|name)\s*(?:is|was|:)?\s+(.+?)${nameEnd}`, "i")
  );
  if (explicit) return cleanCustomerName(explicit[1]);

  const soldTo = text.match(
    new RegExp(String.raw`\b(?:sold|selling|sell)\b.+?\bto\s+(.+?)${nameEnd}`, "i")
  );
  if (soldTo) return cleanCustomerName(soldTo[1]);

  const bought = text.match(/^(.+?)\s+\b(?:bought|buy|purchased|got|took)\b/i);
  if (bought) {
    const name = bought[1]
      .replace(/^(?:(?:i|we)\s+)?(?:(?:the\s+)?customer|sale)\s+/i, "")
      .replace(/^(?:i|we)\s+/i, "");
    return cleanCustomerName(name);
  }

  const saleFor = text.match(
    new RegExp(String.raw`\b(?:sale\s+)?for\s+(?:customer\s+)?(.+?)${nameEnd}`, "i")
  );
  if (saleFor) return cleanCustomerName(saleFor[1]);

  return "";
}

function cleanCustomerName(value) {
  return value
    .replace(/^(?:customer|the customer)\s+/i, "")
    .replace(/\s+(?:on\s+)?(?:credit|cash|momo|mobile money)\b.*$/i, "")
    .trim();
}

export function parseSpokenSale(text) {
  const paymentType = /\b(?:on\s+)?credit\b/i.test(text)
    ? "credit"
    : /\b(?:momo|mobile money|mobilemoney)\b/i.test(text)
      ? "momo"
      : "cash";

  return {
    customerName: extractCustomerName(text),
    itemDescription: extractItem(text),
    quantity: extractQuantity(text),
    price: extractAmount(text),
    paymentType
  };
}

function findExpenseCueAmounts(text) {
  const cues = [
    new RegExp(String.raw`\b(?:spent|spend|paid|pay|cost|costs|costed|expense|expensed|used)\s+(?:(?:about|around|roughly|approximately)\s+)?(?:GHS\s*)?(${AMOUNT})\b`, "gi"),
    new RegExp(String.raw`\b(?:for|at|of|totalling|totaling|amounting\s+to)\s+(${AMOUNT})\b`, "gi"),
    new RegExp(String.raw`\b(${AMOUNT})\s+(?:for|on)\s+`, "gi"),
    new RegExp(String.raw`\b(${AMOUNT})\s+(?:on|for)\s+(?:my\s+)?(?:expense|expenses)\b`, "gi"),
    new RegExp(String.raw`\b(${AMOUNT})\s*$`, "gi")
  ];
  const candidates = new Map();

  for (const pattern of cues) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[0].lastIndexOf(match[1]);
      const end = start + match[1].length;
      candidates.set(`${start}:${end}`, {
        price: normalizeAmount(match[1]),
        start,
        end
      });
    }
  }

  return candidates;
}

function findExpenseAmount(text) {
  const currencyMatches = [...text.matchAll(CURRENCY_AMOUNT)];
  const candidates = findExpenseCueAmounts(text);
  if (currencyMatches.length > 1) return null;

  if (currencyMatches.length === 1) {
    const match = currencyMatches[0];
    const currencyStart = match.index;
    const currencyEnd = currencyStart + match[0].length;
    const otherAmounts = [...candidates.values()].filter(
      ({ start, end }) => start < currencyStart || end > currencyEnd
    );
    if (otherAmounts.length) return null;
    return {
      price: amountFromCurrencyMatch(match[0]),
      start: currencyStart,
      end: currencyEnd
    };
  }

  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function extractExpenseNote(text, amountMatch) {
  let note = amountMatch
    ? `${text.slice(0, amountMatch.start)} ${text.slice(amountMatch.end)}`
    : text;

  return note
    .replace(new RegExp(CURRENCY, "gi"), " ")
    .replace(/\b(?:i|we)\s+(?:(?:have|had)\s+)?(?:spent|spend|paid|pay|used|bought|buy|purchased|expense|expensed|cost|costs|costed)\b/gi, " ")
    .replace(/\b(?:spent|spend|paid|pay|used|bought|buy|purchased|expense|expensed|cost|costs|costed)\b/gi, " ")
    .replace(/^\s*(?:for|on|at|towards|to)\b\s*/i, "")
    .replace(/\b(?:for|on|at|towards|to)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, "")
    .trim();
}

export function parseSpokenExpense(text) {
  const currencyMatches = [...text.matchAll(CURRENCY_AMOUNT)];
  const cueAmounts = findExpenseCueAmounts(text);
  const amountMatch = findExpenseAmount(text);
  const ambiguousAmount = !amountMatch && (
    currencyMatches.length > 1 ||
    (currencyMatches.length === 1 && [...cueAmounts.values()].some(
      ({ start, end }) => start < currencyMatches[0].index || end > currencyMatches[0].index + currencyMatches[0][0].length
    )) ||
    (currencyMatches.length === 0 && cueAmounts.size > 1)
  );
  return {
    note: ambiguousAmount ? text.trim() : extractExpenseNote(text, amountMatch),
    price: amountMatch?.price ?? "",
    ambiguousAmount
  };
}
