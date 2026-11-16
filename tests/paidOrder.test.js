import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatGhs } from "../src/lib/formatGhs.js";
import { loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// rules_global.customer_proof.paid_order (16 Nov 2026): wherever a payment is split, 29, 43 and 73 list
// Cash first, then MoMo, through one shared helper (historyRows.js paidParts).

const T = new Date(2026, 10, 12, 9, 30).getTime();
// Stored MoMo first, as the database can return them.
const payment = { id: "collection-1", type: "payment", timestamp: T, amountPesewas: 1000, collectionParts: [{ method: "MoMo", amountPesewas: 400 }, { method: "Cash", amountPesewas: 600 }] };
const single = { id: "p2", type: "payment", timestamp: T - 1000, amountPesewas: 500, method: "MoMo" };
const EXPECTED = `Cash ${formatGhs(600)}, MoMo ${formatGhs(400)}`;

async function detailText(late) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", {});
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 9000, status: "unpaid", isInstallmentPlan: false, dueDate: late ? "2020-01-01" : "2099-01-01" };
  setLiveQuery(([debtId]) => (debtId === "d1" ? { name: "Ama", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 9000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [payment, single], lastReminderAt: 0 } : undefined));
  try {
    return textOf(render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

async function recordText() {
  const { default: CustomerRecordView } = await loadJsx("src/pos/CustomerRecordView.jsx");
  setLiveQuery(() => ({ name: "Ama", balancePesewas: 9000, rows: [payment, single] }));
  try {
    return textOf(render({ type: CustomerRecordView, props: { params: { customerId: "c1" }, onBack() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

for (const [screen, text] of [["29", () => detailText(false)], ["43", () => detailText(true)], ["73", recordText]]) {
  test(`${screen}: a split payment lists Cash before MoMo`, async () => {
    const shown = await text();
    assert.ok(shown.includes(EXPECTED), `${screen} shows "${EXPECTED}"`);
    assert.ok(shown.indexOf("Cash") < shown.indexOf("MoMo"), `${screen}: Cash first`);
    assert.ok(shown.includes(`MoMo ${formatGhs(500)}`), `${screen}: a one-part payment shows its method and amount`);
  });
}

test("one shared helper: 29/43 and 73 both draw Paid through EventRows, which uses paidParts; none joins the parts itself", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(read("src/pos/EventRows.jsx"), /\bpaidParts\(event\)/, "EventRows uses paidParts");
  for (const file of ["src/pos/DebtCollection.jsx", "src/pos/CustomerRecordView.jsx", "src/pos/EventRows.jsx"]) {
    assert.doesNotMatch(read(file), /collectionParts\s*\.map\(/, `${file} does not join the parts itself`);
  }
  for (const file of ["src/pos/DebtCollection.jsx", "src/pos/CustomerRecordView.jsx"]) {
    assert.match(read(file), /<EventRows\b/, `${file} uses EventRows`);
  }
});
