import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.connection_status: the phone header shows a green dot and "Saved ✓" online, a crossed
// Wi-Fi icon and "Offline" (amber-brown, never red) offline; a tap explains it; the sidebar shows
// the same status; it follows navigator.onLine and the online/offline events with no reload.

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
});

function setOnline(onLine) {
  const nav = { onLine, userAgent: "test" };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  const win = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  return { nav, win };
}

const ONLINE_NAME = "Online. Saved on this phone.";
const OFFLINE_NAME = "Offline. Saved on this phone.";
const ONLINE_MESSAGE = "You are online. Everything is saved on this phone.";
const OFFLINE_MESSAGE = "You are offline. Everything is still saved on this phone. Sending by WhatsApp will wait until you are back online.";

async function showHeader(props = {}) {
  const { PosHeader } = await loadJsx("src/pos/PosComponents.jsx");
  const view = render({ type: PosHeader, props: { shopName: "Mama Esi Provisions", statusLabel: "", onHome() {}, onMenu() {}, ...props } });
  flushEffects(view);
  return view;
}

const statusButton = (tree) => [...walk(tree)].find((node) => node.type === "button" && /Saved on this phone/.test(node.props?.["aria-label"] ?? ""));
const shapes = (tree) => [...walk(tree)];

test("online: a bright green dot with a soft ring, then Saved ✓, named Online. Saved on this phone.", async () => {
  setOnline(true);
  const { tree } = await showHeader();
  const button = statusButton(tree);
  assert.equal(button.props["aria-label"], ONLINE_NAME);
  assert.equal(textOf(button), "Saved ✓");
  const dot = shapes(button).find((node) => node.type === "span" && /#22C55E/i.test(JSON.stringify(node.props.style ?? {})));
  assert.ok(dot, "the green dot");
  assert.match(JSON.stringify(dot.props.style), /box-?shadow|boxShadow/);
  assert.ok(!shapes(button).some((node) => node.type?.displayName === "WifiOff" || node.type?.render?.displayName === "WifiOff"));
});

test("offline: a crossed-out Wi-Fi icon and Offline in amber-brown, never red", async () => {
  setOnline(false);
  const { tree } = await showHeader();
  const button = statusButton(tree);
  assert.equal(button.props["aria-label"], OFFLINE_NAME);
  assert.equal(textOf(button), "Offline");
  const word = shapes(button).find((node) => node.type === "span" && textOf(node) === "Offline");
  assert.match(JSON.stringify(word.props.style ?? {}) + (word.props.className ?? ""), /#92400E/i);
  const icon = shapes(button).find((node) => node.props?.["data-status-icon"] === "wifi-off");
  assert.ok(icon, "the crossed Wi-Fi icon");
  assert.doesNotMatch(JSON.stringify(shapes(button).map((node) => [node.props?.style, node.props?.className])), /red|rose|#[Ee][Ff]4444|#[Dd][Cc]2626/);
});

test("the online and offline events switch the status without a reload", async () => {
  const { nav, win } = setOnline(true);
  const view = await showHeader();
  assert.equal(statusButton(view.tree).props["aria-label"], ONLINE_NAME);
  nav.onLine = false;
  win.dispatchEvent(new Event("offline"));
  assert.equal(statusButton(view.rerender().tree).props["aria-label"], OFFLINE_NAME);
  nav.onLine = true;
  win.dispatchEvent(new Event("online"));
  assert.equal(statusButton(view.rerender().tree).props["aria-label"], ONLINE_NAME);
});

test("tapping shows the short message for each state, and again hides it", async () => {
  for (const [onLine, message] of [[true, ONLINE_MESSAGE], [false, OFFLINE_MESSAGE]]) {
    setOnline(onLine);
    const view = await showHeader();
    assert.ok(!textOf(view.tree).includes("Everything"), "no message before the tap");
    statusButton(view.tree).props.onClick();
    assert.ok(textOf(view.rerender().tree).includes(message));
    statusButton(view.tree).props.onClick();
    assert.ok(!textOf(view.rerender().tree).includes("Everything"));
  }
});

test("Saving… shows while a save runs, in place of the connection status", async () => {
  setOnline(true);
  const { tree } = await showHeader({ statusLabel: "Saving…" });
  assert.ok(textOf(tree).includes("Saving…"));
  assert.equal(statusButton(tree), undefined);
});

test("62 (hideSaved): online shows only the dot, offline still shows the icon and the word", async () => {
  setOnline(true);
  let button = statusButton((await showHeader({ hideSaved: true })).tree);
  assert.equal(textOf(button), "");
  assert.equal(button.props["aria-label"], ONLINE_NAME);
  setOnline(false);
  button = statusButton((await showHeader({ hideSaved: true })).tree);
  assert.equal(textOf(button), "Offline");
});

test("wide layout: the sidebar ends with Online or Offline and Saved on this device", async () => {
  const { PosSideNav } = await loadJsx("src/pos/PosComponents.jsx");
  for (const [onLine, word, name] of [[true, "Online", ONLINE_NAME], [false, "Offline", OFFLINE_NAME]]) {
    setOnline(onLine);
    const view = render({ type: PosSideNav, props: { current: "Home", onNavigate() {} } });
    flushEffects(view);
    const node = [...walk(view.tree)].find((item) => item.props?.["aria-label"] === name);
    assert.ok(node, "the sidebar status carries the accessible name");
    assert.equal(textOf(node), `${word}Saved on this device`);
  }
});

test("62 (hideSaved): the sidebar leaves out Saved on this device", async () => {
  const { PosSideNav } = await loadJsx("src/pos/PosComponents.jsx");
  setOnline(true);
  const view = render({ type: PosSideNav, props: { current: "MoMoDirect", onNavigate() {}, hideSaved: true } });
  flushEffects(view);
  const node = [...walk(view.tree)].find((item) => item.props?.["aria-label"] === ONLINE_NAME);
  assert.equal(textOf(node), "Online");
});

// Real render at 340, 360 and 393px is checked in a browser (see the report); the markup rules that
// keep the header fitting are asserted here.
test("header fit: the shop name still shrinks and truncates; the status never wraps or grows", async () => {
  setOnline(false);
  const { tree } = await showHeader({ shopName: "Nana Akosua Boateng Wholesale and Provisions Shop" });
  const name = shapes(tree).find((node) => node.type === "p" && textOf(node).startsWith("Nana Akosua"));
  assert.match(name.props.className, /min-w-0/);
  assert.match(name.props.className, /truncate/);
  assert.match(name.props.className, /flex-1/);
  // Measured in a real render with a 45-character shop name (Segoe UI): the name is 70, 90 and 123px at
  // 340, 360 and 393 (it was 68, 88 and 121 with "Saved"), because the row gap is 8px, not 12px.
  const row = shapes(tree).find((node) => node.type === "div" && /min-h-16/.test(node.props.className ?? ""));
  assert.match(row.props.className, / gap-2 /);
  assert.doesNotMatch(row.props.className, /gap-3/);
  const button = statusButton(tree);
  assert.match(button.props.className, /shrink-0/);
  assert.match(button.props.className, /whitespace-nowrap/);
});
