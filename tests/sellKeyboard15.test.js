import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSellKeyAction } from "../src/pos/sellKeyboard.js";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 15 "Keyboard" (23 Nov 2026, all widths): a focused keypad key counts as no focus (digits,
// "." and "," go to the pad, Enter is Done when Done is enabled), Delete works like Backspace, any
// other focused button keeps its normal Enter and Space, and a text field is never taken by the pad.

// A fake element: matches/closest over a tag and whether it sits in the keypad.
const element = ({ tag = "button", inPad = false, editable = false } = {}) => ({
  isContentEditable: editable,
  matches: (selector) => selector.split(",").some((part) => part.trim().split(/[[.]/)[0] === tag),
  closest: (selector) => (selector === "[data-amount-keypad]" && inPad ? {} : null)
});
const padKey = () => element({ inPad: true });
const key = (name, target = null, extra = {}) => ({ key: name, target, ...extra });

test("15 keys: with no focus, digits, '.', ',', Backspace, Delete and Enter go to the pad", () => {
  assert.deepEqual(getSellKeyAction(key("7")), { key: "7" });
  assert.deepEqual(getSellKeyAction(key(".")), { key: "." });
  assert.deepEqual(getSellKeyAction(key(",")), { key: "." });
  assert.deepEqual(getSellKeyAction(key("Backspace")), { key: "Delete" });
  assert.deepEqual(getSellKeyAction(key("Delete")), { key: "Delete" });
  assert.deepEqual(getSellKeyAction(key("Enter")), { done: true });
  assert.equal(getSellKeyAction(key("a")), null, "no single-letter shortcuts");
  assert.equal(getSellKeyAction(key("5", null, { ctrlKey: true })), null, "a shortcut with Ctrl is left alone");
});

test("15 keys: a focused keypad key counts as no focus", () => {
  assert.deepEqual(getSellKeyAction(key("4", padKey())), { key: "4" });
  assert.deepEqual(getSellKeyAction(key("Delete", padKey())), { key: "Delete" });
  assert.deepEqual(getSellKeyAction(key("Enter", padKey())), { done: true }, "Enter is Done, not the key pressed again");
});

test("15 keys: another focused button and a text field keep their keys", () => {
  for (const name of ["Enter", " ", "5", "Backspace"]) {
    assert.equal(getSellKeyAction(key(name, element({ tag: "button" }))), null, `${JSON.stringify(name)} on a payment tile is the tile’s own`);
  }
  for (const tag of ["input", "textarea", "select"]) {
    assert.equal(getSellKeyAction(key("5", element({ tag }))), null, `a digit in ${tag} is never taken`);
    assert.equal(getSellKeyAction(key("Delete", element({ tag }))), null, `Delete in ${tag} is never taken`);
  }
  assert.equal(getSellKeyAction(key("5", element({ tag: "div", editable: true }))), null, "content editable");
});

// The real Sell screen with a window that keeps the keydown listener.
async function session() {
  const listeners = new Set();
  globalThis.window = {
    addEventListener: (type, fn) => { if (type === "keydown") listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === "keydown") listeners.delete(fn); }
  };
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const app = { saves: [], routes: [] };
  app.view = render({
    type: Sell,
    props: {
      params: {},
      onNavigate: (route, params) => app.routes.push([route, params]),
      onUpdateParams: () => {},
      recordSale: async (details) => { app.saves.push(details); return { id: "t1", ...details }; }
    }
  });
  flushEffects(app.view);
  app.press = (name, target = null) => {
    let prevented = false;
    // The test renderer does not run effect cleanups, so the newest listener is the live one.
    const live = [...listeners].at(-1);
    live({ key: name, target, preventDefault: () => { prevented = true; } });
    app.view.rerender();
    flushEffects(app.view);
    return prevented;
  };
  app.tap = (label) => {
    [...walk(app.view.tree)].find((node) => node.type === "button" && textOf(node) === label).props.onClick();
    app.view.rerender();
    flushEffects(app.view);
  };
  app.shown = () => textOf(app.view.tree);
  return app;
}

test("15 keys on the screen: after a click on a pad key, typing goes on and Enter saves once (Done enabled)", async () => {
  const app = await session();
  app.tap("1");
  assert.ok(app.press("2", padKey()));
  assert.ok(app.press(",", padKey()));
  assert.ok(app.press("5", padKey()));
  assert.match(app.shown(), /GH₵12\.50/);
  assert.ok(app.press("Delete", padKey()));
  assert.match(app.shown(), /GH₵12\.00/, "Delete works like Backspace");
  assert.ok(app.press("Enter", padKey()), "Enter is not passed to the focused key");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.saves.length, 1, "Enter is Done");
  assert.equal(app.saves[0].amountPesewas, 1200);
  assert.match(app.shown(), /GH₵12\.00/, "the key was not pressed again (not 12.00 then 1)");
});

test("15 keys on the screen: Enter with Done disabled saves nothing; a focused payment tile keeps Enter", async () => {
  const app = await session();
  assert.ok(app.press("Enter", padKey()), "Enter on a pad key is still not a key press");
  assert.equal(app.saves.length, 0, "nothing to save");
  app.press("8");
  assert.equal(app.press("Enter", element({ tag: "button" })), false, "a focused tile keeps its own Enter");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.saves.length, 0, "Enter on another button is not Done");
  assert.ok(findButton(app.view.tree, "Done"));
});
