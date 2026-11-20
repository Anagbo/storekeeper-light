import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordExpense } from "../src/db/suppliers.js";
import { getFinancialTransactions, summarizeFinancialTransactionsSafely } from "../src/lib/money.js";
import { getMoneyPeriodRange } from "../src/pos/money.js";
import { splitPartRows } from "../src/pos/splitTender.js";
import { createPosTransactionRows } from "../src/pos/transactionFeed.js";
import { localDateString } from "../src/utils/installments.js";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { SEEDS } from "./helpers/lookChecks.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Chunk B, item 5, real browser at 340, 360 and 393px: 16 (status rows: an Owe plan row, an Owe due-date row,
// a MoMo row, a long name), 30 (the owe row; buttons stacked, flag on and off, offline line; fits without
// scrolling at 360x740), 39 (empty and with items) and 24 (calmer colours). No sideways scroll; labels never
// wrap; a long value wraps inside the right column only. Plus the scan: no " · " joins two facts on these
// screens. The font is the machine's (Segoe UI on Windows), not a phone font.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 360, 393];
const LONG_NAME = "Nana Akosua Frimpomaa Mensah-Boateng";
const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return localDateString(date); };
after(async () => { db.close(); await db.delete(); });

async function splitHtml(parts, params) {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  const total = parts.reduce((sum, part) => sum + part.amountPesewas, 0);
  return toHtml(render({ type: SplitPayment, props: {
    totalPesewas: total, totalLabel: "Sale total", allowOwe: true, doneLabel: "Done", initialParts: parts,
    onBack() {}, onDone() {}, onOwe() {}, onMoMo() {}, partRows: (part) => splitPartRows(part, params)
  } }).tree);
}

