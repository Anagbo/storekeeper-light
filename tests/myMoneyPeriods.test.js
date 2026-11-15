import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadMyMoneyReport } from "../src/pos/myMoneyReport.js";
import { findButton, loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// Task A: pressing "This month" on My money (33) must load. Realistic data: sales (cash, MoMo, a
// credit sale with a part paid), spent money with categories, stock bought on credit from a
// supplier who is still owed, a supplier payment, and an older record. Also an empty period.
const DAY = 86400000;

async function seed(now) {
  const at = (days) => now.getTime() - days * DAY;
  await db.suppliers.put({ id: "sup1", name: "Yaw Wholesale", nameLower: "yaw wholesale", phone: "", createdAt: at(30), updatedAt: at(30) });
  const rows = [
    { id: "t1", type: "sale", amountPesewas: 5000, paymentType: "cash", createdAt: at(0.2) },
    { id: "t2", type: "sale", amountPesewas: 3000, payment_method: "momo", createdAt: at(1) },
    { id: "t3", type: "sale", amountPesewas: 8000, paymentType: "credit", cashReceivedPesewas: 2000, creditExtendedPesewas: 6000, createdAt: at(2) },
    { id: "t4", type: "expense", category: "stock", amountPesewas: 6000, paidAmountPesewas: 1000, owedAmountPesewas: 5000, supplierId: "sup1", payBy: "", createdAt: at(3) },
    { id: "t5", type: "expense", category: "transport", amountPesewas: 1500, paidAmountPesewas: 1500, createdAt: at(4) },
    { id: "t6", type: "supplier_payment", supplierId: "sup1", amountPesewas: 2000, createdAt: at(5) },
    { id: "t7", type: "sale", amountPesewas: 4000, paymentType: "cash", createdAt: at(12) },
    { id: "t8", type: "expense", category: "rent", amountPesewas: 2500, paidAmountPesewas: 2500, createdAt: at(20) },
    { id: "t9", type: "sale", amountPesewas: 9000, paymentType: "cash", createdAt: at(80) }
  ];
  await db.transactions.bulkPut(rows.map((row) => ({ ...row, total_amount: row.amountPesewas, timestamp: row.createdAt, updatedAt: row.createdAt, items_json: "[]" })));
}

beforeEach(async () => {
  await db.transactions.clear();
  await db.suppliers.clear();
  await db.debts.clear();
  await db.settings.clear();
});

test("A: tapping This month on 33 loads with realistic data, and so does This week", async () => {
  await seed(new Date());
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  let query = null;
  setLiveQuery((_deps, run) => { query = run; return null; });
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  const results = {};
  for (const label of ["This week", "This month", "This week"]) {
    findButton(view.tree, label).props.onClick();
    view.rerender();
    results[label] = await query();
    // Show what the query returned: the screen renders it without throwing.
    setLiveQuery(() => results[label]);
    view.rerender();
    assert.match(textOf(view.tree), label === "This month" ? /Money left this month/ : /Money left this week/);
    setLiveQuery((_deps, run) => { query = run; return null; });
  }
  setLiveQuery(null);
  assert.ok(Number.isSafeInteger(results["This month"].summary.moneyLeft));
  assert.ok(Number.isSafeInteger(results["This week"].summary.profit));
});

test("A: an empty month (and week) loads with zeros and no comparison", async () => {
  for (const period of ["week", "month"]) {
    const report = await loadMyMoneyReport({ period, now: new Date() });
    assert.equal(report.summary.moneyLeft, 0);
    assert.equal(report.summary.profit, 0);
    assert.equal(report.comparison, null);
    assert.equal(report.debtPesewas, 0);
  }
});

test("A: a month with only an older record and nothing this month loads", async () => {
  const now = new Date();
  await db.transactions.put({ id: "old", type: "sale", amountPesewas: 9000, total_amount: 9000, paymentType: "cash", createdAt: now.getTime() - 200 * DAY, timestamp: now.getTime() - 200 * DAY, updatedAt: now.getTime() });
  for (const period of ["week", "month"]) {
    const report = await loadMyMoneyReport({ period, now });
    assert.equal(report.summary.moneyLeft, 0);
  }
});

// Date edges: the first week of a month, the first of the month on a Sunday, the year start, a leap
// day and the days the clock changes. Each loads for week and month, with and without records.
const EDGE_DATES = [
  "2026-11-01T12:00:00", // Sunday: the week began in October
  "2026-11-02T00:00:05", // the first Monday of November
  "2026-12-01T09:00:00", // the week began in November
  "2026-12-31T23:59:00", // the last minute of the year
  "2027-01-01T00:30:00", // the year start (the week began in December)
  "2027-01-04T09:00:00", // the first Monday of the year
  "2027-03-01T12:00:00",
  "2028-02-29T12:00:00", // a leap day
  "2026-03-29T12:00:00", // clocks change (Europe)
  "2026-10-25T12:00:00"
];

for (const iso of EDGE_DATES) {
  test(`A: week and month load on ${iso}, with records and with none`, async () => {
    const now = new Date(iso);
    for (const withRecords of [true, false]) {
      await db.transactions.clear();
      await db.suppliers.clear();
      if (withRecords) await seed(now);
      for (const period of ["week", "month"]) {
        const report = await loadMyMoneyReport({ period, now });
        const { summary } = report;
        for (const value of Object.values(summary)) assert.ok(Number.isSafeInteger(value), `${period} ${withRecords}: ${JSON.stringify(summary)}`);
        assert.equal(summary.moneyLeft, summary.moneyIn - summary.moneySpent);
        assert.equal(summary.spentStock + summary.spentOther, summary.moneySpent);
        if (report.comparison) assert.ok(["more", "less", "same"].includes(report.comparison.kind));
        if (!withRecords) assert.equal(summary.moneyLeft, 0);
      }
    }
  });
}

test("A: the month before this month is the previous calendar month, even from January", async () => {
  await db.transactions.clear();
  const jan = new Date("2027-01-15T12:00:00");
  await db.transactions.bulkPut([
    { id: "dec", type: "sale", amountPesewas: 7000, total_amount: 7000, paymentType: "cash", createdAt: new Date("2026-12-20T10:00:00").getTime(), timestamp: 1, updatedAt: 1 },
    { id: "jan", type: "sale", amountPesewas: 10000, total_amount: 10000, paymentType: "cash", createdAt: new Date("2027-01-10T10:00:00").getTime(), timestamp: 1, updatedAt: 1 },
    { id: "nov", type: "sale", amountPesewas: 99000, total_amount: 99000, paymentType: "cash", createdAt: new Date("2026-11-20T10:00:00").getTime(), timestamp: 1, updatedAt: 1 }
  ]);
  const report = await loadMyMoneyReport({ period: "month", now: jan });
  assert.equal(report.summary.moneyLeft, 10000);
  assert.deepEqual(report.comparison, { kind: "more", amountPesewas: 3000 });
});
