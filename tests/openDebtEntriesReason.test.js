import assert from "node:assert/strict";
import { test } from "node:test";
import { getDebtEntryReason } from "../src/lib/creditReason.js";
import { toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// 29/43 "Open debt entries" (decided 16 Nov 2026): each entry shows its own reason, generated words
// hidden, or "No reason written". Never "Sale", "Sale, Sale" or "Credit entry".

const strip = (html) => html.replace(/<[^>]+>/g, "");

test("getDebtEntryReason: the typed reasons of the entry, generated words dropped", () => {
  assert.equal(getDebtEntryReason({ note: "Sale, Sale" }), "");
  assert.equal(getDebtEntryReason({ note: "Sale" }), "");
  assert.equal(getDebtEntryReason({ note: "School fees, Sale" }), "School fees");
  assert.equal(getDebtEntryReason({ note: "Rice · beans" }), "Rice · beans");
  assert.equal(getDebtEntryReason({ note: "Other amount" }), "");
  assert.equal(getDebtEntryReason({ note: "" }), "");
  assert.equal(getDebtEntryReason({}), "");
  assert.equal(getDebtEntryReason({ note: "", itemDescription: "Old fridge" }), "Old fridge");
});

test("29 and 43: each open debt entry shows its own reason or No reason written", async () => {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", {});
  const at = new Date(2026, 10, 12, 16, 40).getTime();
  const entries = [
    { id: "d1", note: "Sale, Sale", amountPesewas: 1000 },
    { id: "d2", note: "School fees, Sale", amountPesewas: 2000 },
    { id: "d3", note: "Rice · beans", amountPesewas: 3000 },
    { id: "d4", amountPesewas: 4000 }
  ].map((debt) => ({ ...debt, customerId: "c1", customerName: "Kofi", status: "unpaid", isInstallmentPlan: false, dueDate: "2099-01-01", createdAt: at }));
  for (const late of [false, true]) {
    const debt = { ...entries[0], dueDate: late ? "2020-01-01" : "2099-01-01" };
    setLiveQuery(([debtId]) => (debtId === "d1" ? { name: "Kofi", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 10000, debt, unpaidDebts: entries, unpaidDebtCount: entries.length, history: [], lastReminderAt: 0 } : undefined));
    let html;
    try {
      html = toHtml(render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Kofi" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } }).tree);
    } finally {
      setLiveQuery(null);
    }
    const section = /Open debt entries<\/h2>([\s\S]*?)<\/section>/.exec(html);
    assert.ok(section, `${late ? "43" : "29"}: the Open debt entries list`);
    const lines = [...section[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => strip(match[1]).replace(/&amp;/g, "&"));
    const reasons = lines.map((line) => line.replace(/^GH₵[\d,.]+/, "").split(" · 12/11/2026")[0]);
    assert.deepEqual(reasons, ["No reason written", "School fees", "Rice · beans", "No reason written"], `${late ? "43" : "29"}: one reason per entry`);
    assert.doesNotMatch(strip(section[1]), /\bSale\b|Credit entry/);
  }
});
