import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRouteState, pushRoute, replaceRoute, backRoute, returnToMomoOrigin } from "../src/pos/routes.js";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 15: the amount, the Cash/MoMo choice and the added items survive a trip to a screen opened
// from 15 and back. 15 keeps its draft in the route parameters, as the split screen does.
// This drives the real Sell screen with the real route state functions: each visit to 15 is a fresh
// mount (the screen remounts when the route changes), fed the parameters of its history entry.

// flushEffects also runs the keyboard effect, which needs a window.
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

const ITEMS = [{ productId: 1, name: "Rice", quantity: 2, unitPricePesewas: 500, total_amount: 1000 }];
const exact = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node) === label);

async function session(initialParams = {}) {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const app = { state: createRouteState("Sell", initialParams), saves: [], view: null };
  app.mount = () => {
    app.view = render({
      type: Sell,
      props: {
        params: app.state.params,
        onNavigate: (route, params = {}) => { app.state = pushRoute(app.state, route, params); },
        onUpdateParams: (patch) => { app.state = replaceRoute(app.state, app.state.current, { ...app.state.params, ...patch }); },
        recordSale: async (details) => { app.saves.push(details); return { id: `t${app.saves.length}`, ...details }; }
      }
    });
    flushEffects(app.view);
    return app.view;
  };
  app.type = (digits) => {
    for (const digit of digits) {
      exact(app.view.tree, digit).props.onClick();
      app.view.rerender();
      flushEffects(app.view);
    }
  };
  app.shown = () => textOf(app.view.tree);
  app.mount();
  return app;
}

const trips = {
  "Add items (20)": (app) => { findButton(app.view.tree, "Add items").props.onClick(); },
  "Owe (17), then 18": (app) => {
    findButton(app.view.tree, "Owe").props.onClick();
    app.state = pushRoute(app.state, "WhenWillTheyPay", { amountPesewas: 12500 });
  },
  // The phone tile shows "Split" (c1b1320); its accessible name stays "Split payment".
  "Split payment (16)": (app) => {
    const split = [...walk(app.view.tree)].find((node) => node.type === "button" && node.props["aria-label"] === "Split payment");
    assert.ok(split, "15 has the Split payment tile");
    split.props.onClick();
  },
  "MoMo and 61": (app) => { findButton(app.view.tree, "MoMo").props.onClick(); },
  "MoMo, 61, then 62": (app) => {
    findButton(app.view.tree, "MoMo").props.onClick();
    app.state = pushRoute(app.state, "MoMoDirect", { amountPesewas: 12500 });
  },
  // The Menu drawer is not navigation (wiring 23): its Settings row pushes Settings on 15.
  "Menu > Settings": (app) => {
    app.state = pushRoute(app.state, "SettingsProfitTools", {});
  }
};

for (const [name, go] of Object.entries(trips)) {
  test(`15 draft: an amount typed before ${name} is still there after Back`, async () => {
    const app = await session();
    app.type("125");
    assert.match(app.shown(), /GH₵125\.00/);
    go(app);
    assert.notEqual(app.state.current, "Sell");
    while (app.state.current !== "Sell") app.state = backRoute(app.state);
    app.mount();
    assert.match(app.shown(), /GH₵125\.00/, "the amount is back, not 0.00");
  });
}

// Opening and closing the Menu drawer over 15 with a draft: menuNavigation.test.js (the real PosApp).

test("15 draft: a half-typed amount (12.5) and the Cash choice come back exactly", async () => {
  const app = await session();
  app.type("12.5".replace(".", "") + "");
  findButton(app.view.tree, "Cash").props.onClick();
  app.view.rerender();
  flushEffects(app.view);
  const before = app.shown();
  trips["Split payment (16)"](app);
  app.state = backRoute(app.state);
  app.mount();
  assert.equal(app.shown(), before);
  assert.equal(findButton(app.view.tree, "Cash").props["aria-pressed"], true);
});

test("15 draft: added items (and the locked total) come back after Owe and Back", async () => {
  const app = await session({ amountPesewas: 1000, saleItems: ITEMS });
  assert.match(app.shown(), /GH₵10\.00/);
  trips["Owe (17), then 18"](app);
  while (app.state.current !== "Sell") app.state = backRoute(app.state);
  assert.deepEqual(app.state.params.saleItems.map((item) => item.name), ["Rice"]);
  app.mount();
  assert.match(app.shown(), /GH₵10\.00/);
  assert.equal(findButton(app.view.tree, "1").props.disabled, true, "pad stays locked while items are added");
});

