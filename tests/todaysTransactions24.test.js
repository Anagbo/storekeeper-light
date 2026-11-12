import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordExpense } from "../src/db/suppliers.js";
import { formatDate } from "../src/lib/formatDate.js";
import { getFinancialTransactions, summarizeFinancialTransactionsSafely } from "../src/lib/money.js";
import { posText } from "../src/pos/i18n.js";
import { getMoneyPeriodRange } from "../src/pos/money.js";
import { createPosTransactionRows, describeTransactionRow } from "../src/pos/transactionFeed.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 24 Today's transactions (redesign 11 Nov 2026, wiring rules for 24). Money in is money actually
// received today; every row's amount agrees with it.

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all(["transactions", "debts", "customers", "payments", "suppliers"].map((name) => db.table(name).clear()));
});

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node?.props?.className ?? "");

async function today() {
  const transactions = await getFinancialTransactions(getMoneyPeriodRange("day"));
  const suppliers = new Map((await db.suppliers.toArray()).map((supplier) => [supplier.id, supplier.name]));
  return { rows: createPosTransactionRows(transactions, suppliers), totals: summarizeFinancialTransactionsSafely(transactions).totals };
}

async function mount(rows, totals) {
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals }));
  try {
    return render({ type: TodaysTransactions, props: { onBack() {} } });
  } finally {
    setLiveQuery(null);
  }
}
const rowViews = (tree) => all(tree, (n) => n.type === "article").map((row) => ({
  node: row,
  title: textOf(all(row, (n) => n.props["data-row-title"] !== undefined)[0]),
  amount: textOf(all(row, (n) => n.props["data-row-amount"] !== undefined)[0]),
  amountNode: all(row, (n) => n.props["data-row-amount"] !== undefined)[0],
  chips: all(row, (n) => n.type === "span" && n.props["data-chip"] !== undefined).map((chip) => ({ kind: chip.props["data-chip"], text: textOf(chip) }))
}));
const pesewas = (text) => {
  const digits = text.replace(/[^\d]/g, "");
  return Number.parseInt(digits, 10);
};

async function seedDay() {
  await recordCashSale({ amountPesewas: 800, cashReceivedPesewas: 0, momoReceivedPesewas: 800, parts: [{ paymentMethod: "momo", amountPesewas: 800 }], saleItems: [] });
  await recordCashSale({ amountPesewas: 1300, cashReceivedPesewas: 500, momoReceivedPesewas: 800, parts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 800 }], saleItems: [] });
  await recordCreditSale({ amountPesewas: 800, name: "juju", initialPaymentPesewas: 400, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 400 }], paymentMethod: "cash", note: "Sale" });
  await recordCreditSale({ amountPesewas: 800, name: "juju", note: "Sale" });
  await recordCreditSale({ amountPesewas: 1000, name: "ama", initialPaymentPesewas: 300, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 200 }, { paymentMethod: "momo", amountPesewas: 100 }], paymentMethod: "cash", note: "Sale" });
  const ama = (await db.debts.toArray()).find((debt) => (debt.customerName ?? debt.customer_name ?? "").toLowerCase() === "ama");
  await recordDebtCollection({ debtId: ama.id, parts: [{ paymentMethod: "cash", amountPesewas: 150 }] });
  await recordExpense({ amountPesewas: 500, paidAmountPesewas: 500, category: "transport", note: "" });
}

test("24: the sum of the green + amounts equals the Money in card (real writers, mixed day)", async () => {
  await seedDay();
  const { rows, totals } = await today();
  const described = rows.map(describeTransactionRow);
  const plus = described.filter((view) => view.tone === "in").reduce((sum, view) => sum + view.amountPesewas, 0);
  // 8.00 MoMo + 13.00 (5.00 cash + 8.00 MoMo) + 4.00 + 3.00 + 1.50 collected = GH₵29.50
  assert.equal(totals.cashInflow, 2950);
  assert.equal(plus, totals.cashInflow);
  // The same on screen: the + amounts as shown add up to the card.
  const view = await mount(rows, totals);
  const card = all(view.tree, (n) => n.props["data-summary"] === "money-in")[0];
  assert.ok(textOf(card).includes("GH₵29.50"));
  const shownPlus = rowViews(view.tree).filter((row) => row.amount.startsWith("+")).reduce((sum, row) => sum + pesewas(row.amount), 0);
  assert.equal(shownPlus, 2950);
});