async function saleHtml(env, extra = {}) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", env);
  const transaction = {
    id: "s1", amountPesewas: 1534500, total_amount: 1534500, payment_method: "split", cashReceivedPesewas: 200000, momoReceivedPesewas: 100000,
    paymentType: "credit", customer_name: LONG_NAME, customerName: LONG_NAME, creditExtendedPesewas: 1234500, momoVerification: "merchant_confirmed",
    items_json: JSON.stringify([{ name: "Rice 50kg bag", quantity: 1, total_amount: 1534500 }]), timestamp: Date.now(), ...extra
  };
  return toHtml(render({ type: SaleRecorded, props: { transaction, creditResult: { previousDebtPesewas: 100, totalDebtPesewas: 1234600 }, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
}

async function itemsHtml(products) {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products, error: "" }));
  try {
    return toHtml(render({ type: ItemScreens, props: { route: "MyItems", params: {}, onBack() {}, onNavigate() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

async function todayHtml() {
  await recordCashSale({ amountPesewas: 1234500, cashReceivedPesewas: 1234500, momoReceivedPesewas: 0, parts: [{ paymentMethod: "cash", amountPesewas: 1234500 }], saleItems: [] });
  await recordCreditSale({ amountPesewas: 1234500, name: LONG_NAME, note: "Sale" });
  await recordCreditSale({ amountPesewas: 1000, name: "ama", initialPaymentPesewas: 300, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 300 }], paymentMethod: "cash", note: "Sale" });
  const ama = (await db.debts.toArray()).find((debt) => /ama/i.test(debt.customerName ?? debt.customer_name ?? ""));
  await recordDebtCollection({ debtId: ama.id, parts: [{ paymentMethod: "cash", amountPesewas: 200 }] });
  await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 1234500, category: "transport", note: "" });
  const transactions = await getFinancialTransactions(getMoneyPeriodRange("day"));
  const rows = createPosTransactionRows(transactions, new Map());
  const totals = summarizeFinancialTransactionsSafely(transactions).totals;
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals }));
  try {
    return toHtml(render({ type: TodaysTransactions, props: { onBack() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

const PLAN = { isInstallmentPlan: true, installmentAmount: 123400, frequency: "bi-weekly", nextDueDate: inDays(14) };
async function pages() {
  return [
    { name: "16 plan", html: await splitHtml(
      [{ paymentMethod: "cash", amountPesewas: 200000 }, { paymentMethod: "momo", amountPesewas: 100000, momoMethod: "direct" }, { paymentMethod: "owe", amountPesewas: 1234500 }],
      { customer: { name: LONG_NAME }, installmentPlan: PLAN, firstPaymentDate: inDays(14) }) },
    { name: "16 due", html: await splitHtml(
      [{ paymentMethod: "momo", amountPesewas: 100000, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: 100000 }, { paymentMethod: "owe", amountPesewas: 1234500 }],
      { customer: { name: LONG_NAME }, dueDate: inDays(7) }) },
    { name: "16 person only", html: await splitHtml([{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "owe", amountPesewas: 300 }], { customer: { name: LONG_NAME }, dueDate: inDays(0) }) },
    { name: "30 flag on", html: await saleHtml({ VITE_ENABLE_POS_RECEIPTS: "true" }) },
    { name: "30 flag off", html: await saleHtml({}) },
    { name: "39 empty", html: await itemsHtml([]) },
    { name: "39 items", html: await itemsHtml([{ id: 1, name: "Bread", default_price: 5 }, { id: 2, name: "Cooking oil 5 litre gallon, Frytol", default_price: 12345 }]) },
    { name: "24", html: await todayHtml() }
  ];
}

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
  const rows = [...doc.querySelectorAll("[data-kv-rows] [data-event-detail]")].map((row) => {
    const label = row.querySelector("dt");
    const value = row.querySelector("dd");
    return { name: row.dataset.eventDetail, label: label.textContent, value: value.textContent, labelLines: textLines(label), labelBox: box(label), valueBox: box(value), rowBox: box(row), fontSize: win.getComputedStyle(row.parentElement).fontSize, valueOverflow: value.scrollWidth > value.clientWidth + 0.5 };
  });
  const chipLines = [...doc.querySelectorAll("[data-split-row]")].map((row) => { const line = row.querySelector("[data-row-line]"); return { method: row.dataset.splitRow, line: box(line), row: box(row), lineOverflow: line.scrollWidth > line.clientWidth + 0.5 }; });
  const buttons = [...doc.querySelectorAll("button")].map((b) => ({ text: b.textContent.replace(/\\s+/g, " ").trim(), lines: textLines(b), box: box(b), overflow: b.scrollWidth > b.clientWidth + 0.5 }));
  const owe = doc.querySelector("[data-owe-row]");
  const oweRow = owe && { label: owe.querySelector("[data-owe-label]").textContent, labelLines: textLines(owe.querySelector("[data-owe-label]")), labelBox: box(owe.querySelector("[data-owe-label]")), sub: box(owe.querySelector("[data-owe-sub]")), amount: box(owe.querySelector("[data-owe-amount]")), row: box(owe), subFont: win.getComputedStyle(owe.querySelector("[data-owe-sub]")).fontSize };
  const hint = doc.querySelector("[data-empty-hint]");
  const input = doc.querySelector("input");
  const tiles = ["spent", "given-on-credit"].map((name) => { const el = doc.querySelector('[data-summary="' + name + '"]'); if (!el) return null; const cs = win.getComputedStyle(el); const amount = [...el.querySelectorAll("p")].at(-1); return { name, bg: cs.backgroundColor, left: cs.borderLeftWidth, top: cs.borderTopWidth, amountFont: win.getComputedStyle(amount).fontSize, labelLines: textLines(el.querySelector("p")), amountOverflow: amount.scrollWidth > amount.clientWidth + 0.5 || box(amount).right > box(el).right + 0.5 }; }).filter(Boolean);
  const chips = [...doc.querySelectorAll("[data-chip]")].map((chip) => ({ box: box(chip), card: box(chip.closest("article")) }));
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth || doc.body.scrollWidth > win.innerWidth,
    rows, chipLines, buttons, oweRow, tiles, chips,
    hint: hint && { box: box(hint), lines: textLines(hint), font: win.getComputedStyle(hint).fontSize, inputTop: box(input).top }
  };
}`;

const EXPECTED_ROWS = {
  "16 plan": ["status", "person", "payment", "first-payment"],
  "16 due": ["status", "person", "due"],
  "16 person only": ["person"]
};

test("chunk B screens at 340, 360 and 393px: 16 status rows, 30 owe row and buttons, 39, 24", { skip, timeout: 300_000 }, async () => {
  const all = await pages();
  const results = measureInFrames({ pages: all, css: await appCss(), widths: WIDTHS, height: 1800, measure: MEASURE });
  if (process.env.LAYOUT_DUMP) console.log(JSON.stringify(results, null, 1));
  assert.equal(results.length, all.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    if (EXPECTED_ROWS[result.page]) {
      assert.deepEqual(result.rows.map((row) => row.name), EXPECTED_ROWS[result.page], `${where}: the rows`);
      for (const row of result.rows) {
        const at = `${where} / ${row.label}`;
        assert.equal(row.fontSize, "16px", `${at}: 16px rows`);
        assert.ok(row.label.length <= 14, `${at}: a short label`);
        assert.equal(row.labelLines, 1, `${at}: the label never wraps`);
        assert.ok(row.valueBox.left >= row.labelBox.right - 0.5, `${at}: "${row.value}" stays right of the label`);
        assert.ok(row.valueBox.right <= row.rowBox.right + 0.5, `${at}: the value ends inside the row`);
        assert.equal(row.valueOverflow, false, `${at}: the value is not clipped`);
      }
      for (const chip of result.chipLines) {
        assert.equal(chip.lineOverflow, false, `${where} / ${chip.method}: the chip line is not clipped`);
        assert.ok(chip.line.right <= chip.row.right + 0.5, `${where} / ${chip.method}: the chip and x stay in the row`);
      }
    }
    if (result.page.startsWith("30")) {
      const names = result.buttons.map((button) => button.text);
      assert.deepEqual(names, result.page === "30 flag on" ? ["Send receipt", "Copy receipt", "Done", "New sale"] : ["Done", "New sale"], `${where}: the buttons`);
      const widest = Math.max(...result.buttons.map((button) => button.box.width));
      for (const button of result.buttons) {
        assert.equal(button.lines, 1, `${where} / ${button.text}: one line`);
        assert.equal(button.overflow, false, `${where} / ${button.text}: not clipped`);
        assert.ok(Math.abs(button.box.width - widest) < 0.5, `${where} / ${button.text}: full width`);
      }
      for (let index = 1; index < result.buttons.length; index += 1) {
        assert.ok(result.buttons[index].box.top >= result.buttons[index - 1].box.bottom - 0.5, `${where}: ${names[index]} is under ${names[index - 1]}`);
      }
      const owe = result.oweRow;
      assert.equal(owe.label, "Nana Akosu… owes", `${where}: the name is cut at 10 characters`);
      assert.equal(owe.labelLines, 1, `${where}: the owe label is one line`);
      assert.equal(owe.subFont, "14px", `${where}: "from this sale" is 14px`);
      assert.ok(owe.sub.top >= owe.labelBox.bottom - 0.5, `${where}: "from this sale" is under the label`);
      assert.ok(owe.amount.left >= owe.labelBox.right && owe.amount.right <= owe.row.right + 0.5, `${where}: the amount is on the right`);
      const middle = (owe.labelBox.top + owe.sub.bottom) / 2;
      assert.ok(Math.abs((owe.amount.top + owe.amount.bottom) / 2 - middle) < 2, `${where}: the amount is centred against the two lines`);
    }
    if (result.page === "39 empty") {
      assert.ok(result.hint, `${where}: the hint`);
      assert.equal(result.hint.font, "17px");
      assert.ok(result.hint.box.bottom <= result.hint.inputTop, `${where}: the hint is above Find item`);
      const add = result.buttons.filter((button) => /New item|starter list/.test(button.text));
      assert.equal(add.length, 2);
      assert.ok(add[1].box.top - add[0].box.bottom < 16, `${where}: the two add buttons sit together`);
      for (const button of add) assert.equal(button.lines, 1, `${where} / ${button.text}: one line`);
    }
    if (result.page === "39 items") {
      assert.equal(result.hint, null, `${where}: no hint with items`);
      const last = result.buttons.at(-1);
      assert.match(last.text, /Add from starter list$/, `${where}: the starter list button is last`);
    }
    if (result.page === "24") {
      for (const tile of result.tiles) {
        assert.equal(tile.bg, "rgb(255, 255, 255)", `${where} / ${tile.name}: white card`);
        assert.equal(tile.left, "6px", `${where} / ${tile.name}: 6px left edge`);
        assert.equal(tile.top, "2px", `${where} / ${tile.name}: 2px border`);
        assert.equal(tile.amountOverflow, false, `${where} / ${tile.name}: GH₵12,345.00 is not clipped`);
        assert.ok(parseFloat(tile.amountFont) <= 22 && parseFloat(tile.amountFont) >= 17, `${where} / ${tile.name}: the amount is 22px at most (${tile.amountFont})`);
        assert.equal(tile.labelLines, 1, `${where} / ${tile.name}: the label is one line`);
      }
      for (const chip of result.chips) assert.ok(chip.box.right <= chip.card.right + 0.5, `${where}: a chip stays inside its card`);
    }
  }
});

// 30 in the real app (header, no bottom bar on 30): a cash sale with the receipts flag on (online and offline,
// where the offline line shows) and off. Every button on one line, no sideways scroll. "Fits without scrolling"
// at 360x740: New sale, the last control, ends inside the screen before any scroll. (The page area always keeps
// the shell's 112px bottom padding, so the area itself can scroll into that empty space; that is not counted.)
async function visit30(env, offline, width, height) {
  let result = null;
  await withEdgeApp({ seeds: SEEDS, env }, async (app) => {
    await app.open("base", width, height);
    await app.send("Network.enable");
    await app.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await app.steps(["^Sell$", "^5$", "^Done"]);
    await app.shows("New sale$");
    await sleep(300);
    const m = await app.measure();
    const extra = await app.evaluate(`(() => ({ offline: !!document.querySelector("[data-receipt-offline]"), scrollTop: document.querySelector("[data-page-area]").scrollTop }))()`);
    await app.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    result = { m, ...extra };
  });
  return result;
}

const CASES_30 = [["on online", { VITE_ENABLE_POS_RECEIPTS: "true" }, false], ["on offline", { VITE_ENABLE_POS_RECEIPTS: "true" }, true], ["off", {}, false]];

test("30 in the real app at 340, 360 and 393px wide: stacked buttons on one line, no sideways scroll", { skip, timeout: 600_000 }, async () => {
  for (const [name, env, offline] of CASES_30) {
    for (const width of WIDTHS) {
      const label = `30 flag ${name} ${width}x740`;
      const { m, offline: lineShown } = await visit30(env, offline, width, 740);
      assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll`);
      const main = m.controls.filter((c) => ["Send receipt", "Copy receipt", "Done", "New sale"].includes(c.text));
      assert.deepEqual(main.map((c) => c.text), name === "off" ? ["Done", "New sale"] : ["Send receipt", "Copy receipt", "Done", "New sale"], `${label}: the buttons in order`);
      for (const c of main) assert.equal(c.lines, 1, `${label}: ${c.text} on one line`);
      assert.equal(lineShown, offline, `${label}: the offline line only offline`);
    }
  }
});

