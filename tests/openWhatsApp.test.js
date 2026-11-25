import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { isPhoneBrowser, openWhatsApp, whatsAppDigits } from "../src/lib/openWhatsApp.js";
import { loadJsx, render, setLiveQuery, walk } from "./helpers/renderJsx.js";

// rules_global.whatsapp_links (4d, 21 Nov 2026): one shared opener for every WhatsApp action. On a
// phone a valid number opens whatsapp://send?phone=233…&text=… (the installed app; offline the share
// sheet instead, 4g);
// wa.me only on a desktop browser; an invalid number or none goes to the share sheet, then the links
// without a number. Nothing is sent automatically.

const ANDROID = "Mozilla/5.0 (Linux; Android 13; Phone) Mobile";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const TEXT = "Hi & bye";
const ENCODED = "Hi%20%26%20bye";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  else delete globalThis.navigator;
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
  setLiveQuery(null);
});

function device({ userAgent = ANDROID, share = null } = {}) {
  const calls = { location: [], open: [], share: [] };
  const nav = { userAgent, onLine: true };
  if (share === "works") nav.share = async (data) => { calls.share.push(data); };
  if (share === "cancel") nav.share = async (data) => { calls.share.push(data); throw Object.assign(new Error("closed"), { name: "AbortError" }); };
  if (share === "fails") nav.share = async (data) => { calls.share.push(data); throw new Error("not allowed"); };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
  const win = { open: (...args) => { calls.open.push(args); }, location: { set href(link) { calls.location.push(link); } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  return calls;
}

// ---- unit tests -----------------------------------------------------------------------------------------

test("phone browsers: Android, iPhone and iPad; a desktop browser is not one", () => {
  for (const userAgent of [ANDROID, IPHONE, IPAD]) assert.equal(isPhoneBrowser({ userAgent }), true, userAgent);
  assert.equal(isPhoneBrowser({ userAgent: DESKTOP }), false);
  assert.equal(isPhoneBrowser(undefined), false);
});

test("number forms 0241234567, +233241234567 and 233241234567 all open the same chat in the app", async () => {
  for (const phone of ["0241234567", "+233241234567", "233241234567", "024 123 4567", "+233 24 123 4567"]) {
    assert.equal(whatsAppDigits(phone), "233241234567", phone);
    const calls = device({ share: "works" });
    assert.equal(await openWhatsApp({ text: TEXT, phone }), "app", phone);
    assert.deepEqual(calls.location, [`whatsapp://send?phone=233241234567&text=${ENCODED}`], phone);
    assert.deepEqual(calls.open, [], `${phone}: no web page on a phone`);
    assert.deepEqual(calls.share, [], `${phone}: no share sheet with a valid number`);
  }
});

// 4g (21 Nov 2026): offline the share sheet comes first, even with a valid number
// (tests/whatsAppOffline.test.js); online the app link opens directly on iPhone and iPad too.
test("valid number on a phone opens the app link, also on iPhone and iPad; offline the share sheet instead", async () => {
  for (const userAgent of [IPHONE, IPAD]) {
    let calls = device({ userAgent, share: "works" });
    assert.equal(await openWhatsApp({ text: TEXT, phone: "+233241234567" }), "app");
    assert.deepEqual(calls.location, [`whatsapp://send?phone=233241234567&text=${ENCODED}`]);
    assert.deepEqual(calls.open, []);
    calls = device({ userAgent, share: "works" });
    navigator.onLine = false;
    assert.equal(await openWhatsApp({ text: TEXT, phone: "+233241234567" }), "share");
    assert.deepEqual(calls.location, []);
    assert.deepEqual(calls.share, [{ text: TEXT }]);
  }
});

test("valid number on a desktop browser: wa.me with the number in a new tab", async () => {
  const calls = device({ userAgent: DESKTOP, share: "works" });
  assert.equal(await openWhatsApp({ text: TEXT, phone: "0241234567" }), "web");
  assert.deepEqual(calls.open, [[`https://wa.me/233241234567?text=${ENCODED}`, "_blank", "noopener,noreferrer"]]);
  assert.deepEqual(calls.location, []);
});

test("an invalid number is treated as no number: the share sheet", async () => {
  for (const phone of ["abc", "0301234567", "12345", "+44 7700 900123"]) {
    assert.equal(whatsAppDigits(phone), "", phone);
    const calls = device({ share: "works" });
    assert.equal(await openWhatsApp({ text: TEXT, phone, title: "Remind" }), "share", phone);
    assert.deepEqual(calls.share, [{ title: "Remind", text: TEXT }]);
    assert.deepEqual(calls.location, []);
  }
});

test("no number: the share sheet; closing it is cancelled, not an error, and opens nothing", async () => {
  let calls = device({ share: "works" });
  assert.equal(await openWhatsApp({ text: TEXT }), "share");
  assert.deepEqual(calls.share, [{ text: TEXT }]);
  calls = device({ share: "cancel" });
  assert.equal(await openWhatsApp({ text: TEXT, phone: "" }), "cancelled");
  assert.deepEqual(calls.location, []);
  assert.deepEqual(calls.open, []);
});

test("no number and no share sheet (or a failing one): the app without a number on a phone, wa.me on desktop", async () => {
  let calls = device({ share: null });
  assert.equal(await openWhatsApp({ text: TEXT }), "app");
  assert.deepEqual(calls.location, [`whatsapp://send?text=${ENCODED}`]);
  calls = device({ share: "fails" });
  assert.equal(await openWhatsApp({ text: TEXT }), "app");
  assert.deepEqual(calls.location, [`whatsapp://send?text=${ENCODED}`]);
  calls = device({ userAgent: DESKTOP, share: null });
  assert.equal(await openWhatsApp({ text: TEXT }), "web");
  assert.equal(calls.open[0][0], `https://wa.me/?text=${ENCODED}`);
});

test("a text is required; nothing opens without one", async () => {
  const calls = device();
  await assert.rejects(() => openWhatsApp({ text: "", phone: "0241234567" }), TypeError);
  assert.deepEqual(calls.location, []);
});

// ---- scan: no WhatsApp link is built anywhere but the opener --------------------------------------------

const root = fileURLToPath(new URL("../", import.meta.url));
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${path}/`);
    return /\.(js|jsx)$/.test(entry.name) ? [path.slice(root.length)] : [];
  });
}

test("scan: wa.me and whatsapp:// appear only in src/lib/openWhatsApp.js", () => {
  const files = sourceFiles(`${root}src/`);
  assert.ok(files.length > 50, "the scan sees the source");
  const offenders = files.filter((path) => path !== "src/lib/openWhatsApp.js" && /wa\.me|whatsapp:\/\/|api\.whatsapp/i.test(readFileSync(`${root}${path}`, "utf8")));
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(`${root}src/lib/openWhatsApp.js`, "utf8"), /whatsapp:\/\/send/);
});

test("scan: every screen that opens WhatsApp imports the opener (or sendReceipt, which calls it)", () => {
  for (const file of ["src/pos/Home.jsx", "src/pos/OwedScreens.jsx", "src/pos/DebtCollection.jsx", "src/pos/receiptShare.js"]) {
    assert.match(readFileSync(`${root}${file}`, "utf8"), /import \{ openWhatsApp[^}]*\} from "\.\.\/lib\/openWhatsApp\.js"/, file);
  }
  const read = (file) => readFileSync(`${root}${file}`, "utf8");
  assert.match(read("src/pos/ReceiptActions.jsx"), /sendReceipt/);
  // The saved-as-credit screens (Add debt saved, Sell → Owe) open WhatsApp only through the shared
  // SavedCreditReceiptActions, which uses ReceiptActions → sendReceipt → openWhatsApp. Each link of that
  // chain is checked, and the screen itself must not open WhatsApp on its own.
  assert.match(read("src/pos/ManualDebtScreens.jsx"), /import SavedCreditReceiptActions\b[^;]*from "\.\/SavedCreditReceiptActions\.jsx"/);
  assert.match(read("src/pos/SavedCreditReceiptActions.jsx"), /import \{[^}]*useReceiptActions[^}]*\} from "\.\/ReceiptActions\.jsx"/);
  assert.match(read("src/pos/ReceiptActions.jsx"), /import \{[^}]*sendReceipt[^}]*\} from "\.\/receiptShare\.js"/);
  assert.match(read("src/pos/ReceiptActions.jsx"), /await sendReceipt\(/);
  assert.match(read("src/pos/receiptShare.js"), /return openWhatsApp\(/);
  assert.doesNotMatch(read("src/pos/ManualDebtScreens.jsx"), /window\.open|wa\.me|location\.(href|assign)/);
});

// Item 5 for chunk E: the texts that go through the opener, and the 7-day sheet, join no two facts with " · ".
test("scan: no ' · ' in the reminder text or the Send another reminder? sheet", async () => {
  const { buildWhatsAppReminderText } = await import("../src/utils/whatsapp.js");
  const { reminderAgainText } = await import("../src/pos/reminderLabel.js");
  const now = new Date(2026, 10, 21, 12, 0);
  for (const text of [
    buildWhatsAppReminderText("Ama", 8000, "My shop"),
    buildWhatsAppReminderText("Nana Akosua Frimpomaa", 1234500),
    reminderAgainText("Ama", now.getTime() - 3_600_000, now),
    reminderAgainText("Ama", now.getTime() - 3 * 86_400_000, now)
  ]) assert.doesNotMatch(text, / · /, text);
});

// ---- Home 22: the reminder names the real shop ----------------------------------------------------------

async function homeWhatsApp(shopName) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({
    totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 8000, hideAmounts: false,
    urgentDebt: { customerName: "ama", phone: "+233241234567", amountPesewas: 8000, dueDate: "2026-01-01", debtId: "d1" },
    urgentPerson: { customerId: "c1", name: "ama" }, urgentLastReminderAt: 0,
    owed: { people: 1, late: 1 }, uncounted: { sales: 0, other: 0 }
  }));
  const view = render({ type: Home, props: { onNavigate() {}, shopName } });
  const button = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "WhatsApp Ama");
  return { view, button };
}

test("22 Home: the WhatsApp reminder is a button that opens Ama's chat with the real shop name", async () => {
  const { button } = await homeWhatsApp("Auntie Esi Provisions");
  assert.equal(button.type, "button", "no wa.me link");
  const calls = device();
  await button.props.onClick({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.location.length, 1);
  const link = calls.location[0];
  assert.match(link, /^whatsapp:\/\/send\?phone=233241234567&text=/);
  const text = decodeURIComponent(link.split("text=")[1]);
  assert.match(text, /from \*Auntie Esi Provisions\*/);
  assert.doesNotMatch(text, /StoreKeeper Light/);
});

test("22 Home: PosApp passes the shop name to Home (both places it renders Home)", () => {
  const source = readFileSync(`${root}src/pos/PosApp.jsx`, "utf8");
  const homes = source.match(/<Home\b[^>]*>/g) ?? [];
  assert.equal(homes.length, 2);
  for (const tag of homes) assert.match(tag, /shopName=\{shopName\}/, tag);
});

// ---- 32 Owed list (Ama's case, 4c): a valid number opens her chat; an invalid one shows Add phone -------

async function owedRow(phone) {
  const { db } = await import("../src/db/db.js");
  const { loadUnpaidDebtPage } = await import("../src/pos/owed.js");
  await db.debts.clear();
  await db.debts.put({ id: "d1", customerId: "c1", customerName: "Ama", phone, status: "unpaid", amountPesewas: 8000, total_owed: 8000, dueDate: "2026-01-01", isInstallmentPlan: false });
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: [{ id: "c1", name: "Ama", nameLower: "ama", phone }], reminderEvents: [] };
  setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  const { flushEffects } = await import("./helpers/renderJsx.js");
  flushEffects(view);
  view.rerender();
  return view;
}

test("32 Owed row: with a valid number, WhatsApp is a button that opens her chat in the app (no wa.me, no picker)", async () => {
  const view = await owedRow("+233241234567");
  const button = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "WhatsApp Ama");
  assert.equal(button.type, "button");
  assert.ok(![...walk(view.tree)].some((node) => node.type === "a" && /wa\.me|whatsapp:/.test(String(node.props.href))));
  const calls = device({ share: "works" });
  await button.props.onClick({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.share.length, 0, "not the share sheet contact picker");
  assert.match(calls.location[0], /^whatsapp:\/\/send\?phone=233241234567&text=Hello%20\*Ama\*.*My%20shop/);
});

// 4g (21 Nov 2026): the phone tests' case, offline with a valid number on 22 and 32.
test("22 Home and 32 Owed row offline with a valid number: the share sheet with the reminder, no direct link", async () => {
  const { button: home } = await homeWhatsApp("Auntie Esi Provisions");
  const owed = [...walk((await owedRow("+233241234567")).tree)].find((node) => node.props?.["aria-label"] === "WhatsApp Ama");
  for (const [screen, button, shop] of [["22", home, "Auntie Esi Provisions"], ["32", owed, "My shop"]]) {
    const calls = device({ share: "works" });
    navigator.onLine = false;
    await button.props.onClick({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls.location, [], `${screen}: no whatsapp://send?phone= offline`);
    assert.deepEqual(calls.open, [], `${screen}: no wa.me offline`);
    assert.equal(calls.share.length, 1, screen);
    assert.match(calls.share[0].text, new RegExp(`^Hello \\*Ama\\*.*from \\*${shop}\\*`), screen);
  }
});

// rules_global.person_row (decided 21 Nov 2026): any saved number shows WhatsApp and Call; WhatsApp then
// opens the share sheet. "+ Add contact" only when no number is saved.
test("32 Owed row: a saved number that fails the Ghana check shows WhatsApp (share sheet) and Call, no Add contact", async () => {
  const view = await owedRow("0301234567");
  const button = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "WhatsApp Ama");
  assert.equal(button?.type, "button");
  assert.equal([...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Call Ama")?.props.href, "tel:0301234567");
  assert.equal([...walk(view.tree)].find((node) => /^Add phone/.test(node.props?.["aria-label"] ?? "")), undefined);
  const calls = device({ share: "works" });
  await button.props.onClick({ preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.location, [], "no direct link for a number that fails the check");
  assert.equal(calls.share.length, 1, "the share sheet");
});

test("32 Owed row: no saved number shows + Add contact, no WhatsApp and no Call", async () => {
  const view = await owedRow("");
  assert.equal([...walk(view.tree)].find((node) => node.props?.["aria-label"] === "WhatsApp Ama"), undefined);
  assert.equal([...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Call Ama"), undefined);
  assert.ok([...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Add phone or WhatsApp contact for Ama"));
});
