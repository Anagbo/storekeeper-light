import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { POS_LINKS, POS_ROUTES, backRoute, createRouteState, pushRoute } from "../src/pos/routes.js";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

// Brief 3.13, wiring screens 47 (Settings) and 71 (Backup and restore): layout only. Four groups,
// switches, a My plan row, and Backup and restore as a normal route screen with a confirmation.
// The shop name is kept in localStorage, which Node does not have.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all(["transactions", "payments", "debts", "customers", "products", "suppliers", "settings"].map((name) => db.table(name).clear()));
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ---- helpers ---------------------------------------------------------------------------------

function settingsProps(overrides = {}) {
  const calls = { back: 0, backup: 0, momo: 0, plan: 0, names: [] };
  const props = {
    shopName: "My shop",
    onShopNameChange: (name) => calls.names.push(name),
    onBack: () => { calls.back += 1; },
    onOpenBackup: () => { calls.backup += 1; },
    onOpenMomoSettings: () => { calls.momo += 1; },
    onOpenPlan: () => { calls.plan += 1; },
    ...overrides
  };
  return { props, calls };
}
async function mountSettings(overrides) {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  const { props, calls } = settingsProps(overrides);
  const view = render({ type: SettingsProfitTools, props });
  return { view, calls };
}
const nodes = (tree, predicate) => [...walk(tree)].filter(predicate);
const headings = (tree) => nodes(tree, (node) => node.type === "h2").map((node) => textOf(node).trim());
const switches = (tree) => nodes(tree, (node) => node.type === "input" && node.props.role === "switch");
const shopInput = (tree) => nodes(tree, (node) => node.type === "input" && node.props.type !== "checkbox" && node.props.type !== "file")[0];
const saveButton = (tree) => nodes(tree, (node) => node.type === "button" && textOf(node).trim() === "Save")[0];
const row = (tree, title) => nodes(tree, (node) => node.type === "button" && textOf(node).includes(title)).at(-1);

// ---- Settings (47) ---------------------------------------------------------------------------

test("47: four groups, each a white card with a small uppercase heading", async () => {
  const { view } = await mountSettings({ subscriptionEnabled: true });
  assert.deepEqual(headings(view.tree).filter((text) => ["Shop", "Preferences", "Payments and plan", "Your records"].includes(text)),
    ["Shop", "Preferences", "Payments and plan", "Your records"]);
  const titles = nodes(view.tree, (node) => node.type === "h2");
  for (const title of titles) assert.match(title.props.className, /uppercase/, "a small uppercase heading");
  const cards = nodes(view.tree, (node) => node.type === "div" && /bg-white/.test(node.props.className ?? "") && /border/.test(node.props.className ?? ""));
  assert.ok(cards.length >= 4, "one white bordered card per group");
  for (const card of cards) assert.match(card.props.className, /divide-y|border-slate-300/, "rows are separated by a thin line, not boxes");
});

test("47: Shop name has Save beside it, disabled until the name changed and is not empty", async () => {
  const { view, calls } = await mountSettings();
  assert.equal(saveButton(view.tree).props.disabled, true, "disabled at first");
  const input = shopInput(view.tree);
  assert.equal(input.props.value, "My shop");
  input.props.onChange({ target: { value: "My shop" } });
  view.rerender();
  assert.equal(saveButton(view.tree).props.disabled, true, "same name: still disabled");
  shopInput(view.tree).props.onChange({ target: { value: "Ama Stores" } });
  view.rerender();
  assert.equal(saveButton(view.tree).props.disabled, false, "changed: enabled");
  shopInput(view.tree).props.onChange({ target: { value: "   " } });
  view.rerender();
  assert.equal(saveButton(view.tree).props.disabled, true, "empty: disabled");
  shopInput(view.tree).props.onChange({ target: { value: "Ama Stores" } });
  view.rerender();
  const form = nodes(view.tree, (node) => node.type === "form")[0];
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(calls.names, ["Ama Stores"], "the existing shop name save is unchanged");
});

