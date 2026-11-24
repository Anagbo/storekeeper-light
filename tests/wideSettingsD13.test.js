import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wide Settings (D13, wide_layout.screens["47 Settings"]): list with detail on the Settings route. Four
// rows (My plan only with the subscription flag), Shop selected first, 63, 64 and 71 drawn in the right
// pane, no Back and no Done. The phone keeps 47 with 63, 64 and 71 as screens of their own.

globalThis.HTMLElement ??= class {};
const FLAGS = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_ENABLE_SUBSCRIPTION: "true" };

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.settings, db.transactions].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function open(width, env = FLAGS) {
  const app = await openPosApp({ width, env });
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const rows = (app) => nodes(app.view.tree).filter((node) => node.type === "button" && node.props["data-settings-row"]);
const pane = (app) => nodes(app.view.tree).find((node) => node.props["data-settings-pane"]) ?? null;
async function row(app, id) {
  await rows(app).find((node) => node.props["data-settings-row"] === id).props.onClick();
  return app.settle();
}
const buttonNames = (root) => [...walk(root)].filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());

test("D13 at 768 and 1280: four rows, Shop selected first, each section in the pane, no Back or Done", async () => {
  for (const width of [768, 1280]) {
    const app = await open(width);
    await app.side("SettingsProfitTools");
    assert.equal(app.route, "SettingsProfitTools");
    assert.deepEqual(rows(app).map((node) => node.props["data-settings-row"]), ["shop", "momo", "plan", "backup"], `${width}: the four rows`);
    assert.deepEqual(rows(app).map((node) => textOf(node)), ["ShopName and preferences", "MoMo paymentsNot set up", "My planNot active", "Backup and restoreSave or restore your records"]);
    assert.equal(rows(app)[0].props["aria-current"], "true", `${width}: Shop selected first`);
    assert.equal(pane(app).props["data-settings-pane"], "shop");
    assert.match(textOf(pane(app)), /Shop name.*Save.*Preferences.*Show estimated profit.*A good guess, not exact/);
    const names = buttonNames(app.view.tree);
    assert.ok(!names.includes("Back") && !names.includes("Done"), `${width}: no Back and no Done (${names.join(", ")})`);

    for (const [id, title, route] of [["momo", "MoMo payments", "PaymentSettings"], ["plan", "My plan", "MyPlan"], ["backup", "Backup and restore", "BackupRestore"]]) {
      await row(app, id);
      assert.equal(app.route, "SettingsProfitTools", `${width}: ${id} stays on Settings (not ${route})`);
      assert.equal(pane(app).props["data-settings-pane"], id);
      assert.match(textOf(pane(app)), new RegExp(`^${title}`));
      assert.equal(rows(app).find((node) => node.props["data-settings-row"] === id).props["aria-current"], "true");
      assert.ok(!buttonNames(pane(app)).includes("Back"), `${width}: no Back in the ${id} pane`);
    }
  }
});

test("D13 without the subscription flag: no My plan row", async () => {
  const app = await open(1280, { VITE_ENABLE_MOMO_PHONE_REQUEST: "true" });
  await app.side("SettingsProfitTools");
  assert.deepEqual(rows(app).map((node) => node.props["data-settings-row"]), ["shop", "momo", "backup"]);
});

test("phone: 47 keeps its groups, Back and Done; 63, 64 and 71 stay screens of their own", async () => {
  const app = await open(undefined);
  await app.menu("Settings");
  assert.equal(app.route, "SettingsProfitTools");
  assert.equal(rows(app).length, 0);
  assert.equal(pane(app), null);
  assert.ok(buttonNames(app.view.tree).includes("Done"));
  for (const [label, route] of [[/^MoMo payments/, "PaymentSettings"], [/^My plan/, "MyPlan"], [/^Backup and restore/, "BackupRestore"]]) {
    await app.tap(label);
    assert.equal(app.route, route);
    await app.phoneBack();
    assert.equal(app.route, "SettingsProfitTools");
  }
});

test("a 63, 64 or 71 opened from Settings on the phone becomes that pane when the window grows", async () => {
  const app = await open(undefined);
  await app.menu("Settings");
  await app.tap(/^Backup and restore/);
  assert.equal(app.route, "BackupRestore");
  await app.resize(1280);
  assert.equal(app.route, "SettingsProfitTools");
  assert.equal(pane(app).props["data-settings-pane"], "backup");
});

const pressKey = (key) => { for (const listener of [...(window.__listeners.keydown ?? [])]) listener({ key, target: null, preventDefault() {}, stopPropagation() {} }); };
const dialog = (app) => nodes(app.view.tree).find((node) => node.props["data-wide-dialog"] !== undefined) ?? null;
const footer = (app) => nodes(app.view.tree).find((node) => node.props["data-settings-pane-footer"] !== undefined) ?? null;

test("D13b MoMo pane: Save pinned in the pane footer; a changed number asks in a WideDialog with the phone words; Save stays on Settings", async () => {
  for (const width of [768, 1280]) {
    await db.settings.clear();
    await setPreference("posSetupCompleted", true);
    const app = await open(width);
    await app.side("SettingsProfitTools");
    await row(app, "momo");
    assert.deepEqual(buttonNames(footer(app)), ["Save"], `${width}: Save is the pane footer`);
    await app.tap("Customer sends to my number");
    await app.type("My MoMo number", "0241234567");
    await app.tap(/^Save$/);
    assert.ok(dialog(app), `${width}: the confirmation is a WideDialog`);
    assert.equal(dialog(app).props.role, "alertdialog");
    assert.match(textOf(dialog(app)), /^Customers will send money to 024 ••• 4567 \(MTN\)\. Is this your number\?Yes, saveChange$/);
    pressKey("Escape");
    await app.settle();
    assert.equal(dialog(app), null, `${width}: Escape is Change`);
    assert.equal(app.input("My MoMo number").props.value, "0241234567", `${width}: the number is still typed`);
    await app.tap(/^Save$/);
    await app.tap("Yes, save");
    assert.equal(dialog(app), null);
    assert.equal(app.route, "SettingsProfitTools", `${width}: Save stays on Settings`);
    assert.equal(pane(app).props["data-settings-pane"], "momo");
    assert.equal(app.params.momoSettingsDraft, undefined, `${width}: the draft is dropped after Save`);
    assert.equal((await db.settings.get("momoReceivingNumber"))?.value, "0241234567");
    assert.match(textOf(rows(app)[1]), /Set up$/, `${width}: the row says Set up`);
  }
});
