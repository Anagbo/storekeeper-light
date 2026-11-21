import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render } from "./helpers/renderJsx.js";

// Wiring 30 (decided 21 Nov 2026), chunk H item 4h (b): when the customer had an earlier balance, a
// key-value row "Total owed" (label left, bold amount right, the card's dashed divider above it) sits under
// "{Name} owes … from this sale". No row without an earlier balance. Real browser at 340, 360 and 393px:
// no sideways scroll, the label on one line, the amount on the right inside the row, the row under the owe
// row, and no " · " joining two facts. The font is the machine's (Segoe UI on Windows), not a phone font.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 360, 393];
const LONG_NAME = "Nana Akosua Frimpomaa Mensah-Boateng";

async function saleHtml(env, creditResult, extra = {}) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", env);
  const transaction = {
    id: "s1", amountPesewas: 1534500, total_amount: 1534500, payment_method: "split", cashReceivedPesewas: 200000, momoReceivedPesewas: 100000,
    paymentType: "credit", customer_name: LONG_NAME, customerName: LONG_NAME, creditExtendedPesewas: 1234500, momoVerification: "merchant_confirmed",
    items_json: JSON.stringify([{ name: "Rice 50kg bag", quantity: 1, total_amount: 1534500 }]), timestamp: Date.now(), ...extra
  };
  return toHtml(render({ type: SaleRecorded, props: { transaction, creditResult, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
}

const pages = async () => [
  // A large earlier balance: GH₵12,345.00 from this sale, GH₵99,999.99 in total.
  { name: "30 earlier balance, flag on", html: await saleHtml({ VITE_ENABLE_POS_RECEIPTS: "true" }, { previousDebtPesewas: 8765499, totalDebtPesewas: 9999999 }) },
  { name: "30 earlier balance, flag off", html: await saleHtml({}, { previousDebtPesewas: 8765499, totalDebtPesewas: 9999999 }) },
  { name: "30 no earlier balance", html: await saleHtml({}, { previousDebtPesewas: 0, totalDebtPesewas: 1234500 }) }
];

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
  const total = doc.querySelector("[data-total-owed]");
  const owe = doc.querySelector("[data-owe-row]");
  const label = total && total.querySelector("span");
  const amount = total && total.querySelector("[data-total-owed-amount]");
  const cashRow = [...doc.querySelectorAll("span")].find((el) => el.textContent === "Cash")?.parentElement;
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth || doc.body.scrollWidth > win.innerWidth,
    total: total && {
      row: box(total), label: label.textContent, labelLines: textLines(label), labelBox: box(label),
      amount: amount.textContent, amountBox: box(amount), amountLines: textLines(amount), amountWeight: win.getComputedStyle(amount).fontWeight,
      amountOverflow: amount.scrollWidth > amount.clientWidth + 0.5, font: win.getComputedStyle(total).fontSize,
      borderTop: win.getComputedStyle(total).borderTopStyle + " " + win.getComputedStyle(total).borderTopWidth
    },
    owe: owe && box(owe),
    cashFont: cashRow && win.getComputedStyle(cashRow).fontSize,
    text: doc.body.innerText
  };
}`;

test("30 Total owed row at 340, 360 and 393px: one-line label, bold amount right, under the owe row", { skip, timeout: 300_000 }, async () => {
  const all = await pages();
  const results = measureInFrames({ pages: all, css: await appCss(), widths: WIDTHS, height: 1800, measure: MEASURE });
  if (process.env.LAYOUT_DUMP) console.log(JSON.stringify(results.map(({ text, ...rest }) => rest), null, 1));
  assert.equal(results.length, all.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    if (result.page === "30 no earlier balance") {
      assert.equal(result.total, null, `${where}: no Total owed row`);
      continue;
    }
    const { total, owe } = result;
    assert.ok(total, `${where}: the Total owed row`);
    assert.equal(total.label, "Total owed");
    assert.equal(total.labelLines, 1, `${where}: the label is one line`);
    assert.equal(total.amount, "GH₵99,999.99");
    assert.equal(total.amountLines, 1, `${where}: the amount is one line`);
    assert.ok(Number(total.amountWeight) >= 700, `${where}: the amount is bold`);
    assert.equal(total.amountOverflow, false, `${where}: the amount is not clipped`);
    assert.ok(total.amountBox.left >= total.labelBox.right, `${where}: the amount is right of the label`);
    assert.ok(Math.abs(total.amountBox.right - total.row.right) < 0.5, `${where}: the amount ends at the row's right edge`);
    assert.ok(total.row.top >= owe.bottom - 0.5, `${where}: under the owe row`);
    assert.equal(total.font, result.cashFont, `${where}: the same text size as the other rows of the card (${total.font})`);
    assert.equal(total.borderTop, "dashed 2px", `${where}: the card's dashed divider above it`);
  }
});

// Item 5: no " · " joins two facts on 30. Named exceptions as in tests/kvRowsChunkB.test.js: "Today · {time}"
// under the amount and the "MoMo · you confirmed" method label.
test("scan: no ' · ' joins two facts on 30 with and without the Total owed row", async () => {
  for (const page of await pages()) {
    let text = page.html.replace(/<[^>]+>/g, "\n");
    text = text.replace(/Today · \d{2}:\d{2}/, "").replace("MoMo · you confirmed", "");
    assert.doesNotMatch(text, / · /, `${page.name}: no facts joined with " · "`);
  }
});
