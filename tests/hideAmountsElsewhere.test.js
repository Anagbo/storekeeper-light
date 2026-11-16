import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { saveHideAmounts, setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.hide_amounts "not_hidden": the Sell keypad (15), Collect (25), debtor pages (29, 43),
// Transactions (24), receipts and the customer record (73) keep every amount, even while Home and My
// money are hidden. Only 22 and 33 read the setting or use the hidden rendering.

globalThis.HTMLElement ??= class {};
const root = fileURLToPath(new URL("..", import.meta.url));
let liveResults = new Map();

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps.map((dep) => (typeof dep === "number" && dep > 1e12 ? "now" : dep)))}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  await Promise.all([db.products, db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await saveHideAmounts(true);
});

const DAY = 86_400_000;
const hiddenCount = (tree) => [...walk(tree)].filter((node) => node.props?.["data-hidden-amount"] !== undefined).length;
// Hidden figures outside Home (25 is a sheet over Home, so Home's own hidden figures are under it).
function hiddenOutsideHome(node) {
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + hiddenOutsideHome(child), 0);
  if (!node || typeof node !== "object") return 0;
  if (node.type?.name === "Home") return 0;
  const own = node.props?.["data-hidden-amount"] !== undefined ? 1 : 0;
  return own + hiddenOutsideHome("rendered" in node ? node.rendered : node.props?.children);
}
const showsMoney = (text) => /GH₵-?\d/.test(text);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [relative(root, path).replace(/\\/g, "/")] : [];
  });
}

test("hide_amounts: only Home and My money use the hidden rendering; only they and the store read the setting", () => {
  const files = sourceFiles(join(root, "src"));
  const usesHidden = files.filter((file) => /HiddenAmount(\.jsx)?["']/.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(usesHidden.sort(), ["src/pos/Home.jsx", "src/pos/MyMoney.jsx"]);
  const readsSetting = files.filter((file) => /HIDE_AMOUNTS_PREFERENCE|loadHideAmounts|saveHideAmounts|hideAmounts/.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(readsSetting.sort(), ["src/db/preferences.js", "src/pos/Home.jsx", "src/pos/MyMoney.jsx", "src/pos/myMoneyReport.js", "src/utils/backup.js"]);
});

test("hide_amounts: the wiring puts the Hide amounts control on 22 and 33 only", () => {
  const wiring = JSON.parse(readFileSync(join(root, "src/pos/wiring.json"), "utf8"));
  const withControl = Object.entries(wiring.screens).filter(([, screen]) => (screen.controls ?? []).some((control) => control.label === "Hide amounts")).map(([id]) => id);
  assert.deepEqual(withControl.sort(), ["22", "33"]);
});

test("hide_amounts: with amounts hidden, 15, 25, 29, 43 and 24 still show every amount", async () => {
  await recordCreditSale({ name: "Ama Late", amountPesewas: 4200, now: Date.now() - 40 * DAY });
  await recordCreditSale({ name: "Kojo Soon", amountPesewas: 3100, now: Date.now() - DAY, dueDate: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  assert.equal(app.route, "Home");
  assert.ok(hiddenCount(app.view.tree) > 0, "Home is hidden");
  const home = () => [...walk(app.view.tree)].find((node) => node.type?.name === "Home");

  for (const name of ["Ama Late", "Kojo Soon"]) {
    const debt = (await db.debts.toArray()).find((row) => row.customerName === name);
    home().props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: name });
    await app.settle();
    assert.equal(app.route, "DebtorDetail", name);
    assert.equal(hiddenCount(app.view.tree), 0, `29/43 ${name}: nothing hidden`);
    assert.ok(showsMoney(app.text()), `29/43 ${name}: amounts shown`);
    await app.tap(/^Collect$/);
    assert.equal(app.route, "CollectPayment");
    assert.equal(hiddenOutsideHome(app.view.tree), 0, "25: nothing hidden on the sheet");
    assert.ok(showsMoney(app.text()), "25: amounts shown");
    // The phone's Back closes the sheet, then leaves the debtor page.
    for (let step = 0; step < 4 && app.route !== "Home"; step += 1) {
      window.history.back();
      await app.settle();
    }
    assert.equal(app.route, "Home");
  }

  await app.tap(/^Sell$/);
  assert.equal(app.route, "Sell");
  await app.keys(["8"]);
  assert.equal(hiddenCount(app.view.tree), 0, "15: nothing hidden");
  assert.ok(showsMoney(app.text()), "15: the keypad amount is shown");
  await app.goHome();

  await app.menu("Today");
  assert.equal(app.route, "TodaysTransactions");
  assert.equal(hiddenCount(app.view.tree), 0, "24: nothing hidden");
  assert.ok(showsMoney(app.text()), "24: amounts shown");
});

test("hide_amounts: the sale receipt (VITE_ENABLE_POS_RECEIPTS on) keeps its amounts while hidden", async () => {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", { VITE_ENABLE_POS_RECEIPTS: "true" });
  const sale = { id: "sale-1", amountPesewas: 800, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0, timestamp: Date.now(), items_json: "[]" };
  const tree = render({ type: SaleRecorded, props: { transaction: sale, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree;
  assert.equal(hiddenCount(tree), 0);
  assert.match(textOf(tree), /GH₵8\.00/);
  assert.match(textOf(tree), /receipt/i, "the receipt control is there");
});
