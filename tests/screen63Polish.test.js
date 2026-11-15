import assert from "node:assert/strict";
import { test } from "node:test";
import { findButton, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// The fee text on 63 "MoMo payments".

async function card63(env) {
  const error = console.error;
  console.error = () => {};
  try {
    const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", env);
    const view = render({ type: PaymentSettings, props: { onBack() {}, onNavigate() {} } });
    return { view, text: textOf(view.tree) };
  } finally {
    console.error = error;
  }
}

// ---- (2) the fee text -------------------------------------------------------------------------
// The contract never shows a zero fee: the prototype's card has a real figure (GH₵0.25 is an
// example) and 68's rule says the fee is shown from configuration. The text is hidden unless
// Phone request is available and a real fee above zero is configured.

test("63: no fee text while Phone request is off (the default), not even GH₵0.00", async () => {
  const { text, view } = await card63({});
  assert.match(text, /Phone request/);
  assert.match(text, /Confirmed by itself\./);
  assert.doesNotMatch(text, /Fee/);
  assert.doesNotMatch(text, /GH₵0\.00/);
  assert.match(text, /Coming soon/, "a grey Coming soon tag, not a disabled button");
  assert.equal(findButton(view.tree, "Set up"), null);
});

test("63: no fee text when Phone request is on but the fee is 0 or missing", async () => {
  for (const fee of [undefined, "", "0"]) {
    const env = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", ...(fee === undefined ? {} : { VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: fee }) };
    const { text } = await card63(env);
    assert.doesNotMatch(text, /Fee/, `fee ${JSON.stringify(fee)}`);
    assert.match(text, /Confirmed by itself\./);
  }
});

test("63: no fee text when a fee is configured but Phone request is off", async () => {
  const { text } = await card63({ VITE_ENABLE_MOMO_PHONE_REQUEST: "false", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "25" });
  assert.doesNotMatch(text, /Fee/);
});

test("63: no fee text when the fee setting is invalid (Phone request stays off)", async () => {
  const { text } = await card63({ VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "0.25" });
  assert.doesNotMatch(text, /Fee/);
});

test("63: the fee shows, through the formatter, when Phone request is on and the fee is above zero", async () => {
  const { text, view } = await card63({ VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "25" });
  assert.match(text, /Confirmed by itself\. Fee GH₵0\.25 per payment\./);
  assert.ok(findButton(view.tree, "Set up ›"), "the contract's set-up control");
});

// The network row is now one three-column grid (see screens63And64Layout.test.js).