test("30 fits without scrolling at 360x740 (receipts on online, receipts off)", { skip, timeout: 300_000 }, async () => {
  for (const [name, env, offline] of CASES_30.filter(([name]) => name !== "on offline")) {
    const { m, scrollTop } = await visit30(env, offline, 360, 740);
    const newSale = m.controls.find((c) => c.text === "New sale");
    assert.equal(scrollTop, 0);
    assert.ok(newSale.bottom <= m.innerHeight + 0.5, `30 flag ${name} 360x740: New sale ends at ${newSale.bottom} of ${m.innerHeight}`);
  }
});

// Reported to the owner (20 Nov 2026), not fixed: with the receipts flag on AND offline, the offline line adds
// 48px and New sale ends 9px below the screen at 360x740 (749 of 740). Making it fit needs a change outside this
// item (a smaller check circle at the top, a lower New sale, or less shell padding).
test("30 fits without scrolling at 360x740, receipts on and offline", { skip, todo: "New sale ends 9px below the screen (reported)", timeout: 300_000 }, async () => {
  const { m } = await visit30(CASES_30[1][1], true, 360, 740);
  const newSale = m.controls.find((c) => c.text === "New sale");
  assert.ok(newSale.bottom <= m.innerHeight + 0.5, `New sale ends at ${newSale.bottom} of ${m.innerHeight}`);
});

// Item 5: no " · " joins two facts in these screens' text. Named exceptions: 30's "Today · {time}" under the
// amount and the "MoMo · you confirmed" method label (one label, as on 56); 24's "Today · dd/mm/yyyy" under the
// title (its own wiring rule). None of them is a line these items replace.
test("scan: no ' · ' joins two facts on 16, 30, 39 and 24", async () => {
  for (const page of await pages()) {
    let text = page.html.replace(/<[^>]+>/g, "\n");
    text = text.replace(/Today · \d{2}:\d{2}/, "").replace("MoMo · you confirmed", "").replace(/Today · \d{2}\/\d{2}\/\d{4}/, "");
    assert.doesNotMatch(text, / · /, `${page.name}: no facts joined with " · "`);
  }
});