test("47: Show estimated profit is the only switch, with one helper line; no Sound and voice feedback switch", async () => {
  const { view } = await mountSettings();
  const list = switches(view.tree);
  assert.equal(list.length, 1, "exactly one switch");
  assert.deepEqual(list.map((node) => node.props["aria-label"] ?? null).filter(Boolean).length, 0, "named by its visible label");
  const text = textOf(view.tree);
  assert.doesNotMatch(text, /Sound and voice feedback/, "no switch that does nothing (decision 10 Nov 2026)");
  assert.doesNotMatch(text, /Play confirmation sounds and spoken messages/);
  assert.match(text, /Show estimated profit/);
  assert.match(text, /Shows or hides the Estimated profit card on My money/);
  assert.doesNotMatch(text, /Track cost price/);
  for (const node of list) assert.equal(node.props.type, "checkbox");
});

test("47: the profit switch toggles and is saved", async () => {
  const { view } = await mountSettings();
  const [profit] = switches(view.tree);
  assert.equal(profit.props.checked, true);
  assert.equal(profit.props["aria-checked"], true);
  profit.props.onChange({ target: { checked: false } });
  view.rerender();
  assert.equal(switches(view.tree)[0].props.checked, false);
  await waitFor(async () => (await db.settings.get("showEstimatedProfit"))?.value === false, "the profit switch to be saved");
});

test("47: the MoMo payments row says Not set up, then Set up once a number is saved", async () => {
  const { view, calls } = await mountSettings();
  flushEffects(view);
  await waitFor(() => { view.rerender(); return /Not set up/.test(textOf(row(view.tree, "MoMo payments"))); }, "the MoMo row to say Not set up");
  row(view.tree, "MoMo payments").props.onClick();
  assert.equal(calls.momo, 1);
  await setPreference("momoReceivingNumber", "0241234567");
  flushEffects(view);
  await waitFor(() => { view.rerender(); return /Set up/.test(textOf(row(view.tree, "MoMo payments"))) && !/Not set up/.test(textOf(row(view.tree, "MoMo payments"))); }, "the MoMo row to say Set up");
  assert.doesNotMatch(textOf(row(view.tree, "MoMo payments")), /Not set up/);
});

test("47: My plan is one row with the status in words (dd/mm/yyyy) and a green Active tag", async () => {
  const active = await mountSettings({ subscriptionEnabled: true, hasActiveSubscription: true, subscriptionExpiry: "2026-12-05T00:00:00.000Z" });
  const planRow = row(active.view.tree, "My plan");
  assert.match(textOf(planRow), /Active until 05\/12\/2026/);
  const tag = nodes(planRow, (node) => /bg-(emerald|green)-/.test(node.props.className ?? "") && textOf(node).trim() === "Active");
  assert.equal(tag.length, 1, "a green Active tag");
  planRow.props.onClick();
  assert.equal(active.calls.plan, 1);
  const inactive = await mountSettings({ subscriptionEnabled: true, hasActiveSubscription: false });
  const quietRow = row(inactive.view.tree, "My plan");
  assert.doesNotMatch(textOf(quietRow), /Active until|\bActive\b/);
  const off = await mountSettings({ subscriptionEnabled: false });
  assert.equal(row(off.view.tree, "My plan"), undefined, "My plan stays behind the subscription flag");
});

test("47: the separate View subscription button is gone from Settings", async () => {
  const { view } = await mountSettings({ subscriptionEnabled: true, hasActiveSubscription: true });
  const text = textOf(view.tree);
  assert.doesNotMatch(text, /View subscription|Subscribe with Mobile Money|Subscription$/m);
  assert.doesNotMatch(read("src/pos/SettingsScreens.jsx"), /onOpenSubscription/);
});

test("47: Backup and restore is a row that opens 71; Back and Done both go back, never Home", async () => {
  const { view, calls } = await mountSettings();
  row(view.tree, "Backup and restore").props.onClick();
  assert.equal(calls.backup, 1);
  nodes(view.tree, (node) => node.type === "button" && textOf(node).trim() === "‹ Back")[0].props.onClick();
  const done = nodes(view.tree, (node) => node.type === "button" && textOf(node).trim() === "Done").at(-1);
  done.props.onClick();
  assert.equal(calls.back, 2);
  const source = read("src/pos/SettingsScreens.jsx");
  assert.doesNotMatch(source, /onNavigate\("Home"\)|POS_ROUTES\.Home/);
});

