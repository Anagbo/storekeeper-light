import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dialog: the leave question and the restore confirm are WideDialogs when the
// mode is not phone, with the phone content and names. On the leave question Escape and a scrim click
// are Stay (16 behind keeps its draft); on the restore confirm they are Cancel (nothing restored).

globalThis.HTMLElement ??= class {};

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

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const names = (root) => [...walk(root)].filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());
const pressKey = (key) => { for (const listener of [...(window.__listeners.keydown ?? [])]) listener({ key, target: null, preventDefault() {}, stopPropagation() {} }); };
const scrimClick = (app) => nodes(app.view.tree).find((node) => node.props["data-wide-dialog-scrim"] !== undefined).props.onMouseDown({ target: "scrim", currentTarget: "scrim" });
const question = (app) => nodes(app.view.tree).find((node) => node.props.role === "alertdialog" && node.props["aria-labelledby"] === "leave-draft-question") ?? null;
const go = async (app, route) => {
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate(route);
  await app.settle();
};

// Sell 8 > Split > Cash 4.00 > MoMo 4.00 Direct > Done > 62 > Money received with the commit failing:
// 16 holds GH₵4.00 MoMo received (as tests/splitLeaveGuard16.test.js).
async function lockedOn16(app) {
  await go(app, "Sell");
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  const store = globalThis.IDBObjectStore.prototype;
  const original = { add: store.add, put: store.put };
  for (const name of ["add", "put"]) {
    store[name] = function (...args) {
      if (this.name === "transactions") throw new DOMException("Disk full (test)", "UnknownError");
      return original[name].apply(this, args);
    };
  }
  try {
    await app.tap(/^Money received$/);
  } finally {
    Object.assign(store, original);
  }
  assert.equal(app.route, "SplitPayment");
}

test("leave question on wide (768, 1280): WideDialog with the phone content; Escape and the scrim are Stay; 16 keeps its draft", async () => {
  const phone = await open();
  await lockedOn16(phone);
  await phone.tap("Back");
  const phoneQuestion = question(phone);
  assert.ok(phoneQuestion, "phone: the question");
  assert.equal(phoneQuestion.props["data-wide-dialog"], undefined);
  for (const width of [768, 1280]) {
    const app = await open(width);
    await lockedOn16(app);
    const before = JSON.stringify(app.params);
    const screen = nodes(app.view.tree).find((node) => node.type?.name === "SaleSplitPayment");
    await app.tap("Back");
    const dialog = question(app);
    assert.ok(dialog, `${width}: the question`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(textOf(dialog), textOf(phoneQuestion), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneQuestion), `${width}: Stay first, then Leave`);
    pressKey("Escape");
    await app.settle();
    assert.equal(question(app), null, `${width}: Escape is Stay`);
    assert.equal(app.route, "SplitPayment");
    assert.equal(JSON.stringify(app.params), before, `${width}: the draft behind is kept`);
    await app.tap("Back");
    assert.ok(question(app));
    scrimClick(app);
    await app.settle();
    assert.equal(question(app), null, `${width}: the scrim is Stay`);
    assert.equal(app.route, "SplitPayment");
    assert.equal(JSON.stringify(app.params), before);
    assert.equal(nodes(app.view.tree).find((node) => node.type?.name === "SaleSplitPayment").type, screen.type, "16 stays drawn behind");
    assert.equal((await db.transactions.toArray()).length, 0, "nothing saved");
  }
});

const backupFile = () => new File([JSON.stringify({
  app: "StoreKeeper Light",
  formatVersion: 1,
  exportedAt: "2026-11-09T00:00:00.000Z",
  data: { transactions: [{ id: "sale-1", type: "sale", amountPesewas: 1_234_500, total_amount: 1_234_500, payment_method: "cash", cashReceivedPesewas: 1_234_500, momoReceivedPesewas: 0, createdAt: 100, timestamp: 100, updatedAt: 100 }], customers: [], debts: [], products: [], payments: [], suppliers: [] }
})], "backup.json", { type: "application/json" });

async function askRestore(app) {
  if (app.route !== "BackupRestore") await go(app, "BackupRestore");
  assert.equal(app.route, "BackupRestore");
  const input = nodes(app.view.tree).find((node) => node.type === "input" && node.props.type === "file");
  await input.props.onChange({ target: { files: [backupFile()], value: "x" } });
  for (let round = 0; round < 50 && !/Restore from this file\?/.test(app.text()); round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await app.settle(2);
  }
  return nodes(app.view.tree).find((node) => node.type === "section" && node.props["aria-labelledby"] === "backup-confirm-title") ?? null;
}

test("restore confirm on wide (768, 1280): WideDialog with the phone content; Escape and the scrim are Cancel", async () => {
  const phone = await open();
  const phoneConfirm = await askRestore(phone);
  assert.ok(phoneConfirm, "phone: the confirm on 71");
  assert.equal(phoneConfirm.props["data-wide-dialog"], undefined);
  for (const width of [768, 1280]) {
    const app = await open(width);
    const dialog = await askRestore(app);
    assert.ok(dialog, `${width}: the confirm`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(dialog.props["aria-modal"], "true");
    assert.equal(textOf(dialog), textOf(phoneConfirm), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneConfirm), `${width}: Restore then Cancel, as on the phone`);
    pressKey("Escape");
    await app.settle();
    assert.doesNotMatch(app.text(), /Restore from this file\?/, `${width}: Escape is Cancel`);
    await askRestore(app);
    scrimClick(app);
    await app.settle();
    assert.doesNotMatch(app.text(), /Restore from this file\?/, `${width}: the scrim is Cancel`);
    assert.equal(app.route, "BackupRestore");
  }
  assert.equal((await db.transactions.toArray()).length, 0, "nothing restored");
});
