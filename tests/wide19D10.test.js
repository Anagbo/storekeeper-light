import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wide D10 (wide_layout.screens["19 A little at a time"]): a wider task layout (1040px) with the form on
// the left and the summary on the right (Owed, exactly one Paying today panel, Save plan at the bottom).
// The panel and the Owed block are soft tiles; the Still owed row is neutral. Layout only: the same
// controls and accessible names as the phone (Back moves to the top left of the panel), the same
// saved records, the draft kept over Back and a sidebar tap. The phone (393) is unchanged.

globalThis.HTMLElement ??= class {};

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
});

const WIDTHS = [768, 1024, 1280, 1440];
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const byAttr = (tree, attr) => nodes(tree).filter((node) => node.props[attr] !== undefined);
const one = (tree, attr) => byAttr(tree, attr)[0] ?? null;
const classOf = (node) => node?.props.className ?? "";
function controlNames(node) {
  return [...walk(node)]
    .filter((child) => child.type === "button")
    .map((button) => (button.props["aria-label"] ?? textOf(button)).replace(/\s+/g, " ").trim());
}
const pageOf = (app, width) => width >= 768 ? one(app.view.tree, "data-task-column") : [...walk(app.view.tree)].find((node) => node.type === "main");

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

// Sell GH₵8.00 on credit to a new customer "KOFI MENSAH", then 19 with GH₵2.00 each time.
async function to19(app, width) {
  if (width >= 768) await app.side("Sell");
  else await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  const nameInput = nodes(app.view.tree).find((node) => node.type === "input" && node.props.placeholder === "e.g. Kofi Mensah");
  nameInput.props.onChange({ target: { value: "KOFI MENSAH" } });
  await app.settle();
  await nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "2");
}

async function payTodayCash(app) {
  await app.tap("Today");
  await app.type("Amount paid today", "2");
  await app.tap(/^Cash$/);
}

