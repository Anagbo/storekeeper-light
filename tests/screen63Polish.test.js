import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findButton, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// Two small fixes on 63 "How customers pay me".
const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");

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
  assert.ok(findButton(view.tree, "Not available yet"), "the set-up button says it is not available");
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
  assert.ok(findButton(view.tree, "Phone request: set up ›"), "the contract's set-up control");
});

// ---- (1) the network row at 320 px ------------------------------------------------------------
// "AirtelTigo" at 16px bold needs about 97px with its padding and border. Three equal columns
// are only about 79px wide at 320 and 87px at 360, so the label clipped. The row now wraps
// (labels unchanged, text still 16px or more) and each button is at least 100px wide.

function networkRow() {
  const start = source.indexOf("export function PaymentSettings");
  const end = source.indexOf("export function MoMoSetup", start);
  const body = source.slice(start, end);
  const row = body.indexOf("RECEIVING_NETWORKS.map");
  assert.ok(row > 0, "found the network row on 63");
  const open = body.lastIndexOf("<div", row);
  return body.slice(open, body.indexOf("</div>", row));
}

test("63: the network row wraps instead of clipping, keeps the same labels and the 16px text", async () => {
  const row = networkRow();
  assert.match(row, /className="flex flex-wrap gap-2"/, "the row can wrap");
  assert.doesNotMatch(row, /grid-cols-3/, "no fixed three-column grid");
  assert.match(row, /min-w-\[6\.25rem\]/, "each button is at least 100px wide, so the label fits");
  assert.match(row, /flex-1/, "buttons share the row");
  assert.doesNotMatch(row, /text-(xs|sm)|text-\[(?:[0-9]|1[0-5])px\]/, "text stays at 16px or more (brief)");
  assert.match(row, /min-h-14/, "touch height kept");
  const { RECEIVING_NETWORKS } = await import("../src/pos/momoConfig.js");
  assert.deepEqual([...RECEIVING_NETWORKS], ["MTN", "Telecel", "AirtelTigo"], "no label changed");
});