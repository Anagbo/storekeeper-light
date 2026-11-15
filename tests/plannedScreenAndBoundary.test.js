import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POS_ROUTES } from "../src/pos/routes.js";
import { hasPosText, posText } from "../src/pos/i18n.js";
import { findButton, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// A missing planned title, or any thrown error, must never show raw text such as
// "Missing English POS string: planned.titles.PaymentSettings" to the merchant.
const RAW = /Missing English|planned\.titles|POS string|undefined|\[object/;
const quietly = async (run) => {
  const warn = console.warn;
  const error = console.error;
  const calls = [];
  console.warn = (...args) => calls.push(["warn", ...args]);
  console.error = (...args) => calls.push(["error", ...args]);
  try { return { result: await run(), calls }; } finally { console.warn = warn; console.error = error; }
};

test("PlannedScreen shows a plain title for a route with no planned title, and never throws", async () => {
  const { default: PlannedScreen } = await loadJsx("src/pos/PlannedScreen.jsx");
  let backs = 0;
  const { result: view, calls } = await quietly(() => render({ type: PlannedScreen, props: { route: "NoSuchScreen", params: {}, onBack: () => { backs += 1; }, onOpenBackup() {} } }));
  const text = textOf(view.tree);
  assert.doesNotMatch(text, RAW);
  assert.match(text, /This screen/);
  findButton(view.tree, "Back").props.onClick();
  assert.equal(backs, 1, "Back still works");
  assert.ok(calls.some((call) => call.join(" ").includes("NoSuchScreen")), "the route name is logged for developers");
});

test("PlannedScreen renders without raw text for every declared route, with or without a title", async () => {
  const { default: PlannedScreen } = await loadJsx("src/pos/PlannedScreen.jsx");
  await quietly(async () => {
    for (const route of Object.values(POS_ROUTES)) {
      const view = render({ type: PlannedScreen, props: { route, params: { customerName: "Ama", amountPesewas: 500 }, onBack() {}, onOpenBackup() {} } });
      assert.doesNotMatch(textOf(view.tree), RAW, route);
    }
  });
});

test("posText still throws on a missing key (so tests keep catching them), and hasPosText tells the two apart", () => {
  assert.throws(() => posText("planned.titles.NoSuchScreen"), /Missing English POS string/);
  assert.equal(hasPosText("planned.titles.NoSuchScreen"), false);
  assert.equal(hasPosText("planned.back"), true);
  assert.equal(posText("planned.untitled"), "This screen");
});

test("the error boundary shows a plain message and Retry, never the error's own text", async () => {
  const { default: PosErrorBoundary } = await loadJsx("src/pos/PosErrorBoundary.jsx");
  const boundary = new PosErrorBoundary({ children: null });
  const secret = new Error("Missing English POS string: planned.titles.PaymentSettings at C:\\app\\secret.js:12");
  boundary.state = PosErrorBoundary.getDerivedStateFromError(secret);
  const tree = boundary.render();
  const text = textOf(tree);
  assert.doesNotMatch(text, RAW);
  assert.doesNotMatch(text, /secret\.js|PaymentSettings/);
  assert.match(text, /This screen could not load\./);
  assert.ok(findButton(tree, "Try again"), "Retry is still there");
  assert.ok([...walk(tree)].some((node) => node.props?.role === "alert"));
});

test("the error boundary logs the error detail for developers instead of showing it", async () => {
  const { default: PosErrorBoundary } = await loadJsx("src/pos/PosErrorBoundary.jsx");
  const boundary = new PosErrorBoundary({ children: null });
  const failure = new Error("boom-detail");
  const { calls } = await quietly(async () => boundary.componentDidCatch(failure, { componentStack: "" }));
  assert.ok(calls.some((call) => call.includes(failure)), "the error object is logged");
});

test("the error boundary source never prints error.message", () => {
  const source = readFileSync(new URL("../src/pos/PosErrorBoundary.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /error\.message/);
});

test("PosApp uses the PlannedScreen file and keeps no copy of it", () => {
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.match(app, /import PlannedScreen from "\.\/PlannedScreen\.jsx"/);
  assert.doesNotMatch(app, /function PlannedScreen\(/);
});