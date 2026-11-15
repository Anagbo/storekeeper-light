import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { toPesewas } from "../src/lib/money.js";
import { normalizeProductInput } from "../src/db/products.js";
import { prepareAddDebt } from "../src/utils/addDebt.js";
import { db } from "../src/db/db.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Typed amounts become pesewas in ONE place: toPesewas (src/lib/money.js), which uses the integer
// parser (src/lib/parsePesewas.js). Exponent and hex text (1e2, 0x10) is refused on every screen,
// and no screen reads an amount through floating point (wiring rule_global "amount_entry").
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const REFUSED = ["1e2", "0x10", "0b11", "1_000", "Infinity", "-1", "+5", "1 000", "1.2.3", "abc"];
const inputs = (tree) => [...walk(tree)].filter((node) => node.type === "input");
const buttons = (tree, label) => [...walk(tree)].filter((node) => node.type === "button" && textOf(node).includes(label));
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ---- toPesewas itself ---------------------------------------------------------------------------------

test("toPesewas: integer math, and 1e2 / 0x10 and the like are refused", () => {
  for (const typed of REFUSED) assert.equal(toPesewas(typed), null, typed);
  assert.deepEqual(["20", "20.5", "20.05", "0.1", "0.01", "19.99", "20,05", ".5", "5."].map(toPesewas), [2000, 2050, 2005, 10, 1, 1999, 2005, 50, 500]);
  assert.equal(toPesewas("1.005"), 101, "floating point gave 100");
  assert.equal(toPesewas("1.255"), 126, "floating point gave 125");
  assert.equal(toPesewas(" 7 "), 700);
  assert.equal(toPesewas("99999999999999999999"), null);
});

test("toPesewas: numbers (prices stored as cedis) and blank text keep their meaning", () => {
  assert.equal(toPesewas(12.5), 1250);
  assert.equal(toPesewas(4.35), 435, "4.35 * 100 is 434.99999999999994 in floating point");
  assert.equal(toPesewas(0.1 + 0.2), 30);
  assert.equal(toPesewas(-1), null);
  assert.equal(toPesewas(""), 0, "blank text was 0 before and stays 0");
  assert.equal(toPesewas("   "), 0);
  assert.equal(toPesewas(null), null);
  assert.equal(toPesewas(undefined), null);
  assert.equal(toPesewas(Number.NaN), null);
});

// ---- 19: how much each time, amount paid today ---------------------------------------------------------

async function screen19(params) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  return render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {}, onSaveCredit() {} } });
}
const base19 = { amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 }, nextDueDate: "2099-03-07" };

test("19: How much each time refuses 1e2 and 0x10; Save plan stays off; a plain amount turns it on", async () => {
  for (const typed of ["1e2", "0x10"]) {
    const view = await screen19({ ...base19, installmentAmount: typed });
    assert.equal(findButton(view.tree, "Save plan").props.disabled, true, typed);
  }
  const ok = await screen19({ ...base19, installmentAmount: "12.50" });
  assert.equal(findButton(ok.tree, "Save plan").props.disabled, false);
});

test("19: Amount paid today refuses 1e2 and 0x10", async () => {
  for (const typed of ["1e2", "0x10"]) {
    const view = await screen19({ ...base19, installmentAmount: "1", startToday: true, todayPaymentAmount: typed });
    assert.equal(findButton(view.tree, "Save plan").props.disabled, true, typed);
  }
  const ok = await screen19({ ...base19, installmentAmount: "1", startToday: true, todayPaymentAmount: "5.05" });
  assert.equal(findButton(ok.tree, "Save plan").props.disabled, false);
});

// ---- 26 and 27: collecting ------------------------------------------------------------------------------

test("26: the amount to collect refuses 1e2 and 0x10 (Received stays off)", async () => {
  const { CollectPayPart } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(() => ({ id: "d1", amountPesewas: 20000, customerName: "Ama", status: "unpaid" }));
  const received = (typed) => findButton(render({ type: CollectPayPart, props: { params: { debtId: "d1", amount: typed }, onBack() {}, onNavigate() {}, onUpdateParams() {}, onRecordCollection() {} } }).tree, "Received");
  for (const typed of ["1e2", "0x10"]) assert.equal(received(typed).props.disabled, true, typed);
  assert.equal(received("100").props.disabled, false);
  setLiveQuery(null);
});

