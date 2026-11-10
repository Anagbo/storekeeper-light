import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { flushEffects, loadJsx, render, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

after(async () => { db.close(); await db.delete(); });
beforeEach(async () => {
  await setPreference("momoDefault", "ask");
  await setPreference("paystackPayoutNumber", "");
});

const FLAG_ON = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "25" };
const FLAG_OFF = {};
const read = (file) => readFileSync(new URL(`../src/pos/${file}`, import.meta.url), "utf8");

// Every sale screen (15 Sell, 55 ReviewAndPay, 16/27/19 credit and collection screens, and the
// split screens) opens MoMo through 61, which is the one place that reads the saved choice.
test("every sale screen opens MoMo through MoMoChoice (61), the one place that reads the saved choice", () => {
  for (const [file, count] of [["Sell.jsx", 1], ["ReviewAndPay.jsx", 1], ["CreditScreens.jsx", 1], ["DebtCollection.jsx", 3], ["SaleSplitPayment.jsx", 1], ["InstallmentSplitPayment.jsx", 1]]) {
    const hits = read(file).match(/"MoMoChoice"/g) ?? [];
    assert.ok(hits.length >= count, `${file} opens MoMoChoice`);
    assert.doesNotMatch(read(file), /"MoMoSetup"|"MoMoPayment"/, `${file} never goes to 60/56 itself`);
  }
});

async function open61(env, { saved, payout }) {
  await setPreference("momoDefault", saved);
  await setPreference("paystackPayoutNumber", payout);
  const { MoMoChoice } = await loadJsx("src/pos/MoMoScreens.jsx", env);
  const replaced = [];
  const navigated = [];
  const params = { amountPesewas: 5000 };
  const view = render({ type: MoMoChoice, props: { params, onBack() {}, onNavigate: (...args) => navigated.push(args), onReplace: (...args) => replaced.push(args) } });
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 80));
  view.rerender();
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 20));
  view.rerender();
  return { view, replaced, navigated };
}

for (const [label, env, payout] of [["flag off", FLAG_OFF, ""], ["flag off, payout saved", FLAG_OFF, "0241234567"], ["flag on, no payout", FLAG_ON, ""], ["flag on, blank payout", FLAG_ON, "   "]]) {
  test(`Always: phone request + ${label}: 61 opens like Ask me each time (no setup, nothing sent)`, async () => {
    const { replaced, navigated } = await open61(env, { saved: "phone", payout });
    assert.deepEqual(replaced, [], "no redirect to 60 or 56");
    assert.deepEqual(navigated, []);
  });
}

test("Always: phone request + flag on + payout saved: goes straight to the phone request (56)", async () => {
  const { replaced } = await open61(FLAG_ON, { saved: "phone", payout: "0241234567" });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0][0], "MoMoPayment");
  assert.equal(replaced[0][1].momoMethod, "paystack");
});

test("Always: customer sends still skips 61 to 62 in every state", async () => {
  for (const [env, payout] of [[FLAG_OFF, ""], [FLAG_ON, ""], [FLAG_ON, "0241234567"]]) {
    const { replaced } = await open61(env, { saved: "direct", payout });
    assert.equal(replaced[0]?.[0], "MoMoDirect");
  }
});

test("the explicit Phone request tile on 61 goes to 60 without a saved payout, otherwise 56", async () => {
  for (const [payout, destination] of [["", "MoMoSetup"], ["0241234567", "MoMoPayment"]]) {
    const { view, navigated } = await open61(FLAG_ON, { saved: "ask", payout });
    const tile = [...walk(view.tree)].find((node) => node.props?.title === "Phone request");
    assert.ok(tile, "tile");
    tile.props.onClick();
    assert.equal(navigated.at(-1)[0], destination);
  }
});

test("availability is one function: flag on AND a saved payout number", async () => {
  const config = await import("../src/pos/momoConfig.js");
  assert.equal(config.phoneRequestAvailable({ flagOn: true, payoutNumber: "0241234567" }), true);
  assert.equal(config.phoneRequestAvailable({ flagOn: true, payoutNumber: "" }), false);
  assert.equal(config.phoneRequestAvailable({ flagOn: true, payoutNumber: "  " }), false);
  assert.equal(config.phoneRequestAvailable({ flagOn: true, payoutNumber: undefined }), false);
  assert.equal(config.phoneRequestAvailable({ flagOn: false, payoutNumber: "0241234567" }), false);
});