test("24: Sale of GH₵8.00 with Cash GH₵4.00 and GH₵4.00 owed by Juju", async () => {
  await recordCreditSale({ amountPesewas: 800, name: "juju", initialPaymentPesewas: 400, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 400 }], paymentMethod: "cash", note: "Sale" });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Sale of GH₵8.00");
  assert.equal(row.amount, "+GH₵4.00");
  assert.match(cls(row.amountNode), /text-\[#03543F\]/);
  assert.deepEqual(row.chips, [{ kind: "payment", text: "Cash GH₵4.00" }, { kind: "person", text: "Juju owes GH₵4.00" }]);
  const personChip = all(row.node, (n) => n.props["data-chip"] === "person" && n.type === "span")[0];
  assert.match(cls(personChip), /bg-\[#FECDD3\]/, "pink person chip");
  assert.ok(all(personChip, (n) => typeof n.type === "function").length > 0, "with a person icon");
});

test("24: a credit-only sale shows \"Sold on credit\", GH₵8.00 in dark red with no sign, and a Juju chip", async () => {
  await recordCreditSale({ amountPesewas: 800, name: "juju", note: "Sale" });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Sold on credit");
  assert.equal(row.amount, "GH₵8.00");
  assert.match(cls(row.amountNode), /text-\[#7F1D1D\]/);
  assert.deepEqual(row.chips, [{ kind: "person", text: "Juju" }]);
});

test("24: a fully paid MoMo sale shows +GH₵8.00 and a MoMo chip", async () => {
  await recordCashSale({ amountPesewas: 800, cashReceivedPesewas: 0, momoReceivedPesewas: 800, parts: [{ paymentMethod: "momo", amountPesewas: 800 }], saleItems: [] });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Sale");
  assert.equal(row.amount, "+GH₵8.00");
  assert.deepEqual(row.chips, [{ kind: "payment", text: "MoMo GH₵8.00" }]);
});

test("24: a Cash + MoMo sale shows both payment chips, not the whole sale as Cash", async () => {
  await recordCashSale({ amountPesewas: 1300, cashReceivedPesewas: 500, momoReceivedPesewas: 800, parts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 800 }], saleItems: [] });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.amount, "+GH₵13.00");
  assert.deepEqual(row.chips.map((chip) => chip.text), ["Cash GH₵5.00", "MoMo GH₵8.00"]);
});

test("24: spent shows −amount in amber-brown with an amber category chip", async () => {
  await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 1000, category: "transport", note: "" });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Spent");
  assert.equal(row.amount, "−GH₵10.00");
  assert.match(cls(row.amountNode), /text-\[#92400E\]/);
  assert.deepEqual(row.chips, [{ kind: "category", text: "Transport" }]);
});

test("24: an empty filter shows \"Nothing here yet today.\"", async () => {
  await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 1000, category: "transport", note: "" });
  const { rows, totals } = await today();
  const view = await mount(rows, totals);
  const sold = all(view.tree, (n) => n.type === "button" && textOf(n) === "Sold")[0];
  sold.props.onClick();
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals }));
  const tree = view.rerender().tree;
  setLiveQuery(null);
  assert.equal(all(tree, (n) => n.type === "article").length, 0);
  assert.equal(textOf(all(tree, (n) => n.props["data-empty"] !== undefined)[0]), "Nothing here yet today.");
  const empty = await mount([], totals);
  assert.ok(textOf(empty.tree).includes("Nothing here yet today."));
});

test("24: names are capitalised and never a plain grey chip", async () => {
  await recordCreditSale({ amountPesewas: 800, name: "juju", note: "Sale" });
  await recordCreditSale({ amountPesewas: 800, name: "ama", initialPaymentPesewas: 300, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 300 }], paymentMethod: "cash", note: "Sale" });
  const { rows, totals } = await today();
  const tree = (await mount(rows, totals)).tree;
  const people = rowViews(tree).flatMap((row) => row.chips.filter((chip) => /juju|ama/i.test(chip.text)));
  assert.ok(people.length >= 2);
  for (const chip of people) {
    assert.equal(chip.kind, "person");
    assert.match(chip.text, /^(Juju|Ama)/);
  }
  assert.doesNotMatch(textOf(tree), /\bjuju\b|\bama\b/);
});

test("24 at 360px: GH₵12,345.00 is never clipped (card, tiles, row amount)", async () => {
  await recordCashSale({ amountPesewas: 1234500, cashReceivedPesewas: 1234500, momoReceivedPesewas: 0, parts: [{ paymentMethod: "cash", amountPesewas: 1234500 }], saleItems: [] });
  const { rows, totals } = await today();
  const tree = (await mount(rows, { ...totals, expenses: 1234500, newCreditExtended: 1234500 })).tree;
  for (const name of ["money-in", "spent", "owed"]) {
    const box = all(tree, (n) => n.props["data-summary"] === name)[0];
    const amount = all(box, (n) => n.type === "p" && textOf(n) === "GH₵12,345.00")[0];
    assert.ok(amount, `${name} amount`);
    assert.match(cls(amount), /whitespace-nowrap/);
    assert.doesNotMatch(cls(amount), /amount-fit|truncate|text-\[10px\]/);
  }
  assert.match(cls(all(all(tree, (n) => n.props["data-summary"] === "money-in")[0], (n) => n.type === "p")[1]), /text-\[34px\]/);
  const [row] = rowViews(tree);
  assert.equal(row.amount, "+GH₵12,345.00");
  assert.match(cls(row.amountNode), /shrink-0/);
  assert.match(cls(row.amountNode), /whitespace-nowrap/);
  // Width at 360px: 16px page gutters; half tile = (360 - 32 - 8) / 2 = 160px, minus 8px padding each
  // side = 144px. GH₵12,345.00 at bold 22px is about 140px.
  assert.ok(140 <= (360 - 32 - 8) / 2 - 16);
});