test("27: the split total from 26's typed amount, and 27 from 19, refuse 1e2 and 0x10", async () => {
  const { CollectSplitPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
  setLiveQuery(() => ({ id: "d1", amountPesewas: 20000, customerName: "Ama", status: "unpaid" }));
  for (const typed of ["1e2", "0x10"]) {
    const view = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount: typed }, onRecordCollection() {}, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
    assert.equal(buttons(view.tree, "Cash").length, 0, `27 with ${typed} shows no split editor`);
    const nineteen = render({ type: InstallmentSplitPayment, props: { params: { todayPaymentAmount: typed }, onBack() {}, onNavigate() {}, onReturnTo() {}, onUpdateParams() {} } });
    assert.equal(textOf(nineteen.tree), "", `27 from 19 with ${typed}`);
  }
  const good = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount: "100" }, onRecordCollection() {}, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
  assert.ok(buttons(good.tree, "Cash").length > 0, "27 with a plain amount shows the editor");
  assert.match(textOf(good.tree), /GH₵100\.00/);
  setLiveQuery(null);
});

// ---- 34 (new person) and 18 --------------------------------------------------------------------------------

test("34: no typed amount on the new person form (wiring 34 \"No amount field on 34\", 15 Nov 2026)", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  for (const params of [{ amountPesewas: 5000 }, { manualDebt: true, flow: "add_debt" }]) {
    const view = render({ type: CreditScreens, props: { route: "NewPerson", params, onBack() {}, onNavigate() {} } });
    assert.equal(inputs(view.tree).length, 3, JSON.stringify(params));
    assert.equal(inputs(view.tree).some((node) => node.props?.type === "number" || node.props?.inputMode === "decimal"), false, JSON.stringify(params));
  }
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const newPerson = source.slice(source.indexOf("function NewPerson"), source.indexOf("function WhenWillTheyPay"));
  assert.doesNotMatch(newPerson, /toPesewas|parseFloat|\bNumber\(/);
});

test("18: the screen takes its amounts from the sale in whole pesewas (no typed field to parse)", async () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const when = source.slice(source.indexOf("function WhenWillTheyPay"), source.indexOf("function ALittleAtATime"));
  assert.doesNotMatch(when, /toPesewas|parseFloat|\bNumber\(/);
});

// ---- Sell (15): number pad ---------------------------------------------------------------------------------

test("15: the pad builds an exact amount; 1250 on the pad is saved as 125000 pesewas", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const sales = [];
  const view = render({ type: Sell, props: { params: {}, onNavigate() {}, recordSale: async (sale) => { sales.push(sale); return { id: "t1" }; } } });
  for (const key of ["1", "2", "5", "0"]) {
    // Exact text: findButton matches by "includes", and the shared keypad has 00 after 0 (15 Nov 2026).
    [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === key).props.onClick();
    view.rerender();
  }
  assert.match(textOf(view.tree), /1,250\.00/);
  const done = buttons(view.tree, "Done").at(-1);
  assert.equal(done.props.disabled, false);
  await done.props.onClick();
  // GH₵1,250.00 is above the GH₵1,000.00 large-amount limit (brief 3.12): Yes, save continues the save.
  view.rerender();
  await buttons(view.tree, "Yes, save").at(-1).props.onClick();
  await settle();
  assert.equal(sales.at(-1)?.amountPesewas ?? sales.at(-1)?.total_amount, 125000);
});

// ---- suppliers ---------------------------------------------------------------------------------------------

test("suppliers: Spent money refuses 1e2 and 0x10 (Save stays off)", async () => {
  const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
  const saveOff = (typed) => {
    const view = render({ type: SpentMoney, props: { onBack() {}, onNavigate() {}, onSave: async () => {} } });
    inputs(view.tree)[0].props.onChange({ target: { value: typed } });
    view.rerender();
    return buttons(view.tree, "Save").at(-1).props.disabled;
  };
  for (const typed of ["1e2", "0x10"]) assert.equal(saveOff(typed), true, typed);
  assert.equal(saveOff("12.50"), false);
});

test("suppliers: the amount already paid on stock bought on credit refuses 1e2 and 0x10 (Save stays off)", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => []);
  const saveOff = (typed) => {
    const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 50000, category: "stock" }, onBack() {}, onSaveExpense: async () => {} } });
    inputs(view.tree).find((node) => node.props?.type === "text").props.onChange({ target: { value: typed } });
    view.rerender();
    return buttons(view.tree, "Save").at(-1).props.disabled;
  };
  for (const typed of ["1e2", "0x10"]) assert.equal(saveOff(typed), true, typed);
  assert.equal(saveOff("100"), false, "a plain amount that is the whole total");
  setLiveQuery(null);
});

