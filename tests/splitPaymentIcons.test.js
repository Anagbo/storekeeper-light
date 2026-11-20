import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// rules_global.button_system.add_variants (20 Nov 2026): every Split payment control keeps its joined icons
// (cash + phone, plus a person where Owe can be part of the split, with the small plus signs BETWEEN them)
// and has no separate "+" symbol before the label. Accessible name "Split payment".

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(`${root}/${file}`, "utf8");

// [file, label key, whether Owe can be part of the split]
const CONTROLS = [
  ["src/pos/Sell.jsx", "sell.split", true],
  ["src/pos/ReviewAndPay.jsx", "review.split", true],
  ["src/pos/DebtCollection.jsx", "collect.splitPayment", false]
];

test("every Split payment control contains the joined icons and no separate + before the label", () => {
  for (const [file, key, withOwe] of CONTROLS) {
    const source = read(file);
    const at = source.lastIndexOf(`t("${key}")`);
    assert.ok(at > 0, `${file}: uses ${key}`);
    const before = source.slice(Math.max(0, at - 700), at);
    const icons = withOwe ? /<SplitIcons withOwe size=\{\d+\} \/>/ : /<SplitIcons size=\{\d+\} \/>/;
    assert.match(before, icons, `${file}: joined icons ${withOwe ? "with Owe" : "(Cash + MoMo)"} before the label`);
    // The control that holds the label draws no "+" of its own (AddButton must say plus={false}).
    const control = before.slice(Math.max(before.lastIndexOf("<AddButton"), before.lastIndexOf("<PosSecondaryButton")));
    if (control.startsWith("<AddButton")) assert.match(control, /plus=\{false\}/, `${file}: AddButton without its own +`);
    assert.doesNotMatch(control, />\s*\+\s*</, `${file}: no stray + symbol`);
  }
  // The Collect tile is named "Split payment" for screen readers; the icons are hidden from them.
  assert.match(read("src/pos/DebtCollection.jsx"), /aria-label=\{t\("collect\.splitPayment"\)\}/);
  assert.match(read("src/pos/Sell.jsx"), /aria-label=\{t\("sell\.split"\)\}/);
});

test("the shared SplitIcons puts the plus signs between the icons, not before the first", async () => {
  const source = read("src/pos/PosComponents.jsx");
  const body = source.slice(source.indexOf("export function SplitIcons"));
  const order = [...body.slice(0, body.indexOf("\n}\n")).matchAll(/<Banknote|<Smartphone|<UserRound|\{plusSize\}|className=\{plusSize\}/g)].map((m) => m[0]);
  assert.deepEqual(order.slice(0, 3), ["<Banknote", "className={plusSize}", "<Smartphone"], "cash + phone");
});

test("19 keeps its cash + phone tile with the name Split payment", () => {
  const source = read("src/pos/CreditScreens.jsx");
  assert.match(source, /aria-label=\{method === "split" \? t\("split\.title"\) : undefined\}/);
  assert.match(source, /<Banknote size=\{16\}[^>]*\/>\s*<Plus size=\{12\}[^>]*\/>\s*<Smartphone size=\{16\}/);
});
