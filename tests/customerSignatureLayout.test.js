import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 72 layout (16 Nov 2026), real browser at 340, 360 and 393px: Back (PosBackButton) and the title
// "Please sign" on the top row; Clear above Done, both full width and 60px; Skip for now an underlined
// link below; nothing wraps or scrolls sideways, with a long name, shop, amount and reason.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";

async function signatureHtml() {
  const { default: CustomerSignature } = await loadJsx("src/pos/CustomerSignature.jsx");
  const event = {
    id: "t1", type: "sale", paymentType: "credit", customer_name: "Nana Akosua Frimpomaa", creditExtendedPesewas: 1234567,
    createdAt: new Date(2026, 10, 16, 10, 0).getTime(), dueDate: "2026-11-23",
    items_json: JSON.stringify([{ name: "Bread", quantity: 2 }, { name: "Sugar", quantity: 1 }, { name: "Cooking oil 5L", quantity: 1 }, { name: "Milo tin", quantity: 3 }])
  };
  setLiveQuery(() => ({ event, debt: null }));
  try {
    return toHtml(render({ type: CustomerSignature, props: { params: { transactionId: "t1" }, onFinish() {}, shopName: "Mama Esi's Provisions Store" } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const byText = (text) => [...doc.querySelectorAll("button")].find((el) => el.textContent.trim() === text);
  const back = doc.querySelector('button[aria-label="Back"]');
  const title = doc.querySelector("h1");
  const page = doc.querySelector("main");
  const pageStyle = win.getComputedStyle(page);
  const content = { left: page.getBoundingClientRect().left + parseFloat(pageStyle.paddingLeft), right: page.getBoundingClientRect().right - parseFloat(pageStyle.paddingRight) };
  const skipLink = byText("Skip for now");
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    content,
    back: { ...box(back), lines: textLines(back), first: [...doc.querySelectorAll("button")][0] === back },
    title: { ...box(title), lines: textLines(title), text: title.textContent },
    clear: { ...box(byText("Clear")), lines: textLines(byText("Clear")) },
    done: { ...box(byText("Done")), lines: textLines(byText("Done")) },
    skip: { ...box(skipLink), lines: textLines(skipLink), underline: win.getComputedStyle(skipLink).textDecorationLine },
    pad: box(doc.querySelector("[data-signature-box]")),
    amountLines: textLines(doc.querySelector("[data-sign-amount]")),
    buttons: [...doc.querySelectorAll("button")].map((el) => ({ name: (el.getAttribute("aria-label") || el.textContent).trim(), lines: textLines(el), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, clipped: el.scrollWidth > el.clientWidth + 1 }))
  };
}`;

test("72 at 340, 360 and 393px: Back and title on top, Done above Clear, both full width and 60px", { skip }, async () => {
  const results = measureInFrames({ pages: [{ name: "72", html: await signatureHtml() }], css: await appCss(), widths: [340, 360, 393], height: 1400, measure: MEASURE });
  assert.equal(results.length, 3);
  for (const result of results) {
    const where = `72 at ${result.width}px`;
    const { back, title, clear, done, skip: skipLink, pad, content } = result;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    // Top row: Back first, then the title, on the same row.
    assert.ok(back.first, `${where}: Back is the first control`);
    assert.ok(Math.abs(back.height - 52) < 0.5, `${where}: Back is the 52px PosBackButton (${back.height})`);
    assert.ok(title.left >= back.right, `${where}: the title is right of Back`);
    assert.ok(title.top < back.bottom && title.bottom > back.top, `${where}: Back and the title share the top row`);
    assert.equal(title.text, "Please sign");
    assert.equal(title.lines, 1, `${where}: the title is one line`);
    assert.ok(back.bottom <= pad.top, `${where}: the top row is above the signature box`);
    // Done above Clear (rules.8, owner's choice 16 Nov 2026), both full width and 60px.
    for (const [name, button] of [["Clear", clear], ["Done", done]]) {
      assert.ok(Math.abs(button.height - 60) < 0.5, `${where}: ${name} is 60px (${button.height})`);
      assert.ok(Math.abs(button.left - content.left) < 1 && Math.abs(button.right - content.right) < 1, `${where}: ${name} is full width (${button.left}..${button.right}, content ${content.left}..${content.right})`);
      assert.equal(button.lines, 1, `${where}: ${name} is one line`);
    }
    assert.ok(done.top >= pad.bottom, `${where}: Done is below the signature box`);
    assert.ok(clear.top >= done.bottom, `${where}: Done is above Clear`);
    // Skip for now: an underlined link below Clear, 52px or more.
    assert.ok(skipLink.top >= clear.bottom, `${where}: Skip for now is below Clear`);
    assert.ok(skipLink.height >= 52, `${where}: Skip for now is 52px or more (${skipLink.height})`);
    assert.match(skipLink.underline, /underline/, `${where}: Skip for now is underlined`);
    assert.equal(result.amountLines, 1, `${where}: the amount is one line`);
    for (const button of result.buttons) {
      assert.equal(button.lines, 1, `${where}: "${button.name}" is one line`);
      assert.equal(button.clipped, false, `${where}: "${button.name}" is not clipped`);
      assert.ok(button.left >= -0.5 && button.right <= result.width + 0.5, `${where}: "${button.name}" is on screen`);
    }
  }
});
