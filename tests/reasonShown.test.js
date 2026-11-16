import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { proofPages } from "./helpers/proofPages.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";
import { toHtml } from "./helpers/browserLayout.js";

// rules_global.credit_reason (16 Nov 2026): 29, 43, 72 and 73 show the real reason of each credit,
// from events saved by the real writers: the reason typed on 18 (keypad sale, split), the items, the
// 53 note. An empty reason, the word "Sale" and the "Other amount" line show "No reason written".

after(async () => {
  db.close();
  await db.delete();
});

const strip = (html) => html.replace(/<[^>]+>/g, "");
const DAY = 86_400_000;
const NOW = Date.now();
const OTHER_AMOUNT = { productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 700 };

// Oldest first; the pages list newest first.
const SAVED = [
  ["keypad with a reason", () => recordCreditSale({ name: "Kofi", amountPesewas: 1000, creditReason: "School fees", now: NOW - 9 * DAY }), "School fees"],
  ["reason with · in it", () => recordCreditSale({ name: "Kofi", amountPesewas: 1100, creditReason: "Rice · beans", now: NOW - 8 * DAY }), "Rice · beans"],
  ["keypad, no reason", () => recordCreditSale({ name: "Kofi", amountPesewas: 1200, now: NOW - 7 * DAY }), "No reason written"],
  ["the word Sale typed", () => recordCreditSale({ name: "Kofi", amountPesewas: 1300, creditReason: "Sale", now: NOW - 6 * DAY }), "No reason written"],
  ["Other amount cart, no reason", () => recordCreditSale({ name: "Kofi", amountPesewas: 700, note: "Other amount", saleItems: [OTHER_AMOUNT], now: NOW - 5 * DAY }), "No reason written"],
  ["items", () => recordCreditSale({ name: "Kofi", amountPesewas: 1300, saleItems: [{ productId: 3, name: "Rice", quantity: 2, unitPricePesewas: 500 }, { productId: 4, name: "Water", quantity: 3, unitPricePesewas: 100 }], now: NOW - 4 * DAY }), "Rice × 2, Water × 3"],
  ["split with a reason", () => recordCreditSale({ name: "Kofi", amountPesewas: 2000, initialPaymentPesewas: 500, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 500 }], creditReason: "Gas refill", now: NOW - 3 * DAY }), "Gas refill"],
  ["53 with a note", () => recordManualDebt({ name: "Kofi", amountPesewas: 1500, note: "Old fridge", now: NOW - 2 * DAY }), "Old fridge"],
  ["53 with no note", () => recordManualDebt({ name: "Kofi", amountPesewas: 1600, note: "", now: NOW - DAY }), "No reason written"]
];

async function savedHistory() {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  const ids = [];
  for (const [, save] of SAVED) {
    const result = await save();
    ids.push(result.saleTransaction?.id ?? result.transactionId ?? result.event?.id);
  }
  const customer = await db.customers.where("nameLower").equals("kofi").first();
  const { events } = await loadCustomerHistory(customer.id, "Kofi");
  return { ids, credits: events.filter((event) => ["credit", "addon", "manual_debt"].includes(event.type)) };
}

test("29, 43 and 73: each credit shows its real reason, or No reason written", async () => {
  const { credits } = await savedHistory();
  assert.equal(credits.length, SAVED.length);
  const expected = SAVED.map(([, , shown]) => shown).reverse();
  for (const page of await proofPages(credits)) {
    const lines = [...page.html.matchAll(/<[a-z]+ data-reason=""[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map((match) => strip(match[1]).replace(/&amp;/g, "&"));
    assert.deepEqual(lines, expected, `${page.name}: the reason lines, newest first`);
    assert.doesNotMatch(strip(page.html), /\bSale\b|Other amount|Credit extended/, `${page.name}: no generated word`);
  }
});

test("72: the For row shows the real reason, or No reason written", async () => {
  const { ids } = await savedHistory();
  const { default: CustomerSignature } = await loadJsx("src/pos/CustomerSignature.jsx");
  for (const [index, [what, , shown]] of SAVED.entries()) {
    const event = await db.transactions.get(ids[index]);
    assert.ok(event, `${what}: the saved event`);
    setLiveQuery(() => ({ event, debt: null }));
    let html;
    try {
      html = toHtml(render({ type: CustomerSignature, props: { params: { transactionId: event.id }, onFinish() {}, shopName: "My shop" } }).tree);
    } finally {
      setLiveQuery(null);
    }
    const forRow = /<div data-sign-detail=""[^>]*><dt[^>]*>For<\/dt><dd[^>]*>([^<]*)<\/dd><\/div>/.exec(html);
    assert.ok(forRow, `${what}: a For row on 72`);
    assert.equal(forRow[1].replace(/&amp;/g, "&"), shown, `${what}: 72 For`);
  }
});