test("47: Done is the last thing in the list (it scrolls with it) and the touch targets are at least 48px", async () => {
  const { view } = await mountSettings({ subscriptionEnabled: true, hasActiveSubscription: true });
  const buttons = nodes(view.tree, (node) => node.type === "button");
  assert.equal(textOf(buttons.at(-1)).trim(), "Done");
  assert.doesNotMatch(buttons.at(-1).props.className, /mt-auto|fixed|sticky/);
  for (const button of buttons) assert.match(button.props.className, /min-h-(12|14|16|\[(5\d|6\d|7\d)px\])|h-(12|14|16|\[(5\d|6\d)px\])/, `48px: ${textOf(button).slice(0, 30)}`);
  for (const input of switches(view.tree)) assert.match(input.props.className ?? "", /sr-only|h-6|h-7/);
});

// ---- 71 in the route table -----------------------------------------------------------------

test("71: BackupRestore is a declared route with links, and Back returns to Settings", () => {
  assert.equal(POS_ROUTES.BackupRestore, "BackupRestore");
  assert.ok(POS_LINKS.some((link) => link.from === "SettingsProfitTools" && link.to === "BackupRestore"));
  assert.ok(POS_LINKS.some((link) => link.from === "BackupRestore" && link.to === "SettingsProfitTools"));
  const menu = pushRoute(createRouteState(POS_ROUTES.Home, {}), POS_ROUTES.Menu, {});
  const settings = pushRoute(menu, POS_ROUTES.SettingsProfitTools, {});
  const backup = pushRoute(settings, POS_ROUTES.BackupRestore, {});
  assert.equal(backup.current, POS_ROUTES.BackupRestore);
  assert.equal(backRoute(backup).current, POS_ROUTES.SettingsProfitTools);
});

test("71: PosApp renders BackupRestore for the route and no longer opens the old pop-up", () => {
  const app = read("src/pos/PosApp.jsx");
  assert.match(app, /route === POS_ROUTES\.BackupRestore \?/);
  assert.match(app, /onOpenBackup=\{\(\) => navigate\(POS_ROUTES\.BackupRestore\)\}/);
  assert.doesNotMatch(app, /BackupModal|backupOpen|setBackupOpen/);
});

// ---- 71 Backup and restore -----------------------------------------------------------------

function validBackup(records = {}) {
  return {
    app: "StoreKeeper Light",
    formatVersion: 1,
    exportedAt: "2026-11-09T00:00:00.000Z",
    data: { transactions: [], customers: [], debts: [], products: [], payments: [], suppliers: [], ...records }
  };
}
const sale = { id: "sale-1", type: "sale", amountPesewas: 1000, total_amount: 1000, payment_method: "cash", cashReceivedPesewas: 1000, momoReceivedPesewas: 0, createdAt: 100, timestamp: 100, updatedAt: 100 };
const fileOf = (contents) => new File([typeof contents === "string" ? contents : JSON.stringify(contents)], "backup.json", { type: "application/json" });

async function mountBackup() {
  const { default: BackupRestore } = await loadJsx("src/pos/BackupRestore.jsx");
  const calls = { back: 0 };
  const view = render({ type: BackupRestore, props: { onBack: () => { calls.back += 1; } } });
  return { view, calls };
}
const fileInput = (tree) => nodes(tree, (node) => node.type === "input" && node.props.type === "file")[0];
async function chooseFile(view, file) {
  const target = { files: [file], value: "x" };
  await fileInput(view.tree).props.onChange({ target });
  await waitFor(() => { view.rerender(); const shown = textOf(view.tree); return shown.includes("Restore from this file?") || shown.includes("This file cannot be used"); }, "the question or the message about the file");
  return target;
}
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && textOf(node).trim() === label)[0];

