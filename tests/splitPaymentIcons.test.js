import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadJsx } from "./helpers/renderJsx.js";

// rules_global.button_system.add_variants (20 Nov 2026): every Split payment control keeps its joined icons
// (cash + phone, plus a person where Owe can be part of the split, with the small plus signs BETWEEN them)
// and has no separate "+" symbol before the label. Accessible name "Split payment".
// split_payment_look (21 Nov 2026): every one of them is the add look (AddButton: dashed 2px dark green),
// on 15, 55, 19, 25/26 and their wide layouts (the same components); 19's selected state stays dashed.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(`${root}/${file}`, "utf8");

// [file, label key, whether Owe can be part of the split]
const CONTROLS = [
  ["src/pos/Sell.jsx", "sell.split", true],
  ["src/pos/ReviewAndPay.jsx", "review.split", true],
  ["src/pos/DebtCollection.jsx", "collect.splitPayment", false],
  ["src/pos/CreditScreens.jsx", "split.title", false]
];

test("every Split payment control contains the joined icons and no separate + before the label", () => {
  for (const [file, key, withOwe] of CONTROLS) {
    const source = read(file);
    const at = source.lastIndexOf(`t("${key}")`);
    assert.ok(at > 0, `${file}: uses ${key}`);
    const before = source.slice(Math.max(0, at - 700), at + (file.endsWith("Sell.jsx") ? 400 : 0));
    const icons = withOwe ? /<SplitIcons? (withOwe )?size=\{\d+\} \/>/ : /<SplitIcons size=\{\d+\} \/>/;
    assert.match(before, icons, `${file}: joined icons ${withOwe ? "with Owe" : "(Cash + MoMo)"} before the label`);
    // The control that holds the label draws no "+" of its own (AddButton must say plus={false}).
    const control = before.slice(Math.max(before.lastIndexOf("<AddButton"), before.lastIndexOf("<PosSecondaryButton"), before.lastIndexOf("<button")));
    if (control.startsWith("<AddButton")) assert.match(control, /plus=\{false\}/, `${file}: AddButton without its own +`);
    assert.doesNotMatch(control, />\s*\+\s*</, `${file}: no stray + symbol`);
  }
  // Each tile is named "Split payment" for screen readers; the icons are hidden from them.
  assert.match(read("src/pos/DebtCollection.jsx"), /aria-label=\{t\("collect\.splitPayment"\)\}/);
  assert.match(read("src/pos/Sell.jsx"), /aria-label=\{t\("sell\.split"\)\}/);
  assert.match(read("src/pos/ReviewAndPay.jsx"), /aria-label=\{t\("review\.split"\)\}/);
  assert.match(read("src/pos/CreditScreens.jsx"), /aria-label=\{t\("split\.title"\)\}/);
});

test("every Split payment control is the add look (AddButton), never the other look or a plain tile", () => {
  for (const [file, key] of CONTROLS) {
    const source = read(file);
    const at = source.lastIndexOf(`t("${key}")`);
    const before = source.slice(0, at);
    const opener = Math.max(before.lastIndexOf("<AddButton"), before.lastIndexOf("<PosSecondaryButton"), before.lastIndexOf("<button"));
    assert.ok(before.startsWith("<AddButton", opener), `${file}: the control holding ${key} is an AddButton`);
    // Nothing between the opening tag and the label closes it (the label is inside the AddButton).
    assert.doesNotMatch(source.slice(opener, at), /<\/AddButton>/, `${file}: ${key} is inside the AddButton`);
  }
});

test("AddButton draws the dashed look, also when pressed (19 chosen) and when disabled", async () => {
  const { AddButton } = await loadJsx("src/pos/PosComponents.jsx");
  const plain = AddButton({ plus: false, children: "Split payment" });
  const pressed = AddButton({ plus: false, pressed: true, children: "Split payment" });
  const notPressed = AddButton({ plus: false, pressed: false, children: "Split payment" });
  const disabled = AddButton({ plus: false, disabled: true, children: "Split payment" });
  for (const [name, element] of [["plain", plain], ["pressed", pressed], ["not pressed", notPressed], ["disabled", disabled]]) {
    const classes = element.props.className.split(/\s+/);
    assert.ok(classes.includes("border-dashed"), `${name}: dashed`);
    assert.ok(classes.includes("border-2") && classes.includes("border-emerald-900"), `${name}: 2px dark green`);
    assert.equal(element.props["data-look"], "add", `${name}: data-look add`);
  }
  assert.ok(pressed.props.className.split(/\s+/).includes("bg-green-100"), "pressed: the green fill of the tiles beside it");
  assert.equal(pressed.props["aria-pressed"], true);
  assert.equal(notPressed.props["aria-pressed"], false);
  assert.ok(notPressed.props.className.split(/\s+/).includes("bg-transparent"), "not pressed: no fill");
  assert.equal(plain.props["aria-pressed"], undefined, "no aria-pressed when the button is not a choice");
  assert.ok(disabled.props.disabled && disabled.props.className.includes("disabled:opacity-50"), "disabled: faded, still dashed");
});

test("the shared SplitIcons puts the plus signs between the icons, not before the first", async () => {
  const source = read("src/pos/PosComponents.jsx");
  const body = source.slice(source.indexOf("export function SplitIcons"));
  const order = [...body.slice(0, body.indexOf("\n}\n")).matchAll(/<Banknote|<Smartphone|<UserRound|\{plusSize\}|className=\{plusSize\}/g)].map((m) => m[0]);
  assert.deepEqual(order.slice(0, 3), ["<Banknote", "className={plusSize}", "<Smartphone"], "cash + phone");
});

test("19 shows the cash + phone icons with the label Split payment", () => {
  const source = read("src/pos/CreditScreens.jsx");
  assert.match(source, /aria-label=\{t\("split\.title"\)\}[\s\S]{0,400}<SplitIcons size=\{16\} \/>\s*<span[^>]*>\{t\("split\.title"\)\}<\/span>/);
});
