import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 47 (polish): Save is grey until the name changes then green; the Shop name field starts with
// the saved name (or shows My shop as a grey placeholder); the Payments and plan and Your records rows
// have a small green icon; Backup and restore has a second line; Done is bold.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
after(async () => {
  db.close();
  await db.delete();
});
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const nodes = (tree, predicate) => [...walk(tree)].filter(predicate);

async function mountSettings(overrides = {}) {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  const saved = [];
  const view = render({ type: SettingsProfitTools, props: {
    shopName: "My shop", onShopNameChange: (name) => saved.push(name), onBack() {}, onOpenBackup() {}, onOpenMomoSettings() {}, onOpenPlan() {},
    subscriptionEnabled: true, hasActiveSubscription: true, subscriptionExpiry: "2026-12-05T00:00:00.000Z", ...overrides
  } });
  return { view, saved };
}
const shopInput = (tree) => nodes(tree, (node) => node.type === "input" && node.props.maxLength === 60)[0];
const saveButton = (tree) => nodes(tree, (node) => node.type === "button" && textOf(node).trim() === "Save")[0];
const type = (view, value) => { shopInput(view.tree).props.onChange({ target: { value } }); view.rerender(); };
const row = (tree, title) => nodes(tree, (node) => node.type === "button" && textOf(node).includes(title)).at(-1);

// ---- Save colour states ------------------------------------------------------------------------

test("47 Save: grey and disabled while the name is unchanged", async () => {
  const { view } = await mountSettings({ shopName: "Ama Stores", savedShopName: "Ama Stores" });
  const save = saveButton(view.tree);
  assert.equal(save.props.disabled, true);
  assert.match(save.props.className, /bg-slate-200/);
  assert.match(save.props.className, /text-slate-500/);
  assert.doesNotMatch(save.props.className, /03543F|text-white/);
  type(view, "Ama Stores");
  assert.equal(saveButton(view.tree).props.disabled, true, "typing the same name changes nothing");
  type(view, "  Ama Stores  ");
  assert.equal(saveButton(view.tree).props.disabled, true, "spaces around the same name change nothing");
});

test("47 Save: grey and disabled while the name is empty", async () => {
  const { view } = await mountSettings({ shopName: "Ama Stores", savedShopName: "Ama Stores" });
  for (const empty of ["", "   "]) {
    type(view, empty);
    const save = saveButton(view.tree);
    assert.equal(save.props.disabled, true);
    assert.match(save.props.className, /bg-slate-200/);
  }
});

