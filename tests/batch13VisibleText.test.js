import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { formatGhs } from "../src/lib/formatGhs.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("68: no developer text; one You pay row through the formatter, no Fee row", async () => {
  assert.match(wiring.screens["68"].rules[0], /No developer placeholder text/);
  const { PlanPayPhone } = await loadJsx("src/pos/PlanScreens.jsx", { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "125" });
  const view = render({ type: PlanPayPhone, props: { onBack() {}, onNavigate() {} } });
  const text = textOf(view.tree);
  assert.doesNotMatch(text, /configuration-driven/);
  // Wiring 68 "Fee and You pay" (20 Nov 2026): one row, You pay = the plan price; no Fee row, even with a fee set.
  const { PLAN_CONFIG } = await import("../src/pos/planPayments.js");
  const rows = [...walk(view.tree)].filter((node) => node.props?.["data-event-detail"] !== undefined && typeof node.type === "string");
  assert.deepEqual(rows.map((node) => textOf(node)), [`You pay${formatGhs(PLAN_CONFIG.amountPesewas)}`]);
  assert.doesNotMatch(text, /Fee/);
  assert.doesNotMatch(text, / · /);
});

test("60: no 'Account name will appear after verification' text while nothing verifies names", () => {
  assert.match(wiring.screens["60"].rules[0], /Account name will appear after verification/);
  assert.doesNotMatch(read("src/pos/MoMoScreens.jsx"), /Account name will appear after verification/);
});

test("47: no profit text while the profit switches are deferred", async () => {
  // The wiring for 47 now has four layout rules first; the deferred item-cost switch has its own rule.
  assert.ok(wiring.screens["47"].rules.some((rule) => /No "Track cost price of items" switch/.test(rule)));
  assert.doesNotMatch(read("src/pos/i18n.js"), /Profit estimates|settings\.profitUnavailable|settings\.profitTitle/);
  assert.doesNotMatch(read("src/pos/SettingsScreens.jsx"), /settings\.profit/);
});

// Owner decision (Batch 14): "Money in" includes MoMo (cash + MoMo received), so 22 no longer says "Cash".
test("22: the money card uses the owner's headings (Money left today, Money in, Spent)", async () => {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ hideAmounts: false, totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 0, urgentDebt: null }));
  try {
    const view = render({ type: Home, props: { onNavigate() {} } });
    const card = [...(function* walkAll(node) {
      if (Array.isArray(node)) { for (const child of node) yield* walkAll(child); return; }
      if (!node || typeof node !== "object") return;
      yield node;
      yield* walkAll("rendered" in node ? node.rendered : node.props?.children);
    })(view.tree)].find((node) => node.type === "section" && textOf(node).includes("Money left today"));
    assert.ok(card, "Money left today");
    const text = textOf(card);
    assert.match(text, /Money in/);
    assert.match(text, /Spent/);
    assert.doesNotMatch(text, /Cash left today|Cash in|Money spent/);
    assert.equal(card.props["aria-label"], "Money left today");
  } finally {
    setLiveQuery(null);
  }
});