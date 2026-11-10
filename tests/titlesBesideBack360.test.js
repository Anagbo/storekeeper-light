import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { shortSaveName } from "../src/pos/saveLabel.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Screens 29, 40, 42: a long name must never push the title past two lines at 360px.
const LONG = "Nana Akosua Frimpomaa-Boateng Asantewaa Special Groundnut Paste Large";
const has = (node, cls) => (node.props?.className ?? "").split(/\s+/).includes(cls);

test("42 Delete item: the title beside Back is limited to two lines with an ellipsis", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  const view = render({ type: ItemScreens, props: { route: "DeleteItem", params: { itemId: 1, itemName: LONG }, onBack() {}, onNavigate() {}, onReturnToItems() {} } });
  const nodes = [...walk(view.tree)];
  const title = nodes.find((node) => node.type === "h1");
  assert.ok(title, "title");
  assert.ok(has(title, "line-clamp-2") && has(title, "break-words") && has(title, "min-w-0"));
});

test("42 Delete item: the Keep button uses the short name, so it stays within two lines", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  const view = render({ type: ItemScreens, props: { route: "DeleteItem", params: { itemId: 1, itemName: LONG }, onBack() {}, onNavigate() {}, onReturnToItems() {} } });
  const keep = [...walk(view.tree)].find((node) => node.type === "button" && /^Keep /.test(textOf(node)));
  assert.ok(keep, "Keep button");
  assert.equal(textOf(keep), `Keep ${shortSaveName(LONG)}`);
  assert.ok(textOf(keep).length <= 16);
  // The full name is still on the screen in the confirmation heading.
  assert.ok([...walk(view.tree)].some((node) => node.type === "h2" && textOf(node).includes(LONG)), "full name in the question");
});

test("40 Edit item: the title is limited to two lines and the full name stays in the Name field", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ id: 1, name: LONG, priceInPesewas: 500, price: 5, active: true }));
  try {
    const view = render({ type: ItemScreens, props: { route: "EditItem", params: { itemId: 1 }, onBack() {}, onNavigate() {} } });
    const nodes = [...walk(view.tree)];
    const title = nodes.find((node) => node.type === "h1");
    assert.ok(title && has(title, "line-clamp-2") && has(title, "break-words"));
    assert.ok(nodes.some((node) => node.type === "input" && node.props.value === LONG), "full name is in the Name input");
  } finally {
    setLiveQuery(null);
  }
});

test("29 Debtor detail: the name in the header card is limited to two lines, not cut to one", () => {
  const source = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
  const line = source.split("\n").find((row) => row.includes("{data.name}</strong>"));
  assert.ok(line, "name element");
  assert.match(line, /line-clamp-2/);
  assert.match(line, /break-words/);
  assert.doesNotMatch(line, /truncate/);
  // "block" would replace the clamp's display value and let the name run to five lines.
  assert.ok(!line.includes(' block '), 'no block class');
});
