import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring "Key-value rows" (decided 16 Nov 2026) on 29, 43, 54, 53, 56, 68, 69 and 64, real browser at 340, 360
// and 393px: no sideways scroll; every label is one line; a value stays in the right column (a long one wraps
// there, never under the label); the plan card's progress bar sits between its rows (29, 43, 54: after Payment,
// before Paid; 53: after Due, before Paid). 56: white labels on the green card, the line white at about
// 35% opacity. The font is the machine's (Segoe UI on Windows), not a phone font.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 360, 393];
const LONG_NAME = "Nana Akosua Frimpomaa Mensah-Boateng";
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return localDateString(date); };
const quiet = async (run) => { const error = console.error; console.error = () => {}; try { return await run(); } finally { console.error = error; } };

// 29 / 43: a large bi-weekly plan, a reminder sent on an older day (the longest Last reminder value).
async function detailHtml({ late, openCorrection = false }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const debt = {
    id: "d1", customerId: "c1", customerName: LONG_NAME, amountPesewas: 1234500, status: "unpaid", isInstallmentPlan: true,
    installmentAmount: 1234500 / 5, frequency: "bi-weekly", nextDueDate: inDays(late ? -4 : 9), dueDate: "",
    // Plan card rows (21 Nov 2026): GH₵1,234.56 already paid toward this GH₵2,469.00 payment (long values).
    installmentPaymentCarryPesewas: 123456
  };
  const data = {
    name: LONG_NAME, customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 1234500, debt, unpaidDebts: [debt],
    unpaidDebtCount: 1, history: [], planPaidPesewas: 246900 * 3, lastReminderAt: new Date(2026, 9, 3, 23, 58).getTime()
  };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: LONG_NAME }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
    if (openCorrection) {
      const button = [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).trim() === "Correct balance");
      button.props.onClick();
      view.rerender();
      assert.ok(textOf(view.tree).includes("Correct balance"), "54 is open");
    }
    return toHtml(view.tree);
  } finally {
    setLiveQuery(null);
  }
}

// 53 with the Existing payment terms card: from 29 (that debt) and from 17 (the person's largest single debt).
async function card53Html(from) {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const debt = {
    id: "d1", amountPesewas: 1234500, status: "unpaid", isInstallmentPlan: true, installmentAmount: 123400, frequency: "bi-weekly",
    nextDueDate: inDays(3), installmentsRemaining: 11, totalInstallments: 11, installmentPaymentCarryPesewas: 45600
  };
  const customer = { id: "c1", name: LONG_NAME, totalDebtPesewas: from === "17" ? 2345600 : 1234500, debt };
  return toHtml(render({ type: ManualDebtAmount, props: { params: { manualDebt: true, customer, ...(from === "17" ? { amountPesewas: 0 } : {}) }, onBack() {}, onNavigate() {}, onSaveManualDebt: async () => {} } }).tree);
}

