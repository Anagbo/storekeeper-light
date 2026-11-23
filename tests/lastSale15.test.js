import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { describeLastSale, loadLastSaleToday } from "../src/pos/lastSale.js";
import { flushEffects, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// wide_layout.approved_additions (2) and wiring 15 "Last sale box wording" (23 Nov 2026): the most
// recent saved sale today, read from the saved records, changing no stored value. Amount: the sale
// total. Method: Cash, MoMo or Split when nothing is owed; On credit when the whole sale is on credit;
// Part paid when some money was received and some is owed. Hidden when there is no sale today.

const NOON = new Date(2026, 10, 23, 12, 0, 0);
const at = (hours, minutes = 0) => new Date(2026, 10, 23, hours, minutes).getTime();
// A credit sale as the Owe flow stores it (debts.js): type by what was received, paymentType credit.
const creditSale = (id, createdAt, amountPesewas, cash = 0, momo = 0, type = cash + momo > 0 ? "installment_sale" : "sale") => ({
  id, type, amountPesewas, total_amount: amountPesewas, paymentType: "credit",
  payment_method: cash && momo ? "split" : momo ? "momo" : cash ? "cash" : null,
  cashReceivedPesewas: cash, momoReceivedPesewas: momo,
  ...(cash + momo > 0 && { installmentPaymentPesewas: cash + momo }),
  creditExtendedPesewas: amountPesewas - cash - momo, customer_name: "Ama", customerName: "Ama",
  createdAt, timestamp: createdAt, updatedAt: createdAt, synced: false, syncStatus: "pending"
});

async function reset() { await db.transactions.clear(); await db.saveAttempts?.clear?.(); }
const snapshot = async () => JSON.stringify(await db.transactions.orderBy("id").toArray());

test("Last sale: none today (only yesterday’s sale and today’s spending) gives nothing", async () => {
  await reset();
  await recordCashSale({ amountPesewas: 500, now: at(12) - 24 * 3600_000 });
  await db.transactions.add({ id: "e1", type: "expense", amountPesewas: 300, total_amount: 300, createdAt: at(11), timestamp: at(11) });
  assert.equal(await loadLastSaleToday(db, NOON), null);
});

test("Last sale: the newest sale today across sale, installment_sale and installment_addon", async () => {
  await reset();
  await recordCashSale({ amountPesewas: 800, now: at(9) });
  await db.transactions.add(creditSale("c1", at(10), 5000, 2000, 0, "installment_addon"));
  await db.transactions.add({ id: "e2", type: "expense", amountPesewas: 300, total_amount: 300, createdAt: at(11), timestamp: at(11) });
  const before = await snapshot();
  const last = await loadLastSaleToday(db, NOON);
  assert.deepEqual(last, { amountPesewas: 5000, method: "part_paid", timestamp: at(10) }, "the newer add-on sale, its total, Part paid");
  assert.equal(await snapshot(), before, "reading changes no stored value");
  await recordCashSale({ amountPesewas: 1234, cashReceivedPesewas: 1000, momoReceivedPesewas: 234, now: at(10, 30) });
  assert.deepEqual(await loadLastSaleToday(db, NOON), { amountPesewas: 1234, method: "split", timestamp: at(10, 30) });
});

test("Last sale: the method words (Cash, MoMo, Split, On credit, Part paid) and the total", () => {
  const sale = (cash, momo) => ({ id: "s", type: "sale", amountPesewas: cash + momo, total_amount: cash + momo, payment_method: cash && momo ? "split" : momo ? "momo" : "cash", paymentType: momo && !cash ? "momo" : "cash", cashReceivedPesewas: cash, momoReceivedPesewas: momo, createdAt: at(9), timestamp: at(9) });
  assert.equal(describeLastSale(sale(800, 0)).method, "cash");
  assert.equal(describeLastSale(sale(0, 800)).method, "momo");
  assert.equal(describeLastSale(sale(300, 500)).method, "split");
  assert.deepEqual(describeLastSale(creditSale("c", at(9), 4000)), { amountPesewas: 4000, method: "credit", timestamp: at(9) });
  assert.deepEqual(describeLastSale(creditSale("c", at(9), 4000, 0, 1500)), { amountPesewas: 4000, method: "part_paid", timestamp: at(9) }, "the amount is the total, not what was received");
});

test("Last sale box: shows amount · method and the time; hidden when there is none; not tappable", async () => {
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const { default: LastSaleBox } = await loadJsx("src/pos/LastSaleBox.jsx");
  const { formatTime } = await import("../src/lib/formatDate.js");
  const view = render({ type: LastSaleBox, props: { load: async () => ({ amountPesewas: 800, method: "credit", timestamp: at(18, 40) }) } });
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.rerender();
  const text = textOf(view.tree);
  assert.match(text, /^Last saleGH₵8\.00 · On credit/);
  assert.ok(text.endsWith(formatTime(at(18, 40))), "the time through formatTime");
  assert.doesNotMatch(JSON.stringify(view.tree, (k, v) => typeof v === "function" ? "fn" : v), /"onClick"|"button"/, "nothing to tap");

  const empty = render({ type: LastSaleBox, props: { load: async () => null } });
  flushEffects(empty);
  await new Promise((resolve) => setTimeout(resolve, 10));
  empty.rerender();
  assert.equal(textOf(empty.tree), "", "no sale today: no box");
});
