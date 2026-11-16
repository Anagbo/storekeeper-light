import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { loadHideAmounts, saveHideAmounts, setPreference } from "../src/db/preferences.js";
import { formatGhs } from "../src/lib/money.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 22 "Hide amounts" and rules_global.hide_amounts: an eye button (48px) on the title row of the
// green Money left today block hides every shop figure on Home (Money left today, Money in, Money
// spent, the Owed to you total) behind "GH₵ ••••". The Collect first row (one person) stays visible.

globalThis.HTMLElement ??= class {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
let liveResults = new Map();

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  liveResults = new Map();
  // A real query per deps; clearing liveResults re-runs them, as Dexie does when a table changes.
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps)}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const DAY = 86_400_000;
const AMOUNT = /\d\.\d{2}(?!\d)|GH₵\s*-?\d/;

// Every visible text piece and accessible name, skipping the subtree a predicate excludes.
export function moneyPieces(tree, skip = () => false) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node == null || typeof node !== "object") return;
    if (skip(node)) return;
    for (const name of ["aria-label", "title"]) if (typeof node.props?.[name] === "string") out.push(node.props[name]);
    if ("rendered" in node) return visit(node.rendered);
    const children = node.props?.children;
    for (const child of [children].flat(Infinity)) {
      if (typeof child === "string" || typeof child === "number") out.push(String(child));
      else visit(child);
    }
  };
  visit(tree);
  return out.filter((piece) => AMOUNT.test(piece));
}

const isUrgentRow = (node) => node.props?.["data-urgent-debtor"] !== undefined;
const hiddenNodes = (tree) => [...walk(tree)].filter((node) => node.props?.["data-hidden-amount"] !== undefined);
// What reaches the screen: host elements only (component props hold the raw amount, the page does not).
export function hostShape(node) {
  if (Array.isArray(node)) return node.map(hostShape);
  if (node == null || typeof node !== "object") return node;
  if ("rendered" in node) return hostShape(node.rendered);
  const { children, ...props } = node.props ?? {};
  return { type: String(node.type), props: Object.fromEntries(Object.entries(props).filter(([, value]) => typeof value !== "function")), children: hostShape(children) };
}
const eyeButton = (tree) => [...walk(tree)].find((node) => node.type === "button" && node.props?.["data-hide-amounts"] !== undefined);

async function seed() {
  await db.transactions.add({ id: "sale-1", type: "sale", amountPesewas: 123456, total_amount: 123456, payment_method: "cash", cashReceivedPesewas: 123456, momoReceivedPesewas: 0, createdAt: Date.now(), timestamp: Date.now() });
  await db.transactions.add({ id: "exp-1", type: "expense", category: "transport", amountPesewas: 2500, paidAmountPesewas: 2500, payment_method: "cash", createdAt: Date.now(), timestamp: Date.now() });
  await recordCreditSale({ name: "Ama Owes", amountPesewas: 7700, now: Date.now() - 3 * DAY });
}

async function openHome() {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  const view = render({ type: Home, props: { onNavigate() {} } });
  for (let index = 0; index < 200 && !eyeButton(view.tree); index += 1) {
    await tick();
    view.rerender();
  }
  assert.ok(eyeButton(view.tree), "Home loaded with its eye button");
  return view;
}

async function toggle(view) {
  await eyeButton(view.tree).props.onClick();
  liveResults = new Map();
  const before = eyeButton(view.tree).props["aria-label"];
  for (let index = 0; index < 200 && (!eyeButton(view.tree) || eyeButton(view.tree).props["aria-label"] === before); index += 1) {
    await tick();
    view.rerender();
  }
}

