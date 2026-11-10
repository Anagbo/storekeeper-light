import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// A browser measures real widths; node cannot. These tests guard the structure that keeps the
// 22/25 urgent debtor tile readable at 360px: name (two lines) beside the amount, the due tag
// under the name, and three equal action buttons on their own row.

const LONG_NAME = "Nana Akosua Frimpomaa-Boateng Asantewaa of Kejetia Market";

async function renderTile(debt) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: debt.amountPesewas, urgentDebt: debt }));
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
  assert.ok(has(amount, "shrink-0") && has(amount, "whitespace-nowrap"), "amount never wraps or shrinks");
  assert.ok(!has(amount, "amount-fit"), "amount is not scaled down by the fit container");
});

test("22/25 tile: the due tag sits under the name, inside the same column", async () => {
  const nodes = await renderTile(debt());
  const column = nodes.find((node) => node.type === "div" && has(node, "min-w-0") && textOf(node).includes(LONG_NAME) && textOf(node).includes("Late"));
  assert.ok(column, "a name column that also holds the due tag");
  assert.ok(!textOf(column).includes("GH₵12,345.00"), "the amount is not in the name column");
});

test("22/25 tile: three action buttons share one row of equal width", async () => {
  const nodes = await renderTile(debt());
  const row = nodes.find((node) => node.type === "div" && has(node, "grid-cols-3"));
  assert.ok(row, "a three-column action row");
  const buttons = (row.props.children ?? []).flat(Infinity).filter(Boolean);
  const actions = [...walk(row)].filter((node) => node.props?.["aria-label"]);
  assert.equal(actions.length, 3, "Collect, WhatsApp and Call");
  for (const action of actions) assert.ok(has(action, "w-full") && has(action, "min-w-0"), "each fills its equal column");
  assert.ok(buttons.length > 0);
});

test("22/25 tile: with no phone the row has two equal columns (Collect, Add contact)", async () => {
  const nodes = await renderTile(debt({ phone: "" }));
  const row = nodes.find((node) => node.type === "div" && has(node, "grid-cols-2") && [...walk(node)].some((n) => n.props?.["aria-label"]));
  assert.ok(row, "a two-column action row");
  assert.equal([...walk(row)].filter((node) => node.props?.["aria-label"]).length, 2);
});
