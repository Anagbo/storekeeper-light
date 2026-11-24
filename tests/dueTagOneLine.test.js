import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// rules_global.person_row "Due tag on one line" (4k, 21 Nov 2026), real Edge at 340, 360 and 393px: the
// top row of PartyCard is a grid. On Home 22, the Owed list 32 and the suppliers card 46 the due tag is
// one line whatever the name and the amount (before 4k, "Late 12 days" beside GH₵98,765.43 took two
// lines at 340 and 360). The name gives way (two lines at most); the amount stays whole on one line at
// the right; the tag sits left under the name and never covers the amount. On 22 and 32 the tag is
// inside the open button and the button is exactly as tall as its content. No sideways scroll.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const due = (days) => `new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10)`;
const sale = (name, amount, days) => `await recordCreditSale({ name: ${JSON.stringify(name)}, phone: "0244123456", amountPesewas: ${amount}, dueDate: ${due(days)}, now: Date.now() - 86400000 * 40 });`;
const supplier = (name, amount, days) => `await recordExpense({ amountPesewas: ${amount}, paidAmountPesewas: 0, category: "stock", newSupplier: { name: ${JSON.stringify(name)} }, paidWith: "cash", payBy: ${due(days)}, now: Date.now() - 86400000 * 40 });`;
const head = `await setPreference("posSetupCompleted", true);`;
const LONG = "Nana Akosua Frimpomaa Asamoah-Boateng";
const PEOPLE = [[LONG, 1234567, -9], ["Kwabena Asamoah-Boateng", 9876543, -12], ["Akosua Serwaa Mensah", 123456, 5], ["Yaw", 1200, -100]];
const SEEDS = {
  // Home shows the first person to collect from; each case puts one long name with a large amount there.
  homeLong: `${head} ${sale(LONG, 1234567, -9)}`,
  homeBig: `${head} ${sale("Kwabena Asamoah-Boateng", 9876543, -12)}`,
  owed: `${head} ${PEOPLE.map((p) => sale(...p)).join(" ")}`,
  suppliers: `${head} ${supplier("Nana Akosua Frimpomaa-Boateng Wholesale Distributors", 9876543, -12)} ${supplier("Kofi Wholesale", 1234567, -9)} ${supplier("Ama Rice", 1200, 2)}`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const tops = [...document.querySelectorAll("[data-party-amount]")].map((amount) => amount.parentElement);
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    rows: tops.map((top) => {
      const tagEl = top.querySelector("[data-party-tag] > *");
      const nameEl = top.querySelector("[data-party-name], h2");
      const amountEl = top.querySelector("[data-party-amount]");
      return {
        name: nameEl.textContent, open: top.hasAttribute("data-person-open"), card: box(top.parentElement), top: box(top),
        nameBox: box(nameEl), nameHeight: nameEl.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(nameEl).lineHeight),
        dateBottom: (top.querySelector("[data-party-date]")?.getBoundingClientRect().bottom) ?? 0,
        amount: amountEl.textContent, amountBox: box(amountEl), amountLines: lines(amountEl),
        tag: tagEl ? { text: tagEl.textContent, lines: lines(tagEl), ...box(tagEl), overflow: tagEl.scrollWidth > tagEl.clientWidth + 0.5 } : null
      };
    })
  };
})()`;

function check(m, label, { open, expectedRows }) {
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
  assert.equal(m.rows.length, expectedRows, `${label}: ${expectedRows} rows`);
  for (const row of m.rows) {
    const what = `${label} "${row.name.slice(0, 20)}"`;
    assert.equal(row.open, open, `${what}: the top row ${open ? "is" : "is not"} the open button`);
    assert.ok(row.tag, `${what}: has a due tag`);
    assert.equal(row.tag.lines, 1, `${what}: the tag "${row.tag.text}" is one line`);
    assert.ok(!row.tag.overflow, `${what}: the tag text stays inside its border`);
    assert.equal(row.amountLines, 1, `${what}: the amount ${row.amount} is one line`);
    assert.ok(row.nameHeight <= row.lineHeight * 2 + 1, `${what}: the name is at most two lines`);
    assert.ok(row.amountBox.right <= row.top.right + 0.5 && row.tag.right <= row.top.right + 0.5, `${what}: amount and tag inside the row`);
    assert.ok(Math.abs(row.tag.left - row.top.left) < 1, `${what}: the tag starts at the left, under the name`);
    assert.ok(row.tag.top >= row.nameBox.bottom + 5, `${what}: the tag is under the name`);
    assert.ok(row.tag.top >= row.amountBox.bottom - 0.5 || row.tag.right <= row.amountBox.left, `${what}: the tag never covers the amount`);
    assert.ok(Math.abs(row.amountBox.top - row.top.top) < 1, `${what}: the amount is on the name's line`);
    // The top row ends with its content: as tall as before 4k (name, gap and tag, or the amount).
    const contentBottom = Math.max(row.tag.bottom, row.amountBox.bottom, row.nameBox.bottom, row.dateBottom);
    assert.ok(Math.abs(row.top.bottom - contentBottom) < 1, `${what}: the row is as tall as its content (${row.top.bottom} vs ${contentBottom})`);
    if (open) assert.ok(Math.abs(row.top.width - row.card.width) < 1, `${what}: the open button is the full card width`);
  }
}

const WIDTHS = [340, 360, 393];

test("22, 32 and 46: the due tag is one line beside a long name and a large amount at 340/360/393", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      for (const seed of ["homeLong", "homeBig"]) {
        await app.open(seed, width, 740);
        await app.shows("^Collect");
        await sleep(300);
        check(await app.evaluate(MEASURE), `22 ${seed} ${width}px`, { open: true, expectedRows: 1 });
      }
      await app.open("owed", width, 740);
      await app.shows("^Collect");
      await app.steps(["^Owed$"]);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-person-open]").length === ${PEOPLE.length}`), "32 with its rows");
      await sleep(300);
      check(await app.evaluate(MEASURE), `32 ${width}px`, { open: true, expectedRows: PEOPLE.length });
      await app.open("suppliers", width, 740);
      await app.steps(["^Open menu$", "^My money", "You owe suppliers"]);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-supplier]").length === 3`), "46 with its cards");
      await sleep(300);
      check(await app.evaluate(MEASURE), `46 ${width}px`, { open: false, expectedRows: 3 });
    }
  });
});
