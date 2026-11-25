import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// rules_global.button_system (16-17 Nov 2026, brief 3.24): four looks, one shared component each
// (PosPrimaryButton, PosSecondaryButton, AddButton, LeaveButton in src/pos/PosComponents.jsx).
// - shared: no screen draws its own dashed add button or grey-outline leave button.
// - no_link_buttons: underlined text is never a button (no "underline" class on any screen).
// - open_text_sweep: no tappable plain green text (a button with green text and no border or fill).
// - every add, leave and former open-text action in the 17 Nov list uses its component.
// - status tags ("Signed ✓" / "Not signed", PosStatusTag) are never tappable and are not flagged.

const root = fileURLToPath(new URL("..", import.meta.url));
const posDir = join(root, "src/pos");
const SHARED = "PosComponents.jsx";
const screens = readdirSync(posDir).filter((file) => file.endsWith(".jsx") && file !== SHARED);
const read = (file) => readFileSync(join(posDir, file), "utf8");

// Every class list written in a file: string literals and template literals that look like Tailwind.
function classStrings(source) {
  const found = [];
  const re = /"([^"\n]*)"|`([^`]*)`/g;
  for (const match of source.matchAll(re)) {
    const text = match[1] ?? match[2];
    if (/\b(border|text|bg|flex|grid|rounded|min-h|h)-/.test(text)) {
      found.push({ text, line: source.slice(0, match.index).split("\n").length });
    }
  }
  return found;
}

// The opening tag of every <button and <a in a file (quotes, braces and "=>" handled), with its line.
function openingTags(source, tag) {
  const tags = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  for (const match of source.matchAll(re)) {
    let depth = 0;
    let quote = "";
    let index = match.index + match[0].length;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && source[index - 1] !== "=") break;
    }
    tags.push({ text: source.slice(match.index, index + 1), line: source.slice(0, match.index).split("\n").length });
  }
  return tags;
}

