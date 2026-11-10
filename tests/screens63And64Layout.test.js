import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

// Layout rules for 63 "MoMo payments" and 64 "My plan" (wiring rules, 2026-11-10 redesign).
// Behaviour is unchanged: these tests look at what is shown and how it is laid out.

after(async () => {
  db.close();
  await db.delete();
});

const FLAG_ON = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "25" };

async function screen63(env = {}) {
  const error = console.error;
  console.error = () => {};
  try {
    const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", env);
    const view = render({ type: PaymentSettings, props: { onBack() {}, onNavigate() {} } });
    return view;
  } finally {
    console.error = error;
  }
}

const nodes = (view) => [...walk(view.tree)];
const hostByRole = (view, role) => nodes(view).filter((node) => node.type === "button" && node.props.role === role || node.props?.role === role);
const classes = (node) => String(node?.props?.className ?? "").split(/\s+/);
const labelled = (view, label) => nodes(view).find((node) => node.props?.["aria-label"] === label);
const networkButtons = (view) => nodes(view).filter((node) => node.type === "button" && ["MTN", "Telecel", "AirtelTigo"].includes(textOf(node).trim()));

test("63: the title is MoMo payments", async () => {
  const view = await screen63();
  assert.match(textOf(view.tree), /MoMo payments/);
  assert.doesNotMatch(textOf(view.tree), /How customers pay me/);
});

test("63: Customer sends to my number is a switch, not a tick box, and off hides the number and network fields", async () => {
  const view = await screen63();
  const toggle = labelled(view, "Customer sends to my number");
  assert.equal(toggle.props.role, "switch");
  assert.equal(toggle.props.type, "button", "a button, not a checkbox input");
  assert.equal(toggle.props["aria-checked"], false);
  assert.equal(labelled(view, "My MoMo number"), undefined, "number field hidden when off");
  assert.equal(networkButtons(view).length, 0, "network buttons hidden when off");
  toggle.props.onClick();
  view.rerender();
  assert.equal(labelled(view, "Customer sends to my number").props["aria-checked"], true);
  assert.ok(labelled(view, "My MoMo number"), "number field shows when on");
  assert.equal(networkButtons(view).length, 3, "three networks");
  labelled(view, "Customer sends to my number").props.onClick();
  view.rerender();
  assert.equal(labelled(view, "My MoMo number"), undefined, "hidden again when switched off");
  assert.equal(networkButtons(view).length, 0);
});

test("63: the three network buttons share one row (a three-column grid that cannot wrap) so they fit at 360px", async () => {
  const view = await screen63();
  labelled(view, "Customer sends to my number").props.onClick();
  view.rerender();
  const buttons = networkButtons(view);
  assert.deepEqual(buttons.map((button) => textOf(button).trim()), ["MTN", "Telecel", "AirtelTigo"]);
  const row = nodes(view).find((node) => node.type === "div" && [].concat(node.props.children ?? []).flat().filter(Boolean).length === 3 && networkButtons({ tree: node }).length === 3);
  assert.ok(row, "found the row holding the three buttons");
  assert.ok(classes(row).includes("grid") && classes(row).includes("grid-cols-3"), "one row of three equal columns");
  assert.ok(!classes(row).includes("flex-wrap"), "never wraps to a second row");
  for (const button of buttons) {
    assert.ok(classes(button).includes("min-w-0"), "a button may shrink to its column");
    assert.ok(!classes(button).some((name) => name.startsWith("min-w-[")), "no fixed minimum width that would force a wrap");
    assert.ok(classes(button).some((name) => /^text-(sm|\[1[3-5]px\])$/.test(name)), "label small enough for AirtelTigo in a 360px column");
  }
});

test("63: Save is pinned at the bottom (always visible), 60px, with a check icon, whether the switch is on or off", async () => {
  for (const on of [false, true]) {
    const view = await screen63();
    if (on) { labelled(view, "Customer sends to my number").props.onClick(); view.rerender(); }
    const save = nodes(view).find((node) => typeof node.type === "function" && /Button$/.test(node.type.name) && textOf(node).trim() === "Save");
    assert.ok(save, `Save exists (switch ${on ? "on" : "off"})`);
    assert.ok(classes(save).includes("h-[60px]"), "60px tall");
    const pinned = nodes(view).find((node) => node.type === "div" && classes(node).includes("fixed") && classes(node).includes("bottom-0") && walkHas(node, save));
    assert.ok(pinned, "Save sits in a bar fixed to the bottom of the screen");
  }
});

function walkHas(root, target) {
  for (const node of walk(root)) if (node === target) return true;
  return false;
}