async function pages() {
  const momo = await quiet(() => loadJsx("src/pos/MoMoScreens.jsx", { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "125" }));
  const plan = await quiet(() => loadJsx("src/pos/PlanScreens.jsx", { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS: "125" }));
  const expiry = new Date(Date.now() + 12 * 86_400_000).toISOString();
  return [
    { name: "29", html: await detailHtml({ late: false }) },
    { name: "43", html: await detailHtml({ late: true }) },
    { name: "54", html: await detailHtml({ late: true, openCorrection: true }) },
    { name: "53 from 29", html: await card53Html("29") },
    { name: "53 from 17", html: await card53Html("17") },
    { name: "56", html: toHtml(render({ type: momo.MoMoPayment, props: { params: { amountPesewas: 1234500 }, onBack() {}, onNavigate() {} } }).tree) },
    { name: "68", html: toHtml(render({ type: plan.PlanPayPhone, props: { onBack() {}, onNavigate() {} } }).tree) },
    { name: "69", html: toHtml(render({ type: plan.PlanPaymentResult, props: { params: { state: "confirmed", payment: { method: "momo_paystack", status: "confirmed", createdAt: Date.now(), amountPesewas: 1500 } }, onNavigate() {} } }).tree) },
    { name: "64", html: toHtml(render({ type: plan.MyPlan, props: { expiry, onBack() {}, onNavigate() {} } }).tree) }
  ];
}

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const rows = [...doc.querySelectorAll("[data-kv-rows] [data-event-detail]")].map((row) => {
    const label = row.querySelector("dt");
    const value = row.querySelector("dd");
    const ls = win.getComputedStyle(label);
    return {
      name: row.dataset.eventDetail, label: label.textContent, value: value.textContent,
      labelLines: textLines(label), valueLines: textLines(value), labelBox: box(label), valueBox: box(value), rowBox: box(row),
      labelColor: ls.color, divider: win.getComputedStyle(row).borderTopColor, valueOverflow: value.scrollWidth > value.clientWidth + 0.5
    };
  });
  const bars = [...doc.querySelectorAll('[role="progressbar"]')].map((bar) => box(bar));
  return { pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth || doc.body.scrollWidth > win.innerWidth, rows, bars };
}`;

const EXPECTED_ROWS = {
  "29": ["last-reminder", "payment", "paid", "still-needed", "payments-left", "next-payment"],
  "43": ["last-reminder", "payment", "paid", "still-needed", "payments-left", "was-due"],
  // 54: the sheet header's Now owed row (20 Nov 2026) comes after the page's rows (the sheet is last).
  "54": ["last-reminder", "payment", "paid", "still-needed", "payments-left", "was-due", "now-owed"],
  "53 from 29": ["debt", "payment", "due", "paid", "still-needed", "payments-left", "next-payment"],
  "53 from 17": ["debt", "payment", "due", "paid", "still-needed", "payments-left", "next-payment"],
  "56": ["fee", "you-receive"],
  // 68 (20 Nov 2026): one row, You pay; the Fee row is not shown until the fee decision.
  "68": ["you-pay"],
  "69": ["plan-runs-to", "paid-by", "status"],
  "64": ["active-until", "days-left"]
};
// The bar sits after the first row named and before the second.
const BAR_BETWEEN = { "29": ["payment", "paid"], "43": ["payment", "paid"], "54": ["payment", "paid"], "53 from 29": ["due", "paid"], "53 from 17": ["due", "paid"] };

test("Key-value rows on 29, 43, 54, 53 (from 29 and 17), 56, 68, 69 and 64 at 340, 360 and 393px", { skip }, async () => {
  const all = await pages();
  const results = measureInFrames({ pages: all, css: await appCss(), widths: WIDTHS, height: 1600, measure: MEASURE });
  if (process.env.LAYOUT_DUMP) console.log(JSON.stringify(results, null, 1));
  assert.equal(results.length, all.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.deepEqual(result.rows.map((row) => row.name), EXPECTED_ROWS[result.page], `${where}: the rows`);
    for (const row of result.rows) {
      const at = `${where} / ${row.label}`;
      assert.ok(row.label.length <= 14, `${at}: a short label (rules_global.kv_labels)`);
      assert.equal(row.labelLines, 1, `${at}: the label never wraps`);
      assert.ok(row.valueBox.left >= row.labelBox.right - 0.5, `${at}: the value "${row.value}" stays right of the label`);
      assert.ok(row.valueBox.right <= row.rowBox.right + 0.5, `${at}: the value ends inside the row`);
      assert.equal(row.valueOverflow, false, `${at}: the value is not clipped`);
    }
    const between = BAR_BETWEEN[result.page];
    if (between) {
      const [before, after] = between.map((name) => result.rows.find((row) => row.name === name));
      assert.ok(result.bars.some((bar) => bar.top >= before.rowBox.bottom - 0.5 && bar.bottom <= after.rowBox.top + 0.5), `${where}: the progress bar sits between ${between.join(" and ")}`);
    }
    if (result.page === "56") {
      for (const row of result.rows) {
        assert.equal(row.labelColor, "rgb(255, 255, 255)", `${where}: white label on the green card`);
        assert.match(row.divider, /^(rgba\(255, 255, 255, 0\.35\)|oklab\(0\.999\d* 0\.0000?\d* 0\.0000?\d* \/ 0\.35\)|color\(srgb 1 1 1 \/ 0\.35\))$/, `${where}: the line is white at 35% (${row.divider})`);
      }
    }
  }
});

// Item 5: no " · " joins two facts in these screens' text (the rows replace every such line).
test("scan: no ' · ' joins two facts on 29, 43, 54, 53, 56 (green card), 68, 69 and 64", async () => {
  for (const page of await pages()) {
    let text = page.html.replace(/<[^>]+>/g, "\n");
    // 56: "Saved as MoMo · you confirmed." under the buttons is one method label (decided earlier), not two facts.
    if (page.name === "56") text = text.replace("Saved as MoMo · you confirmed.", "");
    assert.doesNotMatch(text, / · /, `${page.name}: no facts joined with " · "`);
  }
});