test("15 draft: typing again after coming back carries on from the restored amount", async () => {
  const app = await session();
  app.type("12");
  trips["Split payment (16)"](app);
  app.state = backRoute(app.state);
  app.mount();
  app.type("5");
  assert.match(app.shown(), /GH₵125\.00/);
});

test("15 draft: a draft is not cleared by Back; it is cleared by header Home, a different tab, or a saved sale", async () => {
  const app = await session();
  app.type("125");
  // Header Home and the Owed / Home tabs use switchTab: a fresh route state.
  for (const tab of ["Home", "PeopleWhoOweYou"]) {
    const fresh = createRouteState(tab);
    assert.deepEqual(fresh.history, []);
    assert.deepEqual(fresh.params, {});
  }
  // Done saves and moves to SaleRecorded; "Done" / "New sale" there start a fresh state.
  const done = findButton(app.view.tree, "Done");
  await done.props.onClick();
  app.view.rerender();
  const yes = [...walk(app.view.tree)].filter((node) => node.type === "button" && textOf(node) === "Yes, save").at(-1);
  if (yes) await yes.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.saves.length, 1);
  assert.equal(app.state.current, "SaleRecorded");
  assert.deepEqual(createRouteState("Sell").params, {}, "New sale starts empty");
});

test("15 draft: the Sell tab pressed on 15 itself keeps the draft (it is not a different tab)", () => {
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  const switchTab = source.slice(source.indexOf("function switchTab"), source.indexOf("function navigateBack"));
  assert.match(switchTab, /route === POS_ROUTES\.Sell|current === POS_ROUTES\.Sell/);
});

test("15 is given onUpdateParams by PosApp", () => {
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("route === POS_ROUTES.Sell ?"), source.indexOf("route === POS_ROUTES.SellWithItems ?"));
  assert.match(block, /onUpdateParams=\{updateCurrentParams\}/);
});

// ---- MoMo: pending values never come back -------------------------------------------------------

test("15 draft: after a MoMo trip returns to 15 (Cancel, Pay another way), pending MoMo values are removed", () => {
  let state = createRouteState("Sell", { amountPesewas: 12500, amountText: "125", paymentMethod: "cash", pendingMomoAmountPesewas: 99900, momoRowAmountPesewas: 99900, momoMethod: "mtn", verification: "x", reference: "r", pickOnly: true, returnRoute: "SplitPayment" });
  state = pushRoute(state, "MoMoChoice", { amountPesewas: 12500 });
  state = pushRoute(state, "MoMoDirect", { amountPesewas: 12500 });
  const back = returnToMomoOrigin(state);
  assert.equal(back.current, "Sell");
  for (const key of ["pendingMomoAmountPesewas", "momoRowAmountPesewas", "momoMethod", "verification", "reference", "pickOnly", "returnRoute"]) {
    assert.ok(!(key in back.params), `${key} removed`);
  }
  assert.equal(back.params.amountPesewas, 12500, "the amount itself stays");
});

// ---- large amount and save attempts on a restored draft ------------------------------------------

test("15 draft: a restored amount above the limit still asks before saving, and saves once", async () => {
  const app = await session();
  app.type("5000");
  trips["Split payment (16)"](app);
  app.state = backRoute(app.state);
  app.mount();
  await findButton(app.view.tree, "Done").props.onClick();
  app.view.rerender();
  assert.equal(app.saves.length, 0, "asked first");
  const yes = [...walk(app.view.tree)].filter((node) => node.type === "button" && textOf(node) === "Yes, save").at(-1);
  assert.ok(yes, "large-amount dialog shown");
  yes.props.onClick();
  yes.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.saves.length, 1, "no double save");
});

test("15 draft: the attempt key is not kept in the draft; a restored screen starts a new key and the params hold no key", async () => {
  const app = await session();
  app.type("10");
  const first = [];
  await findButton(app.view.tree, "Done").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  first.push(app.saves[0].attemptId);
  assert.ok(first[0]);
  const draft = app.state.history.find((entry) => entry.current === "Sell").params;
  assert.ok(!JSON.stringify(draft).includes(first[0]), "the key is not written to the draft in the route parameters");
  for (const key of Object.keys(draft)) assert.ok(!/attempt/i.test(key), key);
  assert.equal(draft.amountText, "10", "the draft itself is kept");
});