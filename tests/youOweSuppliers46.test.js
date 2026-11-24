import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 46 "You owe suppliers": layout from the wiring rules for screen 46. Behaviour is unchanged.

const dayOffset = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
const supplier = (over) => ({ id: over.name, phone: "", balancePesewas: 10000, nextDueDate: "", ...over });

async function mount(suppliers) {
  const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => suppliers);
  return render({ type: YouOweSuppliers, props: { onBack() {}, onPay() {} } });
}
const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node.props.className ?? "");
const cardOf = (tree, name) => all(tree, (n) => n.type === "section" && n.props["data-supplier"] === name)[0];
const tagOf = (tree, name) => all(cardOf(tree, name), (n) => /rounded-lg border-2/.test(cls(n)))[0];

test("46 summary: count is plural and singular, total is bold, neutral soft tile (never amber)", async () => {
  const two = (await mount([supplier({ name: "Kofi Wholesale", balancePesewas: 20000 }), supplier({ name: "Madam Ama", balancePesewas: 8000 })])).tree;
  const text = textOf(two);
  assert.ok(text.includes("Total you owe"));
  assert.ok(text.includes("2 suppliers"));
  assert.ok(text.includes("GH₵280.00"));
  const card = all(two, (n) => n.type === "section" && n.props["data-summary"] === "suppliers")[0];
  assert.ok(card, "summary card");
  assert.match(cls(card), /bg-\[#F1F5F9\]/);
  assert.ok(!/amber/.test(cls(card)), "never amber");
  assert.ok(all(card, (n) => /font-extrabold|font-bold/.test(cls(n)) && textOf(n) === "GH₵280.00").length > 0);
  const one = (await mount([supplier({ name: "Kofi Wholesale" })])).tree;
  assert.ok(textOf(one).includes("1 supplier"));
  assert.ok(!textOf(one).includes("1 suppliers"));
});

test("46 due tag wording and colour for every case", async () => {
  const tree = (await mount([
    supplier({ name: "Far", nextDueDate: dayOffset(10), dueStatus: "upcoming" }),
    supplier({ name: "Four", nextDueDate: dayOffset(4), dueStatus: "upcoming" }),
    supplier({ name: "Three", nextDueDate: dayOffset(3), dueStatus: "upcoming" }),
    supplier({ name: "One", nextDueDate: dayOffset(1), dueStatus: "upcoming" }),
    supplier({ name: "Today", nextDueDate: dayOffset(0), dueStatus: "today" }),
    supplier({ name: "Late", nextDueDate: dayOffset(-2), dueStatus: "late" }),
    supplier({ name: "LateOne", nextDueDate: dayOffset(-1), dueStatus: "late" }),
    supplier({ name: "Nodate", nextDueDate: "", dueStatus: "not_set" })
  ])).tree;
  const expectTag = (name, label, colour) => {
    const tag = tagOf(tree, name);
    assert.ok(tag, `${name}: tag`);
    assert.equal(textOf(tag), label, name);
    assert.match(cls(tag), colour, name);
  };
  expectTag("Far", "Due in 10 days", /bg-slate-100/);
  expectTag("Four", "Due in 4 days", /bg-slate-100/);
  expectTag("Three", "Due in 3 days", /bg-amber-100/);
  expectTag("One", "Due in 1 day", /bg-amber-100/);
  expectTag("Today", "Due today", /bg-amber-100/);
  expectTag("Late", "Late 2 days", /bg-rose-100/);
  expectTag("LateOne", "Late 1 day", /bg-rose-100/);
  assert.equal(tagOf(tree, "Nodate"), undefined, "no tag without a due date");
});

test("46 cards: Late first (most days late first), then soonest due, then no due date", async () => {
  const input = [
    supplier({ name: "Nodate" }),
    supplier({ name: "Soon", nextDueDate: dayOffset(3), dueStatus: "upcoming" }),
    supplier({ name: "LateOne", nextDueDate: dayOffset(-1), dueStatus: "late" }),
    supplier({ name: "Far", nextDueDate: dayOffset(10), dueStatus: "upcoming" }),
    supplier({ name: "LateFive", nextDueDate: dayOffset(-5), dueStatus: "late" })
  ];
  const text = textOf((await mount(input)).tree);
  const at = (name) => text.indexOf(name);
  assert.ok(at("LateFive") < at("LateOne") && at("LateOne") < at("Soon") && at("Soon") < at("Far") && at("Far") < at("Nodate"));
});

test("46 Call only with a valid number; never a disabled Call; Pay always; accessible names", async () => {
  const tree = (await mount([
    supplier({ name: "Kofi Wholesale", phone: "024 123 4567" }),
    supplier({ name: "Madam Ama", phone: "" }),
    supplier({ name: "Bad Number", phone: "12" })
  ])).tree;
  const callNames = all(tree, (n) => n.type === "a" && /^Call /.test(n.props["aria-label"] ?? "")).map((n) => n.props["aria-label"]);
  assert.deepEqual(callNames, ["Call Kofi Wholesale"]);
  const call = all(tree, (n) => n.type === "a" && n.props["aria-label"] === "Call Kofi Wholesale")[0];
  assert.equal(call.props.href, "tel:0241234567");
  assert.equal(call.props["aria-disabled"], undefined);
  assert.ok(!/aria-disabled/.test(cls(call)));
  assert.match(cls(call), /h-\[52px\]/);
  assert.match(cls(call), /w-\[52px\]/);
  const payNames = all(tree, (n) => n.type === "button" && /^Pay /.test(n.props["aria-label"] ?? "")).map((n) => n.props["aria-label"]);
  assert.deepEqual(payNames, ["Pay Kofi Wholesale", "Pay Madam Ama", "Pay Bad Number"]);
  const pay = all(tree, (n) => n.type === "button" && n.props["aria-label"] === "Pay Kofi Wholesale")[0];
  assert.match(cls(pay), /bg-emerald-/);
  assert.match(cls(pay), /h-\[52px\]/);
  assert.ok(textOf(pay).includes("Pay"));
});

test("46 empty state: no summary card", async () => {
  const tree = (await mount([])).tree;
  assert.ok(textOf(tree).includes("You don’t owe any suppliers."));
  assert.ok(!textOf(tree).includes("Total you owe"));
  assert.equal(all(tree, (n) => n.props["data-summary"] === "suppliers").length, 0);
});

test("46 display name has a capital first letter; the stored name is untouched", async () => {
  const input = [supplier({ name: "kofi wholesale", phone: "0241234567" })];
  const tree = (await mount(input)).tree;
  assert.ok(textOf(tree).includes("Kofi Wholesale"));
  assert.equal(all(tree, (n) => n.props["aria-label"] === "Pay Kofi Wholesale").length, 1);
  assert.equal(input[0].name, "kofi wholesale");
});

test("46 long name and GH₵12,345.00 do not clip at 360px (class contract)", async () => {
  const longName = "Nana Akosua Frimpomaa-Boateng Wholesale Distributors and Sons";
  const tree = (await mount([supplier({ name: longName, balancePesewas: 1234500, phone: "0241234567" })])).tree;
  const card = cardOf(tree, longName);
  assert.ok(card);
  const nameNode = all(card, (n) => n.type === "h2")[0];
  assert.match(cls(nameNode), /min-w-0/);
  assert.match(cls(nameNode), /line-clamp-2/);
  assert.match(cls(nameNode), /break-words/);
  assert.match(cls(nameNode), /text-\[19px\]/);
  const amount = all(card, (n) => textOf(n) === "GH₵12,345.00" && /text-\[24px\]/.test(cls(n)))[0];
  assert.ok(amount, "amount at 24px");
  // 4k (21 Nov 2026): the top row is a grid; the amount has the auto (content-sized) column, so it never shrinks.
  assert.match(cls(amount), /col-start-2/);
  assert.match(cls(amount), /whitespace-nowrap/);
  assert.ok(all(card, (n) => /grid-cols-\[minmax\(0,1fr\)_auto\]/.test(cls(n)))[0], "the name/amount grid");
  assert.ok(!/amount-fit/.test(cls(amount)), "never shrunk");
});

test("46 uses PosBackButton", () => {
  const source = readFileSync(new URL("../src/pos/SupplierScreens.jsx", import.meta.url), "utf8");
  assert.ok(source.slice(source.indexOf("export function YouOweSuppliers")).includes("<PosBackButton"));
});

// Item 1 (11 Nov 2026): the Pay sheet.
async function openPaySheet(name) {
  const view = await mount([supplier({ name, phone: "0241234567", balancePesewas: 1234500 })]);
  const pay = all(view.tree, (n) => n.type === "button" && /^Pay /.test(n.props["aria-label"] ?? ""))[0];
  pay.props.onClick();
  const tree = view.rerender().tree;
  const sheet = all(tree, (n) => n.props.role === "dialog")[0];
  assert.ok(sheet, "Pay sheet is open");
  return sheet;
}

test("46 Pay sheet: a long supplier name wraps in the title and cannot run past the sheet at 360px", async () => {
  const longName = "Nana Akosua Frimpomaa-Boateng Wholesale Distributors and Sons Limited";
  const sheet = await openPaySheet(longName);
  const title = all(sheet, (n) => n.type === "h2" && n.props["data-sheet-title"] === "supplier-pay")[0];
  assert.equal(textOf(title), `Pay ${longName}`);
  const classes = cls(title).split(/\s+/);
  assert.ok(classes.includes("[overflow-wrap:anywhere]"), "overflow-wrap anywhere");
  assert.ok(classes.includes("min-w-0"));
  assert.ok(!classes.some((c) => /^(truncate|whitespace-nowrap|line-clamp-)/.test(c)), "the title wraps onto more lines, never cut");
  const panel = all(sheet, (n) => n.type === "div" && /rounded-2xl/.test(cls(n)))[0];
  assert.match(cls(panel), /\bw-full\b/);
  assert.match(cls(panel), /\bmin-w-0\b/);
});

test("46 Pay sheet: Record payment (green) and Cancel (outlined) are both full width and 52px, Cancel below", async () => {
  const sheet = await openPaySheet("Kofi Wholesale");
  const buttons = all(sheet, (n) => n.type === "button");
  const record = buttons.find((n) => textOf(n) === "Record payment");
  const cancel = buttons.find((n) => textOf(n) === "Cancel");
  assert.ok(record && cancel);
  assert.ok(buttons.indexOf(record) < buttons.indexOf(cancel), "Cancel is below Record payment");
  for (const button of [record, cancel]) {
    const c = cls(button).split(/\s+/);
    assert.ok(c.includes("w-full"), `${textOf(button)} full width`);
    assert.ok(c.includes("h-[52px]"), `${textOf(button)} 52px`);
    assert.ok(!c.some((x) => /^min-h-/.test(x)), `${textOf(button)} has no taller minimum`);
  }
  assert.match(cls(record), /bg-emerald-900/);
  assert.match(cls(cancel), /bg-white/);
  assert.match(cls(cancel), /border-2/);
});

test("46 Pay sheet: a lowercase stored name is shown capitalised; the stored name is unchanged", async () => {
  const input = [supplier({ name: "kofi wholesale", phone: "0241234567" })];
  const view = await mount(input);
  all(view.tree, (n) => n.type === "button" && n.props["aria-label"] === "Pay Kofi Wholesale")[0].props.onClick();
  const sheet = all(view.rerender().tree, (n) => n.props.role === "dialog")[0];
  assert.equal(textOf(all(sheet, (n) => n.type === "h2")[0]), "Pay Kofi Wholesale");
  assert.equal(input[0].name, "kofi wholesale");
});
