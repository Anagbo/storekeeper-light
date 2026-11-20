import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { setPreference } from "../src/db/preferences.js";
import { signCreditEvent } from "../src/db/signatures.js";
import { isSignedEvent } from "../src/lib/signature.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 29 and 43 (rules_global.customer_proof, 16 Nov 2026): a reason line under every credit row ("No
// reason written" when empty), "Signed ✓" / "Not signed" tags, and Get signature on unsigned entries at
// or above the threshold (opens 72 for that entry; 72 returns to 29/43). All amounts show GH₵.

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

const DAY = 86_400_000;
const NOW = Date.now();
let ids;

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  const rice = await recordCreditSale({ name: "Kofi", amountPesewas: 6000, saleItems: [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: 6000 }], now: NOW - 5 * DAY });
  await signCreditEvent({ transactionId: rice.transactionId, strokes: [[[1, 1]]], now: NOW - 5 * DAY });
  const keypad = await recordCreditSale({ name: "Kofi", amountPesewas: 5000, now: NOW - 4 * DAY });
  const small = await recordManualDebt({ name: "Kofi", amountPesewas: 4999, note: "School fees", now: NOW - 3 * DAY });
  const noNote = await recordManualDebt({ name: "Kofi", amountPesewas: 7000, note: "", now: NOW - 2 * DAY });
  ids = { rice: rice.transactionId, keypad: keypad.transactionId, small: small.event.id, noNote: noNote.event.id };
});

async function openKofi() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Owed$/);
  await app.tap(/^Kofi/);
  assert.equal(app.route, "DebtorDetail");
  return app;
}

function creditRows(app) {
  return [...walk(app.view.tree)].filter((node) => node.props?.["data-credit-row"] !== undefined).map((node) => {
    const reason = [...walk(node)].find((child) => child.props?.["data-reason"] !== undefined);
    const tag = [...walk(node)].find((child) => child.props?.["data-signed"] !== undefined);
    const button = [...walk(node)].find((child) => child.type === "button");
    return { text: textOf(node), reason: textOf(reason), tag: textOf(tag), getSignature: button ? textOf(button) : null, node };
  });
}

test("every credit row: what for, Signed ✓ / Not signed (no Signature row on a small unsigned credit), and Get signature only on unsigned entries at or above GH₵50.00", async () => {
  const app = await openKofi();
  const rows = creditRows(app);
  assert.deepEqual(rows.map(({ reason, tag, getSignature }) => ({ reason, tag, getSignature })), [
    { reason: "No reason written", tag: "Not signed", getSignature: "Get signature" }, // GH₵70.00, no note
    { reason: "School fees", tag: "", getSignature: null }, // GH₵49.99, never signed: below the threshold, no Signature row (threshold_scope)
    { reason: "No reason written", tag: "Not signed", getSignature: "Get signature" }, // GH₵50.00 keypad sale ("Sale")
    { reason: "Rice", tag: "Signed ✓", getSignature: null }
  ]);
  assert.match(rows[0].text, /GH₵70\.00/);
  assert.match(rows[1].text, /GH₵49\.99/);
  assert.match(rows[2].text, /GH₵50\.00/);
  assert.doesNotMatch(app.text(), /Item description unavailable|Item: /);
});

test("every amount in What happened shows GH₵", async () => {
  const app = await openKofi();
  const list = [...walk(app.view.tree)].find((node) => node.type === "ul" && [...walk(node)].some((child) => child.props?.["data-credit-row"] !== undefined));
  const text = textOf(list);
  const amounts = text.match(/(?:GH₵)?[\d,]+\.\d{2}/g);
  assert.ok(amounts.length >= 4);
  for (const amount of amounts) assert.match(amount, /^GH₵/, `${amount} has GH₵`);
});

test("Get signature opens 72 for that entry with its amount and reason; Skip and Back return to 29", async () => {
  const app = await openKofi();
  const row = creditRows(app)[0];
  const button = [...walk(row.node)].find((child) => child.type === "button");
  await button.props.onClick();
  await app.settle();
  assert.equal(app.route, "CustomerSignature");
  assert.equal(app.params.transactionId, ids.noNote);
  assert.equal(app.params.next, undefined, "opened from 29: no onward destination");
  assert.ok(app.state.history.length > 0, "pushed on 29");
  const text = app.text().replace(/\s+/g, " ");
  assert.match(text, /GH₵70\.00/, "that entry's amount, not the balance");
  assert.match(text, /For ?No reason written/);
  await app.tap("Skip for now");
  assert.equal(app.route, "DebtorDetail");
  const again = [...walk(creditRows(app)[0].node)].find((child) => child.type === "button");
  await again.props.onClick();
  await app.settle();
  await app.tap("Back");
  assert.equal(app.route, "DebtorDetail");
  await [...walk(creditRows(app)[0].node)].find((child) => child.type === "button").props.onClick();
  await app.settle();
  await app.phoneBack();
  assert.equal(app.route, "DebtorDetail");
  assert.equal(isSignedEvent(await db.transactions.get(ids.noNote)), false);
});

test("Done on 72 from Get signature signs that entry and returns to 29, which then shows Signed ✓", async () => {
  const app = await openKofi();
  await [...walk(creditRows(app)[2].node)].find((child) => child.type === "button").props.onClick();
  await app.settle();
  assert.equal(app.params.transactionId, ids.keypad);
  const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }), setPointerCapture() {} };
  const canvas = () => [...walk(app.view.tree)].find((node) => node.type === "canvas");
  canvas().props.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10, currentTarget: target, preventDefault() {} });
  await app.settle(2);
  canvas().props.onPointerMove({ pointerId: 1, clientX: 50, clientY: 50, currentTarget: target, preventDefault() {} });
  await app.settle(2);
  await app.tap("Done");
  assert.equal(app.route, "DebtorDetail");
  const signed = await db.transactions.get(ids.keypad);
  assert.equal(isSignedEvent(signed), true);
  assert.equal(signed.signedAmountPesewas, 5000);
  liveResults = new Map();
  await app.settle();
  const rows = creditRows(app);
  assert.equal(rows[2].tag, "Signed ✓");
  assert.equal(rows[2].getSignature, null);
});

test("43 (late) shows the same credit rows", async () => {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  await db.debts.update(debt.id, { dueDate: "2020-01-01" });
  const app = await openKofi();
  assert.match(app.text(), /Late /);
  const rows = creditRows(app);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.tag), ["Not signed", "", "Not signed", "Signed ✓"]);
  assert.equal(rows.filter((row) => row.getSignature).length, 2);
});
