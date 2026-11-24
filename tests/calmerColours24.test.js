import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordExpense } from "../src/db/suppliers.js";
import { getFinancialTransactions, summarizeFinancialTransactionsSafely } from "../src/lib/money.js";
import { getMoneyPeriodRange } from "../src/pos/money.js";
import { createPosTransactionRows, describeTransactionRow } from "../src/pos/transactionFeed.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 24, Summary tiles (rules_global.soft_tiles, 24 Nov 2026, replaces "Calmer colours" of 20 Nov):
// Money in, Spent and Given on credit are soft tiles (#F1F5F9, no border, no coloured edge) with dark
// numbers (Given on credit is not red) and a small neutral icon before each label. A person chip is pink only when it says someone owes money; a person who only paid gets a neutral white
// chip with a 2px grey outline and the person icon. Payment chips and filters are unchanged.

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all(["transactions", "debts", "customers", "payments", "suppliers"].map((name) => db.table(name).clear()));
});

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node?.props?.className ?? "");

async function mountToday() {
  const transactions = await getFinancialTransactions(getMoneyPeriodRange("day"));
  const suppliers = new Map((await db.suppliers.toArray()).map((supplier) => [supplier.id, supplier.name]));
  const rows = createPosTransactionRows(transactions, suppliers);
  const totals = summarizeFinancialTransactionsSafely(transactions).totals;
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals }));
  try {
    return render({ type: TodaysTransactions, props: { onBack() {} } }).tree;
  } finally {
    setLiveQuery(null);
  }
}
const tile = (tree, name) => all(tree, (node) => node.props["data-summary"] === name)[0];
const amountIn = (node) => all(node, (child) => child.type === "p").at(-1);