test("63: Phone request is one row; flag off shows a grey Coming soon tag, not tappable, and no disabled button", async () => {
  const view = await screen63({});
  const text = textOf(view.tree);
  assert.match(text, /Phone request/);
  assert.match(text, /Confirmed by itself\./);
  assert.match(text, /Coming soon/);
  assert.doesNotMatch(text, /Set up ›/);
  assert.doesNotMatch(text, /Not available yet/);
  const disabledButtons = nodes(view).filter((node) => (node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name))) && node.props.disabled === true);
  assert.deepEqual(disabledButtons.map((node) => textOf(node)), [], "no disabled button on the screen");
  const row = nodes(view).find((node) => node.props?.["data-row"] === "phone-request");
  assert.ok(row, "the Phone request row is marked");
  assert.equal(row.props.onClick, undefined, "the row is not tappable");
});

test("63: Phone request on: the row has Set up › on the right and it opens 60", async () => {
  const error = console.error;
  console.error = () => {};
  let opened = null;
  try {
    const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", FLAG_ON);
    const view = render({ type: PaymentSettings, props: { onBack() {}, onNavigate: (route) => { opened = route; } } });
    assert.match(textOf(view.tree), /Confirmed by itself\. Fee GH₵0\.25 per payment\./);
    assert.doesNotMatch(textOf(view.tree), /Coming soon/);
    const setUp = nodes(view).find((node) => node.type === "button" && textOf(node).trim() === "Set up ›");
    assert.ok(setUp, "Set up › button");
    setUp.props.onClick();
    assert.equal(opened, "MoMoSetup");
  } finally {
    console.error = error;
  }
});

test("63: When I tap MoMo is a card of radio rows; Always: phone request is hidden while the flag is off", async () => {
  const view = await screen63({});
  const radios = hostByRole(view, "radio");
  assert.deepEqual(radios.map((node) => textOf(node).trim()), ["Ask me each time", "Always: customer sends to my number"]);
  assert.equal(radios[0].props["aria-checked"], true, "Ask me each time is the default");
  assert.equal(radios[1].props["aria-checked"], false);
  assert.ok(nodes(view).some((node) => node.props?.role === "radiogroup"), "the rows are one radio group");
  assert.doesNotMatch(textOf(view.tree), /Always: phone request|Set up phone request first/);
  radios[1].props.onClick();
  view.rerender();
  const after = hostByRole(view, "radio");
  assert.equal(after[1].props["aria-checked"], true);
  assert.equal(after[0].props["aria-checked"], false);
});

test("63: flag on but phone request not set up: the row shows, greyed and not selectable, with Set up phone request first", async () => {
  const view = await screen63(FLAG_ON);
  const radios = hostByRole(view, "radio");
  assert.equal(radios.length, 3);
  const phone = radios[2];
  assert.match(textOf(phone), /Always: phone request/);
  assert.match(textOf(phone), /Set up phone request first/);
  assert.equal(phone.props["aria-disabled"], true);
  phone.props.onClick?.();
  view.rerender();
  assert.equal(hostByRole(view, "radio")[2].props["aria-checked"], false, "it cannot be chosen");
});

test("63: no person icons on the radio rows", async () => {
  const view = await screen63(FLAG_ON);
  const rows = hostByRole(view, "radio");
  for (const row of rows) {
    const names = [...walk(row)].map((node) => (typeof node.type === "function" ? node.type.name : ""));
    assert.ok(!names.includes("UserRound"), "no UserRound icon");
  }
});

// ---- 64 ------------------------------------------------------------------------------------

async function screen64(props = {}, seed = []) {
  await db.planPayments.clear();
  if (seed.length) await db.planPayments.bulkAdd(seed);
  const { MyPlan } = await loadJsx("src/pos/PlanScreens.jsx", {});
  const view = render({ type: MyPlan, props: { onBack() {}, onNavigate() {}, onOpenSubscription() {}, ...props } });
  flushEffects(view);
  if (seed.length) await waitFor(() => { view.rerender(); return textOf(view.tree).includes("Confirmed") || textOf(view.tree).includes("Waiting"); }, "payments to load");
  else await new Promise((resolve) => setTimeout(resolve, 30));
  view.rerender();
  return view;
}

const day = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();
const dmy = (value) => { const d = new Date(value); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };

