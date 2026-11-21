import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { openWhatsApp, setOfflineChooser } from "../src/lib/openWhatsApp.js";
import { sendReceipt } from "../src/pos/receiptShare.js";
import { findButton, flushEffects, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// 4g, rules_global.whatsapp_links offline (decided 21 Nov 2026): offline, the direct link
// (whatsapp://send?phone=…) and wa.me stop at WhatsApp's "No internet connection", the share sheet
// works. So offline every WhatsApp action opens the share sheet with the text first, even with a valid
// number. No share sheet, or one that fails: a small sheet with Copy reminder / Copy receipt, Open
// WhatsApp anyway and Not now. Online nothing changes.

const ANDROID = "Mozilla/5.0 (Linux; Android 13; Phone) Mobile";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const TEXT = "Hi & bye";
const ENCODED = "Hi%20%26%20bye";
const VALID = "0241234567";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let removeChooser = () => {};
afterEach(() => {
  removeChooser();
  removeChooser = () => {};
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  else delete globalThis.navigator;
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
});

function device({ onLine = false, share = null, userAgent = ANDROID, clipboard = false } = {}) {
  const calls = { location: [], open: [], share: [], copy: [] };
  const nav = { userAgent, onLine };
  if (share === "works") nav.share = async (data) => { calls.share.push(data); };
  if (share === "cancel") nav.share = async (data) => { calls.share.push(data); throw Object.assign(new Error("closed"), { name: "AbortError" }); };
  if (share === "fails") nav.share = async (data) => { calls.share.push(data); throw new Error("not allowed"); };
  if (clipboard) nav.clipboard = { writeText: async (text) => { calls.copy.push(text); } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
  const win = { open: (...args) => { calls.open.push(args); }, location: { set href(link) { calls.location.push(link); } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  return calls;
}

function chooser(answer) {
  const asked = [];
  removeChooser = setOfflineChooser(async (request) => { asked.push(request); return answer; });
  return asked;
}

// ---- the opener ----------------------------------------------------------------------------------------

test("offline with a valid number: the share sheet with the text, not the direct link", async () => {
  const calls = device({ share: "works" });
  const asked = chooser("open");
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID, title: "Remind" }), "share");
  assert.deepEqual(calls.share, [{ title: "Remind", text: TEXT }]);
  assert.deepEqual(calls.location, [], "no whatsapp://send?phone= offline");
  assert.deepEqual(calls.open, [], "no wa.me offline");
  assert.deepEqual(asked, [], "the share sheet worked, so no offline sheet");
});

test("offline with no number: the share sheet, as online", async () => {
  const calls = device({ share: "works" });
  assert.equal(await openWhatsApp({ text: TEXT }), "share");
  assert.deepEqual(calls.share, [{ text: TEXT }]);
  assert.deepEqual(calls.location, []);
});

test("offline, closing the share sheet is cancelled and opens nothing else", async () => {
  const calls = device({ share: "cancel" });
  const asked = chooser("open");
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "cancelled");
  assert.deepEqual(calls.location, []);
  assert.deepEqual(asked, []);
});

for (const share of [null, "fails"]) {
  const how = share ? "a failing share sheet" : "no share sheet";
  for (const phone of [VALID, ""]) {
    const who = phone ? "a valid number" : "no number";
    test(`offline with ${how} and ${who}: the offline sheet is asked, nothing opens before the choice`, async () => {
      const calls = device({ share });
      const asked = chooser("cancelled");
      assert.equal(await openWhatsApp({ text: TEXT, phone, title: "Remind" }), "cancelled");
      assert.deepEqual(asked, [{ text: TEXT, kind: "reminder", title: "Remind" }]);
      assert.deepEqual(calls.location, [], "Not now opens nothing");
      assert.deepEqual(calls.open, []);
    });

    test(`offline with ${how} and ${who}: Open WhatsApp anyway opens the direct link as online`, async () => {
      const calls = device({ share });
      chooser("open");
      assert.equal(await openWhatsApp({ text: TEXT, phone }), "app");
      assert.deepEqual(calls.location, [phone ? `whatsapp://send?phone=233241234567&text=${ENCODED}` : `whatsapp://send?text=${ENCODED}`]);
    });
  }
}

test("offline with no share sheet: Copy returns copied and opens nothing", async () => {
  const calls = device();
  chooser("copied");
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "copied");
  assert.deepEqual(calls.location, []);
});

test("offline, a receipt asks with kind receipt (Copy receipt); a reminder with kind reminder", async () => {
  device();
  const asked = chooser("cancelled");
  await sendReceipt({ text: TEXT, phone: VALID, title: "Receipt" });
  await openWhatsApp({ text: TEXT, phone: VALID });
  assert.deepEqual(asked.map((request) => request.kind), ["receipt", "reminder"]);
});

test("offline with no share sheet and no sheet mounted: the links open as before", async () => {
  const calls = device();
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "app");
  assert.deepEqual(calls.location, [`whatsapp://send?phone=233241234567&text=${ENCODED}`]);
});

