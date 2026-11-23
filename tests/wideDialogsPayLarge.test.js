import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { recordExpense } from "../src/db/suppliers.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dialog: the 46 Pay sheet and the large-amount confirm are WideDialogs when the
// mode is not phone, with the phone content and names. Escape and the scrim are Cancel (46) and Change
// amount (confirm). The sale typed behind the confirm survives opening and closing it.

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
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts, db.suppliers].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
  await recordExpense({ amountPesewas: 1_234_500, paidAmountPesewas: 0, category: "stock", supplierId: "s1" });
});

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const modal = (app, title) => nodes(app.view.tree).find((node) => node.type === "section" && node.props["aria-modal"] === "true" && node.props["aria-labelledby"] === title) ?? null;
const names = (root) => [...walk(root)].filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());
const pressKey = (key) => { for (const listener of [...(window.__listeners.keydown ?? [])]) listener({ key, target: null, preventDefault() {}, stopPropagation() {} }); };
const scrimClick = (app) => nodes(app.view.tree).find((node) => node.props["data-wide-dialog-scrim"] !== undefined).props.onMouseDown({ target: "scrim", currentTarget: "scrim" });
const go = async (app, route) => {
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate(route);
  await app.settle();
  assert.equal(app.route, route);
};

async function openPay(app) {
  await go(app, "YouOweSuppliers");
  await app.tap("Pay Kofi");
  return modal(app, "supplier-payment-title");
}

test("46 Pay sheet on wide (768, 1280) is a WideDialog with the phone content; Escape and the scrim are Cancel", async () => {
  const phone = await open();
  const phoneSheet = await openPay(phone);
  assert.ok(phoneSheet, "phone: the Pay sheet");
  assert.equal(phoneSheet.props["data-wide-dialog"], undefined);
  for (const width of [768, 1280]) {
    const app = await open(width);
    const dialog = await openPay(app);
    assert.ok(dialog, `${width}: dialog`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(dialog.props.role, "dialog");
    assert.equal(textOf(dialog), textOf(phoneSheet), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneSheet), `${width}: same names and order`);
    assert.match(textOf(dialog), /GH₵12,345\.00/);
    pressKey("Escape");
    await app.settle();
    assert.equal(modal(app, "supplier-payment-title"), null, `${width}: Escape is Cancel`);
    await app.tap("Pay Kofi");
    scrimClick(app);
    await app.settle();
    assert.equal(modal(app, "supplier-payment-title"), null, `${width}: the scrim is Cancel`);
    assert.equal(app.route, "YouOweSuppliers");
  }
  assert.equal((await db.transactions.toArray()).length, 1, "no payment recorded");
});

async function askLarge(app) {
  await go(app, "Sell");
  await app.keys(["1", "2", "3", "4", "5"]);
  await app.tap("Done");
  return nodes(app.view.tree).find((node) => node.props.role === "alertdialog" && node.props["aria-labelledby"] === "large-amount-title") ?? null;
}

test("large-amount confirm on wide is a WideDialog alertdialog with the phone content", async () => {
  const phone = await open();
  const phoneDialog = await askLarge(phone);
  assert.ok(phoneDialog, "phone: the confirm");
  assert.equal(phoneDialog.props["data-wide-dialog"], undefined);
  for (const width of [768, 1280]) {
    const app = await open(width);
    const dialog = await askLarge(app);
    assert.ok(dialog, `${width}: dialog`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(dialog.props["aria-describedby"], "large-amount-body");
    assert.equal(textOf(dialog), textOf(phoneDialog), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneDialog), `${width}: Change amount first, then Yes, save`);
    assert.match(textOf(dialog), /GH₵12,345\.00/);
  }
});

test("large-amount confirm on wide: Escape and the scrim are Change amount; the typed sale behind survives", async () => {
  const app = await open(1280);
  const sell = () => nodes(app.view.tree).find((node) => node.type?.name === "Sell");
  await askLarge(app);
  const before = sell();
  pressKey("Escape");
  await app.settle();
  assert.equal(nodes(app.view.tree).find((node) => node.props.role === "alertdialog"), undefined, "Escape closes it");
  assert.equal(app.route, "Sell");
  assert.match(textOf(sell()), /12,345\.00/, "the amount typed behind is kept");
  assert.equal(sell().type, before.type);
  await app.tap("Done");
  scrimClick(app);
  await app.settle();
  assert.equal(nodes(app.view.tree).find((node) => node.props.role === "alertdialog"), undefined, "the scrim closes it");
  assert.match(textOf(sell()), /12,345\.00/);
  assert.equal((await db.transactions.toArray()).length, 1, "no sale saved");
  // Yes, save still saves once.
  await app.tap("Done");
  await app.tap(/^Yes, save/);
  assert.equal((await db.transactions.toArray()).filter((row) => row.type === "sale").length, 1);
});
