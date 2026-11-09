import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { formatGhs } from "../src/lib/formatGhs.js";
import { loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("68: no developer text; the fee is shown through the formatter from configuration", async () => {
  assert.match(wiring.screens["68"].rules[0], /No developer placeholder text/);
  const { PlanPayPhone } = await loadJsx("src/pos/PlanScreens.jsx");
  const { MOMO_CONFIG } = await import("../src/pos/momoConfig.js");
  const view = render({ type: PlanPayPhone, props: { onBack() {}, onNavigate() {} } });
  const text = textOf(view.tree);
  assert.doesNotMatch(text, /configuration-driven/);
  assert.match(text, new RegExp(`Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas).replace(".", "\\.")}`));
  assert.match(read("src/pos/PlanScreens.jsx"), /`Fee \$\{formatGhs\(MOMO_CONFIG\.phoneRequestFeePesewas\)\}`/);
});

test("60: no 'Account name will appear after verification' text while nothing verifies names", () => {
  assert.match(wiring.screens["60"].rules[0], /Account name will appear after verification/);
  assert.doesNotMatch(read("src/pos/MoMoScreens.jsx"), /Account name will appear after verification/);
});

test("47: no profit text while the profit switches are deferred", async () => {
  assert.match(wiring.screens["47"].rules[0], /No "Profit estimates" text/);
  assert.doesNotMatch(read("src/pos/i18n.js"), /Profit estimates|settings\.profitUnavailable|settings\.profitTitle/);
  assert.doesNotMatch(read("src/pos/SettingsScreens.jsx"), /settings\.profit/);
});

test("22: the money card uses the prototype's headings (Cash left today, Cash in, Spent)", async () => {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 0, urgentDebt: null }));
  try {
    const view = render({ type: Home, props: { onNavigate() {}, onLegacyEntry() {} } });
    const card = [...(function* walkAll(node) {
      if (Array.isArray(node)) { for (const child of node) yield* walkAll(child); return; }
      if (!node || typeof node !== "object") return;
      yield node;
      yield* walkAll("rendered" in node ? node.rendered : node.props?.children);
    })(view.tree)].find((node) => node.type === "section" && textOf(node).includes("Cash left today"));
    assert.ok(card, "Cash left today");
    const text = textOf(card);
    assert.match(text, /Cash in/);
    assert.match(text, /Spent/);
    assert.doesNotMatch(text, /Money in|Money spent/);
    assert.equal(card.props["aria-label"], "Cash left today");
  } finally {
    setLiveQuery(null);
  }
});