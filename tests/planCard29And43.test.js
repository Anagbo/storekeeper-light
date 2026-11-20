import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29, 43 and 54, plan card ("Key-value rows", decided 16 Nov 2026; replaces the two lines of 12 Nov):
// rows "Payment" (GH₵x weekly | bi-weekly | monthly), then the progress bar, then "Paid so far" ("1 of 3") and
// "Next payment" (dd/mm/yyyy) on 29, or "Was due" on a late debt (43, and 54 over it). The "In n days" tag
// stays on the card header and follows the shared DueTag colours (grey more than 3 days, amber 3 days or less
// or today, red late).

const dateOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};

function debtorData(debtOverrides, planPaidPesewas) {
  const debt = {
    id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid",
    isInstallmentPlan: true, installmentAmount: 2000, frequency: "weekly", dueDate: "", ...debtOverrides
  };
  return { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [], planPaidPesewas };
}

async function detail(debtOverrides = {}, planPaidPesewas = 14200) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const data = debtorData(debtOverrides, planPaidPesewas);
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  setLiveQuery(null);
  return view;
}
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const cls = (node) => String(node.props.className ?? "").split(/\s+/);
const planCard = (tree) => nodes(tree).find((node) => node.type === "section" && textOf(node).startsWith("A little at a time"));
const tagOf = (card) => nodes(card).find((node) => typeof node.type === "function" && node.type.name === "PosStatusTag");

const rowsIn = (card) => nodes(card).filter((node) => node.props["data-event-detail"] !== undefined || node.props.role === "progressbar")
  .map((node) => (node.props.role === "progressbar" ? "bar" : [node.props["data-event-detail"], textOf(node)]));

test("plan card on 29: Payment, the bar, Paid so far and Next payment as label-value rows", async () => {
  const view = await detail({ nextDueDate: "2099-11-18" });
  const card = planCard(view.tree);
  assert.ok(card, "plan card");
  // GH₵142.00 paid of GH₵20.00 payments: 7 made; GH₵80.00 left: 4 more. 7 of 11.
  assert.deepEqual(rowsIn(card), [
    ["payment", "PaymentGH₵20.00 weekly"],
    "bar",
    ["paid-so-far", "Paid so far7 of 11"],
    ["next-payment", "Next payment18/11/2099"]
  ]);
  for (const row of nodes(card).filter((node) => node.props["data-event-detail"] !== undefined)) {
    const [label] = [...walk(row)].filter((node) => node.type === "dt");
    assert.ok(cls(label).includes("whitespace-nowrap"), "the label never wraps");
  }
  assert.doesNotMatch(textOf(card), / · /, "no facts joined with a dot");
});

test("plan card on 43 (late): Was due instead of Next payment; bi-weekly and monthly words", async () => {
  const late = planCard((await detail({ nextDueDate: dateOffset(-2) })).tree);
  assert.deepEqual(rowsIn(late).at(-1), ["was-due", `Was due${dateOffset(-2).split("-").reverse().join("/")}`]);
  for (const [frequency, word] of [["bi-weekly", "bi-weekly"], ["monthly", "monthly"]]) {
    const card = planCard((await detail({ nextDueDate: "2099-11-18", frequency })).tree);
    assert.deepEqual(rowsIn(card)[0], ["payment", `PaymentGH₵20.00 ${word}`]);
  }
});

test("plan card header: the In n days tag follows the shared DueTag colours", async () => {
  const cases = [
    [5, "neutral", "In 5 days"],
    [3, "amber", "In 3 days"],
    [0, "amber", "Due today"],
    [-2, "red", "Late 2 days"]
  ];
  for (const [days, tone, label] of cases) {
    const card = planCard((await detail({ nextDueDate: dateOffset(days) })).tree);
    const tag = tagOf(card);
    assert.ok(tag, `tag for ${label}`);
    assert.equal(tag.props.tone, tone, label);
    assert.equal(textOf(tag), label);
    const header = nodes(card).find((node) => node.type === "div" && cls(node).includes("justify-between"));
    assert.ok(nodes(header).includes(tag), `${label}: the tag is on the card header`);
  }
});
