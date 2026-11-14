import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wiring 16 (11 Nov 2026): with no locked row, Back from 16 goes to 15 and keeps the split parts in
// 15's route parameters, so tapping Split payment again reopens 16 with the same Cash, MoMo and Owe
// parts. If the amount on 15 changed meanwhile (the total no longer matches the parts), the parts
// are cleared and 16 starts again with the new total. Done, header Home and another tab still clear
// the draft. After a MoMo pick returns, pending MoMo values are removed as before.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const partsOf = (app) => (app.params.splitParts ?? []).map((part) => [part.paymentMethod, part.amountPesewas, part.momoMethod ?? null, part.verification ?? null]);
const rows = (app) => [...walk(app.view.tree)].filter((node) => node.props?.["data-split-row"] !== undefined).map((node) => node.props["data-split-row"]);
const PENDING = ["pendingMomoAmountPesewas", "momoRowAmountPesewas", "momoMethod", "verification", "reference", "pickOnly", "returnRoute", "confirmAtDone"];

// Sell 8.00 > Split > Cash 4.00 > MoMo 2.00 Direct (back on 16, not confirmed yet). Left GH₵2.00.
async function cash4Momo2(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(partsOf(app), [["cash", 400, null, null], ["momo", 200, "direct", null]]);
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`16: Cash 4.00 + MoMo 2.00, ${name} to 15, Split payment again: both parts are still there`, async () => {
    const app = await open();
    await cash4Momo2(app);
    await back(app);
    assert.equal(app.route, "Sell");
    assert.match(shown(app), /GH₵8\.00/, "15 keeps its amount");
    assert.ok(Array.isArray(app.params.splitDraft?.splitParts), "the parts are kept in 15's route params");
    for (const key of PENDING) {
      assert.equal(app.params[key], undefined, `${key} not on 15`);
      assert.equal(app.params.splitDraft[key], undefined, `${key} not in the kept draft`);
    }
    await app.tap("Split payment");
    assert.equal(app.route, "SplitPayment");
    assert.deepEqual(partsOf(app), [["cash", 400, null, null], ["momo", 200, "direct", null]]);
    assert.deepEqual(rows(app), ["cash", "momo"]);
    assert.match(shown(app), /Left to payGH₵2\.00/);
    assert.equal((await db.transactions.toArray()).length, 0);
  });
}

test("16: the amount on 15 changed: Split payment clears the parts and Left to pay is the new total", async () => {
  const app = await open();
  await cash4Momo2(app);
  await app.tap("Back");
  assert.equal(app.route, "Sell");
  await app.tap("Delete last digit");
  await app.keys(["9"]);
  assert.match(shown(app), /GH₵9\.00/);
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(rows(app), []);
  assert.deepEqual(app.params.splitParts ?? [], []);
  assert.match(shown(app), /Left to payGH₵9\.00/);
  // And Back again keeps nothing stale: 15 then 16 with 9.00 stays empty.
  await app.tap("Back");
  await app.tap("Split payment");
  assert.deepEqual(rows(app), []);
  assert.match(shown(app), /Left to payGH₵9\.00/);
});

test("16: an Owe part (Juju) is kept too, and Done after coming back saves once with it", async () => {
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment");
  await app.tap("Back");
  assert.equal(app.route, "Sell");
  await app.tap("Split payment");
  assert.deepEqual(rows(app), ["cash", "owe"]);
  const oweRow = [...walk(app.view.tree)].find((node) => node.props?.["data-split-row"] === "owe");
  assert.match(textOf(oweRow), /Juju/);
  assert.match(shown(app), /Left to payGH₵0\.00/);
  const before = (await db.transactions.toArray()).length;
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
  assert.equal((await db.transactions.toArray()).filter((row) => row.amountPesewas === 800 && row.paymentType === "credit").length, 1);
  assert.ok((await db.transactions.toArray()).length > before);
});

test("16: header Home and another tab still clear the kept parts", async () => {
  const app = await open();
  await cash4Momo2(app);
  await app.tap("Back");
  assert.ok(app.params.splitDraft);
  await app.menu("Home");
  assert.equal(app.route, "Home");
  await app.tap(/^Sell$/);
  assert.equal(app.params.splitDraft, undefined);
  await app.keys(["8"]);
  await app.tap("Split payment");
  assert.deepEqual(rows(app), []);

  await app.tap("Back");
  const owed = [...walk(app.view.tree)].find((node) => node.type === "button" && textOf(node).trim() === "Owed" && node.props?.["aria-label"] === undefined);
  await owed.props.onClick();
  await app.settle();
  assert.equal(app.route, "PeopleWhoOweYou");
  assert.equal(app.state.history.length, 0);
});

test("16: Done clears the draft: the next sale's 16 starts empty", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Back");
  await app.tap("Split payment");
  assert.deepEqual(rows(app), ["cash"]);
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
  await app.tap(/^New sale$/);
  assert.equal(app.route, "Sell");
  assert.equal(app.params.splitDraft, undefined);
  await app.keys(["8"]);
  await app.tap("Split payment");
  assert.deepEqual(rows(app), []);
});
