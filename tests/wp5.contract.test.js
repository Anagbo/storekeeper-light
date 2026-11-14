import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { POS_ROUTES } from "../src/pos/routes.js";

const posDirectory = fileURLToPath(new URL("../src/pos/", import.meta.url));
function readSourceTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}\\${entry.name}`;
    if (entry.isDirectory()) return readSourceTree(path);
    return /\.(js|jsx)$/.test(entry.name) ? [{ name: entry.name, path, contents: readFileSync(path, "utf8") }] : [];
  });
}
const posSources = readSourceTree(posDirectory);
const source = posSources.map((entry) => entry.contents).join("\n");
const routeNames = new Set(Object.values(POS_ROUTES));
const specialDestinations = new Set(Object.keys(wiring.special_destinations));
const componentAliases = new Map([
  ["SavedAsCredit", "CreditSaved"],
  ["ItemPrice", "HowMuchIsItem"],
  ["ItemQuantity", "HowManyItem"],
  ["Settings", "SettingsProfitTools"],
  ["HowMuchDoTheyOwe", "ManualDebtAmount"],
  ["CorrectBalance", "DebtorDetail"]
]);

// Wiring 23 (14 Nov 2026): the Menu is a drawer over the page, not a route.
const overlays = new Set(["MenuDrawer"]);

test("every wiring screen has an implemented component and a route", () => {
  for (const screen of Object.values(wiring.screens)) {
    const implementation = componentAliases.get(screen.component) ?? screen.component;
    assert.match(source, new RegExp(`\\b${implementation}\\b`), `missing component ${screen.component}`);
    if (overlays.has(implementation)) {
      assert.ok(!routeNames.has(implementation), `${implementation} is an overlay, not a route`);
      assert.match(source, new RegExp(`export default function ${implementation}\\b`), `${implementation} is a component`);
      continue;
    }
    assert.ok(
      routeNames.has(implementation),
      `component ${screen.component} has no route mapping`
    );
  }
});

test("every wiring navigation target resolves to a declared screen or special destination", () => {
  const screenIds = new Set(Object.keys(wiring.screens));
  for (const [screenId, screen] of Object.entries(wiring.screens)) {
    for (const control of screen.controls) {
      if (control.type !== "navigate" || control.prototype_only) continue;
      assert.ok(
        screenIds.has(control.to) || specialDestinations.has(control.to),
        `screen ${screenId} control ${control.label} has unknown destination ${control.to}`
      );
    }
  }
});

test("wiring exposes all required screen states and excludes prototype demo controls", () => {
  assert.equal(wiring.screens["16"].component, "SplitPayment");
  assert.equal(wiring.screens["27"].component, "SplitPayment");
  assert.equal(wiring.screens["69"].component, "PlanPaymentResult");
  assert.equal(wiring.screens["70"].component, "PlanPaymentResult");
  const demoControls = Object.values(wiring.screens).flatMap((screen) => screen.controls.filter((control) => control.prototype_only));
  assert.ok(demoControls.length > 0);
  assert.doesNotMatch(source, />Demo: approved</);
  assert.doesNotMatch(source, />Demo: declined</);
});

test("POS user-facing source uses the GH₵ formatter boundary", () => {
  // formatGhs.js is the one formatter (money.js re-exports it): the only place GHS is the currency code.
  const allowed = new Set(["money.js", "formatGhs.js", "wiring.json"]);
  const srcDirectory = fileURLToPath(new URL("../src/", import.meta.url));
  for (const entry of readSourceTree(srcDirectory)) {
    if (allowed.has(entry.name)) continue;
    const contents = entry.contents;
    const violations = contents.split(/\r?\n/).filter((line) => /GHS/.test(line) && !/VITE_SUBSCRIPTION_/.test(line));
    assert.deepEqual(violations, [], `${entry.path} contains non-API GHS text`);
  }
});

test("critical WP5 screens use responsive widths and touch-sized primary controls", () => {
  for (const file of ["MoMoScreens.jsx", "PlanScreens.jsx", "CreditScreens.jsx", "SplitPayment.jsx", "DebtCollection.jsx"]) {
    const contents = readFileSync(`${posDirectory}\\${file}`, "utf8");
    assert.doesNotMatch(contents, /min-w-\[(?:4|5)\d{2}px\]/, `${file} has a viewport-breaking minimum width`);
    assert.match(contents, /min-h-(?:11|12|14|16|\[68px\])/, `${file} lacks a touch-sized control`);
  }
});
