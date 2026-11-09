import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { POS_LINKS, POS_ROUTES } from "../src/pos/routes.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };

// Every route, and every link to one, must have a built screen. A route with no screen falls to
// PlannedScreen, which is not meant to be reachable. (63 PaymentSettings and 52
// YourStarterListGrouped were built but never rendered, and the old hand-written
// "implementedRoutes" list in pos.routes.test.js claimed they were.)
const posDirectory = new URL("../src/pos/", import.meta.url);
const read = (name) => readFileSync(new URL(name, posDirectory), "utf8");
const app = read("PosApp.jsx");

// Owner decision: no route may fall through to PlannedScreen. An intentional placeholder
// must be added here with the owner's approval; the list starts empty.
const PLANNED_ALLOWED = [];

// The routes PosApp really renders: the branches of its render chain.
function builtRoutes() {
  const start = app.indexOf("const content = route === POS_ROUTES.Home");
  const end = app.indexOf("<PlannedScreen route={route}", start);
  assert.ok(start >= 0 && end > start, "found the render chain in PosApp.jsx");
  const chain = app.slice(start, end);
  const built = new Set();
  for (const name of Object.keys(POS_ROUTES)) {
    if (chain.includes(`route === POS_ROUTES.${name} ?`)) built.add(name);
  }
  if (chain.includes("isCollectSheet ?")) built.add("CollectPayment");
  // A branch that sends several routes to one screen file: [POS_ROUTES.A, POS_ROUTES.B].includes(route) ? (
  for (const group of chain.match(/\[[^\]]*\]\.includes\(route\) \?/g) ?? []) {
    for (const name of Object.keys(POS_ROUTES)) if (group.includes(`POS_ROUTES.${name}`)) built.add(name);
  }
  return built;
}

// The component name in the wiring file may differ from the route name.
const routeOfComponent = (component) => ({
  SavedAsCredit: "CreditSaved",
  ItemPrice: "HowMuchIsItem",
  ItemQuantity: "HowManyItem",
  Settings: "SettingsProfitTools",
  HowMuchDoTheyOwe: "ManualDebtAmount",
  CorrectBalance: "DebtorDetail"
}[component] ?? component);

// Where the sources navigate: onNavigate("Name"), navigate(POS_ROUTES.Name), returnRoute: "Name", ...
function sourceTargets() {
  const targets = new Map();
  const add = (name, where) => targets.set(name, [...(targets.get(name) ?? []), where]);
  const calls = ["onNavigate(", "navigate(", "onReplace(", "onReturnTo(", "returnTo(", "switchTab(", "replaceCurrentRoute(", "onReturnToSplit("];
  for (const file of readdirSync(posDirectory)) {
    if (!file.endsWith(".js") && !file.endsWith(".jsx")) continue;
    read(file).split("\n").forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      for (const call of calls) {
        let from = 0;
        for (;;) {
          const at = line.indexOf(call, from);
          if (at < 0) break;
          from = at + call.length;
          const rest = line.slice(from);
          const quoted = rest.startsWith('"') ? rest.slice(1, rest.indexOf('"', 1)) : null;
          const viaRoutes = rest.startsWith("POS_ROUTES.") ? rest.slice(11).split(/[^A-Za-z0-9_]/)[0] : null;
          const name = quoted ?? viaRoutes;
          if (name && /^[A-Z]/.test(name)) add(name, where);
        }
      }
      // A route name written as a quoted word anywhere on a navigate line (also inside a ternary).
      if (calls.some((call) => line.includes(call))) {
        for (const match of line.matchAll(/"([A-Z][A-Za-z0-9]*)"/g)) if (POS_ROUTES[match[1]]) add(match[1], where);
      }
      for (const match of line.matchAll(/(?:returnRoute|originRoute): "([A-Z][A-Za-z0-9]*)"/g)) add(match[1], where);
    });
  }
  return targets;
}

test("the scan itself works: it finds the screens PosApp renders", () => {
  const built = builtRoutes();
  for (const name of ["Home", "Sell", "CollectPayment", "MyItems", "YourStarterList", "MoMoDirect", "MyPlan", "PeopleWhoOweYou"]) {
    assert.ok(built.has(name), `${name} is found`);
  }
  assert.ok(built.size >= 45, `found ${built.size} built routes`);
});

test("every declared route has a built screen, so none falls through to PlannedScreen", () => {
  const built = builtRoutes();
  const missing = Object.keys(POS_ROUTES).filter((name) => !built.has(name) && !PLANNED_ALLOWED.includes(name));
  assert.deepEqual(missing, [], `routes with no screen (they would show PlannedScreen): ${missing.join(", ")}`);
});

test("every POS_LINKS start and end has a built screen", () => {
  const built = builtRoutes();
  const missing = new Set();
  for (const link of POS_LINKS) {
    for (const name of [link.from, link.to]) {
      if (!POS_ROUTES[name]) missing.add(`${name} (not a declared route, in ${link.from}.${link.action})`);
      else if (!built.has(name) && !PLANNED_ALLOWED.includes(name)) missing.add(`${name} (${link.from}.${link.action})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("every route a screen navigates to, or keeps in its params, has a built screen", () => {
  const built = builtRoutes();
  const problems = [];
  for (const [name, where] of sourceTargets()) {
    if (!POS_ROUTES[name]) problems.push(`${name} is not a declared route (${where.slice(0, 2).join(", ")})`);
    else if (!built.has(name) && !PLANNED_ALLOWED.includes(name)) problems.push(`${name} has no screen (${where.slice(0, 3).join(", ")})`);
  }
  assert.deepEqual(problems, []);
});

test("every screen in the wiring file, and every wiring navigate target, has a built screen", () => {
  const built = builtRoutes();
  const problems = [];
  for (const [id, screen] of Object.entries(wiring.screens)) {
    const route = routeOfComponent(screen.component);
    if (!built.has(route) && !PLANNED_ALLOWED.includes(route)) problems.push(`screen ${id} ${screen.name} (${route}) has no screen`);
    for (const control of screen.controls) {
      const target = wiring.screens[control.to];
      if (control.type !== "navigate" || control.prototype_only || !target) continue;
      const targetRoute = routeOfComponent(target.component);
      if (!built.has(targetRoute) && !PLANNED_ALLOWED.includes(targetRoute)) {
        problems.push(`screen ${id} "${control.label}" goes to ${control.to} (${targetRoute}), which has no screen`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the planned-screen allowed list starts empty (owner decision)", () => {
  assert.deepEqual(PLANNED_ALLOWED, []);
});