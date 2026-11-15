import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import * as planPayments from "../src/pos/planPayments.js";
import * as paymentAmount from "../src/pos/paymentAmount.js";

after(async () => {
  db.close();
  await db.delete();
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const momoSource = read("src/pos/MoMoScreens.jsx");
const part = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} .. ${end} not found`);
  return source.slice(from, to);
};

// ---- E5: the 57 countdown follows the clock, not the number of ticks -------------------------

test("E5: seconds left come from an end time, so a throttled background tab catches up", async () => {
  const countdown = await import("../src/lib/countdown.js").catch(() => ({}));
  assert.equal(typeof countdown.secondsUntil, "function", "src/lib/countdown.js must export secondsUntil");
  const start = 1_000_000;
  const end = start + 120_000;
  assert.equal(countdown.secondsUntil(end, start), 120);
  assert.equal(countdown.secondsUntil(end, start + 500), 120, "rounds up");
  assert.equal(countdown.secondsUntil(end, start + 1000), 119);
  // The tab slept for 90 seconds: one late tick shows the right time, not 119.
  assert.equal(countdown.secondsUntil(end, start + 90_000), 30);
  assert.equal(countdown.secondsUntil(end, end), 0);
  assert.equal(countdown.secondsUntil(end, end + 5000), 0, "never negative");
  assert.equal(countdown.secondsUntil(NaN, start), 0);
});

test("E5: screen 57 counts down from an end time and Resend starts a new one", () => {
  const waiting = part(momoSource, "export function MoMoWaiting", "export function MoMoCode");
  assert.match(waiting, /secondsUntil\(expiresAt, now\)/);
  assert.match(waiting, /setExpiresAt\(Date\.now\(\) \+ MOMO_WAIT_SECONDS \* 1000\)/);
  assert.doesNotMatch(waiting, /value - 1/, "no tick counting");
  assert.doesNotMatch(waiting, /setSecondsRemaining/);
});

// ---- E6: the Undo timer stops at zero --------------------------------------------------------

test("E6: the Undo timer on 28 clears its own interval when the window has passed", () => {
  const source = read("src/pos/DebtCollection.jsx");
  const end = source.indexOf("}, [result.undoExpiresAt]);");
  assert.ok(end > 0, "undo effect not found");
  const effect = source.slice(source.lastIndexOf("useEffect(() => {", end), end);
  const tick = effect.slice(effect.indexOf("window.setInterval(() => {"), effect.indexOf("}, 250)"));
  assert.ok(tick.length > 0, "interval callback not found");
  assert.match(tick, /window\.clearInterval\(timer\)/, "the interval stops itself at zero");
  assert.match(effect, /secondsUntil\(result\.undoExpiresAt, Date\.now\(\)\)/);
  assert.match(effect, /if \(secondsUntil\(result\.undoExpiresAt, Date\.now\(\)\) <= 0\) return undefined;/, "no interval when already expired");
});

// ---- E9: the computed tender fields cannot be overridden by route params ---------------------

test("E9: the sale tender (total, cash, MoMo, parts) is set after the route params, so params cannot override it", () => {
  const source = read("src/pos/SaleSplitPayment.jsx");
  // D11 (Batch 14): the sale is built as `content`, then saved with its attempt key last.
  const call = part(source, "const content = {", "};");
  assert.match(source, /onSaveSale\(\{ \.\.\.content, attemptId \}\)/);
  const at = (text) => call.indexOf(text);
  // The route params come in as draftParams (params without the one-shot commitNow flag).
  assert.ok(source.includes("const { commitNow: _commitNow, ...draftParams } = params;"));
  assert.ok(at("...draftParams") >= 0);
  for (const field of ["amountPesewas: totalPesewas", "cashReceivedPesewas: amountOf(\"cash\")", "momoReceivedPesewas: amountOf(\"momo\")", "parts"]) {
    assert.ok(at(field) > at("...draftParams"), `${field} must come after ...draftParams`);
  }
});

// ---- F5: a confirmed plan payment is one row, not two ----------------------------------------

test("F5: a waiting payment and its later confirmation show as one row with the confirmed status", () => {
  assert.equal(typeof planPayments.groupPlanPayments, "function");
  const rows = [
    { id: "p1", method: "cash", amountPesewas: 1500, status: "waiting", confirmedBy: "", createdAt: 100 },
    { id: "c1", originalPaymentId: "p1", method: "cash", amountPesewas: 1500, status: "confirmed", confirmedBy: "agent-7", createdAt: 500 },
    { id: "p2", method: "momo_direct", amountPesewas: 1500, status: "waiting", confirmedBy: "", createdAt: 300 }
  ];
  const grouped = planPayments.groupPlanPayments(rows);
  assert.deepEqual(grouped.map((row) => [row.id, row.status]), [["p1", "confirmed"], ["p2", "waiting"]]);
  assert.equal(grouped[0].createdAt, 100, "the date stays the day the merchant paid");
  assert.equal(grouped[0].confirmedBy, "agent-7");
});

test("F5: the latest confirmation wins, and a confirmation without its original still shows", () => {
  const rows = [
    { id: "p1", method: "cash", amountPesewas: 1500, status: "waiting", createdAt: 100 },
    { id: "c1", originalPaymentId: "p1", status: "confirmed", createdAt: 200 },
    { id: "c2", originalPaymentId: "p1", status: "rejected", createdAt: 300 },
    { id: "c9", originalPaymentId: "missing", method: "cash", amountPesewas: 1500, status: "confirmed", createdAt: 250 }
  ];
  const grouped = planPayments.groupPlanPayments(rows);
  assert.deepEqual(grouped.map((row) => [row.id, row.status]), [["p1", "rejected"], ["c9", "confirmed"]]);
  assert.deepEqual(planPayments.groupPlanPayments([]), []);
});

test("F5: My plan lists grouped rows; the stored rows stay append-only", () => {
  const screen = read("src/pos/PlanScreens.jsx");
  assert.match(screen, /listPlanPayments\(\)\.then\(\(rows\) => setPayments\(groupPlanPayments\(rows\)\)\)/);
});

// ---- L3: the code Paystack asks for is not kept in the route history -------------------------

test("L3: the code typed on 58 is not copied into the route parameters", () => {
  const code = part(momoSource, "export function MoMoCode", "export function MoMoNotCompleted");
  assert.doesNotMatch(code, /\{ \.\.\.params, code \}/);
  assert.doesNotMatch(code, /onNavigate\("MoMoWaiting", \{[^}]*\bcode\b/);
  assert.match(code, /onNavigate\("MoMoWaiting", params\)/);
});

// ---- A3: paying more than the sale today by MoMo on 19 must not crash 61 ---------------------

test("A3: the real trigger: a customer who owes GH₵50.00 buys GH₵20.00 on credit and pays GH₵60.00 today by MoMo", () => {
  const params19 = { amountPesewas: 2000, customer: { totalDebtPesewas: 5000 } };
  // Before: 19 sent only the sale amount as the total, so rendering 61 threw.
  assert.throws(
    () => paymentAmount.getMomoAmountPesewas({ ...params19, pendingMomoAmountPesewas: 6000 }),
    /cannot exceed the remaining payment/
  );
  assert.equal(typeof paymentAmount.getMomoPickParams, "function");
  const pick = paymentAmount.getMomoPickParams(params19, { todayPaymentPesewas: 6000, maxCreditPesewas: 7000 });
  assert.equal(paymentAmount.getMomoAmountPesewas(pick), 6000, "61, 62 show what the customer pays today");
  assert.equal(pick.pendingMomoAmountPesewas, 6000);
  assert.equal(pick.splitTotalPesewas, 7000);
  assert.equal(pick.returnRoute, "ALittleAtATime");
  assert.equal(pick.pickOnly, true);
  assert.equal(pick.paymentMethod, "momo");
});

test("A3: the split guard still holds, and an empty amount today keeps the old behaviour", () => {
  const params19 = { amountPesewas: 2000 };
  for (const todayPaymentPesewas of [null, NaN, 0, -5]) {
    const pick = paymentAmount.getMomoPickParams(params19, { todayPaymentPesewas, maxCreditPesewas: 7000 });
    assert.equal("splitTotalPesewas" in pick, false, String(todayPaymentPesewas));
    assert.equal(paymentAmount.getMomoAmountPesewas(pick), 2000);
  }
  // On 16 and 27 a MoMo amount above what is left is still refused.
  assert.throws(() => paymentAmount.getMomoAmountPesewas({ amountPesewas: 1000, splitParts: [{ paymentMethod: "cash", amountPesewas: 800 }], pendingMomoAmountPesewas: 500 }), RangeError);
});

test("A3: 19 builds the MoMo pick from the shared helper", () => {
  const credit = read("src/pos/CreditScreens.jsx");
  assert.match(credit, /onNavigate\("MoMoChoice", getMomoPickParams\(params, \{ todayPaymentPesewas, maxCreditPesewas \}\)\);/);
});