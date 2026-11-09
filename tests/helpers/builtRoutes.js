import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POS_ROUTES } from "../../src/pos/routes.js";

// The routes PosApp really renders: the branches of its render chain. A route without a
// branch falls through to PlannedScreen. (This replaces a hand-written list in
// pos.routes.test.js that claimed 63 and 52 were implemented when they were not.)
export function builtRoutes() {
  const app = readFileSync(new URL("../../src/pos/PosApp.jsx", import.meta.url), "utf8");
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