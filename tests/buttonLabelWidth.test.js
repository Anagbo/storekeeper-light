import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { shortSaveName } from "../src/pos/saveLabel.js";
import { posText as t } from "../src/pos/i18n.js";
import { loadJsx, render, walk } from "./helpers/renderJsx.js";

// A browser measures real wrapping; node cannot. These tests guard the two things that decide it
// on a 360px phone: the longest label a bottom-row button can get, and that Back never wraps.

// The Save button on 18 and 19 sits beside Back. At 360px it is about 230px wide: two lines of
// 16px bold text hold roughly 36 characters, so the label must stay under that for any name.
const MAX_SAVE_LABEL = 36;

test("18 Save label stays within two lines at 360px for any customer name", async () => {
  const names = ["Ama", "Nana Akosua Frimpomaa-Boateng Asantewaa", "W".repeat(80), "  Kofi Mensah  ", ""];
  for (const name of names) {
    for (const amount of ["GH₵0.50", "GH₵12,345.00", "GH₵1,234,567.89"]) {
      const label = t("credit.saveAmount", { name: shortSaveName(name), amount });
      const longest = Math.max(...label.split(" ").map((word) => word.length));
      assert.ok(label.length <= MAX_SAVE_LABEL + 6, `"${label}" is ${label.length} characters`);
      assert.ok(longest <= 16, `no single word wider than the button: "${label}"`);
    }
  }
});

test("the shared Back button never wraps (one line, no shrink)", async () => {
  const { PosBackButton } = await loadJsx("src/pos/PosComponents.jsx");
  const view = render({ type: PosBackButton, props: { onClick() {} } });
  const button = [...walk(view.tree)].find((node) => node.type === "button");
  const classes = button.props.className.split(/\s+/);
  assert.ok(classes.includes("whitespace-nowrap"));
  assert.ok(classes.includes("shrink-0"));
});

test("a bottom row gives the main button the leftover width (Back is auto width)", () => {
  for (const file of ["CreditScreens.jsx", "SellWithItems.jsx"]) {
    const source = readFileSync(new URL(`../src/pos/${file}`, import.meta.url), "utf8");
    const rows = source.match(/grid grid-cols-[^"]+ gap-2">\s*<PosBackButton[^>]*\/>/g) ?? [];
    assert.ok(rows.length > 0, file);
    for (const row of rows) assert.match(row, /grid-cols-\[auto_minmax\(0,1fr\)\]/, `${file}: ${row.slice(0, 60)}`);
  }
});
