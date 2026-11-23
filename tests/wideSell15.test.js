import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getLayout } from "../src/pos/layout.js";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wide 15 (D2, D15; wide_layout.screens["15 Sell"] and same_as_phone): only the layout changes. Every
// phone control is there with the same label and accessible name, the taps go to the same places,
// typed keys give the same pesewas as the keypad, the large-amount check still asks, and the Last
// sale box is the read-only addition.

const WIDTHS = [768, 1024, 1280, 1440];
const name = (node) => node.props["aria-label"] ?? textOf(node).trim();
const buttons = (tree) => [...walk(tree)].filter((node) => node.type === "button");

async function session(width, params = {}, extra = {}) {
  const listeners = [];
  globalThis.window = { addEventListener: (type, fn) => { if (type === "keydown") listeners.push(fn); }, removeEventListener() {} };
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const app = { routes: [], saves: [], params: { ...params } };
  app.mount = () => {
    app.view = render({
      type: Sell,
      props: {
        params: app.params,
        layout: getLayout(width),
        onNavigate: (route, next) => app.routes.push([route, next]),
        onUpdateParams: (patch) => { app.params = { ...app.params, ...patch }; },
        recordSale: async (details) => { app.saves.push(details); return { id: "t1", ...details }; },
        loadLastSale: async () => null,
        ...extra
      }
    });
    flushEffects(app.view);
  };
  app.refresh = () => { app.view.rerender(); flushEffects(app.view); };
  app.tap = (label) => { buttons(app.view.tree).find((node) => name(node) === label).props.onClick(); app.refresh(); };
  app.press = (key) => { listeners.at(-1)({ key, target: null, preventDefault() {} }); app.refresh(); };
  app.mount();
  return app;
}

const controlNames = (tree) => buttons(tree).map(name).filter((label) => label !== "Split").sort();

test("wide 15: the same controls with the same accessible names as the phone, at 768, 1024, 1280 and 1440", async () => {
  const phone = await session(393);
  const expected = controlNames(phone.view.tree);
  for (const label of ["Cash", "MoMo", "Owe", "Split payment", "Done", "+ Add items", "Delete last digit"]) assert.ok(expected.includes(label), `phone has ${label}`);
  for (const width of WIDTHS) {
    const wide = await session(width);
    assert.deepEqual(controlNames(wide.view.tree), expected, `${width}: same controls and names`);
    const text = textOf(wide.view.tree);
    assert.match(text, /Customer pays/);
    assert.match(text, /How is it paid\?/);
    assert.match(text, /Type an amount first\. Then press Done or Enter\./, `${width}: why Done is disabled`);
    const done = buttons(wide.view.tree).find((node) => name(node).endsWith("Done"));
    assert.equal(done.props.disabled, true);
    assert.equal(done.props["aria-describedby"], "sell-done-why");
    const cash = buttons(wide.view.tree).find((node) => name(node) === "Cash");
    assert.equal(cash.props["aria-pressed"], true, "Cash selected by default, with its tick");
  }
});

test("wide 15: with an amount Done is enabled and the reason line is empty; taps go where the phone goes", async () => {
  const app = await session(1280);
  app.tap("1"); app.tap("2");
  const done = buttons(app.view.tree).find((node) => name(node).endsWith("Done"));
  assert.equal(done.props.disabled, false);
  assert.doesNotMatch(textOf(app.view.tree), /Type an amount first/);
  app.tap("Owe");
  app.tap("Split payment");
  app.tap("+ Add items");
  assert.deepEqual(app.routes.map(([route]) => route), ["WhoOwesYou", "SplitPayment", "SellWithItems"]);
  assert.equal(app.routes[0][1].amountPesewas, 1200);
});

test("wide 15: typed keys give the same pesewas as the keypad, and Enter saves the same record", async () => {
  const typed = await session(1024);
  for (const key of ["4", "5", ",", "5"]) typed.press(key);
  const padded = await session(393);
  for (const key of ["4", "5", ".", "5"]) padded.tap(key);
  assert.match(textOf(typed.view.tree), /GH₵45\.50/);
  assert.equal(typed.params.amountPesewas, padded.params.amountPesewas);
  assert.equal(typed.params.amountPesewas, 4550);
  typed.press("Enter");
  padded.tap("Done");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const content = (saves) => saves.map(({ attemptId, ...rest }) => rest);
  assert.deepEqual(content(typed.saves), content(padded.saves), "the same saved sale on wide and phone (each save has its own attempt key)");
  assert.equal(typed.saves.length, 1);
});

test("wide 15: large_amount_confirm still asks before the save", async () => {
  const app = await session(1280);
  for (const key of "2000") app.press(key);
  app.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 20));
  app.refresh();
  assert.equal(app.saves.length, 0, "not saved yet");
  assert.match(textOf(app.view.tree), /Large amount/);
});

test("wide 15: the draft comes back from the route parameters (a sidebar trip and Back)", async () => {
  const app = await session(1280);
  app.tap("1"); app.tap("2"); app.tap("5");
  const kept = app.params;
  const back = await session(1280, kept);
  assert.match(textOf(back.view.tree), /GH₵125\.00/);
});

test("wide 15: the Last sale box shows a sale read by the loader; the phone never shows it", async () => {
  const sale = async () => ({ amountPesewas: 800, method: "cash", timestamp: Date.now() });
  const wide = await session(1280, {}, { loadLastSale: sale });
  await new Promise((resolve) => setTimeout(resolve, 10));
  wide.refresh();
  assert.match(textOf(wide.view.tree), /Last saleGH₵8\.00 · Cash/);
  const phone = await session(393, {}, { loadLastSale: sale });
  await new Promise((resolve) => setTimeout(resolve, 10));
  phone.refresh();
  assert.doesNotMatch(textOf(phone.view.tree), /Last sale/, "phone unchanged");
});