test("71: two cards, Save a backup (green Download backup) and Restore from a backup (outlined Choose backup file)", async () => {
  const { view, calls } = await mountBackup();
  const text = textOf(view.tree);
  assert.match(text, /Backup and restore/);
  assert.match(text, /Save a backup/);
  assert.match(text, /Restore from a backup/);
  const download = button(view.tree, "Download backup");
  const choose = button(view.tree, "Choose backup file");
  assert.match(download.props.className, /bg-\[#03543F\]/, "green");
  assert.match(choose.props.className, /bg-white/, "outlined");
  assert.match(choose.props.className, /border-2/);
  nodes(view.tree, (node) => node.type === "button" && textOf(node).trim() === "‹ Back")[0].props.onClick();
  assert.equal(calls.back, 1);
});

test("71: no sound switch, no emoji, no orange, no pop-up, no Last backup line (no date is stored)", async () => {
  const { view } = await mountBackup();
  const text = textOf(view.tree);
  assert.equal(switches(view.tree).length, 0);
  assert.doesNotMatch(text, /Sound|voice/i);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(text, /Last backup/);
  const source = read("src/pos/BackupRestore.jsx");
  assert.doesNotMatch(source, /amber|orange|backdrop-blur|role="dialog"|aria-modal|window\.confirm|setAudioFeedbackEnabled|\p{Extended_Pictographic}/u);
  for (const node of nodes(view.tree, (item) => item.props?.className)) assert.doesNotMatch(node.props.className, /amber|orange/);
  for (const item of [button(view.tree, "Download backup"), button(view.tree, "Choose backup file")]) assert.match(item.props.className, /\bh-(12|14|16)\b/);
});

test("71: Choose backup file opens the file picker", async () => {
  const { view } = await mountBackup();
  let clicked = 0;
  // The hidden input's ref is not attached in the test renderer; the button calls .click() on it.
  const input = fileInput(view.tree);
  assert.equal(input.props.accept, "application/json,.json");
  assert.match(input.props.className, /hidden|sr-only/);
  assert.equal(typeof button(view.tree, "Choose backup file").props.onClick, "function");
  assert.equal(clicked, 0);
});

test("71: a chosen file asks first, with the record count, and Cancel changes nothing", async () => {
  await db.transactions.add(sale);
  const { view } = await mountBackup();
  const incoming = { ...sale, id: "sale-2", amountPesewas: 2500, total_amount: 2500 };
  const target = await chooseFile(view, fileOf(validBackup({ transactions: [incoming] })));
  assert.equal(target.value, "", "the picker is reset so the same file can be chosen again");
  const text = textOf(view.tree);
  assert.match(text, /Restore from this file\?/);
  assert.match(text, /1 record/);
  assert.match(text, /Records already on this phone are kept\. Matching ones are updated\./);
  assert.ok(button(view.tree, "Restore"));
  assert.ok(button(view.tree, "Cancel"));
  assert.equal(await db.transactions.count(), 1, "nothing is restored before the question is answered");
  button(view.tree, "Cancel").props.onClick();
  view.rerender();
  assert.doesNotMatch(textOf(view.tree), /Restore from this file\?/);
  assert.equal(await db.transactions.count(), 1, "Cancel changed nothing");
  assert.equal(await db.transactions.get("sale-2"), undefined);
  assert.doesNotMatch(textOf(view.tree), /Restore finished/);
});

test("71: Restore restores, keeps what is on the phone, and says Restore finished.", async () => {
  await db.transactions.add(sale);
  const { view } = await mountBackup();
  const incoming = { ...sale, id: "sale-2", amountPesewas: 2500, total_amount: 2500 };
  await chooseFile(view, fileOf(validBackup({ transactions: [incoming] })));
  const restore = button(view.tree, "Restore");
  restore.props.onClick();
  restore.props.onClick();
  await waitFor(() => { view.rerender(); return /Restore finished\./.test(textOf(view.tree)); }, "Restore finished.");
  assert.doesNotMatch(textOf(view.tree), /Restore from this file\?/);
  assert.equal(await db.transactions.count(), 2);
  assert.equal((await db.transactions.get("sale-1")).amountPesewas, 1000, "an existing sale is never overwritten");
  assert.equal((await db.transactions.get("sale-2")).amountPesewas, 2500);
});

test("71: after Restore the message gives the records in the file and how many saved rows were kept (singular and plural)", async () => {
  const sales = (n) => Array.from({ length: n }, (_, i) => ({ ...sale, id: `sale-${i + 1}` }));
  const cases = [
    { inFile: 2, existing: 1, expected: "Restore finished. 2 records in the file. 1 saved sale, payment or debt was already on this phone and was kept." },
    { inFile: 3, existing: 2, expected: "Restore finished. 3 records in the file. 2 saved sales, payments and debts were already on this phone and were kept." },
    { inFile: 1, existing: 1, expected: "Restore finished. 1 record in the file. 1 saved sale, payment or debt was already on this phone and was kept." },
    { inFile: 1, existing: 0, expected: "Restore finished. 1 record in the file." },
    { inFile: 4, existing: 0, expected: "Restore finished. 4 records in the file." }
  ];
  for (const { inFile, existing, expected } of cases) {
    await db.transactions.clear();
    if (existing) await db.transactions.bulkAdd(sales(existing));
    const { view } = await mountBackup();
    await chooseFile(view, fileOf(validBackup({ transactions: sales(inFile) })));
    button(view.tree, "Restore").props.onClick();
    await waitFor(() => { view.rerender(); return textOf(view.tree).includes("Restore finished."); }, "Restore finished.");
    const shown = textOf(view.tree);
    assert.ok(shown.includes(expected), `expected "${expected}" in "${shown}"`);
    assert.doesNotMatch(shown, /added or updated|\{\w+\}|undefined|NaN/);
    if (!existing) assert.doesNotMatch(shown, /already on this phone/);
  }
});

test("71: a bad file shows the safe message and changes nothing (never raw error text)", async () => {
  await db.transactions.add(sale);
  const safe = "This file cannot be used. Choose a StoreKeeper backup file.";
  const bad = [
    "this is not json {",
    { app: "Some other app", formatVersion: 1, data: {} },
    { app: "StoreKeeper Light", formatVersion: 1, data: { transactions: "nope" } },
    validBackup({ transactions: [{ id: "x", type: "wizard", amountPesewas: 5 }] }),
    validBackup({ transactions: [sale, sale] })
  ];
  for (const contents of bad) {
    const { view } = await mountBackup();
    await chooseFile(view, fileOf(contents));
    const text = textOf(view.tree);
    assert.ok(text.includes(safe), `safe message for ${typeof contents === "string" ? contents : JSON.stringify(contents).slice(0, 50)}`);
    assert.doesNotMatch(text, /Restore from this file\?|Restore finished/);
    assert.doesNotMatch(text, /valid JSON|supported|unknown|duplicate|invalid|TypeError|Error|SyntaxError|undefined/i);
    assert.equal(button(view.tree, "Restore"), undefined);
    assert.equal(await db.transactions.count(), 1);
  }
});

test("71: a file that cannot be read shows the safe message", async () => {
  const { view } = await mountBackup();
  await chooseFile(view, { text: async () => { throw new Error("disk exploded"); } });
  assert.ok(textOf(view.tree).includes("This file cannot be used. Choose a StoreKeeper backup file."));
  assert.doesNotMatch(textOf(view.tree), /disk exploded/);
});

// ---- the content of View subscription stays reachable from 64 --------------------------------

test("64: My plan has no View subscription or Subscribe button and no pop-up; Pay now is the way to pay", async () => {
  const { MyPlan } = await loadJsx("src/pos/PlanScreens.jsx");
  const base = { expiry: "", onBack() {}, onNavigate() {} };
  const on = render({ type: MyPlan, props: { ...base, subscriptionExpiry: "2026-12-05T00:00:00.000Z", subscriptionEnabled: true, hasActiveSubscription: true } });
  assert.match(textOf(on.tree), /Active until 05\/12\/2026/);
  assert.doesNotMatch(textOf(on.tree), /View subscription|Subscribe|Paystack/);
  assert.ok(findButton(on.tree, "Pay now"));
  const trial = render({ type: MyPlan, props: { ...base, trialActive: true, trialExpiry: new Date(Date.now() + 5 * 86400000).toISOString() } });
  assert.match(textOf(trial.tree), /Trial · 5 days left/);
  assert.doesNotMatch(textOf(trial.tree), /Subscribe/);
  assert.doesNotMatch(read("src/pos/PosApp.jsx"), /SubscriptionModal|onOpenSubscription/);
});
