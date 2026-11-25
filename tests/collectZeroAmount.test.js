import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { isZeroAmount } from "../src/pos/paymentAmount.js";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Wiring 25 "Zero amount" (decided 22 Nov 2026, found on the phone: MoMo opened with GH₵0.00). While the
// typed amount is 0.00, MoMo and Split payment are disabled and their handlers ignore the tap; Cash stays,
// the keypad stays active. Same pattern as "Amount above the balance". Real PosApp screens.

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
const hostButton = (app, label) => {
  const found = app.button(label);
  return found.type === "button" ? found : nodes(found).find((node) => node.type === "button");
};
const MOMO = /^MoMo$/;
const SPLIT = "Split payment";
const click = (button) => button.props.onClick?.({ preventDefault() {}, stopPropagation() {} });

async function to26(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  await app.tap("Pay part");
  assert.equal(app.route, "CollectPayPart");
}

async function assertBlocked(app, where) {
  for (const [name, label] of [["MoMo", MOMO], ["Split payment", SPLIT]]) {
    const button = hostButton(app, label);
    assert.equal(button.props.disabled, true, `${where}: ${name} is disabled`);
    // MoMo is a choice chip: disabled is the light #CBD5E1 border and #94A3B8 label; Split payment stays faded.
    if (name === "MoMo") {
      const classes = new Set(String(button.props.className).split(/\s+/));
      assert.ok(classes.has("border-[#CBD5E1]") && classes.has("text-[#94A3B8]"), `${where}: ${name} has the disabled chip look`);
    } else {
      assert.match(String(button.props.className), /disabled:opacity-50|opacity-50/, `${where}: ${name} is faded`);
    }
    await click(button);
    await app.settle();
    assert.equal(app.route, "CollectPayPart", `${where}: a tap on ${name} does nothing`);
  }
  assert.notEqual(hostButton(app, /^Cash$/).props.disabled, true, `${where}: Cash stays available`);
  assert.notEqual(hostButton(app, "5").props.disabled, true, `${where}: the keypad stays active`);
}

test("isZeroAmount: 0, null and NaN are zero; 1 pesewa is not", () => {
  assert.equal(isZeroAmount(0), true);
  assert.equal(isZeroAmount(null), true);
  assert.equal(isZeroAmount(Number.NaN), true);
  assert.equal(isZeroAmount(1), false);
});

test("25 Pay part: at GH₵0.00 MoMo and Split payment are disabled and a tap does nothing", async () => {
  const app = await open();
  await to26(app);
  assert.equal(app.amountShown("Amount to collect"), "GH₵0.00");
  await assertBlocked(app, "GH₵0.00");
});

test("25 Pay part: back to 0.00 from a typed value, and after Backspace, they are disabled again", async () => {
  const app = await open();
  await to26(app);
  await app.keys([".", "0", "5"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵0.05");
  await app.keys(["Delete last digit", "Delete last digit", "Delete last digit"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵0.00");
  await assertBlocked(app, "after Backspace");
  await app.keys(["5"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵5.00");
  await app.keys(["Delete last digit"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵0.00");
  await assertBlocked(app, "after typing 5.00 and deleting it all");
});

test("25 Pay part: at GH₵0.01 MoMo and Split payment are enabled and work", async () => {
  let app = await open();
  await to26(app);
  await app.keys([".", "0", "1"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵0.01");
  assert.notEqual(hostButton(app, MOMO).props.disabled, true);
  assert.notEqual(hostButton(app, SPLIT).props.disabled, true);
  await app.tap(MOMO);
  assert.equal(app.route, "MoMoChoice");
  assert.equal(app.params.amountPesewas, 1);
  app = await open();
  await to26(app);
  await app.keys([".", "0", "1"]);
  await app.tap(SPLIT);
  assert.equal(app.route, "SplitPayment");
});

test("25 Pay part: above the balance MoMo and Split payment stay disabled", async () => {
  const app = await open();
  await to26(app);
  await app.keys(["1", "5"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵15.00");
  for (const label of [MOMO, SPLIT]) assert.equal(hostButton(app, label).props.disabled, true);
});

test("25 sheet: Due now and Pay all are never zero, so MoMo and Split payment are enabled", async () => {
  const app = await open();
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  for (const label of [MOMO, SPLIT]) assert.notEqual(hostButton(app, label).props.disabled, true);
});

// Real Edge at 340, 360 and 393px: 22 > Owed > Collect from Amoto > Pay part, nothing typed (GH₵0.00).
test("25 Pay part in the real app at 340, 360 and 393px at GH₵0.00", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  const STATE = `(() => {
    const buttons = [...document.querySelectorAll("button")];
    const byText = (re) => buttons.find((b) => re.test(b.textContent.replace(/\\s+/g, " ").trim()) || re.test(b.getAttribute("aria-label") || ""));
    const out = { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    for (const [name, re] of Object.entries({ cash: /^Cash$/, momo: /^MoMo$/, split: /^Split payment$/, received: /Received$/, five: /^5$/ })) {
      const b = byText(re); if (!b) { out.missing = (out.missing || []).concat(name); continue; } const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      out[name] = { disabled: b.disabled, opacity: cs.opacity, border: cs.borderTopColor, color: cs.color, left: r.left, right: r.right };
    }
    return out;
  })()`;
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      const where = `25 Pay part at ${width}px`;
      await app.open("base", width, 800);
      await app.steps(["^Owed$", "^Collect from Amoto", "^Pay part$"]);
      let s = null;
      for (let round = 0; round < 40 && !s; round += 1) {
        await sleep(150);
        try { s = await app.evaluate(STATE); if (s.missing) { s = null; } } catch (e) { console.log("err", String(e).slice(0,200)); s = null; }
      }
      assert.ok(s, `${where}: the Pay part controls show`);
      assert.ok(s.scrollWidth <= s.innerWidth, `${where}: no sideways scroll`);
      for (const name of ["momo", "split", "received"]) {
        assert.equal(s[name].disabled, true, `${where}: ${name} disabled`);
        if (name === "momo") {
          assert.deepEqual([s[name].border, s[name].color, s[name].opacity], ["rgb(203, 213, 225)", "rgb(148, 163, 184)", "1"], `${where}: ${name} has the disabled chip look`);
        } else {
          assert.equal(s[name].opacity, "0.5", `${where}: ${name} faded`);
        }
      }
      for (const name of ["cash", "five"]) assert.equal(s[name].disabled, false, `${where}: ${name} stays active`);
      for (const name of ["cash", "momo", "split", "received"]) assert.ok(s[name].left >= -0.5 && s[name].right <= s.innerWidth + 0.5, `${where}: ${name} inside the screen`);
      await app.steps(["^5$"]);
      await sleep(250);
      const typed = await app.evaluate(STATE);
      for (const name of ["momo", "split"]) assert.equal(typed[name].disabled, false, `${where}: ${name} enabled at GH₵5.00`);
    }
  });
});
