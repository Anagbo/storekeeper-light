import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Header rule (14 Nov 2026, after the drawer commit 41bd232): only screens that show the Menu button
// lose the green home tile. Every screen without a Menu button (26, 27, 28, 29/43, setup, People who
// owe you) keeps the header exactly as before: the green tile as the header Home button, with its
// draft rule (switchTab: leave the draft, asking first when MoMo was received).

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
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const header = (app) => nodes(app.view.tree).find((node) => node.type === "header");
const headerButtons = (app) => [...walk(header(app))].filter((node) => node.type === "button");
const tile = (app) => headerButtons(app).find((node) => node.props["aria-label"] === "Home");
const menuButton = (app) => headerButtons(app).find((node) => node.props["aria-label"] === "Open menu");

function assertTile(app, where) {
  const home = tile(app);
  assert.ok(home, `${where}: the green home tile is in the header`);
  assert.match(home.props.className, /bg-emerald-900/, `${where}: the tile is green`);
  assert.equal(menuButton(app), undefined, `${where}: no Menu button`);
}

async function debtId() {
  return (await db.debts.toArray()).find((row) => row.status === "unpaid").id;
}

async function toCollect(app) {
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: await debtId(), customerName: "Juju" });
  await app.settle();
}

test("screens with the Menu button have no green tile (Home, Sell)", async () => {
  const app = await open();
  assert.ok(menuButton(app));
  assert.equal(tile(app), undefined);
  await app.tap("Sell");
  assert.ok(menuButton(app), "Sell has the Menu button");
  assert.equal(tile(app), undefined);
});

test("26 and 27 (collect split) keep the green home tile; it goes Home", async () => {
  const app = await open();
  await toCollect(app);
  await app.tap("Pay part");
  assert.equal(app.route, "CollectPayPart");
  assertTile(app, "26");
  await app.keys(["4"]);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assertTile(app, "27");
  await tile(app).props.onClick();
  await app.settle();
  assert.equal(app.route, "Home", "the tile leaves the draft and goes Home");
  assert.ok(menuButton(app));
});

test("28 payment received keeps the green home tile; it goes Home", async () => {
  const app = await open();
  await toCollect(app);
  await app.tap("Pay part");
  await app.type("Amount to collect", "7");
  await app.tap(/^Cash$/);
  await app.tap(/^Received$/);
  assert.equal(app.route, "PaymentReceived");
  assertTile(app, "28");
  await tile(app).props.onClick();
  await app.settle();
  assert.equal(app.route, "Home");
});

test("29/43 debtor details keep the green home tile", async () => {
  const app = await open();
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("DebtorDetail", { debtId: await debtId(), customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "DebtorDetail");
  assertTile(app, "29/43");
  await tile(app).props.onClick();
  await app.settle();
  assert.equal(app.route, "Home");
});

test("People who owe you keeps the green home tile", async () => {
  const app = await open();
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("PeopleWhoOweYou");
  await app.settle();
  assert.equal(app.route, "PeopleWhoOweYou");
  assertTile(app, "People who owe you");
});

test("setup (21) keeps the green home tile and no Menu button", async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  const app = await open();
  assert.equal(app.route, "HowDoYouWantToSell");
  assertTile(app, "21");
});