test("offline on a desktop browser: the share sheet when there is one, else the sheet, then wa.me", async () => {
  let calls = device({ userAgent: DESKTOP, share: "works" });
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "share");
  assert.deepEqual(calls.open, []);
  calls = device({ userAgent: DESKTOP });
  chooser("open");
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "web");
  assert.equal(calls.open[0][0], `https://wa.me/233241234567?text=${ENCODED}`);
});

test("online is unchanged: a valid number opens the chat directly, the sheet is never asked", async () => {
  const asked = chooser("copied");
  let calls = device({ onLine: true, share: "works" });
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "app");
  assert.deepEqual(calls.location, [`whatsapp://send?phone=233241234567&text=${ENCODED}`]);
  assert.deepEqual(calls.share, []);
  calls = device({ onLine: true, share: null });
  assert.equal(await openWhatsApp({ text: TEXT }), "app");
  assert.deepEqual(calls.location, [`whatsapp://send?text=${ENCODED}`]);
  calls = device({ onLine: true, share: "fails" });
  assert.equal(await openWhatsApp({ text: TEXT }), "app");
  assert.deepEqual(asked, []);
});

test("onLine missing (an old browser) counts as online", async () => {
  const calls = device({ share: "works" });
  delete navigator.onLine;
  assert.equal(await openWhatsApp({ text: TEXT, phone: VALID }), "app");
  assert.equal(calls.share.length, 0);
});

// ---- the sheet (one bundle with its opener) ------------------------------------------------------------

async function mounted() {
  const entry = await loadJsx("tests/helpers/whatsAppOfflineEntry.js");
  const view = render({ type: entry.WhatsAppOfflineSheet, props: {} });
  flushEffects(view);
  return { entry, view };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("sheet: hidden until asked; a reminder shows Copy reminder (main), Open WhatsApp anyway (other), Not now (leave)", async () => {
  device({ clipboard: true });
  const { entry, view } = await mounted();
  assert.equal(textOf(view.tree), "");
  const result = entry.openWhatsApp({ text: TEXT, phone: VALID, title: "Send reminder on WhatsApp" });
  await settle();
  const tree = view.rerender().tree;
  assert.match(textOf(tree), /^Send reminder on WhatsApp/);
  assert.equal(findButton(tree, "Copy reminder").props["data-look"], "main");
  assert.equal(findButton(tree, "Open WhatsApp anyway").props["data-look"], "other");
  assert.equal(findButton(tree, "Not now").props["data-look"], "leave");
  findButton(tree, "Not now").props.onClick();
  assert.equal(await result, "cancelled");
  assert.equal(textOf(view.rerender().tree), "", "closed");
});

test("sheet: Copy receipt copies the exact text and closes; nothing opens", async () => {
  const calls = device({ clipboard: true });
  const { entry, view } = await mounted();
  const result = entry.sendReceipt({ text: TEXT, phone: VALID, title: "Receipt" });
  await settle();
  const tree = view.rerender().tree;
  assert.ok(!findButton(tree, "Copy reminder"));
  await findButton(tree, "Copy receipt").props.onClick();
  assert.equal(await result, "copied");
  assert.deepEqual(calls.copy, [TEXT]);
  assert.deepEqual(calls.location, []);
  assert.equal(textOf(view.rerender().tree), "");
});

test("sheet: Open WhatsApp anyway opens the direct link to the saved number", async () => {
  const calls = device();
  const { entry, view } = await mounted();
  const result = entry.openWhatsApp({ text: TEXT, phone: VALID });
  await settle();
  findButton(view.rerender().tree, "Open WhatsApp anyway").props.onClick();
  assert.equal(await result, "app");
  assert.deepEqual(calls.location, [`whatsapp://send?phone=233241234567&text=${ENCODED}`]);
});

test("sheet: a copy that fails says so and stays open", async () => {
  device();
  navigator.clipboard = { writeText: async () => { throw new Error("denied"); } };
  const { entry, view } = await mounted();
  const result = entry.openWhatsApp({ text: TEXT });
  await settle();
  await findButton(view.rerender().tree, "Copy reminder").props.onClick();
  const tree = view.rerender().tree;
  assert.match(textOf(tree), /The reminder could not be copied\. Try again\./);
  findButton(tree, "Not now").props.onClick();
  assert.equal(await result, "cancelled");
});

// Item 5 for 4g: the offline sheet joins no two facts with " · ".
test("scan: no ' · ' in the offline sheet's texts", async () => {
  const { posText } = await import("../src/pos/i18n.js");
  for (const key of ["whatsappOffline.copyReminder", "whatsappOffline.openAnyway", "whatsappOffline.reminderCopyFailed", "receipt.copy", "receipt.copyFailed", "reminderAgain.notNow"]) {
    assert.ok(posText(key) && posText(key) !== key, key);
    assert.doesNotMatch(posText(key), / · /, key);
  }
});

test("PosApp mounts the offline sheet once", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.equal((source.match(/<WhatsAppOfflineSheet \/>/g) ?? []).length, 1);
});