test("22: amounts are shown by default; the eye button is named Hide amounts and every figure is unchanged", async () => {
  await seed();
  const view = await openHome();
  const button = eyeButton(view.tree);
  assert.equal(button.props["aria-label"], "Hide amounts");
  assert.match(button.props.className, /\bh-12\b/);
  assert.match(button.props.className, /\bw-12\b/);
  assert.equal(hiddenNodes(view.tree).length, 0);
  const text = textOf(view.tree);
  for (const amount of [123456 - 2500, 123456, 2500, 7700]) assert.ok(text.includes(formatGhs(amount)), `shows ${formatGhs(amount)}`);
});

test("22: the eye sits on the title row of the green Money left today block, not in the shared header", async () => {
  await seed();
  const view = await openHome();
  const block = [...walk(view.tree)].find((node) => node.type === "section" && node.props?.["aria-label"] === "Money left today");
  const row = [...walk(block)].find((node) => node.type === "div" && [...walk(node)].includes(eyeButton(view.tree)) && textOf(node).includes("Money left today"));
  assert.ok(row, "the title and the eye share one row inside the green block");
  assert.ok(!/Hide amounts/.test(textOf(row)), "icon only: the name is the accessible name");
});

test("22: hidden replaces every shop figure with GH₵ •••• (a scan finds no money text outside Collect first)", async () => {
  await seed();
  const view = await openHome();
  await toggle(view);
  assert.equal(eyeButton(view.tree).props["aria-label"], "Show amounts");
  assert.deepEqual(moneyPieces(view.tree, isUrgentRow), [], "no amount left on Home outside the Collect first row");
  const hidden = hiddenNodes(view.tree);
  assert.equal(hidden.length, 4, "Money left today, Money in, Money spent, Owed to you");
  for (const node of hidden) {
    assert.equal(textOf(node), "GH₵ ••••");
    assert.equal(node.props["aria-label"], "Amount hidden");
  }
  // The scan itself catches what it should.
  assert.deepEqual(moneyPieces({ type: "p", props: { children: ["Total ", formatGhs(5)] } }), ["GH₵0.05"]);
});

test("22: Collect first (one person, the owner's working row) keeps its amount while hidden", async () => {
  await seed();
  const view = await openHome();
  await toggle(view);
  const urgent = [...walk(view.tree)].find(isUrgentRow);
  assert.ok(textOf(urgent).includes(formatGhs(7700)));
});

test("22: the choice is the shared setting and survives a fresh Home; showing again restores the figures", async () => {
  await seed();
  const view = await openHome();
  await toggle(view);
  assert.equal(await loadHideAmounts(), true);
  liveResults = new Map();
  const again = await openHome();
  assert.equal(eyeButton(again.tree).props["aria-label"], "Show amounts");
  await toggle(again);
  assert.equal(await loadHideAmounts(), false);
  assert.equal(hiddenNodes(again.tree).length, 0);
  assert.ok(textOf(again.tree).includes(formatGhs(123456)));
});

test("22: until the setting is known the figures render hidden, so a real amount never flashes", async () => {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ totals: { cashLeft: 999999, moneyIn: 999999, moneySpent: 0 }, debtPesewas: 0, urgentDebt: null }));
  try {
    const view = render({ type: Home, props: { onNavigate() {} } });
    assert.deepEqual(moneyPieces(view.tree), []);
    assert.equal(hiddenNodes(view.tree).length, 3);
  } finally {
    setLiveQuery(null);
  }
});

test("22: the hidden form does not leak the length of the figure", async () => {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  const shapes = [];
  for (const amount of [5, 123_456_789_00]) {
    setLiveQuery(() => ({ hideAmounts: true, totals: { cashLeft: amount, moneyIn: amount, moneySpent: amount }, debtPesewas: amount, urgentDebt: null }));
    const view = render({ type: Home, props: { onNavigate() {} } });
    const block = [...walk(view.tree)].find((node) => node.type === "section" && node.props?.["aria-label"] === "Money left today");
    shapes.push(JSON.stringify(hostShape(block)));
  }
  setLiveQuery(null);
  assert.equal(shapes[0], shapes[1], "GH₵0.05 and GH₵123,456,789.00 hide to the very same markup");
});
