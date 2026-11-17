import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { creditRow, proofPages } from "./helpers/proofPages.js";

// Wiring "What happened cards" (final, 16 Nov 2026): a credit card on 29, 43 and 73 is, top to bottom, the
// title and amount, then the Time row, the Reason row and the Signature row (the signed tag). The values
// have the same size as the card on 72 (18px) on all three screens. Real browser at 340, 360 and 393px,
// with a short and a very long reason.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const LONG = "Two bags of rice, three tins of Milo, cooking oil 5L and a crate of eggs for the shop";

const MEASURE = `(frame, win, doc) => ({
  pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
  rows: [...doc.querySelectorAll("[data-signed]")].map((tag) => {
    const row = tag.closest("li");
    const box = (el) => el.getBoundingClientRect();
    const amount = [...row.querySelectorAll("strong")].find((el) => /GH₵/.test(el.textContent));
    const when = row.querySelector("[data-when]");
    const reason = row.querySelector("[data-reason]");
    return {
      amountBottom: box(amount).bottom, whenTop: box(when).top, whenBottom: box(when).bottom, reasonTop: box(reason).top, reasonBottom: box(reason).bottom, tagTop: box(tag).top,
      whenSize: win.getComputedStyle(when).fontSize, reasonSize: win.getComputedStyle(reason).fontSize, reason: reason.textContent, rowRight: box(row).right, reasonRight: box(reason).right
    };
  })
})`;

test("credit cards on 29, 43 and 73: title and amount, Time, Reason, Signature; time and reason the same size", { skip }, async () => {
  const pages = await proofPages([creditRow("c1", 6000, "Rice", true), creditRow("c2", 123456789, LONG, false)]);
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 2400, measure: MEASURE });
  assert.equal(results.length, 9);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(result.rows.length, 2, `${where}: two credit rows`);
    for (const row of result.rows) {
      assert.ok(row.whenTop >= row.amountBottom - 0.5, `${where}: the date is below the title and amount`);
      assert.ok(row.reasonTop >= row.whenBottom - 0.5, `${where}: the reason is below the date`);
      assert.ok(row.tagTop >= row.reasonBottom - 0.5, `${where}: the tag is below the reason`);
      assert.equal(row.whenSize, row.reasonSize, `${where}: the date and the reason have the same size`);
      assert.equal(row.whenSize, "18px", `${where}: time and reason size (as on 72)`);
      assert.ok(row.reasonRight <= row.rowRight + 0.5, `${where}: "${row.reason}" wraps inside the row`);
    }
  }
});
