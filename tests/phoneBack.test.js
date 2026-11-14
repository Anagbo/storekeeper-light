import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { createBrowserBack, hasOpenSheet, holdBack, registerBackHandler, resetBrowserBack, backIsHeld } from "../src/pos/browserBack.js";
import { createRouteState, navigateState, phoneBackState, backRoute } from "../src/pos/routes.js";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// The phone's back button / swipe back, simulated: a fake window.history and popstate.
// pressBack() is what the phone does: leave the page when on the first browser entry, otherwise
// move one entry back and fire popstate.

globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

function fakeHistory() {
  const history = {
    entries: [{ state: null }],
    index: 0,
    left: false,
    onPop: null,
    get state() { return this.entries[this.index].state; },
    pushState(state) { this.entries.splice(this.index + 1); this.entries.push({ state }); this.index += 1; },
    replaceState(state) { this.entries[this.index] = { state }; },
    back() {
      if (this.index === 0) { this.left = true; return; }
      this.index -= 1;
      this.onPop?.({ state: this.state });
    },
    forward() {
      if (this.index === this.entries.length - 1) return;
      this.index += 1;
      this.onPop?.({ state: this.state });
    }
  };
  return history;
}

function app(start = createRouteState("Home")) {
  const history = fakeHistory();
  const sim = { state: start, history };
  sim.commit = (update) => {
    sim.state = typeof update === "function" ? update(sim.state) : update;
    sim.controller.sync(sim.state);
  };
  sim.controller = createBrowserBack({ history, getState: () => sim.state, goBack: () => sim.commit(phoneBackState) });
  history.onPop = (event) => sim.controller.onPopState(event);
  sim.controller.sync(sim.state);
  sim.go = (route, params = {}) => sim.commit((state) => navigateState(state, route, params));
  sim.pressBack = () => history.back();
  return sim;
}

beforeEach(() => resetBrowserBack());

const SELL_DRAFT = { amountText: "125", paymentMethod: "cash", amountPesewas: 12500 };

test("back at Home with nothing behind leaves the app (never trapped)", () => {
  const sim = app();
  assert.equal(sim.history.entries.length, 1, "no extra entry on Home");
  sim.pressBack();
  assert.equal(sim.history.left, true);
});

const paths = {
  "Add items": [["SellWithItems", { amountPesewas: 12500 }]],
  "Owe, 17 then 18": [["WhoOwesYou", { amountPesewas: 12500 }], ["WhenWillTheyPay", { amountPesewas: 12500 }]],
  "Split": [["SplitPayment", { amountPesewas: 12500 }]],
  "MoMo, 61 then 62": [["MoMoChoice", { amountPesewas: 12500 }], ["MoMoDirect", { amountPesewas: 12500 }]]
};

for (const [name, steps] of Object.entries(paths)) {
  test(`phone back from ${name} returns step by step to 15 with its draft, then Home, then leaves`, () => {
    const sim = app();
    sim.go("Sell", SELL_DRAFT);
    for (const [route, params] of steps) sim.go(route, params);
    for (let index = steps.length - 1; index >= 1; index -= 1) {
      sim.pressBack();
      assert.equal(sim.state.current, steps[index - 1][0]);
    }
    sim.pressBack();
    assert.equal(sim.state.current, "Sell");
    // Wiring 16 (11 Nov 2026): Back from 16 also keeps the split draft in 15's params (splitDraft).
    const expected = name === "Split" ? { ...SELL_DRAFT, splitDraft: { amountPesewas: 12500 } } : SELL_DRAFT;
    assert.deepEqual(sim.state.params, expected, "the draft is kept, as with the on-screen Back");
    sim.pressBack();
    assert.equal(sim.state.current, "Home");
    assert.equal(sim.history.left, false);
    sim.pressBack();
    assert.equal(sim.history.left, true);
  });
}

// The Menu drawer (wiring 23) is an open sheet for the phone's back button, as PosApp registers it
// (useBackHandler(menuOpen, ...)); opening it does not touch the route state.
function openDrawer(sim) {
  const drawer = { open: true };
  drawer.close = registerBackHandler(() => { drawer.open = false; drawer.close(); });
  return drawer;
}

test("Menu drawer > Settings > phone back returns to 15 with its draft (not to the drawer)", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  const drawer = openDrawer(sim);
  drawer.close(); // choosing a row closes the drawer, then goes to that screen
  sim.go("SettingsProfitTools");
  sim.pressBack();
  assert.equal(sim.state.current, "Sell");
  assert.deepEqual(sim.state.params, SELL_DRAFT);
});

