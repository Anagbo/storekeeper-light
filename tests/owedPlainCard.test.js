import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadAllUnpaidDebts, loadUnpaidDebtPage } from "../src/pos/owed.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 32 (Layout, decided 22 Nov 2026): no pink block. A plain white summary card (2px #CBD5E1 border, 20px
// radius, no coloured edge) with the grey label over the dark red total; person rows are white cards with a
// light border straight on the page.
after(async () => { db.close(); await db.delete(); });
beforeEach(async () => { await Promise.all([db.debts, db.customers].map((table) => table.clear())); });

const cls = (node) => String(node.props?.className ?? "");
async function open() {
  await db.debts.bulkAdd([["Ama Mensah", "0241234567", 3000], ["Kofi Boateng", "0551112222", 2500]].map(([customerName, phone, amountPesewas], index) => ({
    id: `d${index}`, customerName, phone, status: "unpaid", amountPesewas, total_owed: amountPesewas, dueDate: "", isInstallmentPlan: false
  })));
  const { default: Owed } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: [] };
  const everyDebt = { status: "ready", debts: await loadAllUnpaidDebts() };
  setLiveQuery((_deps, query) => {
    const source = String(query);
    if (source.includes("search outstanding debts")) return everyDebt;
    return source.includes("load outstanding debts") ? firstPage : customerResult;
  });
  const view = render({ type: Owed, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  flushEffects(view);
  view.rerender();
  return view;
}

test("32: no pink block; the summary card is plain white with the label and the dark red total", async () => {
  const view = await open();
  const nodes = [...walk(view.tree)];
  assert.ok(!nodes.some((node) => /bg-rose-200|bg-pink|border-l-/.test(cls(node))), "no pink block or coloured edge");
  const card = nodes.find((node) => node.props?.["data-owed-summary"] !== undefined);
  assert.ok(card);
  assert.ok(!/(^|\s)border/.test(cls(card)), "soft tile: no border");
  for (const want of ["bg-[#F1F5F9]", "rounded-[20px]"]) assert.ok(cls(card).split(/\s+/).includes(want), want);
  assert.match(textOf(card), /Total owed to you/);
  const total = [...walk(card)].find((node) => node.props?.["data-owed-total"] !== undefined);
  assert.equal(textOf(total), "GH₵55.00");
  assert.match(cls(total), /text-\[#0F172A\]/);
  assert.match(cls(total), /text-\[30px\]/);
});

test("32: person rows are white cards on the page, not inside a coloured panel", async () => {
  const view = await open();
  const nodes = [...walk(view.tree)];
  const rows = nodes.filter((node) => node.type === "article");
  assert.equal(rows.length, 2);
  for (const row of rows) for (const want of ["bg-white", "border-2", "w-full"]) assert.ok(cls(row).split(/\s+/).includes(want), want);
  const list = nodes.find((node) => node.props?.role === "list");
  assert.ok(!/bg-/.test(cls(list)));
  const section = nodes.find((node) => node.type === "section" && node.props["aria-label"] === "Total owed to you");
  assert.ok(!/bg-/.test(cls(section)), "the wrapper has no background");
});

test("32: every control keeps its accessible name", async () => {
  const view = await open();
  const labels = [...walk(view.tree)].filter((node) => (node.type === "button" || node.type === "a")).map((node) => node.props["aria-label"] ?? textOf(node));
  for (const want of ["Collect from Ama Mensah", "Collect from Kofi Boateng", "WhatsApp Ama Mensah", "Call Kofi Boateng"]) assert.ok(labels.includes(want), want);
  for (const want of ["All", "Late", "Due soon"]) assert.ok(labels.includes(want), want);
});