test("64: one plan card shows Shop plan, the status tag, a large price with a month, and days left", async () => {
  const expiry = iso(12);
  const view = await screen64({ expiry });
  const text = textOf(view.tree);
  assert.match(text, /Shop plan/);
  assert.match(text, /Active/);
  assert.match(text, /GH₵\d+\.\d{2}/);
  assert.match(text, /a month/);
  assert.ok(text.includes(`Active until ${dmy(expiry)} · 12 days left`), "status line with date and days left");
  assert.match(text, /Your sales and records stay safe if a payment is late\./);
  assert.doesNotMatch(text, /Your monthly subscription is active/, "the duplicate line is gone");
  const cards = nodes(view).filter((node) => typeof node.type === "function" && node.type.name === "PosCard");
  const planCards = cards.filter((card) => textOf(card).includes("Shop plan"));
  assert.equal(planCards.length, 1);
  assert.ok(textOf(planCards[0]).includes("Pay now"), "Pay now is inside the one plan card");
  assert.equal(cards.length, 2, "the plan card and the Payments card, nothing else");
});

test("64: Pay now is the solid green 56px button; View subscription shows only when the subscription flag is on", async () => {
  const off = await screen64({ expiry: iso(12), subscriptionEnabled: false });
  const pay = nodes(off).find((node) => typeof node.type === "function" && /Button$/.test(node.type.name) && textOf(node).trim() === "Pay now");
  assert.ok(pay);
  assert.equal(pay.type.name, "PosPrimaryButton");
  assert.doesNotMatch(textOf(off.tree), /View subscription/);
  const on = await screen64({ expiry: iso(12), subscriptionEnabled: true, hasActiveSubscription: true });
  const view = nodes(on).find((node) => typeof node.type === "function" && /Button$/.test(node.type.name) && textOf(node).trim() === "View subscription");
  assert.ok(view, "View subscription button");
  assert.equal(view.type.name, "PosSecondaryButton", "outlined");
});

test("64: a late or due plan uses its own status tag", async () => {
  const late = await screen64({ expiry: "" });
  assert.match(textOf(late.tree), /Late/);
  const due = await screen64({ expiry: iso(0) });
  assert.match(textOf(due.tree), /Due today|Active/);
});

test("64: each Payments row shows the method, the date, the amount and a status tag", async () => {
  const created = Date.now() - 5 * day;
  const view = await screen64({ expiry: iso(12) }, [
    { id: "p1", planId: "monthly", method: "momo_direct", amountPesewas: 3000, reference: "r", status: "confirmed", confirmedBy: "", createdAt: created },
    { id: "p2", planId: "monthly", method: "cash", amountPesewas: 3000, reference: "r", status: "waiting", confirmedBy: "", createdAt: created + 1000 }
  ]);
  const rows = nodes(view).filter((node) => node.props?.["data-row"] === "payment");
  assert.equal(rows.length, 2);
  const first = textOf(rows[0]);
  assert.match(first, /Mobile money/);
  assert.ok(first.includes(dmy(created)), "date");
  assert.match(first, /GH₵30\.00/);
  assert.match(first, /Confirmed/);
  assert.match(textOf(rows[1]), /Cash/);
  assert.match(textOf(rows[1]), /Waiting to confirm/);
  const tags = nodes(view).filter((node) => typeof node.type === "function" && node.type.name === "PosStatusTag");
  assert.ok(tags.some((tag) => textOf(tag) === "Confirmed" && tag.props.tone === "green"));
  assert.ok(tags.some((tag) => textOf(tag) === "Waiting to confirm" && tag.props.tone === "amber"));
  assert.doesNotMatch(first, / · GH₵30\.00 · /, "the amount and the status are not one long line");
});

test("64: with no payments the card says No payments yet.", async () => {
  const view = await screen64({ expiry: iso(12) });
  assert.match(textOf(view.tree), /No payments yet\./);
  assert.doesNotMatch(textOf(view.tree), /No payments recorded yet/);
});

// "p-0" lost to PosCard's own "p-4" (same specificity, later in the stylesheet), which put 16px
// above the first row. The card around the rows must really have no padding, and every row has the
// same height (room for a two-line label), so the three rows look identical.
test("63: the radio rows are equal in height and nothing pads above the first row", async () => {
  for (const env of [{}, FLAG_ON]) {
    const view = await screen63(env);
    const card = nodes(view).find((node) => classes(node).includes("rounded-2xl") === false && [...walk(node)].some((child) => child.props?.role === "radiogroup") && String(node.props?.className ?? "").includes("p-0"));
    assert.ok(card, "the card around the rows");
    assert.ok(classes(card).includes("!p-0"), "padding is removed with !p-0 so PosCard's p-4 cannot win");
    const rows = hostByRole(view, "radio");
    assert.ok(rows.length >= 2);
    for (const row of rows) {
      assert.ok(classes(row).includes("min-h-20"), `${textOf(row).trim()}: same minimum height`);
      assert.ok(classes(row).includes("py-3"), "same vertical padding");
    }
  }
});
