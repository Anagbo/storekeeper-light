import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { browser, appCss, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29/43 "Header of 29/43" (final, 16 Nov 2026): the contact card stays exactly as it was before Back
// was added (initial circle, the name, and on the right of the same row Edit contact, icon above the words).
// The ONLY change is Back (PosBackButton, to BACK: the previous screen in history) as its own plain row
// above the card, left aligned, 52px high. Done stays at the bottom.

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
// 29 is on time, 43 is late.
const SCREENS = { 29: dayOffset(7), 43: dayOffset(-3) };
const LONG_NAME = "Abenaa Oforiwaa-Mensah Agyeiwaa Boatemaa";

async function detail({ screen, name = "Ama", ghanaCardNumber = "", onBack = () => {} }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", {});
  const debt = { id: "d1", customerId: "c1", customerName: name, amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: SCREENS[screen] };
  const data = { name, customerId: "c1", phone: "+233241234567", ghanaCardNumber, balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: name }, onBack, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  } finally {
    setLiveQuery(null);
  }
}

const childrenOf = (node) => [node.props.children].flat(Infinity).filter((child) => child && typeof child === "object");

for (const screen of ["29", "43"]) {
  test(`${screen}: Back is the shared PosBackButton on its own row above the unchanged contact card; Done stays`, async () => {
    let backs = 0;
    const view = await detail({ screen, onBack: () => { backs += 1; } });
    const nodes = [...walk(view.tree)];
    const backs_ = nodes.filter((node) => node.type?.name === "PosBackButton");
    assert.equal(backs_.length, 1, "one Back, from PosBackButton");
    const card = nodes.find((node) => node.props?.["data-row"] === "debtor-header");
    assert.ok(card, "the contact card");
    assert.ok(![...walk(card)].some((node) => node.type?.name === "PosBackButton"), "Back is not inside the card");
    // The card as it was before Back: circle, name, Edit contact, in one flex row.
    assert.match(card.props.className, /^flex items-center gap-3 /);
    const [circle, nameBlock, edit] = childrenOf(card);
    assert.match(circle.props.className, /rounded-full bg-emerald-900/, "the initial circle comes first");
    assert.equal(textOf(circle), "A");
    assert.match(textOf(nameBlock), /Ama/);
    assert.equal(edit.type, "button");
    assert.equal(textOf(edit).trim(), "Edit contact");
    assert.equal(edit.props["aria-label"], undefined, "Edit contact is named by its words");
    // The rendered Back: the shared button's label and look.
    const button = [...walk(backs_[0])].find((node) => node.type === "button");
    assert.equal(button.props["aria-label"], "Back");
    assert.equal(textOf(button).trim(), "Back");
    assert.match(button.props.className, /h-\[52px\]/);
    assert.match(button.props.className, /self-start/);
    button.props.onClick();
    assert.equal(backs, 1, "Back calls onBack");
    assert.ok(nodes.some((node) => node.type === "button" && textOf(node).trim() === "Done"), "Done is kept");
  });
}

test("PosApp gives 29/43 the history Back (navigateBack), so the place on 32 or 22 is kept", () => {
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  const start = app.indexOf("route === POS_ROUTES.DebtorDetail ? (");
  assert.ok(start >= 0);
  const branch = app.slice(start, app.indexOf(") : route ===", start));
  assert.match(branch, /<DebtorDetail[\s\S]*onBack=\{navigateBack\}/);
});

// Line counts from TEXT nodes only (an icon's box is not a line). The name is line-clamped, so its
// visible lines are its height over its line height.
const MEASURE = `(frame, win, doc) => {
  const card = doc.querySelector('[data-row="debtor-header"]');
  const back = doc.querySelector('button[aria-label="Back"]');
  const circle = card.querySelector(".rounded-full");
  const name = card.querySelector("strong");
  const edit = [...card.querySelectorAll("button")].find((b) => b.textContent.includes("Edit contact"));
  const icon = edit.querySelector("svg");
  const textLines = (el) => {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const tops = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = doc.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) tops.add(Math.round(r.top));
    }
    return tops.size;
  };
  const words = (() => { const range = doc.createRange(); range.selectNodeContents([...edit.childNodes].find((n) => n.nodeType === 3)); return range.getBoundingClientRect(); })();
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  return {
    back: box(back), card: box(card), circle: box(circle), name: box(name), edit: box(edit), icon: box(icon), words: { top: words.top, bottom: words.bottom },
    backLines: textLines(back), backClipped: back.scrollWidth > back.clientWidth,
    backFirst: [...doc.querySelectorAll("button, a, input, select, textarea")][0] === back,
    backInCard: card.contains(back),
    nameLines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
    editName: edit.getAttribute("aria-label") ?? edit.textContent.trim(), editClipped: edit.scrollWidth > edit.clientWidth + 1,
    pageOverflow: doc.documentElement.scrollWidth > win.innerWidth || doc.body.scrollWidth > win.innerWidth
  };
}`;

