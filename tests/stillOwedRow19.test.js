import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// 19 "Owe in the draft panel" (12 Nov 2026): the payment rows above "Total today" are Cash and MoMo
// only and add up to it; what is owed is a separate pink "Still owed · {Name}" row, not in the total.

globalThis.HTMLElement ??= class {};

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

const cedis = (text) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);

// Sell GH₵8.00, split into cash / MoMo / owe (GH₵ strings, "0" = left out), and stop on 19.
async function to19(app, { cash, momo, owe }) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  if (cash) {
    await app.tap(/^Cash$/);
    await app.tap(/^Cash/);
    await app.type("split-draft-amount", cash);
    await app.tap(/^Save$/);
  }
  if (momo) {
    await app.tap(/^MoMo$/);
    await app.type("split-draft-amount", momo);
    await app.tap(/^Save$/);
    assert.equal(app.route, "MoMoChoice");
    await app.tap(/Customer sends to my number/);
  }
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "5");
}

// What the panel shows: the payment rows, the total line and the pink row.
function panel(app) {
  const box = nodes(app.view.tree).find((node) => /bg-emerald-50/.test(node.props.className ?? "") && /Paying today/.test(textOf(node)));
  assert.ok(box, `no Paying today panel: ${app.text()}`);
  const rows = nodes(box).filter((node) => /rounded-xl bg-white/.test(node.props.className ?? ""));
  const total = nodes(box).find((node) => /border-t border-emerald-200/.test(node.props.className ?? ""));
  const owed = nodes(box).find((node) => node.props["data-still-owed"] !== undefined);
  const amountOf = (node) => cedis(textOf(node).match(/GH₵[\d,.]+/g).at(-1));
  return {
    labels: rows.map((row) => textOf(row).replace(/GH₵.*$/, "").trim()),
    rowAmounts: rows.map(amountOf),
    totalLabel: total ? textOf(total).replace(/GH₵.*$/, "").trim() : null,
    total: total ? amountOf(total) : null,
    owedText: owed ? textOf(owed).replace(/\s+/g, " ").trim() : null,
    owedPesewas: owed ? amountOf(owed) : null,
    owedClass: owed?.props.className ?? ""
  };
}

test("Cash 4.00 + MoMo 3.00 + Owe 1.00: two payment rows, Total today 7.00, a pink Still owed 1.00 outside the total", async () => {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await to19(app, { cash: "4.00", momo: "3.00" });
  const shown = panel(app);
  assert.equal(shown.labels.length, 2, "two payment rows");
  assert.ok(/^Cash/.test(shown.labels[0]) && /^MoMo/.test(shown.labels[1]), shown.labels.join(" | "));
  assert.ok(!shown.labels.some((label) => /Owe/.test(label)), "no Owe row among the payment rows");
  assert.equal(shown.totalLabel, "Total today");
  assert.equal(shown.total, 700);
  assert.equal(shown.owedText, "Still owed · JujuGH₵1.00");
  assert.equal(shown.owedPesewas, 100);
  assert.match(shown.owedClass, /bg-rose-100/);
  assert.match(shown.owedClass, /text-rose-900/);
});

test("saved amounts are unchanged: Cash 4.00 + MoMo 3.00 paid, GH₵1.00 added to Juju", async () => {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await to19(app, { cash: "4.00", momo: "3.00" });
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap("Money received");
  const payments = await db.payments.toArray();
  assert.equal(payments.reduce((sum, row) => sum + row.amountPesewas, 0), 700);
  const unpaid = (await db.debts.toArray()).filter((debt) => debt.status === "unpaid");
  assert.equal(unpaid.reduce((sum, debt) => sum + (debt.amountPesewas ?? debt.total_owed), 0), 1000 + 100);
});

// Property-style: for several splits, the payment rows always sum to the total, and the pink row
// is present exactly when something is owed (it is never part of the total).
for (const [cash, momo, owe] of [["4.00", "3.00", 100], ["5.00", "", 300], ["", "5.00", 300], ["3.00", "2.00", 300], ["7.50", "", 50]]) {
  test(`rows sum to Total today: Cash ${cash || "-"} MoMo ${momo || "-"} owes ${owe}p`, async () => {
    const app = await openPosApp();
    after(() => app.restoreConsole());
    await to19(app, { cash, momo });
    const shown = panel(app);
    assert.equal(shown.rowAmounts.reduce((sum, amount) => sum + amount, 0), shown.total);
    assert.equal(shown.total, 800 - owe);
    assert.equal(shown.rowAmounts.length, (cash ? 1 : 0) + (momo ? 1 : 0));
    assert.equal(shown.owedPesewas, owe);
  });
}

test("with nothing owed the pink row is absent (cash 5.00 + MoMo 3.00)", async () => {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  await app.tap(/Split payment$/);
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  const shown = panel(app);
  assert.equal(shown.total, 300);
  assert.equal(shown.rowAmounts.reduce((sum, amount) => sum + amount, 0), 300);
  assert.equal(shown.owedText, null, "no Still owed row when nothing is owed");
});
