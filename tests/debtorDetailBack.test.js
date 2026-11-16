import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { browser, appCss, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29/43 Back (to BACK): "Return to the previous screen in the navigation history (keeps the
// user's place when opened from 32 or 22)". The shared PosBackButton sits top left on the name's row,
// where the initial circle was; Edit contact sits under the name (owner's choice, 16 Nov 2026). Done
// stays at the bottom. Back never wraps and is 52px tall at 340, 360 and 393px.

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
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

for (const screen of ["29", "43"]) {
  test(`${screen}: Back is the shared PosBackButton, top left on the name's row, and calls onBack; Done stays`, async () => {
    let backs = 0;
    const view = await detail({ screen, onBack: () => { backs += 1; } });
    const nodes = [...walk(view.tree)];
    const backs_ = nodes.filter((node) => node.type?.name === "PosBackButton");
    assert.equal(backs_.length, 1, "one Back, from PosBackButton");
    const header = nodes.find((node) => node.props?.["data-row"] === "debtor-header");
    assert.ok(header, "the header row");
    const headerChildren = [header.props.children].flat(Infinity).filter((child) => child && typeof child === "object");
    assert.equal(headerChildren[0], backs_[0], "Back is the first thing in the header row (top left)");
    assert.match(textOf(header), /Ama/, "the name is on the same row");
    assert.match(textOf(header), /Edit contact/, "Edit contact stays in the header");
    // The rendered Back: the shared button's label and look.
    const button = [...walk(backs_[0])].find((node) => node.type === "button");
    assert.equal(button.props["aria-label"], "Back");
    assert.equal(textOf(button).trim(), "Back");
    assert.match(button.props.className, /h-\[52px\]/);
    assert.match(button.props.className, /whitespace-nowrap/);
    button.props.onClick();
    assert.equal(backs, 1, "Back calls onBack");
    // The initial circle is gone (Back took its place).
    assert.ok(!nodes.some((node) => typeof node.props?.className === "string" && /rounded-full bg-emerald-900/.test(node.props.className)), "no initial circle");
    // Done is kept.
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

const MEASURE = `(frame, win, doc) => {
  const back = doc.querySelector('[data-row="debtor-header"] button[aria-label="Back"]');
  const name = doc.querySelector('[data-row="debtor-header"] strong');
  const edit = [...doc.querySelectorAll('[data-row="debtor-header"] button')].find((b) => b.textContent.includes("Edit contact"));
  const header = doc.querySelector('[data-row="debtor-header"]');
  const lines = (el) => { const range = doc.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
  const b = back.getBoundingClientRect(), n = name.getBoundingClientRect(), e = edit.getBoundingClientRect(), h = header.getBoundingClientRect();
  return {
    backHeight: b.height, backLines: lines(back), backClipped: back.scrollWidth > back.clientWidth,
    backFirst: [...doc.querySelectorAll("button, a")][0] === back, backLeft: b.left - h.left,
    sameRow: n.top < b.bottom && n.bottom > b.top, nameRightOfBack: n.left >= b.right, nameWidth: n.width,
    editLines: lines(edit), editHeight: e.height, editInside: e.right <= h.right,
    pageOverflow: doc.documentElement.scrollWidth > win.innerWidth
  };
}`;

test("at 340, 360 and 393px (29 and 43, short and long name): Back is 52px, one line, left of the name", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  for (const screen of ["29", "43"]) {
    for (const name of ["Ama", LONG_NAME]) {
      for (const ghanaCardNumber of ["", "GHA-123456789-0"]) {
        const view = await detail({ screen, name, ghanaCardNumber });
        pages.push({ name: `${screen}|${name.length}|${ghanaCardNumber ? "card" : "no card"}`, html: toHtml(view.tree) });
      }
    }
  }
  const widths = [340, 360, 393];
  // 1300px tall frames: the whole page fits, so no desktop scrollbar (a phone's scrollbar overlays the page)
  // takes width from the header. Show {Name} the record (16 Nov 2026) made 29/43 taller than 900px.
  const results = measureInFrames({ pages, css: await appCss(), widths, height: 1300, measure: MEASURE });
  assert.equal(results.length, pages.length * widths.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    assert.ok(Math.abs(result.backHeight - 52) < 0.5, `${where}: Back is 52px tall (${result.backHeight})`);
    assert.equal(result.backLines, 1, `${where}: Back never wraps`);
    assert.equal(result.backClipped, false, `${where}: Back is not clipped`);
    assert.ok(result.backFirst, `${where}: Back is the first control on the page`);
    assert.ok(result.backLeft < 20, `${where}: Back is at the left of the header`);
    assert.ok(result.sameRow && result.nameRightOfBack, `${where}: the name is on Back's row, right of it`);
    assert.ok(result.nameWidth >= 150, `${where}: the name has room (${result.nameWidth}px)`);
    assert.equal(result.editLines, 1, `${where}: Edit contact on one line`);
    assert.ok(result.editHeight >= 44, `${where}: Edit contact is ${result.editHeight}px tall`);
    assert.ok(result.editInside, `${where}: Edit contact inside the header`);
  }
});