test("at 340, 360 and 393px (29 on time and 43 late, short and long name): Back on its own row, card on one row", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  for (const screen of ["29", "43"]) {
    for (const [size, name] of [["short", "Ama"], ["long", LONG_NAME]]) {
      for (const ghanaCardNumber of ["", "GHA-123456789-0"]) {
        const view = await detail({ screen, name, ghanaCardNumber });
        pages.push({ name: `${screen}|${size}|${ghanaCardNumber ? "card" : "no card"}`, html: toHtml(view.tree) });
      }
    }
  }
  const widths = [340, 360, 393];
  // 1300px tall frames: the whole page fits, so no desktop scrollbar takes width from the header.
  const results = measureInFrames({ pages, css: await appCss(), widths, height: 1300, measure: MEASURE });
  assert.equal(results.length, pages.length * widths.length);
  const editOffset = {};
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const { back, card, circle, name, edit, icon, words } = result;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    // Back: first control, 52px, one line, its own row above the card, left aligned, not stretched.
    assert.ok(result.backFirst, `${where}: Back is the first control on the page`);
    assert.ok(Math.abs(back.height - 52) < 0.5, `${where}: Back is 52px tall (${back.height})`);
    assert.equal(result.backLines, 1, `${where}: Back never wraps`);
    assert.equal(result.backClipped, false, `${where}: Back is not clipped`);
    assert.equal(result.backInCard, false, `${where}: Back is not inside the card`);
    assert.ok(back.bottom <= card.top, `${where}: Back is above the card`);
    assert.ok(Math.abs(back.left - card.left) < 0.5, `${where}: Back is left aligned with the card (${back.left} vs ${card.left})`);
    assert.ok(back.width < card.width / 2, `${where}: Back is not stretched (${back.width}px)`);
    // The card: circle, name and Edit contact on ONE row, in that order, inside the card.
    const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;
    assert.ok(overlaps(circle, name) && overlaps(name, edit) && overlaps(circle, edit), `${where}: circle, name and Edit contact on one row`);
    assert.ok(circle.right <= name.left && name.right <= edit.left, `${where}: circle, then name, then Edit contact`);
    assert.ok(edit.right <= card.right && edit.bottom <= card.bottom, `${where}: Edit contact inside the card`);
    // Edit contact: icon above the words, keeps its accessible name, words not cut.
    assert.ok(icon.bottom <= words.top + 0.5, `${where}: the icon is above "Edit contact"`);
    assert.equal(result.editName, "Edit contact", `${where}: Edit contact keeps its accessible name`);
    assert.equal(result.editClipped, false, `${where}: Edit contact is not cut`);
    if (result.page.includes("long") && result.page.includes("no card")) assert.equal(result.nameLines, 2, `${where}: a long name wraps to two lines`);
    if (result.page.includes("short")) assert.equal(result.nameLines, 1, `${where}: a short name is one line`);
    editOffset[where] = edit.top - card.top;
  }
  // A long name does not push Edit contact down: same place in the card as with a short name. With a Ghana
  // card number under a two-line name the card's row (items-center, unchanged) is taller than Edit contact,
  // which then stays centred on that row; the one-row check above covers that case.
  for (const [where, offset] of Object.entries(editOffset)) {
    if (!where.includes("|long|no card")) continue;
    const short = editOffset[where.replace("|long|", "|short|")];
    assert.ok(Math.abs(offset - short) < 0.5, `${where}: Edit contact stays put (${offset} vs ${short} with a short name)`);
  }
});
