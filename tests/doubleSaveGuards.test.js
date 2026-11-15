import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const planSource = readFileSync(new URL("../src/pos/PlanScreens.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
function section(source, start, end) {
  const from = source.indexOf(`export function ${start}`);
  const to = source.indexOf(`export function ${end}`);
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return source.slice(from, to);
}

test("D1: screen 62 Money received ignores a second tap while saving and shows save errors", () => {
  const direct = section(momoSource, "MoMoDirect", "PaymentSettings");
  assert.match(direct, /const savingRef = useRef\(false\)/);
  // Batch 5b adds "no receiving number" to the same guard.
  assert.match(direct, /if \(savingRef\.current( \|\| !settings\.number)?\) return;\s*savingRef\.current = true;/);
  assert.match(direct, /disabled=\{saving( \|\| !settings\.number)?\}[^\n]*Money received/);
  assert.match(direct, /role="alert"/);
});

test("D1: PosApp passes the direct MoMo save promise back to screen 62 instead of swallowing it", () => {
  const start = appSource.indexOf("<MoMoDirect");
  const handler = appSource.slice(start, appSource.indexOf("/>", appSource.indexOf("onPick=", start)));
  assert.match(handler, /return save\.catch\(\(error\) => \{\s*console\.error\("Could not save direct MoMo payment\.", error\);\s*throw error;\s*\}\);/);
  assert.doesNotMatch(handler, /void save\.catch/);
});

test("E7: plan payment buttons on 66, 67 and 68 ignore a second tap and show save errors", () => {
  for (const [name, next, label] of [["PlanPayCash", "PlanPayMoMo", "I gave the cash"], ["PlanPayMoMo", "PlanPayPhone", "I sent it"], ["PlanPayPhone", "PlanPaymentResult", "Send request"]]) {
    const screen = section(planSource, name, next);
    assert.match(screen, /useSavePlanPayment\(/, `${name} must use the shared guard`);
    assert.match(screen, new RegExp(`disabled=\\{[^}]*saving[^}]*\\}[^\\n]*>${label}<`), `${name} button must be disabled while saving`);
  }
  assert.match(planSource, /function useSavePlanPayment[\s\S]*?if \(savingRef\.current\) return;[\s\S]*?role="alert"/);
});

test("B7 (partial): the plan cash code is 6 random digits, not taken from the clock", async () => {
  const { createPlanCashCode } = await import("../src/pos/planPayments.js");
  assert.equal(typeof createPlanCashCode, "function", "planPayments.js must export createPlanCashCode");
  const codes = new Set();
  for (let index = 0; index < 200; index += 1) {
    const code = createPlanCashCode();
    assert.match(code, /^\d{6}$/);
    codes.add(code);
  }
  assert.ok(codes.size > 190, "codes should almost never repeat");
  assert.doesNotMatch(section(planSource, "PlanPayCash", "PlanPayMoMo"), /Date\.now\(\)/);
});
