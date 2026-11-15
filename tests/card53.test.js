import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { findButton, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

const source = readFileSync(new URL("../src/pos/ManualDebtScreens.jsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/pos/i18n.js", import.meta.url), "utf8");
const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
const planDebt = (overrides = {}) => ({
  id: "d1",
  amountPesewas: 15000,
  status: "unpaid",
  isInstallmentPlan: true,
  installmentAmount: 1000,
  frequency: "weekly",
  nextDueDate: inDays(3),
  installmentsRemaining: 15,
  totalInstallments: 68,
  installmentPaymentCarryPesewas: 400,
  ...overrides
});

async function renderCard(debt) {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const calls = [];
  const view = render({ type: ManualDebtAmount, props: {
    params: { manualDebt: true, customer: { id: "c1", name: "Ama", totalDebtPesewas: debt.amountPesewas, debt } },
    onBack() {},
    onNavigate: (...args) => calls.push(args),
    onSaveManualDebt: async () => {}
  } });
  const card = [...walk(view.tree)].find((node) => node.type === "section" && textOf(node).includes("Existing payment terms"));
  return { view, calls, card: () => [...walk(view.tree)].find((node) => node.type === "section" && textOf(node).includes("Existing payment terms")), first: card };
}
const type = (view, digits) => {
  for (const digit of digits) [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === digit).props.onClick();
  view.rerender();
};

test("53 card: no '{paid} paid' line; the contract removes it", async () => {
  assert.match(wiring.screens["53"].existing_terms_card.removed, /\{paid\} paid/);
  const { first } = await renderCard(planDebt());
  assert.ok(first, "the card shows for a plan");
  assert.doesNotMatch(textOf(first), /\bpaid ·|\d+ paid\b/);
});

test("53 card: '{n} payments left now' is computed live after adding the new amount, not read from the stored counter", async () => {
  const { view, card } = await renderCard(planDebt({ installmentsRemaining: 99 }));
  assert.match(textOf(card()), /15 payments left now/, "before typing: ceil(150.00 ÷ 10.00)");
  type(view, ["2", "5"]); // the shared keypad fills whole cedis (15 Nov 2026)
  assert.match(textOf(card()), /18 payments left now/, "after adding GH₵25.00: ceil(175.00 ÷ 10.00)");
  assert.doesNotMatch(textOf(card()), /99/);
});

test("53 card: one payment left reads '1 payment left now'", async () => {
  const { card } = await renderCard(planDebt({ amountPesewas: 1000, installmentsRemaining: 1, installmentPaymentCarryPesewas: 0 }));
  assert.match(textOf(card()), /1 payment left now/);
});

test("53 card: the button is Change, disabled until an amount is typed, and goes to 18 with the amount and note", async () => {
  const { view, calls, card } = await renderCard(planDebt());
  assert.equal(wiring.screens["53"].existing_terms_card.button.label, "Change");
  const button = () => [...walk(card())].find((node) => node.type === "button" && textOf(node) === "Change");
  assert.ok(button(), "Change");
  assert.doesNotMatch(textOf(card()), /Modify/);
  assert.equal(button().props.disabled, true);
  type(view, ["5"]); // GH₵5.00 on the shared keypad (15 Nov 2026)
  assert.equal(button().props.disabled, false);
  button().props.onClick();
  assert.equal(calls[0][0], "WhenWillTheyPay");
  assert.equal(calls[0][1].amountPesewas, 500);
});

test("53 card: a line names the debt the card describes", async () => {
  const { card } = await renderCard(planDebt());
  assert.match(textOf(card()), /Plan for the debt of GH₵150\.00/);
  const due = await renderCard({ id: "d2", amountPesewas: 4000, status: "unpaid", isInstallmentPlan: false, dueDate: inDays(5) });
  assert.match(textOf(due.card()), /Due date for the debt of GH₵40\.00/);
});

for (const [frequency, every, paid, needed] of [
  ["weekly", "every week", "Paid this week", "Still needed this week"],
  ["bi-weekly", "every 2 weeks", "Paid in these 2 weeks", "Still needed in these 2 weeks"],
  ["monthly", "every month", "Paid this month", "Still needed this month"]
]) {
  test(`53 card: ${frequency} wording follows the frequency`, async () => {
    const { card } = await renderCard(planDebt({ frequency }));
    const text = textOf(card());
    assert.match(text, new RegExp(`GH₵10\\.00 ${every}`));
    assert.match(text, new RegExp(`${paid}: GH₵4\\.00`));
    assert.match(text, new RegExp(`${needed}: GH₵6\\.00`));
  });
}

test("53 card: the progress bar shows this cycle's progress (paid toward this installment ÷ installment)", async () => {
  const { card } = await renderCard(planDebt());
  const bar = [...walk(card())].find((node) => node.props?.role === "progressbar");
  assert.ok(bar, "progress bar");
  assert.equal(bar.props["aria-valuenow"], 400);
  assert.equal(bar.props["aria-valuemax"], 1000);
});

test("53 card: all the card's words come from the translation file", () => {
  for (const words of ["every week", "every 2 weeks", "every month", "Paid this week", "Paid in these 2 weeks", "Paid this month",
    "Still needed this week", "Still needed in these 2 weeks", "Still needed this month", "payments left now", "Plan for the debt of",
    "Existing payment terms", "Change"]) {
    assert.ok(i18n.includes(words), `i18n.js has "${words}"`);
  }
  const card = source.slice(source.indexOf("(hasPlanRecord || hasDueDate) && ("), source.indexOf("<PosPrimaryButton", source.indexOf("(hasPlanRecord || hasDueDate) && (")));
  // Text nodes between tags; JSX code such as ") : hasPlanRecord ? (" is not text.
  const textNodes = [...card.matchAll(/>([^<>{}]*)</g)].map((match) => match[1].trim()).filter((text) => text && !/[?:()]/.test(text));
  assert.deepEqual(textNodes.filter((text) => /[A-Za-z]{3,}/.test(text)), [], "no English words written straight into the card markup");
  assert.doesNotMatch(card, /every \{|"2 weeks"|"month"|"week"/);
});

test("53 card: every amount on the card goes through formatGhs", () => {
  const card = source.slice(source.indexOf("(hasPlanRecord || hasDueDate) && ("), source.indexOf("<PosPrimaryButton", source.indexOf("(hasPlanRecord || hasDueDate) && (")));
  assert.doesNotMatch(card, /toFixed|GH₵/);
  assert.ok((card.match(/formatGhs\(/g) ?? []).length >= 4);
});