test("24 header: curly apostrophe everywhere, and \"Today · dd/mm/yyyy\" under the title; no \"All amounts in GH₵\"", async () => {
  for (const key of ["menu.transactions", "home.transactionsLink", "transactions.title", "planned.titles.TodaysTransactions"]) {
    assert.match(posText(key), /Today’s transactions/, key);
    assert.doesNotMatch(posText(key), /Today['´]s/, key);
  }
  const tree = (await mount([], { cashInflow: 0, expenses: 0, newCreditExtended: 0 })).tree;
  assert.equal(textOf(all(tree, (n) => n.type === "h1")[0]), "Today’s transactions");
  const dateLine = textOf(all(tree, (n) => n.props["data-today-date"] !== undefined)[0]);
  assert.equal(dateLine, `Today · ${formatDate(getMoneyPeriodRange("day").start)}`);
  assert.match(dateLine, /^Today · \d{2}\/\d{2}\/\d{4}$/);
  assert.doesNotMatch(textOf(tree), /All amounts in/);
});

test("24: rows are not buttons (no chevron, not focusable)", async () => {
  await recordCashSale({ amountPesewas: 800, saleItems: [] });
  const { rows, totals } = await today();
  const tree = (await mount(rows, totals)).tree;
  for (const row of all(tree, (n) => n.type === "article")) {
    assert.equal(row.props.tabIndex, undefined);
    assert.equal(row.props.onClick, undefined);
    assert.equal(all(row, (n) => n.type === "button" || n.type === "a").length, 0);
    assert.doesNotMatch(cls(row), /hover:|cursor-pointer/);
  }
  assert.doesNotMatch(readFileSync(new URL("../src/pos/TodaysTransactions.jsx", import.meta.url), "utf8"), /ChevronRight/);
});

// Stock bought on credit (wiring 24, decided 11 Nov 2026). The supplier is stored as "kofi
// wholesale" and shown through the shared displayName helper.
const buyStock = (paidAmountPesewas) => recordExpense({ amountPesewas: 8000, paidAmountPesewas, category: "stock", newSupplier: { name: "kofi wholesale" } });

test("24: stock GH₵80.00 with nothing paid is \"Stock on credit\", dark red with no sign, pink \"You owe Kofi Wholesale\"", async () => {
  await buyStock(0);
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Stock on credit");
  assert.equal(row.amount, "GH₵80.00");
  assert.match(cls(row.amountNode), /text-\[#7F1D1D\]/);
  assert.deepEqual(row.chips, [{ kind: "person", text: "You owe Kofi Wholesale" }]);
  const chip = all(row.node, (n) => n.props["data-chip"] === "person" && n.type === "span")[0];
  assert.match(cls(chip), /bg-\[#FECDD3\]/, "pink chip");
  assert.equal(totals.expenses, 0, "no money went out");
});

test("24: stock GH₵80.00 with GH₵30.00 paid is \"Stock\", −GH₵30.00 in amber-brown, pink \"You owe Kofi Wholesale GH₵50.00\"", async () => {
  await buyStock(3000);
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Stock");
  assert.equal(row.amount, "−GH₵30.00");
  assert.match(cls(row.amountNode), /text-\[#92400E\]/);
  assert.deepEqual(row.chips, [{ kind: "person", text: "You owe Kofi Wholesale GH₵50.00" }]);
  assert.equal(totals.expenses, 3000);
});

test("24: stock GH₵80.00 fully paid is a normal Spent row", async () => {
  await recordExpense({ amountPesewas: 8000, paidAmountPesewas: 8000, category: "stock", note: "" });
  const { rows, totals } = await today();
  const [row] = rowViews((await mount(rows, totals)).tree);
  assert.equal(row.title, "Spent");
  assert.equal(row.amount, "−GH₵80.00");
  assert.match(cls(row.amountNode), /text-\[#92400E\]/);
  assert.deepEqual(row.chips, [{ kind: "category", text: "Stock" }]);
});

test("24: the Spent tile equals the sum of the money paid out (stock on credit counts only what was paid)", async () => {
  await buyStock(0);
  await buyStock(3000);
  await recordExpense({ amountPesewas: 8000, paidAmountPesewas: 8000, category: "stock", note: "" });
  await recordExpense({ amountPesewas: 500, paidAmountPesewas: 500, category: "transport", note: "" });
  const { rows, totals } = await today();
  // 0 + 30.00 + 80.00 + 5.00 paid out = GH₵115.00
  assert.equal(totals.expenses, 11500);
  const view = await mount(rows, totals);
  const minus = rowViews(view.tree).filter((row) => row.amount.startsWith("−")).reduce((sum, row) => sum + pesewas(row.amount), 0);
  assert.equal(minus, totals.expenses);
  assert.ok(textOf(all(view.tree, (n) => n.props["data-summary"] === "spent")[0]).includes("GH₵115.00"));
});
