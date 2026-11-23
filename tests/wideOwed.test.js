import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { recordReminderSent } from "../src/db/reminders.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.screens "32, 29, 43 Owed" (D3, page type list_with_detail) and same_as_phone (b) no Back,
// (c) the per-row Collect, WhatsApp and Call move to the selected person's detail. The selection is in
// Owed's own route params (owedSelected), changed by replacing the current entry. Phone below 768 unchanged.

globalThis.HTMLElement ??= class {};
globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

// Live queries run for real (fake-indexeddb), once per query and deps; cleared by fresh() after a write.
let liveResults = new Map();
const realLiveQuery = (deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  setLiveQuery(realLiveQuery);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.reminders].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("hideAmounts", false);
});

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const LONG_NAME = "Abena Konadu Asantewaa Mensah-Bonsu Ofor"; // 40 characters

// Sera late 3 days and Amoto late 1 day (both with a valid number), Kofi due in 7 days (no number).
async function seed() {
  const now = Date.now();
  await recordCreditSale({ name: "Sera", phone: "0241234567", amountPesewas: 2000, dueDate: iso(now - 3 * DAY), now: now - 5 * DAY });
  await recordCreditSale({ name: "Amoto", phone: "0207654321", amountPesewas: 1200, dueDate: iso(now - DAY), now: now - 4 * DAY });
  await recordCreditSale({ name: "Kofi", amountPesewas: 900, dueDate: iso(now + 7 * DAY), now: now - 2 * DAY });
}

async function open(width) {
  const app = await openPosApp(width === undefined ? {} : { width });
  after(() => app.restoreConsole());
  return app;
}

async function openOwed(width) {
  const app = await open(width);
  if (app.sideNav()) await app.side("PeopleWhoOweYou");
  else await app.tap("Owed");
  assert.equal(app.route, "PeopleWhoOweYou");
  return app;
}

const all = (node) => [...walk(node)];
const byData = (node, name) => all(node).filter((child) => child?.props?.[name] !== undefined);
const accessibleName = (node) => (node.props["aria-label"] ?? textOf(node)).replace(/\s+/g, " ").trim();
const controls = (node) => all(node).filter((child) => child?.type === "button" || child?.type === "a" || child?.type === "input");
const controlNames = (node) => controls(node).map((control) => control.type === "input" ? `input:${control.props["aria-label"]}` : accessibleName(control));
const listColumn = (app) => byData(app.view.tree, "data-owed-list")[0];
const detailColumn = (app) => byData(app.view.tree, "data-owed-detail")[0];
const rowButton = (app, name) => controls(listColumn(app)).find((control) => accessibleName(control) === `Open ${name}’s details`);
async function select(app, name) {
  await rowButton(app, name).props.onClick();
  return app.settle();
}
async function search(app, text) {
  app.input("Search by name or phone").props.onChange({ target: { value: text } });
  return app.settle();
}

