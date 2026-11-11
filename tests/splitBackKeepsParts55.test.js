import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { getSplitPaymentParams } from "../src/pos/routes.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { walk } from "./helpers/renderJsx.js";

// Wiring MOMO16 (11 Nov 2026): Back from 16 opened from 55 (Review and pay) keeps the parts the same
// way as from 15: Split payment on 55 reopens them while the total is unchanged.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const rows = (app) => [...walk(app.view.tree)].filter((node) => node.props?.["data-split-row"] !== undefined).map((node) => node.props["data-split-row"]);
const ITEMS = [{ productId: 1, name: "Rice", unitPricePesewas: 800, quantity: 1 }];

// 55 cannot be filled in without a saved item list, so the real PosApp is opened on 15 and sent to
// 55 through 15's own navigate with one item (what Add items > Next does).
async function open55() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  const sell = [...walk(app.view.tree)].find((node) => node.type?.name === "Sell");
  sell.props.onNavigate("ReviewAndPay", { saleItems: ITEMS });
  await app.settle();
  assert.equal(app.route, "ReviewAndPay");
  return app;
}

test("55 > 16 > Cash 3.00 > Back > Split payment: 16 reopens with the same part; the draft is not left on 16's params twice", async () => {
  const app = await open55();
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  await app.tap("Back");
  assert.equal(app.route, "ReviewAndPay");
  assert.ok(app.params.splitDraft, "kept in 55's route params");
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(rows(app), ["cash"]);
  assert.deepEqual(app.params.splitParts.map((part) => [part.paymentMethod, part.amountPesewas]), [["cash", 300]]);
  assert.equal(app.params.splitDraft, undefined, "16 does not carry a draft of itself");
  assert.match(app.text().replace(/\s+/g, " "), /Left to payGH₵5\.00/);
});

test("getSplitPaymentParams: a changed total starts again; the source's own splitDraft never leaks into 16", () => {
  const draft = { amountPesewas: 800, splitParts: [{ paymentMethod: "cash", amountPesewas: 300 }], saleItems: ITEMS };
  const source = { saleItems: ITEMS, paymentChoice: "cash", splitDraft: draft };
  assert.deepEqual(getSplitPaymentParams(source, 800, ITEMS, source), { paymentChoice: "cash", ...draft, amountPesewas: 800, saleItems: ITEMS });
  assert.deepEqual(getSplitPaymentParams(source, 900, ITEMS, source), { saleItems: ITEMS, paymentChoice: "cash", amountPesewas: 900 });
  assert.deepEqual(getSplitPaymentParams({ splitDraft: draft }, 800, ITEMS), { ...draft, amountPesewas: 800, saleItems: ITEMS });
});
