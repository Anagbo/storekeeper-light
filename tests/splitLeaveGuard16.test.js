import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wiring 16 (11 Nov 2026): when a locked MoMo row exists (money received) and the owner leaves the
// draft (Cancel sale on 59, header Home, another tab, the on-screen Back from 16, the phone back),
// ask first: "GH₵{amount} MoMo was already received and will not be recorded. Leave anyway?" with
// Stay (default) and Leave. Only Leave continues, and then the whole draft is discarded with
// nothing hidden kept. Without a locked row, leaving behaves as before.

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

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const QUESTION = "GH₵4.00 MoMo was already received and will not be recorded. Leave anyway?";
const shown = (app) => app.text().replace(/\s+/g, " ");
const dialogs = (tree) => [...walk(tree)].filter((node) => node.props?.role === "alertdialog");
const momoPart = (app) => app.params.splitParts?.find((part) => part.paymentMethod === "momo");
const splitEntries = (app) => [...app.state.history, app.state].filter((entry) => entry.current === "SplitPayment");

// Sell 8.00 > Split > Cash 4.00 > MoMo 4.00 Direct (back on 16) > Done > 62 > Money received with the
// commit failing: the draft is back on 16 with GH₵4.00 MoMo received (locked).
async function lockedOn16(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
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
  assert.equal(momoPart(app).verification, "merchant_confirmed");
}

// Not confirmed yet: Sell 8.00 > Split > MoMo 8.00 Direct (back on 16), nothing received.
async function unconfirmedOn16(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoPart(app).verification, undefined);
}

// The header Home button (the first "Home" in the tree); the side menu has its own.
async function headerHome(app) {
  const button = [...walk(app.view.tree)].find((node) => node.type === "button" && node.props?.["aria-label"] === "Home");
  await button.props.onClick();
  return app.settle();
}

// 59's Cancel sale calls onNavigate("Home") with PosApp's navigate (Phone request is off, so 59
// cannot be reached through the screens); 16 is given the same navigate.
async function cancelSaleLike59(app) {
  const screen = [...walk(app.view.tree)].find((node) => node.type?.name === "SaleSplitPayment");
  screen.props.onNavigate("Home");
  return app.settle();
}

async function sideNav(app, label) {
  const button = [...walk(app.view.tree)].find((node) => node.type === "button" && textOf(node).trim() === label && node.props?.["aria-label"] === undefined);
  await button.props.onClick();
  return app.settle();
}

const LEAVES = [
  ["Cancel sale (59)", cancelSaleLike59, "Home"],
  ["header Home", headerHome, "Home"],
  ["another tab (Owed)", (app) => sideNav(app, "Owed"), "PeopleWhoOweYou"],
  ["on-screen Back", (app) => app.tap("Back"), "Sell"],
  ["phone back", (app) => app.phoneBack(), "Sell"]
];

for (const [name, leave, landing] of LEAVES) {
  test(`16 with received MoMo: ${name} asks first; Stay keeps 16 as it was; Leave discards the whole draft`, async () => {
    const app = await open();
    await lockedOn16(app);
    const before = { params: JSON.stringify(app.params), depth: app.state.history.length };
    await leave(app);
    assert.equal(app.route, "SplitPayment", "nothing happens before the answer");
    assert.equal(dialogs(app.view.tree).length, 1);
    assert.equal(textOf(dialogs(app.view.tree)[0]).includes(QUESTION), true, shown(app));
    await app.tap("Stay");
    assert.equal(dialogs(app.view.tree).length, 0);
    assert.equal(app.route, "SplitPayment");
    assert.equal(JSON.stringify(app.params), before.params, "16 is unchanged");
    assert.equal(app.state.history.length, before.depth);
    assert.equal(momoPart(app).verification, "merchant_confirmed");

    await leave(app);
    assert.equal(dialogs(app.view.tree).length, 1);
    await app.tap("Leave");
    assert.equal(dialogs(app.view.tree).length, 0);
    assert.equal(app.route, landing);
    assert.deepEqual(splitEntries(app), [], "no 16 left in the stack");
    assert.equal(app.state.history.length, 0, "nothing hidden kept behind");
    assert.equal(app.params.splitParts, undefined);
    assert.equal(app.params.splitDraft, undefined);
    if (landing === "Sell") assert.match(shown(app), /GH₵0\.00/, "15 starts empty");
    assert.equal((await db.transactions.toArray()).length, 0, "nothing saved");
  });
}

