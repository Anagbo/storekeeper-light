import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { formatGhs } from "../src/lib/money.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Screen 62 "Customer sends" redesign (wiring 62 rules, 12 Nov 2026): layout and wording only.
// Header Back + "Customer sends"; green hero with the amount; "Send to my number" card with Copy,
// the number, network chip and name line; amber "Before you tap Money received" card with three
// numbered steps; pinned footer with Money received and "Will be recorded as MoMo · you confirmed.".
// Never "Saved" on this screen; a split adds "MoMo part of a GH₵{total} sale".

let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const byLabel = (tree, label) => nodes(tree).find((node) => node.props["aria-label"] === label);
const shown = (tree) => textOf(tree).replace(/\s+/g, " ");
const classOf = (node) => String(node?.props?.className ?? "");

async function render62(params) {
  const { MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const view = render({ type: MoMoDirect, props: { params, onBack() {}, onConfirm: async () => {}, onPick() {} } });
  flushEffects(view);
  for (let attempt = 0; attempt < 50 && findButton(view.tree, "Money received").props.disabled; attempt += 1) {
    await settle();
    view.rerender();
  }
  return view;
}

const SINGLE = { amountPesewas: 1300 };
const SPLIT16 = {
  amountPesewas: 1300,
  splitParts: [{ paymentMethod: "cash", amountPesewas: 500 }],
  pendingMomoAmountPesewas: 800,
  momoMethod: "direct",
  confirmFor: "sale16"
};

test("62: header, hero, number card, steps and footer in the order of the wiring, with its strings", async () => {
  const view = await render62(SINGLE);
  const text = shown(view.tree);
  const order = [
    "Back",
    "Customer sends",
    "Ask the customer to send",
    formatGhs(1300),
    "Send to my number",
    "Copy",
    "024 123 4567",
    "MTN",
    "Before you tap Money received",
    "1", "Wait for the MoMo message.",
    "2", "Check that the amount and the name are right.",
    "3", "Check your MoMo balance went up, not only the SMS.",
    "Money received",
    "Will be recorded as MoMo · you confirmed."
  ];
  let from = 0;
  for (const piece of order) {
    const at = text.indexOf(piece, from);
    assert.ok(at >= 0, `"${piece}" after position ${from} in: ${text}`);
    from = at + piece.length;
  }
  const title = nodes(view.tree).find((node) => node.type === "h1");
  assert.equal(textOf(title), "Customer sends");
  assert.doesNotMatch(text, /Customer sends to me\b/);
});

test("62: the amount is the hero at 42px through formatGhs; the number at 34px; the steps are round number badges, not tick boxes", async () => {
  const view = await render62(SINGLE);
  const amount = nodes(view.tree).find((node) => textOf(node) === formatGhs(1300) && classOf(node).includes("text-[42px]"));
  assert.ok(amount, "amount at 42px");
  const hero = nodes(view.tree).find((node) => node.type === "section" && textOf(node).startsWith("Ask the customer to send"));
  assert.match(classOf(hero), /bg-emerald-900/);
  const number = nodes(view.tree).find((node) => textOf(node) === "024 123 4567");
  assert.match(classOf(number), /text-\[34px\]/);
  const chip = nodes(view.tree).find((node) => node.type === "span" && textOf(node) === "MTN");
  assert.match(classOf(chip), /bg-amber-200/, "yellow network chip");
  const badges = nodes(view.tree).filter((node) => ["1", "2", "3"].includes(textOf(node)) && classOf(node).includes("rounded-full"));
  assert.equal(badges.length, 3);
  assert.equal(nodes(view.tree).filter((node) => node.type === "input" && node.props.type === "checkbox").length, 0);
  const steps = nodes(view.tree).find((node) => node.type === "section" && textOf(node).startsWith("Before you tap Money received"));
  assert.match(classOf(steps), /border-amber-500/);
  assert.equal(nodes(steps).filter((node) => node.type === "ol").length, 1, "numbered list");
});

test("62: accessible names Back, Copy number, Money received; Copy is 44px; Money received is 60px with a check icon", async () => {
  const view = await render62(SINGLE);
  assert.ok(byLabel(view.tree, "Back"));
  const copy = byLabel(view.tree, "Copy number");
  assert.ok(copy);
  assert.match(classOf(copy), /min-h-11|h-11|min-h-\[44px\]|h-\[44px\]/);
  assert.equal(textOf(copy).trim(), "Copy");
  const received = findButton(view.tree, "Money received");
  assert.match(classOf(received), /h-\[60px\]/);
  assert.ok(nodes(received).some((node) => typeof node.type === "function" || node.type === "svg"), "check icon");
  const back = byLabel(view.tree, "Back");
  assert.match(classOf(back), /whitespace-nowrap/, "the Back label never wraps");
});

test("62: the footer is pinned (fixed to the bottom) and holds Money received and the recorded-as line; the body scrolls", async () => {
  const view = await render62(SINGLE);
  const footer = nodes(view.tree).find((node) => classOf(node).includes("fixed") && classOf(node).includes("bottom-0"));
  assert.ok(footer, "pinned footer");
  assert.match(shown(footer), /^Money received.*Will be recorded as MoMo · you confirmed\.$/);
  const page = nodes(view.tree).find((node) => node.type === "main");
  assert.match(classOf(page), /overflow-y-auto/);
  assert.match(classOf(page), /pb-40/, "room under the body for the footer");
  assert.ok(!shown(footer).includes("Before you tap"), "the steps scroll with the body");
});

test("62: never says Saved, also with a split", async () => {
  for (const params of [SINGLE, SPLIT16]) {
    const view = await render62(params);
    assert.doesNotMatch(shown(view.tree), /saved/i);
  }
  const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
  const direct = source.slice(source.indexOf("export function MoMoDirect"), source.indexOf("export function PaymentSettings"));
  assert.doesNotMatch(direct, /Saved as MoMo/);
});

test("62: a sale split shows the quiet line MoMo part of a GH₵{total} sale under the amount; a single payment does not", async () => {
  const split = await render62(SPLIT16);
  const text = shown(split.tree);
  assert.match(text, new RegExp(`Ask the customer to send ?${formatGhs(800).replace(/[.]/g, "\\.")}`));
  const line = `MoMo part of a ${formatGhs(1300)} sale`;
  assert.ok(text.includes(line), text);
  assert.ok(text.indexOf(line) < text.indexOf("Send to my number"), "under the amount card");
  const single = await render62(SINGLE);
  assert.doesNotMatch(shown(single.tree), /MoMo part of/);
});

test("62: Copy shows Copied on the button for two seconds, and copies the number", async () => {
  const copiedText = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { copiedText.push(value); } } } });
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  try {
    const view = await render62(SINGLE);
    globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
    await byLabel(view.tree, "Copy number").props.onClick();
    await Promise.resolve();
    globalThis.setTimeout = realSetTimeout;
    view.rerender();
    assert.deepEqual(copiedText, ["0241234567"]);
    assert.equal(textOf(byLabel(view.tree, "Copy number")).trim(), "Copied");
    assert.doesNotMatch(shown(view.tree), /Number copied/);
    const reset = timers.find((timer) => timer.delay === 2000);
    assert.ok(reset, "a two-second timer");
    reset.callback();
    view.rerender();
    assert.equal(textOf(byLabel(view.tree, "Copy number")).trim(), "Copy");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});

test("62 in the app (collect split Done): no Saved anywhere on the page, the header included", async () => {
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.match(app.text(), /Saved/, "the header says Saved on other screens");
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.doesNotMatch(app.text(), /saved/i);
  assert.match(app.text(), /Customer sends/);
});

test("62: the hero amount stays 42px when it fits and shrinks only for a long amount (no overflow on a 340px phone)", async () => {
  const short = await render62(SINGLE);
  const amountNode = (view) => nodes(view.tree).find((node) => classOf(node).includes("text-[42px]"));
  assert.match(amountNode(short).props.style.fontSize, /^min\(42px, (\d+\.\d)cqi\)$/);
  const shortCqi = Number(amountNode(short).props.style.fontSize.match(/([\d.]+)cqi/)[1]);
  assert.ok(shortCqi * 2.72 >= 42, "GH₵13.00 is 42px on a 340px phone (272px card)");
  const long = await render62({ amountPesewas: 99999999 });
  assert.equal(textOf(amountNode(long)), formatGhs(99999999));
  const longCqi = Number(amountNode(long).props.style.fontSize.match(/([\d.]+)cqi/)[1]);
  assert.ok(longCqi * 2.72 < 42, "GH₵999,999.99 shrinks on a 340px phone");
});
