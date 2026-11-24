import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { findButton, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// 53 "Existing payment terms" card. Contract 53 existing_terms_card.rows_final (17 Nov 2026): label-value rows
// like the card on 72, short labels (rules_global.kv_labels): Debt, Payment (GH₵y weekly | every 2 weeks | monthly),
// Due (the tag), the progress bar, Paid, Still needed, Payments left, Next payment. Change at the bottom of the
// card, full width, 52px, the "other" look, disabled until an amount is typed.

const source = readFileSync(new URL("../src/pos/ManualDebtScreens.jsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../src/pos/i18n.js", import.meta.url), "utf8");
const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
const ddmmyyyy = (iso) => iso.split("-").reverse().join("/");
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
// [name, label + value] for each row, in order, and "bar" for the progress bar.
const rows = (card) => [...walk(card)].filter((node) => node.props?.["data-event-detail"] !== undefined || node.props?.role === "progressbar")
  .map((node) => (node.props.role === "progressbar" ? "bar" : [node.props["data-event-detail"], textOf(node)]));
const row = (card, name) => rows(card).find((entry) => entry[0] === name)?.[1];
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

test("53 card: the rows in order (Debt, Payment, Due tag, bar, Paid, Still needed, Payments left, Next payment), then Change", async () => {
  const { card } = await renderCard(planDebt());
  assert.deepEqual(rows(card()), [
    ["debt", "DebtGH₵150.00"],
    ["payment", "PaymentGH₵10.00 weekly"],
    ["due", "DueIn 3 days"],
    "bar",
    ["paid", "PaidGH₵4.00"],
    ["still-needed", "Still neededGH₵6.00"],
    ["payments-left", "Payments left15"],
    ["next-payment", `Next payment${ddmmyyyy(inDays(3))}`]
  ]);
  const nodes = [...walk(card())];
  const change = nodes.filter((node) => node.type === "button").at(-1);
  assert.equal(textOf(change), "Change", "Change is the last control of the card");
  assert.equal(change.props["data-look"], "other", "the other look");
  assert.match(change.props.className, /\bw-full\b/, "full width");
  assert.match(change.props.className, /min-h-\[52px\]/, "52px");
  assert.ok(nodes.indexOf(change) > nodes.findIndex((node) => node.props?.["data-event-detail"] === "next-payment"), "below the rows");
  assert.doesNotMatch(textOf(card()), / · |Plan for the debt of|every week|this week/);
});

test("53 card: Payments left is computed live after adding the new amount, not read from the stored counter", async () => {
  const { view, card } = await renderCard(planDebt({ installmentsRemaining: 99 }));
  assert.equal(row(card(), "payments-left"), "Payments left15", "before typing: ceil(150.00 ÷ 10.00)");
  type(view, ["2", "5"]); // the shared keypad fills whole cedis (15 Nov 2026)
  assert.equal(row(card(), "payments-left"), "Payments left18", "after adding GH₵25.00: ceil(175.00 ÷ 10.00)");
  assert.doesNotMatch(textOf(card()), /99/);
});

test("53 card: one payment left reads Payments left 1", async () => {
  const { card } = await renderCard(planDebt({ amountPesewas: 1000, installmentsRemaining: 1, installmentPaymentCarryPesewas: 0 }));
  assert.equal(row(card(), "payments-left"), "Payments left1");
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

test("53 card: the Debt row names the debt the card describes; a due date without a plan shows Debt and Due", async () => {
  const { card } = await renderCard(planDebt());
  assert.equal(row(card(), "debt"), "DebtGH₵150.00");
  const due = await renderCard({ id: "d2", amountPesewas: 4000, status: "unpaid", isInstallmentPlan: false, dueDate: inDays(5) });
  assert.deepEqual(rows(due.card()), [["debt", "DebtGH₵40.00"], ["due", `Due${ddmmyyyy(inDays(5))}`]]);
});

// rules_global.kv_labels: the period words are not in the labels; the Payment value carries the frequency.
for (const frequency of ["weekly", "bi-weekly", "monthly"]) {
  test(`53 card: ${frequency} follows the amount in the Payment row; Paid and Still needed keep short labels`, async () => {
    const { card } = await renderCard(planDebt({ frequency }));
    assert.equal(row(card(), "payment"), `PaymentGH₵10.00 ${frequency === "bi-weekly" ? "every 2 weeks" : frequency}`);
    assert.equal(row(card(), "paid"), "PaidGH₵4.00");
    assert.equal(row(card(), "still-needed"), "Still neededGH₵6.00");
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
  for (const words of ["\"Debt\"", "\"Payment\"", "\"Due\"", "\"Paid\"", "\"Still needed\"", "\"Payments left\"", "\"Next payment\"",
    "{amount} weekly", "{amount} every 2 weeks", "{amount} monthly", "Existing payment terms", "\"Change\""]) {
    assert.ok(i18n.includes(words), `i18n.js has ${words}`);
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
