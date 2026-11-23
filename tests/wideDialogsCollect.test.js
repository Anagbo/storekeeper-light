import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dialog: 25 Collect and 54 Correct balance are WideDialogs when the mode is not
// phone (768 and up), with the phone sheet's content, wording, order and accessible names. Escape and a
// click on the scrim are Close (25) and Cancel (54). Phone below 768 keeps the bottom sheet.

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
  await recordCreditSale({ name: "Ama", amountPesewas: 1_234_500, now: Date.now() - 3 * 86_400_000 });
});

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const sheet = (app, title) => nodes(app.view.tree).find((node) => node.type === "section" && node.props["aria-modal"] === "true" && node.props["aria-labelledby"] === title) ?? null;
const names = (root) => [...walk(root)].filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());
const pressKey = (key) => { for (const listener of [...(window.__listeners.keydown ?? [])]) listener({ key, target: null, preventDefault() {}, stopPropagation() {} }); };
const scrimClick = (app) => nodes(app.view.tree).find((node) => node.props["data-wide-dialog-scrim"] !== undefined).props.onMouseDown({ target: "scrim", currentTarget: "scrim" });

async function open25(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Ama" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
}

async function open54(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: "Ama" });
  await app.settle();
  await app.tap("Correct balance");
}

test("25 Collect on wide (768, 1280) is a WideDialog with the phone sheet's content and names", async () => {
  const phone = await open();
  await open25(phone);
  const phoneSheet = sheet(phone, "collect-title");
  assert.ok(phoneSheet, "phone: the bottom sheet");
  assert.equal(phoneSheet.props["data-wide-dialog"], undefined, "phone keeps its sheet");
  assert.match(phoneSheet.props.className, /rounded-t-\[28px\]/);
  for (const width of [768, 1280]) {
    const app = await open(width);
    await open25(app);
    const dialog = sheet(app, "collect-title");
    assert.ok(dialog, `${width}: dialog`);
    assert.equal(dialog.props["data-wide-dialog"], "", `${width}: the shared WideDialog`);
    assert.equal(dialog.props.role, "dialog");
    assert.match(dialog.props.className, /w-\[520px\]/);
    assert.equal(textOf(dialog), textOf(phoneSheet), `${width}: same content and wording`);
    assert.deepEqual(names(dialog), names(phoneSheet), `${width}: same controls, order and names`);
    assert.match(textOf(dialog), /GH₵12,345\.00/);
  }
});

test("25 on wide: Escape and a click on the scrim are Close (Home)", async () => {
  const app = await open(1280);
  await open25(app);
  pressKey("Escape");
  await app.settle();
  assert.equal(app.route, "Home");
  assert.equal(sheet(app, "collect-title"), null);
  await open25(app);
  scrimClick(app);
  await app.settle();
  assert.equal(app.route, "Home");
});

test("54 Correct balance on wide is a WideDialog with the phone content; Escape and the scrim are Cancel", async () => {
  const phone = await open();
  await open54(phone);
  const phoneSheet = sheet(phone, "pos-correction-title");
  assert.ok(phoneSheet);
  assert.equal(phoneSheet.props["data-wide-dialog"], undefined);
  for (const width of [768, 1280]) {
    const app = await open(width);
    await open54(app);
    const dialog = sheet(app, "pos-correction-title");
    assert.ok(dialog, `${width}: dialog`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(textOf(dialog), textOf(phoneSheet), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneSheet), `${width}: same names and order`);
    pressKey("Escape");
    await app.settle();
    assert.equal(sheet(app, "pos-correction-title"), null, `${width}: Escape is Cancel`);
    assert.equal(app.route, "DebtorDetail", "29 stays behind");
    await app.tap("Correct balance");
    scrimClick(app);
    await app.settle();
    assert.equal(sheet(app, "pos-correction-title"), null, `${width}: the scrim is Cancel`);
    // Nothing was corrected.
    assert.equal((await db.debts.toArray()).find((row) => row.status === "unpaid").amountPesewas, 1_234_500);
  }
});