test("24: Money in, Spent and Given on credit are soft tiles with a neutral icon, no edge, dark numbers", async () => {
  await recordCashSale({ amountPesewas: 500, cashReceivedPesewas: 500, momoReceivedPesewas: 0, parts: [{ paymentMethod: "cash", amountPesewas: 500 }], saleItems: [] });
  await recordCreditSale({ amountPesewas: 800, name: "juju", note: "Sale" });
  await recordExpense({ amountPesewas: 300, paidAmountPesewas: 300, category: "transport", note: "" });
  const tree = await mountToday();
  for (const name of ["money-in", "spent", "given-on-credit"]) {
    const card = tile(tree, name);
    for (const part of ["bg-[#F1F5F9]", "text-[#0F172A]"]) {
      assert.ok(cls(card).split(/\s+/).includes(part), `${name}: ${part} (${cls(card)})`);
    }
    assert.doesNotMatch(cls(card), /(^|\s)border|bg-rose|bg-amber|bg-pink|bg-\[#03543F\]|text-white/, `${name}: no border, edge or coloured fill`);
    assert.ok(all(card, (node) => node.props["data-summary-icon"] !== undefined && node.props.size === 22).length > 0, `${name}: a 22px icon`);
  }
  assert.doesNotMatch(cls(amountIn(tile(tree, "spent"))), /text-\[#92400E\]|amber|rose/, "the Spent number is dark");
  assert.doesNotMatch(cls(amountIn(tile(tree, "given-on-credit"))), /7F1D1D|rose/, "Given on credit above zero is not red");
  assert.equal(textOf(amountIn(tile(tree, "given-on-credit"))), "GH₵8.00");
});

test("24: Given on credit at zero is a dark number", async () => {
  await recordCashSale({ amountPesewas: 500, cashReceivedPesewas: 500, momoReceivedPesewas: 0, parts: [{ paymentMethod: "cash", amountPesewas: 500 }], saleItems: [] });
  const tree = await mountToday();
  assert.equal(textOf(amountIn(tile(tree, "given-on-credit"))), "GH₵0.00");
  assert.doesNotMatch(cls(amountIn(tile(tree, "given-on-credit"))), /7F1D1D|rose/);
});

test("24: the person chip is pink only when it says someone owes; Payment collected is a neutral outlined chip with the icon", async () => {
  await recordCreditSale({ amountPesewas: 1000, name: "ama", initialPaymentPesewas: 300, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 300 }], paymentMethod: "cash", note: "Sale" });
  const ama = (await db.debts.toArray())[0];
  await recordDebtCollection({ debtId: ama.id, parts: [{ paymentMethod: "cash", amountPesewas: 200 }] });
  const tree = await mountToday();
  const chips = all(tree, (node) => node.type === "span" && node.props["data-chip"] === "person");
  const owes = chips.find((chip) => /owes GH₵/.test(textOf(chip)));
  const paid = chips.find((chip) => textOf(chip) === "Ama");
  assert.ok(owes && paid, chips.map(textOf).join(" | "));
  assert.equal(owes.props["data-owes"], "true");
  assert.match(cls(owes), /bg-\[#F1F5F9\]/, "owes: soft tile fill, not pink");
  assert.equal(paid.props["data-owes"], "false");
  assert.doesNotMatch(cls(paid), /F1F5F9|FECDD3|rose|pink/, "paid only: not the soft fill");
  for (const part of ["border-2", "border-slate-500", "bg-white"]) assert.ok(cls(paid).split(/\s+/).includes(part), `paid chip: ${part}`);
  assert.ok(all(paid, (node) => typeof node.type === "function" || node.type === "svg").length > 0, "the small person icon stays");
  // Payment chips are unchanged.
  const payment = all(tree, (node) => node.type === "span" && node.props["data-chip"] === "payment")[0];
  assert.match(cls(payment), /bg-\[#CBD5E1\]/);
});

test("24: which person chips say someone owes (the pink ones)", () => {
  const chip = (row) => describeTransactionRow(row).chips.find((entry) => entry.kind === "person");
  assert.equal(chip({ kind: "sold", customerName: "Juju", cashReceivedPesewas: 0, owedPesewas: 500 }).owes, true, "Sold on credit");
  assert.equal(chip({ kind: "sold", customerName: "Juju", cashReceivedPesewas: 300, cashPesewas: 300, owedPesewas: 500 }).owes, true, "part-paid sale");
  assert.equal(chip({ kind: "credit", supplierName: "Kofi", owedPesewas: 500 }).owes, true, "Stock on credit: You owe Kofi");
  assert.equal(chip({ kind: "adjustment", customerName: "Kojo", adjustmentNewBalancePesewas: 300, adjustmentDeltaPesewas: -200 }).owes, true, "Balance corrected, still owes");
  assert.equal(chip({ kind: "payment", customerName: "Ama", amountPesewas: 200, cashPesewas: 200 }).owes, undefined, "Payment collected");
  assert.equal(chip({ kind: "adjustment", customerName: "Kojo", adjustmentNewBalancePesewas: 0, adjustmentDeltaPesewas: -200 }).owes, undefined, "owes GH₵0.00 now");
  assert.equal(chip({ kind: "debt_added", customerName: "Ama", amountPesewas: 200 }).owes, undefined, "Added to debt shows only the name");
});

// Light contrast check (WCAG 2.x) on white: the new text at 4.5:1, the coloured edges and the grey chip
// outline at 3:1 (non-text). The 2px light grey card border (#CBD5E1) is the same as every row card on 24.
const hex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const onWhite = (value) => { const l = luminance(hex(value)); return 1.05 / (l + 0.05); };

test("24: contrast of the text and the chip outline on white", () => {
  for (const [what, colour] of [["dark numbers #0F172A", "#0F172A"], ["labels and icons #334155", "#334155"], ["neutral chip text #0F172A", "#0F172A"]]) {
    assert.ok(onWhite(colour) >= 4.5, `${what}: ${onWhite(colour).toFixed(2)}:1`);
  }
  for (const [what, colour] of [["chip outline slate-500 (about #62748E)", "#62748E"]]) {
    assert.ok(onWhite(colour) >= 3, `${what}: ${onWhite(colour).toFixed(2)}:1`);
  }
});
