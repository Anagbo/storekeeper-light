import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.task_column: on a wide layout every sale, collect, plan, MoMo, supplier,
// spent-money, manual-debt, backup and plan-payment screen not given its own page type is one white
// panel, 640px wide, centred on the grey page, with the phone screen's components inside it. Screens
// with their own wide page type (15 Sell) are not task columns, and the phone (below 768) is unchanged.

globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  localStorage.clear();
  localStorage.setItem("storekeeper-shop-name", "Ama Stores");
  await Promise.all([db.debts, db.customers, db.transactions, db.settings].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const find = (app, attr) => [...walk(app.view.tree)].find((node) => node.props?.[attr] !== undefined) ?? null;
const pageArea = (app) => find(app, "data-page-area");

async function openWhoOwesYou(width) {
  const app = await openPosApp({ width });
  if (width >= 768) await app.side("Sell");
  else await app.tap("Sell");
  return app;
}

for (const width of [768, 1024, 1280, 1440]) {
  test(`${width}px: 17 Who owes you is a 640px task column on the grey page; 15 Sell is not`, async () => {
    const app = await openWhoOwesYou(width);
    try {
      assert.equal(app.route, "Sell");
      assert.equal(find(app, "data-task-column"), null, "15 keeps its own wide layout");
      await app.keys("500");
      await app.tap("Owe");
      assert.equal(app.route, "WhoOwesYou");
      const panel = find(app, "data-task-column");
      assert.ok(panel, "17 is drawn in the task column");
      assert.equal(panel.props.style.maxWidth, 640);
      assert.match(panel.props.className, /\bmx-auto\b/, "centred");
      assert.match(panel.props.className, /\bbg-white\b/);
      assert.equal(find(app, "data-task-column-page").props.className.includes(width < 1280 ? "px-5" : "px-8"), true, "rail and sidebar padding");
      assert.equal(pageArea(app).props.style?.backgroundColor, "#F1F5F9", "grey page around the panel");
      assert.ok(app.button("Back"), "Back stays on a task column");
    } finally {
      app.restoreConsole();
    }
  });
}

// D5 (wide_layout.screens["16, 27 Split payment"]): task column, same rows as the phone. The wide 16 has
// the phone's text and controls (names and order), all inside the panel.
const panelOf = (app) => find(app, "data-task-column");
function controlNames(node) {
  return [...walk(node)]
    .filter((child) => child.type === "button")
    .map((button) => (button.props["aria-label"] ?? textOf(button)).replace(/\s+/g, " ").trim());
}
async function openSplit(width) {
  const app = await openWhoOwesYou(width);
  await app.keys("800");
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  return app;
}

test("D5: 16 Split payment on wide has the phone's rows and controls, in the same order, inside the panel", async () => {
  const phone = await openSplit(393);
  const phoneMain = [...walk(phone.view.tree)].find((node) => node.type === "main");
  const phoneText = textOf(phoneMain);
  const phoneControls = controlNames(phoneMain);
  phone.restoreConsole();
  assert.equal(phone.route, "SplitPayment");
  assert.match(phoneText, /Sale total/);
  assert.ok(phoneControls.includes("Back") && phoneControls.at(-1) === "Done", `phone controls: ${phoneControls.join(", ")}`);
  for (const width of [768, 1024, 1280, 1440]) {
    const app = await openSplit(width);
    try {
      assert.equal(app.route, "SplitPayment");
      const panel = panelOf(app);
      assert.ok(panel, `${width}px: 16 in the task column`);
      assert.equal(textOf(panel), phoneText, `${width}px: the same rows and wording`);
      assert.deepEqual(controlNames(panel), phoneControls, `${width}px: the same controls in the same order`);
    } finally {
      app.restoreConsole();
    }
  }
});

// Wide design principles: on 17 in the task column a person row's amount is 17px, bold 700, neutral
// #0F172A (not the phone's dark red fit box). The phone row keeps its look.
test("17 person row amount: 17px neutral on wide, phone unchanged", async () => {
  const { recordCreditSale } = await import("../src/db/debts.js");
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 86_400_000 });
  for (const width of [393, 768, 1280]) {
    const app = await openWhoOwesYou(width);
    try {
      await app.keys("500");
      await app.tap("Owe");
      assert.equal(app.route, "WhoOwesYou");
      const amount = find(app, "data-person-amount");
      if (width < 768) {
        assert.equal(amount, null, "phone keeps its amount look");
        continue;
      }
      assert.ok(amount, `${width}px: amount on the person row`);
      assert.match(textOf(amount), /GH₵10\.00/);
      const classes = amount.props.className;
      for (const want of ["text-[17px]", "font-bold", "text-[#0F172A]", "whitespace-nowrap"]) assert.ok(classes.split(/\s+/).includes(want), want);
      assert.doesNotMatch(classes, /rose|extrabold|amount-fit/);
    } finally {
      app.restoreConsole();
    }
  }
});

test("phone (393px): 17 keeps the phone page, no panel, no grey page", async () => {
  const app = await openWhoOwesYou(393);
  try {
    await app.keys("500");
    await app.tap("Owe");
    assert.equal(app.route, "WhoOwesYou");
    assert.equal(find(app, "data-task-column"), null);
    assert.equal(pageArea(app).props.style, undefined);
  } finally {
    app.restoreConsole();
  }
});

test("the panel drops the phone page's width, margin, padding and overflow classes and keeps its layout classes", async () => {
  const { PosPage, TaskColumnContext } = await loadJsx("src/pos/PosComponents.jsx");
  const { createElement } = await import("react");
  const phoneClasses = "overflow-visible! pb-0! !pb-6 mx-auto flex max-w-2xl flex-col gap-3 px-4 sm:px-6 lg:justify-center text-center";
  const view = render(createElement(TaskColumnContext.Provider, { value: "rail" }, createElement(PosPage, { className: phoneClasses }, "x")));
  const panel = [...walk(view.tree)].find((node) => node.props?.["data-task-column"] !== undefined);
  const classes = panel.props.className.split(/\s+/);
  for (const gone of ["overflow-visible!", "pb-0!", "!pb-6", "max-w-2xl", "px-4", "sm:px-6"]) assert.ok(!classes.includes(gone), gone);
  for (const kept of ["flex", "flex-col", "gap-3", "lg:justify-center", "text-center", "mx-auto"]) assert.ok(classes.includes(kept), kept);

  const phone = render(createElement(PosPage, { className: phoneClasses }, "x"));
  assert.equal([...walk(phone.tree)].some((node) => node.props?.["data-task-column"] !== undefined), false, "no panel without the task column");
});