test("47 Save: green (#03543F) with white bold text and tappable as soon as the name changes", async () => {
  const { view } = await mountSettings({ shopName: "Ama Stores", savedShopName: "Ama Stores" });
  type(view, "Ama Stores 2");
  const save = saveButton(view.tree);
  assert.equal(save.props.disabled, false);
  assert.match(save.props.className, /bg-\[#03543F\]/);
  assert.match(save.props.className, /text-white/);
  assert.doesNotMatch(save.props.className, /bg-slate-200|text-slate-500/);
  assert.match(save.props.className, /font-extrabold/, "bold (800) from the class, now that no global rule overrides it");
  assert.equal(save.props.style, undefined);
});

test("47 Save: grey again after saving, green again on the next change", async () => {
  const { view, saved } = await mountSettings({ shopName: "Ama Stores", savedShopName: "Ama Stores" });
  type(view, "Ama Stores 2");
  nodes(view.tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  view.rerender();
  assert.deepEqual(saved, ["Ama Stores 2"]);
  assert.equal(saveButton(view.tree).props.disabled, true, "disabled after saving");
  assert.match(saveButton(view.tree).props.className, /bg-slate-200/);
  assert.equal(shopInput(view.tree).props.value, "Ama Stores 2", "the field keeps the saved name");
  type(view, "Third name");
  assert.match(saveButton(view.tree).props.className, /bg-\[#03543F\]/);
});

// ---- The Shop name field --------------------------------------------------------------------------

test("47 Shop name: starts with the saved name", async () => {
  const { view } = await mountSettings({ shopName: "Ama Stores", savedShopName: "Ama Stores" });
  assert.equal(shopInput(view.tree).props.value, "Ama Stores");
});

test("47 Shop name: with no saved name it shows My shop as grey placeholder text, and typing enables Save", async () => {
  const { view, saved } = await mountSettings({ shopName: "My shop", savedShopName: "" });
  const input = shopInput(view.tree);
  assert.equal(input.props.value, "", "empty, not My shop typed in");
  assert.equal(input.props.placeholder, "My shop");
  assert.match(input.props.className, /placeholder:text-slate-(400|500)/, "grey");
  assert.equal(saveButton(view.tree).props.disabled, true, "nothing to save yet");
  type(view, "Kofi Shop");
  assert.equal(saveButton(view.tree).props.disabled, false);
  nodes(view.tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(saved, ["Kofi Shop"]);
});

test("47 Shop name: a screen that only passes the header name still starts with it", async () => {
  const { view } = await mountSettings({ shopName: "Old caller" });
  assert.equal(shopInput(view.tree).props.value, "Old caller");
});

test("47 Shop name: PosApp tells Settings what was really saved and keeps it up to date", () => {
  const app = read("src/pos/PosApp.jsx");
  assert.match(app, /savedShopName=\{savedShopName\}/);
  assert.match(app, /onShopNameChange=\{\(name\) => \{ setShopName\(name\); setSavedShopName\(name\); \}\}/);
  assert.match(app, /function getRawSavedShopName\(\)/);
});

// ---- Rows --------------------------------------------------------------------------------------------

test("47 rows: MoMo payments, My plan and Backup and restore each have a small green icon on the left", async () => {
  const { view } = await mountSettings();
  const expected = { "MoMo payments": "smartphone", "My plan": "credit-card", "Backup and restore": "database" };
  for (const [title, icon] of Object.entries(expected)) {
    const button = row(view.tree, title);
    const svgs = nodes(button, (node) => node.type === "svg");
    assert.equal(svgs.length, 1, `${title} has one icon`);
    assert.match(svgs[0].props.className ?? "", new RegExp(`lucide-${icon}`), `${title}: ${icon}`);
    assert.equal(svgs[0].props["aria-hidden"], "true");
    const holder = nodes(button, (node) => node.type === "span" && /03543F/.test(node.props.className ?? "") && nodes(node, (child) => child.type === "svg").length === 1)[0];
    assert.ok(holder, `${title}: the icon is green`);
    const labelIndex = textOf(button).indexOf(title);
    assert.ok(labelIndex >= 0);
    // The icon comes first in the row (on the left of the text).
    const order = [...walk(button)].map((node) => (node.type === "svg" ? "icon" : node.props?.id?.endsWith("-title") ? "title" : null)).filter(Boolean);
    assert.deepEqual(order.slice(0, 2), ["icon", "title"], `${title}: icon on the left`);
  }
});

test("47 rows: Backup and restore has the second line Keep a copy of your records; MoMo keeps Not set up", async () => {
  const { view } = await mountSettings();
  assert.match(textOf(row(view.tree, "Backup and restore")), /Keep a copy of your records/);
  assert.match(textOf(row(view.tree, "MoMo payments")), /Not set up/);
  assert.match(textOf(row(view.tree, "My plan")), /Active until 05\/12\/2026/);
  const plain = await mountSettings({ subscriptionEnabled: false });
  assert.equal(row(plain.view.tree, "My plan"), undefined);
});

test("47 rows: the shop and preference rows have no icons", async () => {
  const { view } = await mountSettings();
  const preferences = nodes(view.tree, (node) => node.type === "label" && /Show estimated profit/.test(textOf(node)));
  assert.equal(preferences.length, 1, "one preference row");
  for (const label of preferences) assert.equal(nodes(label, (node) => node.type === "svg").length, 0);
});

// ---- Done ----------------------------------------------------------------------------------------------

test("47 Done: bold (800); Back is the shared PosBackButton", async () => {
  const { view } = await mountSettings();
  const done = nodes(view.tree, (node) => node.type === "button" && textOf(node).trim() === "Done").at(-1);
  assert.match(done.props.className, /font-extrabold/, "bold (800) from the shared primary button class");
  assert.equal(done.props.style, undefined);
  const back = nodes(view.tree, (node) => node.type === "button" && textOf(node).trim() === "‹ Back")[0];
  assert.equal(back.props.style, undefined, "Back is the shared PosBackButton");
  const components = read("src/pos/PosComponents.jsx");
  assert.match(components, /export function PosSecondaryButton[\s\S]*?text-base font-bold text-slate-900/);
  assert.match(components, /export function PosBackButton/);
  assert.match(components, /export function PosPrimaryButton[\s\S]*?text-lg font-extrabold text-white/);
});
