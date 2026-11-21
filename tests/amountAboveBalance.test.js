import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Wiring 26 "Amount above the balance" (decided 21 Nov 2026, found on the phone: Cash and Split were
// disabled but MoMo stayed active and opened), also on 25 (its Pay part opens this same amount editor) and
// 27. While the amount is higher than the balance, the error shows and Cash, MoMo, Split payment and
// Received are ALL disabled and their handlers ignore the tap; the keypad stays active. Real PosApp screens.

const ERROR = "The amount is higher than this customer’s balance.";

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
  // Juju owes GH₵10.00.
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const hostButton = (app, label) => {
  const found = app.button(label);
  // app.button returns the innermost match; for a shared component that is its host <button>.
  return found.type === "button" ? found : nodes(found).find((node) => node.type === "button");
};
const CONTROLS = [["Cash", /^Cash$/], ["MoMo", /^MoMo$/], ["Split payment", "Split payment"], ["Received", /Received$/]];

// 22 > the Collect sheet (25) > Pay part (26).
async function to26(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
  await app.tap("Pay part");
  assert.equal(app.route, "CollectPayPart");
  return debt;
}

async function assertAllBlocked(app, where) {
  assert.ok(app.text().includes(ERROR), `${where}: the error shows`);
  for (const [name, label] of CONTROLS) {
    const button = hostButton(app, label);
    assert.equal(button.props.disabled, true, `${where}: ${name} is disabled`);
    assert.match(String(button.props.className), /disabled:opacity-50/, `${where}: ${name} is faded when disabled`);
  }
  // The handlers ignore the tap too (not just the look): nothing opens, nothing is recorded.
  const before = await db.payments.count();
  for (const [name, label] of CONTROLS) {
    await hostButton(app, label).props.onClick?.({ preventDefault() {}, stopPropagation() {} });
    await app.settle();
    assert.equal(app.route, "CollectPayPart", `${where}: ${name} does not open anything`);
  }
  assert.equal(await db.payments.count(), before, `${where}: nothing is recorded`);
  // The keypad stays active so the amount can be corrected.
  assert.notEqual(hostButton(app, "Delete last digit").props.disabled, true, `${where}: the keypad delete key works`);
  assert.notEqual(hostButton(app, "5").props.disabled, true, `${where}: the keypad digits work`);
}

test("26 (from 25 Pay part): GH₵15.00 above a GH₵10.00 balance disables Cash, MoMo, Split payment and Received", async () => {
  const app = await open();
  await to26(app);
  await app.keys(["1", "5"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵15.00");
  await assertAllBlocked(app, "26 at GH₵15.00");
});

test("26: correcting the amount to GH₵1.00 enables all four again; MoMo then opens 61", async () => {
  const app = await open();
  await to26(app);
  await app.keys(["1", "5"]);
  await app.tap("Delete last digit");
  assert.equal(app.amountShown("Amount to collect"), "GH₵1.00");
  assert.ok(!app.text().includes(ERROR), "the error goes");
  for (const [name, label] of CONTROLS) assert.notEqual(hostButton(app, label).props.disabled, true, `${name} is enabled again`);
  await app.tap(/^MoMo$/);
  assert.equal(app.route, "MoMoChoice");
  assert.equal(app.params.amountPesewas, 100);
});

test("26: correcting the amount enables Split payment (27) and Received (28) again", async () => {
  let app = await open();
  await to26(app);
  await app.keys(["1", "5", "Delete last digit"]);
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  app = await open();
  await to26(app);
  await app.keys(["1", "5", "Delete last digit"]);
  await app.tap(/Received$/);
  assert.equal(app.route, "PaymentReceived");
  assert.equal((await db.payments.toArray()).reduce((sum, row) => sum + row.amountPesewas, 0), 100);
});

test("27: a split total above the balance shows the error and offers no Cash, MoMo or Done to tap", async () => {
  const app = await open();
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("SplitPayment", { debtId: debt.id, customerName: "Juju", amount: "15.00", splitParts: [] });
  await app.settle();
  assert.equal(app.route, "SplitPayment");
  assert.ok(app.text().includes(ERROR), "27: the balance error, not 'could not be found'");
  for (const label of [/^Cash$/, /^MoMo$/, /Done$/, /Received$/, "Split payment"]) {
    assert.throws(() => app.button(label), /No button/, `27: no ${label} control`);
  }
  assert.equal(await db.payments.count(), 0, "27: nothing is recorded");
});

// Real Edge at 340, 360 and 393px: 22 > Owed > Collect from Amoto (25) > Pay part (26), GH₵99.00 typed on a
// GH₵27.00 balance. The error shows, the four controls are disabled and faded, the keypad is not, no
// sideways scroll, every button inside the screen. Then one delete (GH₵9.00) enables them again.
test("26 in the real app at 340, 360 and 393px with an amount above the balance", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  const STATE = `(() => {
    const buttons = [...document.querySelectorAll("button")];
    const byText = (re) => buttons.find((b) => re.test(b.textContent.replace(/\\s+/g, " ").trim()) || re.test(b.getAttribute("aria-label") || ""));
    const pick = { cash: byText(/^Cash$/), momo: byText(/^MoMo$/), split: byText(/^Split payment$/), received: byText(/Received$/), del: byText(/^Delete last digit$/) };
    const out = { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, error: document.body.innerText.includes(${JSON.stringify(ERROR)}) };
    for (const [name, b] of Object.entries(pick)) {
      const r = b.getBoundingClientRect();
      out[name] = { disabled: b.disabled, opacity: getComputedStyle(b).opacity, left: r.left, right: r.right };
    }
    out.text = document.body.innerText;
    return out;
  })()`;
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      const where = `26 at ${width}px`;
      await app.open("base", width, 800);
      await app.steps(["^Owed$", "^Collect from Amoto", "^Pay part$", "^9$", "^9$"]);
      // app.shows waits for a control; the error is a paragraph, so poll the page instead.
      let s = null;
      for (let round = 0; round < 40 && !s?.error; round += 1) {
        await sleep(150);
        s = await app.evaluate(STATE);
      }
      assert.ok(s.error, `${where}: the error shows`);
      assert.ok(s.scrollWidth <= s.innerWidth, `${where}: no sideways scroll`);
      for (const name of ["cash", "momo", "split", "received"]) {
        assert.equal(s[name].disabled, true, `${where}: ${name} disabled`);
        assert.equal(s[name].opacity, "0.5", `${where}: ${name} faded`);
        assert.ok(s[name].left >= -0.5 && s[name].right <= s.innerWidth + 0.5, `${where}: ${name} inside the screen`);
      }
      assert.equal(s.del.disabled, false, `${where}: the keypad stays active`);
      // Item 5: no " · " joins two facts on 26.
      assert.doesNotMatch(s.text, / · /, `${where}: no facts joined with " · "`);
      await app.steps(["^Delete last digit$"]);
      await sleep(200);
      const fixed = await app.evaluate(STATE);
      assert.equal(fixed.error, false, `${where}: the error goes after the correction`);
      for (const name of ["cash", "momo", "split", "received"]) assert.equal(fixed[name].disabled, false, `${where}: ${name} enabled again`);
    }
  });
});

test("27: a total within the balance still offers Cash, MoMo and Done", async () => {
  const app = await open();
  await to26(app);
  await app.keys(["4"]);
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  assert.ok(!app.text().includes(ERROR));
  assert.ok(app.button(/^Cash$/) && app.button(/^MoMo$/) && app.button(/Done$/));
});