test("the phone back with the drawer open closes it; the page, its draft and its history stay", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  const before = JSON.stringify(sim.state);
  for (let index = 0; index < 5; index += 1) {
    const drawer = openDrawer(sim);
    assert.equal(JSON.stringify(sim.state), before, "opening adds no in-app history entry");
    sim.pressBack();
    assert.equal(drawer.open, false, "back closed the drawer");
    assert.equal(JSON.stringify(sim.state), before);
  }
  assert.ok(sim.history.entries.length <= 2, `at most one browser guard entry (${sim.history.entries.length} entries)`);
  sim.pressBack();
  assert.equal(sim.state.current, "Home", "the next back is the page's own back");
});

test("drawer open on Home with nothing behind: back closes it instead of leaving; the next back leaves", () => {
  const sim = app();
  const drawer = openDrawer(sim);
  sim.pressBack();
  assert.equal(drawer.open, false);
  assert.equal(sim.history.left, false);
  assert.equal(sim.state.current, "Home");
  assert.deepEqual(sim.state.history, []);
  sim.pressBack();
  assert.equal(sim.history.left, true, "one press leaves the app, no stale entry to press through");
});

test("the browser keeps at most one extra entry however deep the stack is", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.go("WhoOwesYou");
  sim.go("WhenWillTheyPay");
  sim.go("ALittleAtATime");
  assert.equal(sim.history.entries.length, 2);
});

test("back twice quickly goes back two screens", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.go("WhoOwesYou");
  sim.go("WhenWillTheyPay");
  sim.pressBack();
  sim.pressBack();
  assert.equal(sim.state.current, "Sell");
  assert.deepEqual(sim.state.params, SELL_DRAFT);
});

test("on-screen Back and phone back mixed stay in step", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.go("WhoOwesYou");
  sim.go("WhenWillTheyPay");
  sim.commit(backRoute); // on-screen Back
  sim.pressBack();
  assert.equal(sim.state.current, "Sell");
  sim.pressBack();
  assert.equal(sim.state.current, "Home");
  sim.pressBack();
  assert.equal(sim.history.left, true);
});

test("an open sheet or dialog closes first; the screen and its draft stay", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  let closed = 0;
  const unregister = registerBackHandler(() => { closed += 1; unregister(); });
  sim.pressBack();
  assert.equal(closed, 1);
  assert.equal(sim.state.current, "Sell");
  assert.deepEqual(sim.state.params, SELL_DRAFT);
  assert.equal(sim.history.index, 1, "the guard is back in place");
  sim.pressBack();
  assert.equal(sim.state.current, "Home");
});

test("a dialog open on Home with nothing behind also closes first instead of leaving", () => {
  const sim = app();
  let closed = 0;
  const unregister = registerBackHandler(() => { closed += 1; unregister(); });
  sim.pressBack();
  assert.equal(closed, 1);
  assert.equal(sim.history.left, false);
  sim.pressBack();
  assert.equal(sim.history.left, true);
});

test("while a save is running a back press does nothing", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.go("SplitPayment", { amountPesewas: 12500 });
  const release = holdBack();
  let closed = 0;
  registerBackHandler(() => { closed += 1; });
  sim.pressBack();
  sim.pressBack();
  assert.equal(sim.state.current, "SplitPayment");
  assert.equal(closed, 0, "not even a sheet closes during a save");
  assert.equal(sim.history.left, false);
  release();
  resetBrowserBack();
  const again = app(sim.state);
  again.pressBack();
  assert.equal(again.state.current, "Sell");
});

test("a non-Home screen with nothing behind (a tab opened first) goes to Home", () => {
  const sim = app();
  sim.commit(createRouteState("PeopleWhoOweYou"));
  sim.pressBack();
  assert.equal(sim.state.current, "Home");
  sim.pressBack();
  assert.equal(sim.history.left, true);
});

test("header Home / tab switch after a deep trip leaves no stale entry: one press leaves the app", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.go("WhoOwesYou");
  sim.commit(createRouteState("Home"));
  sim.pressBack();
  assert.equal(sim.history.left, true);
});