test("16 with received MoMo: the phone back with the question open is Stay", async () => {
  const app = await open();
  await lockedOn16(app);
  await headerHome(app);
  assert.equal(dialogs(app.view.tree).length, 1);
  await app.phoneBack();
  assert.equal(dialogs(app.view.tree).length, 0);
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoPart(app).verification, "merchant_confirmed");
});

test("16 with received MoMo: Stay is the default (focused first) choice", async () => {
  const app = await open();
  await lockedOn16(app);
  await headerHome(app);
  const buttons = [...walk(dialogs(app.view.tree)[0])].filter((node) => node.type === "button");
  assert.deepEqual(buttons.map((node) => textOf(node).trim()), ["Stay", "Leave"]);
  assert.equal(buttons[0].props.autoFocus, true);
});

for (const [name, leave, landing] of LEAVES.filter(([, , to]) => to !== "Sell")) {
  test(`16 with no received MoMo: ${name} does not ask`, async () => {
    const app = await open();
    await unconfirmedOn16(app);
    await leave(app);
    assert.equal(dialogs(app.view.tree).length, 0);
    assert.equal(app.route, landing);
  });
}

test("16 with no received MoMo: Back and the phone back do not ask", async () => {
  const app = await open();
  await unconfirmedOn16(app);
  await app.tap("Back");
  assert.equal(dialogs(app.view.tree).length, 0);
  assert.equal(app.route, "Sell");
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  await app.phoneBack();
  assert.equal(dialogs(app.view.tree).length, 0);
  assert.equal(app.route, "Sell");
});

test("59 Cancel sale uses PosApp's navigate to Home, the path the question guards", () => {
  const screens = readFileSync("src/pos/MoMoScreens.jsx", "utf8");
  const app = readFileSync("src/pos/PosApp.jsx", "utf8");
  assert.match(screens, /onClick=\{\(\) => onNavigate\("Home"\)\}>Cancel sale</);
  assert.match(app, /<MoMoNotCompleted params=\{routeState\.params\} onPayAnotherWay=\{returnToOrigin\} onBack=\{navigateBack\} onNavigate=\{navigate\} \/>/);
});

test("the question at 360px and 393px: fits the screen, wraps a long amount, 60px buttons", async () => {
  const { loadJsx, render } = await import("./helpers/renderJsx.js");
  const { default: LeaveDraftDialog } = await loadJsx("src/pos/LeaveDraftDialog.jsx");
  const view = render({ type: LeaveDraftDialog, props: { amountPesewas: 1234500, onStay() {}, onLeave() {} } });
  const section = dialogs(view.tree)[0];
  assert.equal(textOf(section).includes("GH₵12,345.00 MoMo was already received and will not be recorded. Leave anyway?"), true);
  const classes = String(section.props.className);
  for (const name of ["w-full", "min-w-0", "max-w-md"]) assert.ok(classes.split(" ").includes(name), name);
  const question = [...walk(section)].find((node) => node.props?.id === "leave-draft-question");
  assert.match(String(question.props.className), /overflow-wrap:anywhere/);
  for (const button of [...walk(section)].filter((node) => node.type === "button")) assert.match(String(button.props.className), /min-h-\[60px\]/);
  // Overlay padding p-3 (12px) each side, section padding p-5 (20px) and a 3px border: the text has
  // 360 - 24 - 40 - 6 = 290px at 360px and 323px at 393px; "GH₵12,345.00" at bold 20px is about 130px.
  for (const width of [360, 393]) assert.ok(width - 24 - 40 - 6 > 130);
});
