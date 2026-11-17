// 29, 43 (Debtor detail, on time or late) and 73 (customer record) rendered as HTML for the real-browser
// layout checks, from a list of history rows as loadCustomerHistory / groupCollectionHistory give them.
import { toHtml } from "./browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./renderJsx.js";

export const PROOF_T = new Date(2026, 10, 12, 16, 40).getTime();

export const creditRow = (id, amountPesewas, reason = "", signed = false) => ({ id, type: "credit", timestamp: PROOF_T, amountPesewas, reason, signed, transactionId: `t-${id}` });
export const paidRow = (id, amountPesewas) => ({ id, type: "payment", timestamp: PROOF_T, amountPesewas, method: "Cash" });
export const correctionRow = (id, previous, next, note = "Wrong amount typed") => ({ id, type: "adjustment", timestamp: PROOF_T, previousBalancePesewas: previous, newBalancePesewas: next, deltaPesewas: next - previous, amountPesewas: previous - next, reasonCode: "other", reasonNote: note, reasonLabel: "Other" });

export async function detailHtml({ late = false, history = [], name = "Nana Akosua Frimpomaa", balancePesewas = 120000 } = {}) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", {});
  const debt = { id: "d1", customerId: "c1", customerName: name, amountPesewas: balancePesewas, status: "unpaid", isInstallmentPlan: false, dueDate: late ? "2020-01-01" : "2099-01-01" };
  setLiveQuery(([debtId]) => (debtId === "d1" ? { name, customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history, lastReminderAt: 0 } : undefined));
  try {
    return toHtml(render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: name }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

export async function recordHtml({ rows = [], name = "Nana Akosua Frimpomaa", balancePesewas = 120000 } = {}) {
  const { default: CustomerRecordView } = await loadJsx("src/pos/CustomerRecordView.jsx");
  setLiveQuery(() => ({ name, balancePesewas, rows }));
  try {
    return toHtml(render({ type: CustomerRecordView, props: { params: { customerId: "c1" }, onBack() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

// The same history on 29, 43 and 73.
export async function proofPages(history, options = {}) {
  return [
    { name: "29", html: await detailHtml({ ...options, late: false, history }) },
    { name: "43", html: await detailHtml({ ...options, late: true, history }) },
    { name: "73", html: await recordHtml({ ...options, rows: history }) }
  ];
}