test("after a saved sale, back does not return to the finished sale screen", () => {
  for (const result of ["SaleRecorded", "CreditSaved", "PaymentReceived", "ManualDebtSaved"]) {
    const sim = app();
    sim.go("Sell", SELL_DRAFT);
    sim.go("SplitPayment", { amountPesewas: 12500 });
    sim.go(result, { transaction: { id: "t1" } });
    assert.deepEqual(sim.state.history, [], `${result}: the finished sale is not in the stack`);
    sim.pressBack();
    assert.equal(sim.state.current, "Home", result);
  }
});

test("drafts on 15, 16, 19, 27, 53 and 55 come back exactly after phone back", () => {
  const drafts = {
    Sell: SELL_DRAFT,
    SplitPayment: { amountPesewas: 12500, splitParts: [{ paymentMethod: "cash", amountPesewas: 5000 }] },
    ALittleAtATime: { amountPesewas: 12500, planDraft: { every: "week", amountPesewas: 2500 } },
    ManualDebtAmount: { amountText: "40", customer: { name: "Ama" } },
    ReviewAndPay: { amountPesewas: 1000, saleItems: [{ productId: 1, name: "Rice", quantity: 2, unitPricePesewas: 500 }] }
  };
  drafts["SplitPayment (27)"] = { installmentSplit: true, debtId: "d1", splitParts: [{ paymentMethod: "momo", amountPesewas: 300 }] };
  for (const [key, params] of Object.entries(drafts)) {
    const route = key.split(" ")[0];
    const sim = app();
    sim.go(route, params);
    openDrawer(sim).close(); // the drawer's Settings row
    sim.go("SettingsProfitTools");
    sim.pressBack();
    assert.equal(sim.state.current, route, key);
    assert.deepEqual(sim.state.params, params, key);
  }
});

test("the collect sheet closes on back as its Close does (Home behind it)", () => {
  const sim = app();
  sim.go("CollectPayment", { debtId: "d1", customerName: "Ama" });
  sim.pressBack();
  assert.equal(sim.state.current, "Home");
  assert.deepEqual(sim.state.history, []);
});

test("browser Forward into the guard entry does nothing", () => {
  const sim = app();
  sim.go("Sell", SELL_DRAFT);
  sim.pressBack();
  assert.equal(sim.state.current, "Home");
  sim.history.forward();
  assert.equal(sim.state.current, "Home");
});

// ---- the real screens ------------------------------------------------------------------------------

test("15: back with the large-amount dialog open closes it (Change amount) and saves nothing", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const saves = [];
  const view = render({ type: Sell, props: { params: { amountPesewas: 500000 }, onNavigate() {}, onUpdateParams() {}, recordSale: async (sale) => { saves.push(sale); return {}; } } });
  findButton(view.tree, "Done").props.onClick();
  view.rerender();
  flushEffects(view);
  assert.ok([...walk(view.tree)].some((node) => node.props?.role === "alertdialog"), "dialog open");
  assert.equal(hasOpenSheet(), true);
  const sim = app(createRouteState("Sell", { amountPesewas: 500000 }));
  sim.pressBack();
  view.rerender();
  assert.ok(![...walk(view.tree)].some((node) => node.props?.role === "alertdialog"), "dialog closed");
  assert.equal(saves.length, 0, "a back press never confirms");
  assert.equal(sim.state.current, "Sell");
  assert.match(textOf(view.tree), /GH₵5,000\.00/, "the amount stays");
});

test("15: while the sale is saving, back is held; it is released after", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  let finish;
  const view = render({ type: Sell, props: { params: { amountPesewas: 1000 }, onNavigate() {}, onUpdateParams() {}, recordSale: () => new Promise((resolve) => { finish = resolve; }) } });
  const saving = findButton(view.tree, "Done").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backIsHeld(), true);
  finish({ id: "t1" });
  await saving;
  assert.equal(backIsHeld(), false);
});

test("supplier Pay sheet (46): back closes it like Cancel; held while the payment saves", () => {
  const source = readFileSync(new URL("../src/pos/SupplierScreens.jsx", import.meta.url), "utf8");
  const part = source.slice(source.indexOf("export function YouOweSuppliers"));
  assert.match(part, /useBackHandler\(Boolean\(selectedSupplier\), \(\) => setSelectedSupplier\(null\)\)/);
  assert.match(part, /useBackBlock\(saving\)/);
});

test("PosApp listens to popstate and uses the shared route helpers", () => {
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("popstate"/);
  assert.match(source, /removeEventListener\("popstate"/);
  assert.match(source, /createBrowserBack\(/);
  assert.match(source, /navigateState\(/);
  assert.match(source, /phoneBackState/);
});