import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { correctionRow, creditRow, paidRow, recordHtml } from "./helpers/proofPages.js";

// Wiring 73 notice (changed 16 Nov 2026): one plain line right under the "You owe" card, 16px grey,
// "Nothing can be changed here." Not at the bottom, where a long history would push it off screen. No
// "Read only" and no "Please hand the phone back" text anywhere. Back to shop stays.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const root = fileURLToPath(new URL("..", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(jsx?|css)$/.test(name) ? [path] : [];
  });
}

test("the old caption is gone from src/pos (wiring.json, the contract, is not scanned)", () => {
  const hits = [];
  for (const path of files(join(root, "src/pos"))) {
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      if (/read only|hand the phone back|record\.caption/i.test(line)) hits.push(`${relative(root, path)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

// A long history: 40 rows of every kind.
const LONG_HISTORY = Array.from({ length: 40 }, (_, index) => (
  index % 3 === 0 ? creditRow(`c${index}`, 6000 + index, "Two bags of rice and a tin of Milo", index % 2 === 0)
    : index % 3 === 1 ? paidRow(`p${index}`, 1000 + index)
      : correctionRow(`a${index}`, 20000 + index, 15000)
));

const MEASURE = `(frame, win, doc) => {
  const notice = doc.querySelector("[data-record-notice]");
  const card = [...doc.querySelectorAll("section")].find((el) => /You owe/.test(el.textContent));
  const heading = doc.querySelector("h2");
  const r = notice.getBoundingClientRect();
  const s = win.getComputedStyle(notice);
  const lines = (() => { const range = doc.createRange(); range.selectNodeContents(notice); return new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; })();
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    text: notice.textContent, size: s.fontSize, color: s.color, weight: s.fontWeight, lines,
    top: r.top, bottom: r.bottom, cardBottom: card.getBoundingClientRect().bottom, headingTop: heading.getBoundingClientRect().top,
    viewport: win.innerHeight, pageHeight: doc.scrollingElement.scrollHeight,
    bodyText: doc.body.textContent, backToShop: [...doc.querySelectorAll("button")].some((el) => el.textContent.trim() === "Back to shop")
  };
}`;

test("73 at 340, 360 and 393px with a long history: the notice is right under You owe and in view without scrolling", { skip }, async () => {
  const html = await recordHtml({ rows: LONG_HISTORY, name: "Nana Akosua Frimpomaa Boatemaa", balancePesewas: 123456789 });
  // Phone-height frames (640px, a small phone), so the long history is far taller than the screen.
  const results = measureInFrames({ pages: [{ name: "73", html }], css: await appCss(), widths: [340, 360, 393], height: 640, measure: MEASURE });
  assert.equal(results.length, 3);
  for (const result of results) {
    const where = `73 at ${result.width}px`;
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.ok(result.pageHeight > result.viewport * 3, `${where}: the history is long (${result.pageHeight}px page in a ${result.viewport}px screen)`);
    assert.equal(result.text, "Nothing can be changed here.");
    assert.equal(result.size, "16px", `${where}: 16px`);
    assert.equal(result.weight, "400", `${where}: plain weight`);
    assert.equal(result.color, "oklch(0.446 0.043 257.281)", `${where}: grey (slate-600)`);
    assert.equal(result.lines, 1, `${where}: one line`);
    assert.ok(result.top >= result.cardBottom - 0.5 && result.top - result.cardBottom < 20, `${where}: right under the You owe card`);
    assert.ok(result.bottom <= result.headingTop + 0.5, `${where}: above What happened`);
    assert.ok(result.bottom <= result.viewport, `${where}: in view without scrolling (bottom ${result.bottom} of ${result.viewport})`);
    assert.doesNotMatch(result.bodyText, /read only|hand the phone back/i, `${where}: no old caption`);
    assert.ok(result.backToShop, `${where}: Back to shop stays`);
  }
});
