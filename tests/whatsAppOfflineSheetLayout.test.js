import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render } from "./helpers/renderJsx.js";

// 4g follow-up (21 Nov 2026): the offline WhatsApp sheet in a real browser at 340, 360 and 393px (740px
// high): no sideways scroll, every button 52px or taller and full width, every button label on one line,
// and the same layout as "Send another reminder?" (a bottom sheet with the same overlay, width, padding,
// corners, top border and heading, buttons stacked full width with the same gap).

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 360, 393];

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; };
  const overlay = doc.querySelector("#root > div");
  const sheet = overlay.querySelector("section");
  const s = win.getComputedStyle(sheet);
  const o = win.getComputedStyle(overlay);
  const heading = sheet.querySelector("h2");
  const h = win.getComputedStyle(heading);
  const buttons = [...sheet.querySelectorAll("button")].map((button) => ({ text: button.textContent.trim(), lines: textLines(button), scrollsWide: button.scrollWidth > button.clientWidth, ...box(button) }));
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    viewportHeight: win.innerHeight,
    overlay: { position: o.position, alignItems: o.alignItems, justifyContent: o.justifyContent, background: o.backgroundColor },
    sheet: { ...box(sheet), padding: s.padding, radius: s.borderTopLeftRadius + " " + s.borderTopRightRadius + " " + s.borderBottomLeftRadius, borderTop: s.borderTopWidth + " " + s.borderTopStyle, gap: s.rowGap, direction: s.flexDirection },
    heading: { size: h.fontSize, weight: h.fontWeight, ...box(heading) },
    contentLeft: box(sheet).left + parseFloat(s.paddingLeft),
    contentRight: box(sheet).right - parseFloat(s.paddingRight),
    buttons
  };
}`;

async function pages() {
  const { WhatsAppOfflineChoices } = await loadJsx("src/pos/WhatsAppOfflineSheet.jsx");
  const { ReminderAgainSheet } = await loadJsx("src/pos/ReminderCheck.jsx");
  const html = (element) => toHtml(render(element).tree);
  return [
    { name: "reminder", html: html({ type: WhatsAppOfflineChoices, props: { request: { kind: "reminder", title: "Send reminder on WhatsApp" }, onCopy() {}, onOpen() {}, onNotNow() {} } }) },
    { name: "receipt", html: html({ type: WhatsAppOfflineChoices, props: { request: { kind: "receipt", title: "Receipt" }, onCopy() {}, onOpen() {}, onNotNow() {} } }) },
    { name: "receipt-failed", html: html({ type: WhatsAppOfflineChoices, props: { request: { kind: "receipt", title: "Receipt" }, failed: true, onCopy() {}, onOpen() {}, onNotNow() {} } }) },
    { name: "again", html: html({ type: ReminderAgainSheet, props: { text: "You sent Nana Akosua Frimpomaa a reminder today at 14:05. Sending too many can annoy a customer.", onSendAgain() {}, onNotNow() {} } }) }
  ];
}

test("offline WhatsApp sheet at 340, 360 and 393px: no sideways scroll, buttons 52px+ on one line, laid out like Send another reminder?", { skip }, async () => {
  const results = measureInFrames({ pages: await pages(), css: await appCss(), widths: WIDTHS, height: 740, measure: MEASURE });
  assert.equal(results.length, 4 * WIDTHS.length);
  const labels = {
    reminder: ["Copy reminder", "Open WhatsApp anyway", "Not now"],
    receipt: ["Copy receipt", "Open WhatsApp anyway", "Not now"],
    "receipt-failed": ["Copy receipt", "Open WhatsApp anyway", "Not now"]
  };
  for (const width of WIDTHS) {
    const again = results.find((r) => r.page === "again" && r.width === width);
    for (const page of Object.keys(labels)) {
      const result = results.find((r) => r.page === page && r.width === width);
      const where = `${page} at ${width}px`;
      assert.equal(result.innerWidth, width, `${where}: the frame is that wide`);
      assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
      assert.deepEqual(result.buttons.map((b) => b.text), labels[page], `${where}: the buttons, top to bottom`);
      for (const button of result.buttons) {
        assert.ok(button.height >= 52, `${where}: ${button.text} is ${button.height}px high`);
        assert.equal(button.lines, 1, `${where}: ${button.text} on one line`);
        assert.equal(button.scrollsWide, false, `${where}: ${button.text} is not cut`);
        assert.equal(button.left, result.contentLeft, `${where}: ${button.text} full width (left)`);
        assert.equal(button.right, result.contentRight, `${where}: ${button.text} full width (right)`);
      }
      for (let i = 1; i < result.buttons.length; i += 1) assert.ok(result.buttons[i].top >= result.buttons[i - 1].bottom, `${where}: stacked, one above the other`);
      // The same layout as Send another reminder?: a bottom sheet the full width of the phone.
      assert.deepEqual(result.overlay, again.overlay, `${where}: the same overlay`);
      assert.equal(result.sheet.bottom, result.viewportHeight, `${where}: sits on the bottom edge`);
      for (const key of ["left", "right", "width", "padding", "radius", "borderTop", "gap", "direction"]) {
        assert.equal(result.sheet[key], again.sheet[key], `${where}: sheet ${key} as on Send another reminder?`);
      }
      assert.equal(result.heading.size, again.heading.size, `${where}: heading size`);
      assert.equal(result.heading.weight, again.heading.weight, `${where}: heading weight`);
      assert.equal(result.heading.left, again.heading.left, `${where}: heading starts where it does there`);
      assert.ok(result.sheet.top > 0, `${where}: the whole sheet fits on screen`);
    }
  }
});
