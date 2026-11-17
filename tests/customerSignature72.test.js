import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { formatDate } from "../src/lib/formatDate.js";
import { isSignedEvent } from "../src/lib/signature.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 72 Customer signs, SAVECREDIT / SAVE19 / SIGNED (decided 16 Nov 2026). The credit is saved
// first; 72 opens only when THAT credit event is at or above VITE_SIGNATURE_THRESHOLD_PESEWAS (default
// 5000); Done, Skip for now, Back and the phone back continue to where the save would have gone.

globalThis.HTMLElement ??= class {};
let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const creditRows = async () => (await db.transactions.toArray()).filter((row) => row.paymentType === "credit" || row.type === "manual_debt");
const newest = async () => (await creditRows()).sort((a, b) => b.createdAt - a.createdAt)[0];

async function sell(app, keys) {
  await app.tap(/^Sell$/);
  await app.keys(keys.split(""));
}

async function chooseJuju(app) {
  assert.equal(app.route, "WhoOwesYou");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
}

async function saleOnCredit(app, keys) {
  await sell(app, keys);
  await app.tap("Owe");
  await chooseJuju(app);
  await app.tap(/^Save · Juju owes/);
}

const canvas = (app) => [...walk(app.view.tree)].find((node) => node.type === "canvas");
const rect = { left: 0, top: 0, width: 300, height: 190 };
async function drawStroke(app) {
  const target = { getBoundingClientRect: () => rect, setPointerCapture() {} };
  const pad = canvas(app);
  pad.props.onPointerDown({ pointerId: 1, clientX: 30, clientY: 40, currentTarget: target, preventDefault() {} });
  await app.settle(2);
  canvas(app).props.onPointerMove({ pointerId: 1, clientX: 120, clientY: 100, currentTarget: target, preventDefault() {} });
  await app.settle(2);
  canvas(app).props.onPointerMove({ pointerId: 1, clientX: 200, clientY: 150, currentTarget: target, preventDefault() {} });
  await app.settle(2);
  canvas(app).props.onPointerUp({ pointerId: 1, currentTarget: target });
  return app.settle();
}

test("threshold off: a credit of GH₵49.99 saves and goes straight to 31, no 72", async () => {
  const app = await open();
  await saleOnCredit(app, "49.99");
  assert.equal(app.route, "CreditSaved");
  assert.equal((await newest()).creditExtendedPesewas, 4999);
});

test("threshold on: GH₵50.00 is saved BEFORE 72 opens; 72 starts a fresh stack", async () => {
  const app = await open();
  await saleOnCredit(app, "50");
  assert.equal(app.route, "CustomerSignature");
  assert.deepEqual(app.state.history, [], "72 after a save starts a fresh stack");
  const event = await newest();
  assert.equal(event.creditExtendedPesewas, 5000, "the credit is already saved");
  assert.equal(app.params.transactionId, event.id);
  assert.equal(isSignedEvent(event), false);
  const text = shown(app);
  assert.match(text, /Please sign/);
  assert.match(text, /Juju owes My shop/);
  assert.match(text, /GH₵50\.00/);
  assert.match(text, /For ?No reason written/, "a keypad sale has no reason");
  assert.doesNotMatch(text, /For: /, "a label-value row, not \"For: …\"");
  assert.match(text, new RegExp(`Taken ?${formatDate(event.createdAt).replace(/\//g, "\\/")}`));
  assert.match(text, /Pay by ?\d{2}\/\d{2}\/\d{4}/, "18 Save sets a due date");
  assert.match(text, /Sign here with your finger/);
  assert.doesNotMatch(text, /legal|proof|guaranteed/i);
});

for (const [name, leave] of [
  ["Skip for now", (app) => app.tap("Skip for now")],
  ["the on-screen Back", (app) => app.tap("Back")],
  ["the phone back", (app) => app.phoneBack()]
]) {
  test(`${name} on 72 never blocks the save: on to 31, Not signed, 72 dropped`, async () => {
    const app = await open();
    await saleOnCredit(app, "60");
    assert.equal(app.route, "CustomerSignature");
    await leave(app);
    assert.equal(app.route, "CreditSaved");
    assert.deepEqual(app.state.history, [], "72 is not in history");
    assert.match(shown(app), /Saved as credit/);
    const event = await newest();
    assert.equal(event.creditExtendedPesewas, 6000);
    assert.equal(isSignedEvent(event), false);
    const unpaid = (await db.debts.toArray()).filter((debt) => debt.status === "unpaid");
    assert.equal(unpaid.reduce((sum, debt) => sum + debt.amountPesewas, 0), 7000, "the credit stays saved");
    await app.phoneBack();
    assert.equal(app.route, "Home", "the phone back from 31 goes Home, never back to 72");
  });
}

test("Done is disabled until there is ink; Clear erases it; Done saves the signature and goes on to 31", async () => {
  const app = await open();
  await saleOnCredit(app, "50");
  assert.equal(app.button("Done").props.disabled, true, "no ink: Done disabled");
  await drawStroke(app);
  assert.doesNotMatch(shown(app), /Sign here with your finger/, "the hint goes on the first stroke");
  assert.equal(app.button("Done").props.disabled, false);
  await app.tap("Clear");
  assert.equal(app.button("Done").props.disabled, true, "Clear: Done disabled again");
  assert.match(shown(app), /Sign here with your finger/);
  await drawStroke(app);
  await app.tap("Done");
  assert.equal(app.route, "CreditSaved");
  assert.deepEqual(app.state.history, []);
  const event = await newest();
  assert.equal(isSignedEvent(event), true);
  assert.equal(event.signedAmountPesewas, 5000);
  assert.equal(event.signedReason, "");
  assert.deepEqual(event.signature[0][0], [100, 211], "points scaled to 0..1000");
});