test("suppliers: paying a supplier refuses 1e2 and 0x10 (Pay stays off)", async () => {
  const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => [{ id: "s1", name: "Kofi", balancePesewas: 50000, dueStatus: "none" }]);
  const payOff = (typed) => {
    const view = render({ type: YouOweSuppliers, props: { onBack() {}, onPay: async () => {} } });
    buttons(view.tree, "Pay").at(0).props.onClick();
    view.rerender();
    inputs(view.tree).at(-1).props.onChange({ target: { value: typed } });
    view.rerender();
    return buttons(view.tree, "Record payment").at(-1).props.disabled;
  };
  for (const typed of ["1e2", "0x10"]) assert.equal(payOff(typed), true, typed);
  assert.equal(payOff("100"), false);
  setLiveQuery(null);
});

// ---- setup (items) ---------------------------------------------------------------------------------------------

test("setup: an item price refuses 1e2 and 0x10; stored cedis prices read exactly", () => {
  for (const typed of ["1e2", "0x10"]) assert.throws(() => normalizeProductInput({ name: "Rice", price: typed }), /valid item price/, typed);
  assert.equal(normalizeProductInput({ name: "Rice", price: "12.5" }).default_price, 12.5);
  assert.equal(normalizeProductInput({ name: "Rice", price: "4.35" }).default_price, 4.35);
  assert.equal(toPesewas(normalizeProductInput({ name: "Rice", price: "4.35" }).default_price), 435);
});

// ---- legacy add-debt helper ---------------------------------------------------------------------------------

test("legacy add-debt: the amount and the amount each time refuse 1e2 and 0x10", () => {
  const base = { customerName: "Ama", ghanaCardNumber: "" };
  for (const typed of ["1e2", "0x10"]) {
    assert.throws(() => prepareAddDebt({ ...base, amount: typed }), /debt amount/i, typed);
    assert.throws(() => prepareAddDebt({ ...base, amount: "100", isInstallmentPlan: true, installmentAmount: typed }), undefined, typed);
  }
  assert.equal(prepareAddDebt({ ...base, amount: "12.50" }).amountPesewas, 1250);
});

// ---- nothing in src converts a typed amount any other way ------------------------------------------------------------

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

// Every Number( in src that is not the parser, with the reason it is not a typed amount.
const NUMBER_ALLOWED = [
  ["config/plans.js", "Number(raw)", "price from the build environment, checked as digits first"],
  ["db/debts.js", "Number(right.id === debtResult.id)", "a boolean in a sort"],
  ["lib/formatDate.js", "Number(match[", "digits of an ISO date"],
  ["lib/formatGhs.js", "Number(pesewas)", "shows whole pesewas, nothing is parsed"],
  ["lib/subscriptionTrial.js", "Number(value)", "trial length from the build environment"],
  ["pos/DebtCollection.jsx", "Number(timestamp)", "a timestamp"],
  ["pos/DebtCollection.jsx", "Number(debt.lastReminderAt)", "a timestamp"],
  ["pos/momoConfig.js", "Number(text)", "fee from the build environment, checked as digits first"],
  ["pos/planPayments.js", "Number(payment.createdAt)", "a timestamp"],
  ["pos/receiptTemplates.js", "Number(year)", "digits of an ISO date"],
  ["pos/reminderLabel.js", "Number(lastReminderAt)", "a timestamp"]
];
// Every "* 100" in src that is not the parser: percentages.
const TIMES_100_ALLOWED = [
  ["pos/DebtCollection.jsx", "planProgress.progress * 100", "a percentage"],
  ["pos/ManualDebtScreens.jsx", "debt.installmentAmount) * 100", "a percentage"]
];

test("no file in src converts a typed amount with parseFloat, parseInt, Number or * 100 (only reviewed non-amount uses remain)", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const problems = [];
  for (const path of sourceFiles(root)) {
    const name = path.slice(root.length + 1).replaceAll("\\", "/");
    if (name === "lib/parsePesewas.js") continue;
    readFileSync(path, "utf8").split(/\r?\n/).forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      const where = `${name}:${index + 1}: ${code.trim().slice(0, 100)}`;
      if (/\bparseFloat\s*\(|\bparseInt\s*\(|Number\.parse(Float|Int)/.test(code)) problems.push(where);
      if (/(?<![\w.])Number\s*\(/.test(code) && !NUMBER_ALLOWED.some(([file, text]) => name === file && code.includes(text))) problems.push(where);
      if (/\*\s*100\b|\b100\s*\*/.test(code) && !TIMES_100_ALLOWED.some(([file, text]) => name === file && code.includes(text))) problems.push(where);
    });
  }
  assert.deepEqual(problems, []);
});

test("the parser file is the only place that turns amount text into numbers, and toPesewas calls it", () => {
  const money = readFileSync(new URL("../src/lib/money.js", import.meta.url), "utf8");
  assert.match(money, /parseAmountToPesewas/);
  assert.doesNotMatch(money, /Math\.round|Number\(/);
});
