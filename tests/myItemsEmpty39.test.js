import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 39, "Empty list on 39" (decided 17 Nov 2026): with no items the hint "You have no items yet. Add one
// or choose from the starter list." is plain text (17px, no box) directly under the Back and "My items" row,
// above Find item; then Find item, "+ New item", "+ Add from starter list" (the two add buttons together).
// With items: no hint; Find item, "+ New item", the item list, then "+ Add from starter list" at the end.

const HINT = "You have no items yet. Add one or choose from the starter list.";
afterEach(() => setLiveQuery(null));

async function show(products) {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products, error: "" }));
  return render({ type: ItemScreens, props: { route: "MyItems", params: {}, onBack() {}, onNavigate() {} } });
}

// The screen's pieces in document order.
function order(tree) {
  const out = [];
  for (const node of walk(tree)) {
    if (!node.props) continue;
    if (node.type === "h1") out.push("title");
    else if (node.type === "input") out.push("Find item");
    else if (node.props["data-empty-hint"] !== undefined) out.push("hint");
    else if (node.type === "button") {
      const text = textOf(node).replace(/\s+/g, " ").trim();
      if (/New item$/.test(text)) out.push("+ New item");
      else if (/Add from starter list$/.test(text)) out.push("+ Add from starter list");
      else if (/^(Back|Menu)/.test(text) || node.props["aria-label"] === "Back") continue;
      else out.push("item");
    }
  }
  return out.filter((entry, index, all) => entry !== "item" || all[index - 1] !== "item");
}

test("39 empty: hint under the title, then Find item, + New item, + Add from starter list", async () => {
  const view = await show([]);
  assert.deepEqual(order(view.tree), ["title", "hint", "Find item", "+ New item", "+ Add from starter list"]);
  const hint = [...walk(view.tree)].find((node) => node.props?.["data-empty-hint"] !== undefined);
  assert.equal(textOf(hint), HINT);
  assert.equal(hint.type, "p");
  assert.match(hint.props.className, /text-\[17px\]/);
  assert.doesNotMatch(hint.props.className, /border|bg-|rounded|p-\d/, "plain text, no box");
});

test("39 with items: no hint; Find item, + New item, the list, + Add from starter list at the end", async () => {
  const view = await show([{ id: 1, name: "Bread", default_price: 5 }, { id: 2, name: "Water", default_price: 0 }]);
  assert.deepEqual(order(view.tree), ["title", "Find item", "+ New item", "item", "+ Add from starter list"]);
  assert.doesNotMatch(textOf(view.tree), /You have no items yet/);
});