for (const width of [768, 1024, 1280, 1440]) {
  test(`${width}px: D3, the list on the left, the first person on the right, Add debt at the top right, no Back or Done`, async () => {
    await seed();
    const app = await openOwed(width);
    const columns = byData(app.view.tree, "data-owed-columns")[0];
    assert.ok(columns, "two columns");
    assert.match(columns.props.style.gridTemplateColumns, /^min\(400px, 44%\) minmax\(0, 1fr\)$/, "the list about 400px");
    const list = listColumn(app);
    assert.ok(all(list).some((node) => node?.type === "input" && node.props["aria-label"] === "Search by name or phone"), "search");
    assert.deepEqual(all(list).filter((node) => node?.props?.role === "tab").map((tab) => textOf(tab)), ["All", "Late", "Due soon"]);
    const summary = byData(list, "data-owed-summary")[0];
    assert.equal(textOf(summary).trim(), "Total owed to youGH₵41.00", "the plain summary card");
    assert.match(summary.props.className, /bg-\[#F1F5F9\]/);
    assert.doesNotMatch(summary.props.className, /rose|pink|border-l-/, "no pink block, no coloured edge");
    // A row is name, tag and amount only: one button, no Collect, WhatsApp, Call or Add contact.
    assert.deepEqual(controlNames(list).filter((name) => !name.startsWith("input:") && !["All", "Late", "Due soon"].includes(name)), ["Open Sera’s details", "Open Amoto’s details", "Open Kofi’s details"]);
    assert.equal(rowButton(app, "Sera").props["aria-current"], "true", "the first person is selected on open");
    assert.equal(app.params.owedSelected !== undefined, true, "kept in Owed's own params");
    const detail = detailColumn(app);
    assert.match(textOf(detail), /Sera/);
    const names = controlNames(detail);
    assert.ok(!names.includes("Back") && !names.includes("Done"), "no Back and no Done in the pane");
    assert.ok(names.includes("Collect") && names.includes("Send reminder on WhatsApp") && names.includes("Call"), names.join(", "));
    assert.ok(names.includes("Edit contact") && names.includes("Correct balance") && names.includes("+ Add to debt"), names.join(" | "));
    const top = byData(app.view.tree, "data-owed-top")[0];
    assert.match(top.props.className, /justify-between/, "title row, Add debt at the right");
    assert.match(textOf(top), /^Owed/);
    assert.deepEqual(controlNames(top), ["+ Add debt"], "the add look; the + is hidden from screen readers");
    assert.ok(!all(app.view.tree).some((node) => node?.type?.name === "PosBackButton"), "no Back on the page");
  });
}

test("selecting a person changes only the right column: same route, no new history entry, the list unchanged", async () => {
  await seed();
  const app = await openOwed(1280);
  const entries = window.history.entries.length;
  const listBefore = textOf(listColumn(app));
  const namesBefore = controlNames(listColumn(app));
  await select(app, "Kofi");
  assert.equal(app.route, "PeopleWhoOweYou", "never leaves the page");
  assert.equal(window.history.entries.length, entries, "nothing pushed");
  assert.equal(textOf(listColumn(app)), listBefore, "the list reads the same");
  assert.deepEqual(controlNames(listColumn(app)), namesBefore);
  assert.equal(rowButton(app, "Kofi").props["aria-current"], "true");
  assert.equal(rowButton(app, "Sera").props["aria-current"], undefined);
  assert.match(textOf(detailColumn(app)), /Kofi/);
  assert.doesNotMatch(textOf(detailColumn(app)), /Sera/);
  // 29 (on time): Collect, the Reminder button; Kofi has no number, so no Call in the pane.
  const names = controlNames(detailColumn(app));
  assert.ok(names.includes("WhatsApp reminder for Kofi"));
  assert.ok(!names.includes("Call"), "Call only with a valid number");
  assert.ok(!names.includes("Send reminder on WhatsApp"));
});

test("every control of 32 and 43 is on wide with the same label and accessible name (except Back, Done and the per-row buttons)", async () => {
  await seed();
  const phone = await openOwed();
  const phoneOwed = controlNames(all(phone.view.tree).find((node) => node?.type?.name === "PeopleWhoOweYou"))
    .filter((name) => !/^(Collect from|WhatsApp |Call |Add phone or WhatsApp contact for )/.test(name));
  await phone.tap("Open Sera’s details");
  assert.equal(phone.route, "DebtorDetail");
  const phoneDetail = controlNames(all(phone.view.tree).find((node) => node?.type?.name === "DebtorDetail"))
    .filter((name) => !["Back", "Done"].includes(name));
  phone.restoreConsole();
  resetBrowserBack();
  liveResults = new Map();
  const wide = await openOwed(1280);
  const wideOwed = controlNames(all(wide.view.tree).find((node) => node?.type?.name === "PeopleWhoOweYou"));
  const wideDetail = controlNames(detailColumn(wide));
  for (const name of phoneOwed) assert.ok(wideOwed.includes(name), `32 on wide has "${name}"`);
  assert.deepEqual([...wideDetail].sort(), [...phoneDetail].sort(), "43: the same controls, labels and names");
});

test("WhatsApp only through src/lib/openWhatsApp.js on Owed and the detail pane", () => {
  for (const file of ["src/pos/OwedScreens.jsx", "src/pos/DebtCollection.jsx"]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /from "\.\.\/lib\/openWhatsApp\.js"/, `${file} uses the shared opener`);
    assert.doesNotMatch(text, /wa\.me|api\.whatsapp|whatsapp:\/\/|window\.open\(/, `${file} builds no WhatsApp link itself`);
  }
});

test("late state (43) in the pane: Send reminder on WhatsApp; no Last reminder row until one is sent, then the key-value row", async () => {
  await seed();
  let app = await openOwed(1280);
  let detail = detailColumn(app);
  assert.ok(controlNames(detail).includes("Send reminder on WhatsApp"));
  assert.equal(byData(detail, "data-last-reminder").length, 0, "no row when no reminder was sent");
  app.restoreConsole();
  const sera = await db.customers.where("nameLower").equals("sera").first();
  await recordReminderSent({ customerId: sera.id, customerName: "Sera" });
  resetBrowserBack();
  liveResults = new Map();
  app = await openOwed(1280);
  detail = detailColumn(app);
  const row = byData(detail, "data-kv-row").find((node) => /Last reminder/.test(textOf(node))) ?? byData(detail, "data-last-reminder")[0];
  assert.ok(row, "the Last reminder row");
  assert.match(textOf(byData(detail, "data-last-reminder")[0]), /^today \d{2}:\d{2}$/);
  assert.doesNotMatch(textOf(detail), /days ago/);
});

test("search and filters keep a valid selection: kept while listed, otherwise the first listed person; nobody listed shows the empty wording", async () => {
  await seed();
  const app = await openOwed(1024);
  await select(app, "Kofi");
  await search(app, "kof");
  assert.equal(rowButton(app, "Kofi").props["aria-current"], "true", "still listed: still selected");
  await search(app, "");
  assert.equal(rowButton(app, "Kofi").props["aria-current"], "true");
  await app.tap("Late");
  assert.equal(rowButton(app, "Kofi"), undefined, "Kofi is not late");
  assert.equal(rowButton(app, "Sera").props["aria-current"], "true", "the first listed person");
  assert.match(textOf(detailColumn(app)), /Sera/);
  await app.tap("All");
  assert.equal(rowButton(app, "Sera").props["aria-current"], "true", "the selection moved to Sera");
  await search(app, "zzz");
  assert.match(textOf(listColumn(app)), /No one matches that search\./);
  assert.equal(byData(listColumn(app), "data-owed-empty").length, 1, "the existing empty wording");
  assert.equal(textOf(detailColumn(app)).trim(), "", "no person on the right");
  await search(app, "0207654321");
  assert.equal(rowButton(app, "Amoto").props["aria-current"], "true", "phone search finds Amoto and selects him");
});

test("a kept draft survives selecting another person and a sidebar tap", async () => {
  await seed();
  const app = await open(1280);
  await app.side("Sell");
  await app.keys(["1", "2", "5"]);
  await app.side("PeopleWhoOweYou");
  await select(app, "Amoto");
  await select(app, "Kofi");
  await app.side("TodaysTransactions");
  await app.phoneBack();
  assert.equal(app.route, "PeopleWhoOweYou");
  assert.equal(rowButton(app, "Kofi").props["aria-current"], "true", "the selection is kept after Back");
  await app.phoneBack();
  assert.equal(app.route, "Sell");
  assert.match(app.text(), /GH₵125\.00/, "the Sell draft is still there");
});

test("a 40-character name and GH₵12,345.00: the amount never wraps in the row or the summary", async () => {
  await recordCreditSale({ name: LONG_NAME, phone: "0241234567", amountPesewas: 1_234_500, dueDate: iso(Date.now() - DAY) });
  assert.equal(LONG_NAME.length, 40);
  const app = await openOwed(768);
  const amount = byData(listColumn(app), "data-party-amount")[0];
  assert.equal(textOf(amount), "GH₵12,345.00");
  assert.match(amount.props.className, /whitespace-nowrap/);
  assert.match(byData(listColumn(app), "data-owed-total")[0].props.className, /whitespace-nowrap/);
  assert.match(byData(listColumn(app), "data-party-name")[0].props.className, /line-clamp-2/);
});

test("phone below 768 is unchanged: no columns, the phone rows with Collect, WhatsApp and Call", async () => {
  await seed();
  for (const width of [undefined, 767]) {
    resetBrowserBack();
    liveResults = new Map();
    const app = await openOwed(width);
    assert.equal(byData(app.view.tree, "data-owed-columns").length, 0, `${width ?? "phone"}: no wide columns`);
    const names = controlNames(app.view.tree);
    assert.ok(names.includes("Collect from Sera") && names.includes("WhatsApp Sera") && names.includes("Call Sera"));
    assert.equal(app.params.owedSelected, undefined, "the phone stores no selection");
    await app.tap("Open Sera’s details");
    assert.equal(app.route, "DebtorDetail", "the row still opens the detail screen");
    app.restoreConsole();
  }
});
