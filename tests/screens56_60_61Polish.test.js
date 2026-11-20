import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadJsx, render, textOf } from "./helpers/renderJsx.js";

// The two 63 fixes, applied the same way to 60, 56 and 61 (owner: "fix them the same way").
// Network row: three equal columns clipped "AirtelTigo" at 320 and 360. Fee text: the contract
// and prototype only show a real fee (GH₵0.25 is an example), never a zero fee.
const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");

async function load(env) {
  const error = console.error;
  console.error = () => {};
  try { return await loadJsx("src/pos/MoMoScreens.jsx", env); } finally { console.error = error; }
}
const ON = (fee) => ({ VITE_ENABLE_MOMO_PHONE_REQUEST: "true", ...(fee === undefined ? {} : { VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: fee }) });

// ---- network rows ------------------------------------------------------------------------------
function networkRow(screen, nextScreen) {
  const start = source.indexOf(`export function ${screen}`);
  const end = source.indexOf(`export function ${nextScreen}`, start);
  const body = source.slice(start, end);
  const row = body.indexOf("NETWORKS.map");
  assert.ok(row > 0, `found the network row on ${screen}`);
  const open = body.lastIndexOf("<div", row);
  return body.slice(open, body.indexOf("</div>", row));
}

for (const [label, screen, next] of [["60", "MoMoSetup", "MoMoPayment"], ["56", "MoMoPayment", "MoMoWaiting"]]) {
  test(`${label}: the network row wraps instead of clipping; labels and 16px text unchanged`, () => {
    const row = networkRow(screen, next);
    assert.match(row, /className="flex flex-wrap gap-2"/);
    assert.doesNotMatch(row, /grid-cols-3/);
    // 60's labels are extra bold, so a little wider than 63's: at least 104px per button.
    assert.match(row, /min-w-\[6\.5rem\]/);
    assert.match(row, /flex-1/);
    assert.match(row, /min-h-14/);
    assert.doesNotMatch(row, /text-(xs|sm)|text-\[(?:[0-9]|1[0-5])px\]/);
  });
}

test("60 and 56 keep the same network labels", () => {
  assert.match(source, /const NETWORKS = \["MTN", "Telecel", "AirtelTigo"\]/);
});

// ---- 56 fee line -------------------------------------------------------------------------------
async function screen56(env) {
  const { MoMoPayment } = await load(env);
  const view = render({ type: MoMoPayment, props: { params: { amountPesewas: 1300 }, onBack() {}, onNavigate() {} } });
  return textOf(view.tree);
}

test("56: no fee text when Phone request is off, and You receive is the full amount", async () => {
  const text = await screen56({});
  assert.doesNotMatch(text, /Fee/);
  assert.match(text, /You receiveGH₵13\.00/);
});

test("56: no fee text when the fee is 0 or missing, or the fee is set but Phone request is off", async () => {
  for (const env of [ON(), ON("0"), { VITE_ENABLE_MOMO_PHONE_REQUEST: "false", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "25" }]) {
    const text = await screen56(env);
    assert.doesNotMatch(text, /Fee/, JSON.stringify(env));
    assert.match(text, /You receiveGH₵13\.00/, JSON.stringify(env));
  }
});

// Wiring 56 "Key-value rows" (16 Nov 2026): rows Fee and You receive replace "Fee … · You receive …".
test("56: rows Fee and You receive show for a real fee with Phone request on", async () => {
  const text = await screen56(ON("25"));
  assert.match(text, /FeeGH₵0\.25You receiveGH₵12\.75/);
  // The green card only: "Saved as MoMo · you confirmed." under the buttons is one method label, not two facts.
  assert.doesNotMatch(text.slice(0, text.indexOf("Customer’s network")), / · /);
});

// ---- 61 Phone request tile ---------------------------------------------------------------------
async function screen61(env) {
  const { MoMoChoice } = await load(env);
  const view = render({ type: MoMoChoice, props: { params: { amountPesewas: 1300 }, onBack() {}, onNavigate() {}, onReplace() {} } });
  return textOf(view.tree);
}

test("61: the Phone request tile shows no fee when it is off or the fee is 0", async () => {
  const off = await screen61({});
  assert.match(off, /Not available yet/);
  assert.doesNotMatch(off, /Fee/);
  const zero = await screen61(ON("0"));
  assert.match(zero, /Customer approves on their phone\. Confirmed by itself\./);
  assert.doesNotMatch(zero, /Fee/);
});

test("61: the tile shows the fee through the formatter for a real fee with Phone request on", async () => {
  assert.match(await screen61(ON("25")), /Confirmed by itself\. Fee GH₵0\.25\./);
});