test("19 Save plan (sale) at the threshold: 72, then 31", async () => {
  const app = await open();
  await sell(app, "80");
  await app.tap("Owe");
  await chooseJuju(app);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "20");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CustomerSignature");
  await app.tap("Skip for now");
  assert.equal(app.route, "CreditSaved");
});

test("split: 18 in flow=split does not open 72; Done on 16 saves, then 72, then 31 (all owed)", async () => {
  const app = await open();
  await sell(app, "50");
  await app.tap("Split payment");
  await app.tap(/^Owe$/);
  await chooseJuju(app);
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment", "nothing saved on 18 in a split");
  assert.equal((await creditRows()).length, 1, "only the older credit");
  await app.tap(/^Done$/);
  assert.equal(app.route, "CustomerSignature");
  assert.equal((await newest()).creditExtendedPesewas, 5000, "saved before 72");
  await app.tap("Skip for now");
  assert.equal(app.route, "CreditSaved");
});

test("split with cash: the Owe part counts, not the sale: GH₵10.00 cash + GH₵50.00 owed opens 72, then 30", async () => {
  const app = await open();
  await sell(app, "60");
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "10.00");
  await app.tap(/^Save$/);
  await app.tap(/^Owe$/);
  await chooseJuju(app);
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "CustomerSignature");
  assert.match(shown(app), /GH₵50\.00/, "the card shows the Owe part");
  await app.tap("Skip for now");
  assert.equal(app.route, "SaleRecorded", "money received today: 30");
});

test("split with cash below the threshold: GH₵20.00 cash + GH₵40.00 owed goes straight to 30", async () => {
  const app = await open();
  await sell(app, "60");
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "20.00");
  await app.tap(/^Save$/);
  await app.tap(/^Owe$/);
  await chooseJuju(app);
  await app.tap(/^Save · Juju owes/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
});

const byPlaceholder = (app, placeholder) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.placeholder === placeholder);

test("Add debt 53 > 18: 72 shows the amount added and the reason, then ManualDebtSaved", async () => {
  const app = await open();
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(app.route, "ManualDebtAmount");
  await app.keys(["7", "0"]);
  byPlaceholder(app, "What for? (optional)").props.onChange({ target: { value: "Cement" } });
  await app.settle();
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "CustomerSignature");
  const text = shown(app);
  assert.match(text, /GH₵70\.00/, "the amount added, not the balance of GH₵80.00");
  assert.match(text, /For ?Cement/);
  await drawStroke(app);
  await app.tap("Done");
  assert.equal(app.route, "ManualDebtSaved");
  const event = await newest();
  assert.equal(event.type, "manual_debt");
  assert.equal(event.signedAmountPesewas, 7000);
  assert.equal(event.signedReason, "Cement");
});

test("53 inherited-terms save: the same signature step", async () => {
  // Juju's debt has a due date, so 53 saves straight away with the same terms.
  const debt = (await db.debts.toArray())[0];
  await db.debts.update(debt.id, { dueDate: "2099-01-01" });
  const app = await open();
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(app.route, "ManualDebtAmount");
  await app.keys(["5", "0"]);
  await app.tap(/^Next/);
  assert.equal(app.route, "CustomerSignature");
  await app.tap("Skip for now");
  assert.equal(app.route, "ManualDebtSaved");
});

test("72 is built for the customer's hand: text 18px or more, buttons 52px or more, Skip is a grey-outline button", () => {
  const source = readFileSync(new URL("../src/pos/CustomerSignature.jsx", import.meta.url), "utf8");
  const box = readFileSync(new URL("../src/pos/SignatureBox.jsx", import.meta.url), "utf8");
  for (const size of source.matchAll(/text-(xs|sm|base|\[1[0-7]px\])\b/g)) assert.fail(`small text ${size[0]} on 72`);
  for (const size of box.matchAll(/text-(xs|sm|base|\[1[0-7]px\])\b/g)) assert.fail(`small text ${size[0]} in the signature box`);
  assert.match(source, /h-\[60px\] w-full[^"]*">\s*\{saving \? t\("signature\.saving"\) : t\("signature\.done"\)\}/, "Done full width, 60px");
  assert.match(source, /h-\[60px\] w-full[^"]*">\s*\{t\("signature\.clear"\)\}/, "Clear full width, 60px");
  // rules_global.button_system.shared (17 Nov 2026): Skip for now is the shared LeaveButton (grey
  // outline, full width, 52px), checked in PosComponents.
  assert.match(source, /<LeaveButton onClick=\{skip\}[^>]*>\s*\{t\("signature\.skip"\)\}/, "Skip for now: the shared LeaveButton");
  const components = readFileSync(new URL("../src/pos/PosComponents.jsx", import.meta.url), "utf8");
  assert.match(components, /export function LeaveButton[\s\S]*?min-h-\[52px\] w-full[^"]*border-2 border-\[#64748B\] bg-white[^"]*font-bold leading-tight text-\[#334155\]/, "LeaveButton: grey outline, full width, 52px");
  assert.match(box, /h-\[190px\][^"]*border-dashed/, "dashed 190px box");
  assert.equal((box.match(/touchAction: "none"/g) ?? []).length, 2, "touch-action none on the box and the canvas");
});

test("72 never says legal, proof or guaranteed", async () => {
  const app = await open();
  await saleOnCredit(app, "50");
  assert.doesNotMatch(textOf(app.view.tree), /legal|proof|guaranteed/i);
});
