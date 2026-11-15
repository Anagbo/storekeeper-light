import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29/43 "No open debt entries" (decided 15 Nov 2026): when the person has no open debt entries,
// the "Open debt entries" heading and its line are not shown at all. With open entries the list and
// "Correct this entry" stay.

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const entry = (id, amountPesewas, late = false) => ({ id, customerId: "c1", customerName: "Ama", amountPesewas, total_owed: amountPesewas, status: amountPesewas > 0 ? "unpaid" : "paid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7), createdAt: Date.now() - 3_600_000, note: `Entry ${id}` });

function detailData(entries, { balancePesewas = entries.filter((debt) => debt.status === "unpaid").reduce((sum, debt) => sum + debt.amountPesewas, 0), shown = entries[0] } = {}) {
  const unpaidDebts = entries.filter((debt) => debt.status === "unpaid");
  return { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas, debt: shown, unpaidDebts, unpaidDebtCount: unpaidDebts.length, lastReminderAt: 0, history: [] };
}
async function detail(data) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(([debtId]) => (debtId === data.debt.id ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: data.debt.id, customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  } finally {
    setLiveQuery(null);
  }
}
const heading = (view) => [...walk(view.tree)].find((node) => node.type === "h2" && textOf(node) === "Open debt entries");
const entryButtons = (view) => [...walk(view.tree)].filter((node) => node.type === "button" && textOf(node) === "Correct this entry");
const lists = (view) => [...walk(view.tree)].filter((node) => node.type === "ul");

for (const late of [false, true]) {
  const screen = late ? "43" : "29";

  test(`${screen}: a person with no open debt entries (paid in full) shows no heading and no line`, async () => {
    const view = await detail(detailData([entry("d1", 0, late)], { balancePesewas: 0 }));
    assert.equal(heading(view), undefined, "no Open debt entries heading");
    assert.equal(lists(view).length, 0, "no empty bordered list (its line)");
    assert.equal(entryButtons(view).length, 0);
    assert.doesNotMatch(textOf(view.tree), /Open debt entries/);
  });

  test(`${screen}: with open entries the list and Correct this entry stay`, async () => {
    const view = await detail(detailData([entry("d1", 3000, late), entry("d2", 5000, late)]));
    assert.ok(heading(view), "the heading");
    assert.equal(lists(view).length, 1, "the list");
    assert.equal(entryButtons(view).length, 2, "Correct this entry on each open entry");
    assert.match(textOf(view.tree), /Entry d1/);
    assert.match(textOf(view.tree), /Entry d2/);
  });
}
