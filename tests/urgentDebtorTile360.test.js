import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// A browser measures real widths; node cannot. These tests guard the structure that keeps the
// 22/25 urgent debtor tile readable at 360px: name (two lines) beside the amount, the due tag
// under the name, and the action row (Collect taking the remaining width, then 52px squares;
// redesign 11 Nov 2026, wiring 22).

const LONG_NAME = "Nana Akosua Frimpomaa-Boateng Asantewaa of Kejetia Market";

async function renderTile(debt) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ hideAmounts: false, totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: debt.amountPesewas, urgentDebt: debt }));
  try {
    const view = render({ type: Home, props: { onNavigate() {} } });
    return [...walk(view.tree)];
  } finally {
    setLiveQuery(null);
  }
}
const has = (node, cls) => (node.props?.className ?? "").split(/\s+/).includes(cls);
const debt = (extra = {}) => ({ debtId: "d1", customerName: LONG_NAME, amountPesewas: 1234500, dueDate: "2020-01-01", phone: "0244123456", ...extra });

test("22/25 tile: the name takes up to two lines and the amount never shrinks or clips", async () => {
  const nodes = await renderTile(debt());
  const name = nodes.find((node) => node.type === "span" && textOf(node) === LONG_NAME);
  assert.ok(name, "name is shown in full text");
  assert.ok(has(name, "line-clamp-2"), "name limited to two lines");
  assert.ok(!has(name, "truncate"), "no single-line truncation");
  const amount = nodes.find((node) => node.type === "span" && textOf(node) === "GH₵12,345.00");
  assert.ok(amount, "amount shown");
  // 4k (21 Nov 2026): the top row is a grid; the amount has the auto (content-sized) column, so it never shrinks.
  const row = nodes.find((node) => has(node, "grid") && has(node, "grid-cols-[minmax(0,1fr)_auto]") && textOf(node).includes("GH₵12,345.00"));
  assert.ok(row, "the top row is the name/amount grid");
  assert.ok(has(amount, "col-start-2") && has(amount, "whitespace-nowrap"), "amount in the auto column, never wraps or shrinks");
  assert.ok(!has(amount, "amount-fit"), "amount is not scaled down by the fit container");
});

// 4k (rules_global.person_row "Due tag on one line", 21 Nov 2026): the tag is no longer inside the name
// column; it has its own row under the name across the full width, on one line (real-browser check in
// tests/dueTagOneLine.test.js).
test("22/25 tile: the due tag sits under the name, in its own full-width row, on one line", async () => {
  const nodes = await renderTile(debt());
  const name = nodes.find((node) => node.type === "span" && textOf(node) === LONG_NAME);
  assert.ok(has(name, "col-start-1") && has(name, "row-start-1"), "the name is the top-left cell");
  const tag = nodes.find((node) => node.type === "div" && node.props["data-party-tag"] !== undefined);
  assert.ok(tag && textOf(tag).includes("Late"), "the due tag");
  assert.ok(has(tag, "col-span-full") && has(tag, "row-start-2") && has(tag, "whitespace-nowrap"), "the tag row is under the name, full width, one line");
  assert.ok(!textOf(tag).includes("GH₵12,345.00") && !textOf(tag).includes(LONG_NAME), "the tag row holds only the tag");
});

// Redesign 11 Nov 2026 (wiring 22): Collect takes the remaining width; WhatsApp and Call are 52px squares.
test("22/25 tile: Collect fills the row; WhatsApp and Call are 52px squares beside it", async () => {
  const nodes = await renderTile(debt());
  const collect = nodes.find((node) => node.type === "button" && node.props["aria-label"] === "Collect payment from Nana Akosua Frimpomaa-Boateng Asantewaa of Kejetia Market");
  assert.ok(collect);
  assert.ok(has(collect, "flex-1") && has(collect, "min-w-0") && has(collect, "h-[52px]"));
  assert.equal(textOf(collect), "Collect");
  // WhatsApp is a button that calls the shared opener (rules_global.whatsapp_links); Call stays a tel: link.
  for (const [label, type] of [[/^WhatsApp /, "button"], [/^Call /, "a"]]) {
    const square = nodes.find((node) => node.type === type && label.test(node.props["aria-label"] ?? ""));
    assert.ok(square, String(label));
    assert.ok(has(square, "h-[52px]") && has(square, "w-[52px]") && has(square, "shrink-0"));
  }
});

test("22/25 tile: with no phone the row is Collect and Add contact, with no WhatsApp or Call", async () => {
  const nodes = await renderTile(debt({ phone: "" }));
  const labels = nodes.filter((node) => (node.type === "button" || node.type === "a") && node.props["aria-label"]).map((node) => node.props["aria-label"]);
  assert.ok(labels.some((label) => /^Collect payment from /.test(label)));
  assert.ok(labels.some((label) => /^Add/.test(label)), "Add contact kept");
  assert.ok(!labels.some((label) => /^(WhatsApp|Call) /.test(label)));
});