async function open63(env, { saved, payout }) {
  await setPreference("momoDefault", saved);
  await setPreference("paystackPayoutNumber", payout);
  const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", env);
  const view = render({ type: PaymentSettings, props: { onBack() {}, onNavigate() {} } });
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 80));
  view.rerender();
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 20));
  view.rerender();
  return [...walk(view.tree)].filter((node) => node.props?.role === "radio");
}

test("63: Always: phone request is hidden with the flag off, greyed without a payout, normal with one", async () => {
  assert.equal((await open63(FLAG_OFF, { saved: "ask", payout: "0241234567" })).length, 2, "hidden");
  const greyed = await open63(FLAG_ON, { saved: "ask", payout: "" });
  assert.equal(greyed.length, 3);
  assert.equal(greyed[2].props["aria-disabled"], true);
  const normal = await open63(FLAG_ON, { saved: "ask", payout: "0241234567" });
  assert.equal(normal.length, 3);
  assert.notEqual(normal[2].props["aria-disabled"], true);
  const chosen = await open63(FLAG_ON, { saved: "phone", payout: "0241234567" });
  assert.equal(chosen[2].props["aria-checked"], true);
});

// Saving 63 must keep the stored "When I tap MoMo" choice unless the owner tapped that radio group.
async function saveOn63(env, { saved, payout, tap, switchNetwork = false }) {
  const { getPreference } = await import("../src/db/preferences.js");
  await setPreference("momoDefault", saved);
  await setPreference("paystackPayoutNumber", payout);
  const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", env);
  let backed = false;
  const view = render({ type: PaymentSettings, props: { onBack() { backed = true; }, onNavigate() {} } });
  flushEffects(view);
  // Loaded: the screen's own read of the settings is done (ours is queued after it and returns the
  // same data), and the radio group shows the stored choice. An unavailable "phone" shows as Ask.
  const { getMerchantMomoSettings } = await import("../src/pos/momoConfig.js");
  await getMerchantMomoSettings();
  const phoneUsable = env === FLAG_ON && Boolean(payout);
  const shownLabel = { ask: "Ask me each time", direct: "Always: customer sends", phone: phoneUsable ? "Always: phone request" : "Ask me each time" }[saved];
  await waitFor(() => {
    view.rerender();
    const radios = [...walk(view.tree)].filter((node) => node.props?.role === "radio");
    const checked = radios.find((node) => node.props["aria-checked"] === true);
    const phone = radios.find((node) => JSON.stringify(node.props.children ?? "").includes("Always: phone request"));
    return Boolean(checked) && JSON.stringify(checked.props.children ?? "").includes(shownLabel) && (!phone || (typeof phone.props.onClick === "function") === phoneUsable);
  }, "63 shows the stored 'When I tap MoMo' choice");
  if (tap) {
    const row = [...walk(view.tree)].find((node) => node.props?.role === "radio" && node.props.children && JSON.stringify(node.props.children).includes(tap));
    row.props.onClick();
    view.rerender();
  }
  const save = [...walk(view.tree)].find((node) => typeof node.props?.onClick === "function" && JSON.stringify(node.props.children ?? "").includes("Save") && node.props.className?.includes("h-[60px]"));
  await save.props.onClick();
  await waitFor(() => backed, "63 saved and went back");
  assert.ok(backed, "saved");
  return getPreference("momoDefault", "ask");
}

test("63: saving something else keeps a stored 'Always: phone request' that is unavailable", async () => {
  assert.equal(await saveOn63(FLAG_ON, { saved: "phone", payout: "" }), "phone", "flag on, no payout");
  assert.equal(await saveOn63(FLAG_OFF, { saved: "phone", payout: "" }), "phone", "flag off");
  assert.equal(await saveOn63(FLAG_ON, { saved: "phone", payout: "0241234567" }), "phone", "available");
});

test("63: tapping a radio saves what the owner picked", async () => {
  assert.equal(await saveOn63(FLAG_ON, { saved: "phone", payout: "", tap: "Always: customer sends" }), "direct");
  assert.equal(await saveOn63(FLAG_OFF, { saved: "phone", payout: "", tap: "Ask me each time" }), "ask");
  assert.equal(await saveOn63(FLAG_ON, { saved: "ask", payout: "0241234567", tap: "Always: phone request" }), "phone");
});
