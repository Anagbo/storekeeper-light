import assert from "node:assert/strict";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29 and 43, plan card (decided 12 Nov 2026): two full-width lines, never two wrapped
// columns: "GH₵{paid} paid · {left} payments left", then "Next payment {dd/mm/yyyy}". The
// "In n days" tag stays on the card header and follows the shared DueTag colours (grey more than
// 3 days, amber 3 days or less or today, red late).

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

test("plan card: GH₵142.00 paid · 4 payments left and Next payment 18/11/2026 are two separate full-width lines", async () => {
  const view = await detail({ nextDueDate: "2026-11-18" });
  const card = planCard(view.tree);
  assert.ok(card, "plan card");
  const lines = nodes(card).filter((node) => node.props["data-plan-line"] !== undefined);
  assert.deepEqual(lines.map(textOf), ["GH₵142.00 paid · 4 payments left", "Next payment 18/11/2026"]);
  for (const line of lines) {
    assert.equal(line.type, "p", "each is its own block line");
    assert.ok(cls(line).includes("w-full"), "full card width");
  }
  const wrapper = nodes(card).find((node) => node.props["data-plan-lines"] !== undefined);
  assert.ok(cls(wrapper).includes("flex-col"), "stacked, never side by side");
  assert.ok(!cls(wrapper).some((c) => /^(justify-between|flex-row|grid-cols-)/.test(c)), "no two-column layout");
});

test("plan card: the same lines at 360 and 393px (no width-specific classes); each line fits the card", async () => {
  const view = await detail({ nextDueDate: "2026-11-18" });
  const card = planCard(view.tree);
  for (const node of nodes(card)) {
    assert.ok(!cls(node).some((c) => /^(sm|md|lg|xl|max-\[[^\]]+\]|min-\[[^\]]+\]):/.test(c)), `no breakpoint classes (${node.props.className})`);
  }
  // Measured in headless Edge (Segoe UI, bold 14px): "GH₵142.00 paid · 4 payments left" is about
  // 225px. Card inside width = width - 32 (page gutters) - 4 (border) - 28 (padding).
  for (const width of [360, 393]) assert.ok(225 <= width - 32 - 4 - 28, `one line at ${width}px`);
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