test("D10 at 768, 1024, 1280 and 1440: 1040px task layout, form left, summary right, one soft Paying today panel, neutral Still owed", async () => {
  for (const width of WIDTHS) {
    const app = await open(width);
    await to19(app, width);
    await payTodayCash(app);
    const panel = one(app.view.tree, "data-task-column");
    assert.ok(panel, `${width}: task column`);
    assert.equal(panel.props.style.maxWidth, 1040, `${width}: wider task layout`);
    const grid = one(panel, "data-d10");
    assert.match(classOf(grid), /@min-\[820px\]:grid-cols-\[minmax\(0,1fr\)_380px\]/, `${width}: two columns when they fit, stacked otherwise`);
    const form = one(panel, "data-d10-form");
    const summary = one(panel, "data-d10-summary");
    assert.match(classOf(form), /\bgrid-cols-2\b/, `${width}: fields paired`);
    for (const label of ["How much each time?", "How often?", "First payment", "Amount paid today", "Next payment date"]) {
      assert.ok(textOf(form).includes(label), `${width}: ${label} in the form`);
    }

    const panels = byAttr(app.view.tree, "data-paying-today");
    assert.equal(panels.length, 1, `${width}: exactly one Paying today panel`);
    assert.ok(byAttr(summary, "data-paying-today").length === 1, `${width}: the panel is in the summary`);
    const paying = panels[0];
    assert.match(classOf(paying), /bg-\[#F1F5F9\]/, `${width}: soft tile fill`);
    assert.doesNotMatch(classOf(paying), /emerald|border-2/, `${width}: no mint fill, no green border`);
    assert.match(classOf(one(paying, "data-total-today")), /border-\[#E2E8F0\]/);
    assert.match(textOf(one(paying, "data-total-today")), /Total today\s*GH₵2\.00/);
    const owed = one(paying, "data-still-owed");
    assert.equal(textOf(owed).replace(/\s+/g, " ").trim(), "Still owed · Kofi MensahGH₵6.00");
    assert.match(classOf(owed), /\bbg-white\b/);
    assert.match(classOf(owed), /text-\[#0F172A\]/);
    assert.doesNotMatch(classOf(owed), /rose|extrabold/, `${width}: neutral Still owed row`);

    const owedTile = one(summary, "data-owed-tile");
    assert.ok(owedTile, `${width}: Owed at the top of the summary`);
    assert.equal(nodes(summary).indexOf(owedTile) < nodes(summary).indexOf(paying), true);
    assert.match(classOf(owedTile), /bg-\[#F1F5F9\]/);
    assert.match(textOf(owedTile), /OwedGH₵8\.00/);

    const summaryControls = controlNames(summary);
    assert.deepEqual(summaryControls, ["Save plan"], `${width}: Save plan is the one action in the summary`);
    assert.equal(nodes(summary).filter((node) => node.props["data-look"] === "main").length, 1);
  }
});

test("D10 has the phone's controls and accessible names (Back moves to the top left), the phone keeps its look", async () => {
  const phone = await open(393);
  await to19(phone, 393);
  await payTodayCash(phone);
  const phonePage = pageOf(phone, 393);
  const phoneControls = controlNames(phonePage);
  assert.equal(phoneControls.at(-2), "Back");
  assert.equal(phoneControls.at(-1), "Save plan");
  assert.equal(one(phone.view.tree, "data-task-column"), null);
  assert.equal(one(phone.view.tree, "data-d10"), null);
  const phonePanel = byAttr(phone.view.tree, "data-paying-today");
  assert.equal(phonePanel.length, 1);
  assert.match(classOf(phonePanel[0]), /bg-\[#F1F5F9\]/, "phone: the same soft tile (24 Nov 2026)");
  assert.doesNotMatch(classOf(one(phonePanel[0], "data-still-owed")), /rose/, "phone: neutral Still owed row");
  const phoneInputs = nodes(phonePage).filter((node) => node.type === "input").map((node) => node.props["aria-label"] ?? node.props.type);
  for (const width of WIDTHS) {
    const app = await open(width);
    await to19(app, width);
    await payTodayCash(app);
    const page = pageOf(app, width);
    const wide = controlNames(page);
    assert.deepEqual(wide, ["Back", ...phoneControls.filter((name) => name !== "Back")], `${width}: ${wide.join(", ")}`);
    assert.deepEqual(nodes(page).filter((node) => node.type === "input").map((node) => node.props["aria-label"] ?? node.props.type), phoneInputs, `${width}: the same fields in the same order`);
    // rules_global.icons: Cash and MoMo show their icon with the label; Split payment its cash + phone icons.
    for (const label of ["Cash", "MoMo"]) {
      const tile = [...walk(page)].find((node) => node.type === "button" && textOf(node).trim() === label);
      assert.ok([...walk(tile)].some((node) => node.props?.["aria-hidden"] === "true" || node.props?.["aria-hidden"] === true), `${width}: ${label} icon`);
      assert.match(classOf(tile), /text-\[17px\]/, `${width}: ${label} 17px`);
    }
    for (const node of [...walk(page)].filter((child) => child.type === "button" && /^(Every|Next cycle)/.test(textOf(child).trim()))) {
      assert.match(classOf(node), /text-\[17px\]/, `${width}: "${textOf(node)}" 17px`);
    }
    assert.match(classOf(one(page, "data-split-19")), /text-\[17px\]!/, `${width}: Split payment 17px`);
  }
});

test("D10 with parts recorded on 27: one panel, in the summary; Next cycle and flow=split as on the phone", async () => {
  for (const width of [393, 1280]) {
    const app = await open(width);
    await to19(app, width);
    await app.tap("Today");
    await app.type("Amount paid today", "3");
    await app.tap(/Split payment$/);
    assert.equal(app.route, "SplitPayment");
    await app.tap(/^Cash$/);
    await app.tap("Edit Cash amount");
    await app.type("split-draft-amount", "3.00");
    await app.tap(/^Save$/);
    await app.tap(/^Done$/);
    assert.equal(app.route, "ALittleAtATime");
    const panels = byAttr(app.view.tree, "data-paying-today");
    assert.equal(panels.length, 1, `${width}: exactly one panel`);
    assert.match(textOf(panels[0]), /Total today\s*GH₵3\.00/);
    assert.match(textOf(one(panels[0], "data-still-owed")), /GH₵5\.00/);
    if (width >= 768) assert.equal(byAttr(one(app.view.tree, "data-d10-summary"), "data-paying-today").length, 1);

    await app.tap(/^Next cycle/);
    assert.equal(byAttr(app.view.tree, "data-paying-today").length, 0, `${width}: Next cycle hides the panel`);
    assert.equal(byAttr(app.view.tree, "data-still-owed").length, 0);
  }

  // flow=split (an Owe part on 16): 19 hides its own payment section, on the phone and on wide; the
  // parts paid on 16 show in the one panel exactly as on the phone.
  const shownBy = {};
  for (const width of [393, 1280]) {
    const app = await open(width);
    if (width >= 768) await app.side("Sell");
    else await app.tap(/^Sell$/);
    await app.keys(["8"]);
    await app.tap("Split payment");
    await app.tap(/^Cash$/);
    await app.tap("Edit Cash amount");
    await app.type("split-draft-amount", "4.00");
    await app.tap(/^Save$/);
    await app.tap(/^Owe$/);
    await app.tap(/New person/);
    const nameInput = nodes(app.view.tree).find((node) => node.type === "input" && node.props.placeholder === "e.g. Kofi Mensah");
    nameInput.props.onChange({ target: { value: "KOFI MENSAH" } });
    await app.settle();
    await nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    await app.settle();
    await app.tap(/A little at a time/);
    assert.equal(app.route, "ALittleAtATime");
    assert.equal(app.params.flow, "split");
    assert.ok(!app.text().includes("Amount paid today"), `${width}: no Amount paid today in a split`);
    assert.ok(!app.text().includes("How is it paid?"), `${width}: no payment choice in a split`);
    const panels = byAttr(app.view.tree, "data-paying-today");
    assert.ok(panels.length <= 1, `${width}: at most one panel`);
    shownBy[width] = panels.map((panel) => textOf(panel));
  }
  assert.deepEqual(shownBy[1280], shownBy[393], "wide shows the same panel as the phone in a split");
});

// Stored records without their ids and times, so a phone save and a wide save compare.
function plain(records) {
  const drop = /(^id$|Id$|At$|^at$|time|attempt|uuid|^key$)/i;
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !drop.test(key)).map(([key, inner]) => [key, clean(inner)]));
    if (typeof value === "number" && value > 1e12) return "<time>";
    if (typeof value === "string" && /^[0-9a-f-]{20,}$/i.test(value)) return "<id>";
    return value;
  };
  return clean(records);
}

test("Save plan on wide saves exactly what the phone saves", async () => {
  const saved = {};
  for (const width of [393, 1280]) {
    await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
    const app = await open(width);
    await to19(app, width);
    await payTodayCash(app);
    await app.tap(/^Save plan$/);
    assert.equal(app.route, "CreditSaved", `${width}: saved`);
    saved[width] = plain({
      debts: await db.debts.toArray(),
      customers: await db.customers.toArray(),
      transactions: await db.transactions.toArray(),
      payments: db.payments ? await db.payments.toArray() : []
    });
  }
  assert.ok(saved[393].debts.length > 0);
  assert.deepEqual(saved[1280], saved[393]);
});

test("D10 draft survives Back and a sidebar tap", async () => {
  const app = await open(1280);
  await to19(app, 1280);
  await app.tap("Every 2 weeks");
  await payTodayCash(app);
  const draft = () => ({
    each: app.input("How much each time?").props.value,
    today: app.input("Amount paid today").props.value,
    often: app.button("Every 2 weeks").props["aria-pressed"],
    cash: app.button(/^Cash$/).props["aria-pressed"]
  });
  const before = draft();
  assert.deepEqual(before, { each: "2", today: "2", often: true, cash: true });
  await app.tap("Back");
  assert.equal(app.route, "WhenWillTheyPay");
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  assert.deepEqual(draft(), before, "kept over Back");
  await app.side("SettingsProfitTools");
  assert.notEqual(app.route, "ALittleAtATime");
  await app.phoneBack();
  assert.equal(app.route, "ALittleAtATime");
  assert.deepEqual(draft(), before, "kept over a sidebar tap");
});
