import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { formatGhs } from "../src/lib/formatGhs.js";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 68 "Fee and You pay" (decided 20 Nov 2026, until the owner decides who bears the fee): one row, "You
// pay", equal to the plan price that Send request saves as the plan payment; no Fee row. Stored data unchanged:
// the saved payment is the plan price, as before.

after(async () => { db.close(); await db.delete(); });
const ENV = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "125" };

test("68: the You pay value equals the amount Send request saves as the plan payment", async () => {
  const { PlanPayPhone } = await loadJsx("src/pos/PlanScreens.jsx", ENV);
  const { PLAN_CONFIG } = await import("../src/pos/planPayments.js");
  const navigated = [];
  const view = render({ type: PlanPayPhone, props: { onBack() {}, onNavigate: (route, params) => navigated.push({ route, params }) } });
  flushEffects(view);
  const youPay = [...walk(view.tree)].find((node) => typeof node.type === "string" && node.props?.["data-event-detail"] === "you-pay");
  const shown = textOf(youPay).replace("You pay", "");

  const input = [...walk(view.tree)].find((node) => node.type === "input");
  input.props.onChange({ target: { value: "0241234567" } });
  view.rerender();
  const send = [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).trim() === "Send request");
  assert.equal(Boolean(send.props.disabled), false);
  await send.props.onClick();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));

  const saved = await db.planPayments.toArray();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].method, "momo_paystack");
  assert.equal(saved[0].amountPesewas, PLAN_CONFIG.amountPesewas, "the stored amount is the plan price, as before");
  assert.equal(shown, formatGhs(saved[0].amountPesewas), "You pay equals the saved plan payment");
  for (let index = 0; index < 50 && !navigated.length; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(navigated.at(-1)?.route, "PlanPaymentResult");
  assert.equal(navigated.at(-1).params.payment.amountPesewas, saved[0].amountPesewas, "69 receives the same payment");
});