test("no screen draws its own add (dashed green), leave (grey outline) or underlined-link button", () => {
  const problems = [];
  for (const file of screens) {
    for (const { text, line } of classStrings(read(file))) {
      const tokens = text.split(/\s+/);
      if (tokens.some((token) => /(^|:)underline$/.test(token) || /^decoration-/.test(token))) problems.push(`${file}:${line} underlined text: ${text.slice(0, 90)}`);
      if (tokens.includes("border-dashed") && /emerald|green/.test(text)) problems.push(`${file}:${line} its own dashed green (add) look: ${text.slice(0, 90)}`);
      if (/border-\[#64748B\]/i.test(text)) problems.push(`${file}:${line} its own grey-outline (leave) look: ${text.slice(0, 90)}`);
      // The danger look comes only from PosSecondaryButton tone="danger" (button_system.danger).
      if (tokens.some((token) => /^border-rose-\d+!?$/.test(token)) && tokens.some((token) => /^text-rose-\d+!?$/.test(token)) && tokens.some((token) => /!$/.test(token))) problems.push(`${file}:${line} its own red (danger) override: ${text.slice(0, 90)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("no tappable plain green text: a <button> or <a> with green text has a border or a fill", () => {
  const problems = [];
  for (const file of screens) {
    const source = read(file);
    for (const tag of ["button", "a"]) {
      for (const { text, line } of openingTags(source, tag)) {
        const className = text.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
        if (!className) continue;
        const classes = className[1] ?? className[2];
        const green = /\btext-emerald-\d+\b|\btext-green-\d+\b/.test(classes);
        // Any border class counts (a shared class constant like ${SQUARE} carries its own width).
        const outlined = /(^|\s)border(\s|$|-(?!0\b|transparent\b|none\b))/.test(classes);
        const filled = /\bbg-(?!transparent)/.test(classes);
        if (green && !outlined && !filled) problems.push(`${file}:${line} <${tag}> plain green text: ${classes.slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

// The 17 Nov 2026 list (first report and open_text_sweep), each with the component it must use:
// [what, file, component, a pattern its opening tag matches, a pattern its children match].
const ACTIONS = [
  ["15 + Add items", "Sell.jsx", "AddButton", /size="compact"/, /t\("sell\.addItems"\)/],
  // 20's tiles are shared with wide D9 since 23 Nov 2026 (SellItemsParts.jsx).
  ["20 + New item", "SellItemsParts.jsx", "AddButton", /size="tile"/, /t\("sellItems\.newItem"\)/],
  ["32 + Add debt", "OwedScreens.jsx", "AddButton", /openAddDebt/, /^Add debt$/],
  ["17 + New person", "CreditScreens.jsx", "AddButton", /"NewPerson"/, /t\("credit\.newPerson"\)/],
  ["29/43 + Add to debt", "DebtCollection.jsx", "AddButton", /"ManualDebtAmount"/, /^Add to debt$/],
  ["29/43 Get signature (no +)", "DebtCollection.jsx", "AddButton", /plus=\{false\}/, /t\("creditRow\.getSignature"\)/],
  ["45 + New supplier (radio)", "SupplierScreens.jsx", "AddButton", /role="radio"/, /t\("expense\.newSupplierRow"\)/],
  ["28 + Add phone", "DebtCollection.jsx", "AddButton", /setContactEditorOpen/, /t\("collect\.addPhoneForReceipt"\)/],
  ["39 + New item", "ItemScreens.jsx", "AddButton", /"NewItem"/, /t\("items\.new"\)/],
  ["39 + Add from starter list", "ItemScreens.jsx", "AddButton", /"YourStarterList"/, /t\("items\.starterList"\)/],
  ["22 Today’s transactions", "Home.jsx", "PosSecondaryButton", /"TodaysTransactions"/, /t\("home\.transactionsLink"\)/],
  ["25 See {Name}’s details", "DebtCollection.jsx", "PosSecondaryButton", /debtId: debt\.id/, /t\("collect\.seeDetails"/],
  ["28 See {Name}’s details", "DebtCollection.jsx", "PosSecondaryButton", /debtId: result\.debtId/, /t\("collect\.seeDetails"/],
  ["Debt saved See {Name}’s details", "ManualDebtScreens.jsx", "PosSecondaryButton", /"DebtorDetail"/, /t\("credit\.seeDetails"/],
  ["Debt saved WhatsApp {Name} (with or without a phone)", "ManualDebtScreens.jsx", "PosSecondaryButton", /shareReminder/, /t\("debtSaved\.whatsapp"/],
  ["31 See {Name}’s details", "CreditScreens.jsx", "PosSecondaryButton", /"DebtorDetail"/, /t\("credit\.seeDetails"/],
  ["56 Customer already paid me directly", "MoMoScreens.jsx", "PosSecondaryButton", /"MoMoDirect"/, /^Customer already paid me directly$/],
  ["59 Cancel sale", "MoMoScreens.jsx", "PosSecondaryButton", /"Home"/, /^Cancel sale$/],
  ["63 Set up", "MoMoScreens.jsx", "PosSecondaryButton", /aria-label="Phone request: set up"/, /^Set up$/],
  ["45 Show all suppliers", "SupplierScreens.jsx", "PosSecondaryButton", /data-show-all=""/, /t\("expense\.showAllSuppliers"/],
  ["29/43 Correct balance", "DebtCollection.jsx", "PosSecondaryButton", /openCorrection\(\)/, /^Correct balance$/],
  ["29/43 Correct this entry", "DebtCollection.jsx", "PosSecondaryButton", /openCorrection\(debt, true\)/, /^Correct this entry$/],
  // Decisions 17 Nov 2026 (second report): the ones left outside the four looks.
  ["72 Clear", "CustomerSignature.jsx", "PosSecondaryButton", /setStrokes\(\[\]\)/, /t\("signature\.clear"\)/],
  ["29/43 Show {Name} the record", "DebtCollection.jsx", "PosSecondaryButton", /data-show-record=""/, /the record/],
  // rules_global.person_row (chunk C, 21 Nov 2026): "+ Add contact" on 22 and 32 is drawn by PersonRow.
  ["22/32 + Add contact", "PartyCard.jsx", "AddButton", /onClick=\{onAddContact\}/, /t\("contact\.add"\)/],
  ["Large amount: Change amount (main)", "LargeAmountConfirm.jsx", "PosPrimaryButton", /onClick=\{onChange\}/, /t\("largeAmount\.change"\)/],
  ["Large amount: Yes, save (other)", "LargeAmountConfirm.jsx", "PosSecondaryButton", /onClick=\{onConfirm\}/, /t\("largeAmount\.save"\)/],
  ["Leave draft: Stay (main)", "LeaveDraftDialog.jsx", "PosPrimaryButton", /onClick=\{onStay\}/, /t\("leaveDraft\.stay"\)/],
  ["Leave draft: Leave (leave)", "LeaveDraftDialog.jsx", "LeaveButton", /onClick=\{onLeave\}/, /t\("leaveDraft\.leave"\)/],
  // split_payment_look (21 Nov 2026): 15, 55 and 19 are the add look (they were the other look on 15/55).
  ["15 Split (dashed, joined icons, no +)", "Sell.jsx", "AddButton", /plus=\{false\}[\s\S]*aria-label=\{t\("sell\.split"\)\}/, /<SplitTrio/],
  ["55 Split payment (dashed, joined icons, no +)", "ReviewAndPay.jsx", "AddButton", /plus=\{false\}[\s\S]*data-split-55=""/, /<SplitIcons withOwe[\s\S]*t\("review\.split"\)/],
  ["19 Split payment (dashed, joined icons, no +)", "CreditScreens.jsx", "AddButton", /plus=\{false\}[\s\S]*pressed=\{paymentMethod === "split"\}/, /<SplitIcons size=\{16\} \/>[\s\S]*t\("split\.title"\)/],
  // split_icons (20 Nov 2026): the dashed tile keeps its joined icons, so the children now start with <SplitIcons>.
  ["25 Split payment (dashed, joined icons, no +)", "DebtCollection.jsx", "AddButton", /plus=\{false\}[\s\S]*onSplit\(\)/, /<SplitIcons size=\{16\} \/>[\s\S]*t\("collect\.splitPayment"\)/],
  // rules_global.button_system.danger: the shared variant, never a screen's own red outline.
  ["28 Undo (danger)", "DebtCollection.jsx", "PosSecondaryButton", /tone="danger"/, /t\("collect\.undo"\)/],
  ["40 Delete (danger)", "ItemScreens.jsx", "PosSecondaryButton", /tone="danger"/, /t\("items\.delete"\)/],
  ["35 Skip for now", "SetupScreens.jsx", "LeaveButton", /skipSetup/, /t\("setup\.skip"\)/],
  ["36/52 Skip, I’ll add items later", "ItemScreens.jsx", "LeaveButton", /finishSetup/, /t\("setup\.finish"\)/],
  ["72 Skip for now", "CustomerSignature.jsx", "LeaveButton", /onClick=\{skip\}/, /t\("signature\.skip"\)/],
  ["Reminder sheet Not now", "ReminderCheck.jsx", "LeaveButton", /onNotNow/, /t\("reminderAgain\.notNow"\)/]
];

// The elements of one component in a file: its opening tag and its children up to the closing tag.
function elements(source, component) {
  return openingTags(source, component).map(({ text }) => {
    const from = source.indexOf(text) + text.length;
    const close = source.indexOf(`</${component}>`, from);
    return { tag: text, children: close < 0 ? "" : source.slice(from, close).trim() };
  });
}

test("each action in the 17 Nov list uses its shared component", () => {
  const missing = ACTIONS
    .filter(([, file, component, tagRe, childRe]) => !elements(read(file), component).some(({ tag, children }) => tagRe.test(tag) && childRe.test(children)))
    .map(([name, file, component]) => `${name}: no <${component}> in ${file}`);
  assert.deepEqual(missing, []);
  // Debt saved: "WhatsApp {Name}" is one other button (PosSecondaryButton) with or without a phone; it
  // calls the shared WhatsApp opener, so there is no separate link drawn with the other class.
  assert.doesNotMatch(read("ManualDebtScreens.jsx"), /<a href=\{whatsappLink\}/);
});

test("the labels keep the curly apostrophe and the + where the rule says", async () => {
  const { posText } = await import("../src/pos/i18n.js");
  assert.equal(posText("home.transactionsLink"), "Today’s transactions");
  assert.equal(posText("credit.seeDetails", { name: "Ama" }), "See Ama’s details");
  assert.equal(posText("collect.seeDetails", { name: "Ama" }), "See Ama’s details");
  assert.equal(posText("setup.finish"), "Skip, I’ll add items later");
  assert.equal(posText("creditRow.getSignature"), "Get signature", "no + on Get signature");
  // AddButton draws the "+" itself (hidden from screen readers), so the add labels are the words.
  for (const key of ["sell.addItems", "sellItems.newItem", "credit.newPerson", "expense.newSupplierRow", "collect.addPhoneForReceipt"]) {
    assert.doesNotMatch(posText(key), /^\+/, `${key}: the + comes from AddButton`);
  }
  const components = readFileSync(join(posDir, SHARED), "utf8");
  assert.match(components, /\{plus && <span aria-hidden="true" className="shrink-0">\+<\/span>\}/, "the + is shown and hidden from screen readers");
});

test("status tags are never tappable: SignedTag and PosStatusTag are spans", () => {
  assert.match(read("SignedTag.jsx"), /return \(\s*<span\b/);
  assert.doesNotMatch(read("SignedTag.jsx"), /onClick|<button/);
  const components = readFileSync(join(posDir, SHARED), "utf8");
  const statusTag = components.slice(components.indexOf("export function PosStatusTag"));
  assert.match(statusTag, /return <span\b/);
  assert.doesNotMatch(statusTag.slice(0, statusTag.indexOf("\n}")), /onClick|<button/);
});

test("the scan catches a screen-drawn add, leave and link look, and passes the tags", () => {
  const flagged = (source) => classStrings(source).filter(({ text }) => {
    const tokens = text.split(/\s+/);
    return tokens.some((token) => /(^|:)underline$/.test(token)) || (tokens.includes("border-dashed") && /emerald|green/.test(text)) || /border-\[#64748B\]/i.test(text);
  }).length;
  assert.equal(flagged(`<button className="border-2 border-dashed border-emerald-900 text-emerald-900">+ X</button>`), 1);
  assert.equal(flagged(`<button className="h-[52px] border-2 border-[#64748B] text-[#334155]">Skip</button>`), 1);
  assert.equal(flagged(`<button className="text-lg font-extrabold text-emerald-900 underline">See</button>`), 1);
  assert.equal(flagged(read("SignedTag.jsx")), 0, "the Signed / Not signed tag is not flagged");
  assert.equal(flagged(`<div className="border-t-2 border-dashed border-slate-400 pt-2">`), 0, "a dashed grey divider is not a button");
});
