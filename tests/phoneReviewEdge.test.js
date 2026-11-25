import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Phone review fixes, part 2 (25 Nov 2026), real Edge at 340 and 390px: the selected looks differ as
// specified (navy view, mint choice with a tick, solid action), Spent money shows exactly one solid green
// control, nothing scrolls sideways, helper text is 15px or more, Payment received's helper does not touch
// the dashed button, and Suppliers' Pay is full width when no supplier has a phone.

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 390];

const CHIPS = `(() => [...document.querySelectorAll("[data-chip]")].map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { kind: el.dataset.chip, selected: el.dataset.selected === "true", text: el.textContent.trim(), bg: cs.backgroundColor, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, tick: Boolean(el.querySelector("[data-chip-tick]")), left: r.left, right: r.right, top: r.top, height: r.height };
}))()`;

const PAGE = `(() => ({
  scroll: document.documentElement.scrollWidth <= innerWidth,
  solid: [...document.querySelectorAll("button[data-look='main']")].filter((el) => el.offsetParent).map((el) => el.textContent.trim()),
  small: [...document.querySelectorAll("[data-helper], [data-save-hint], [data-saved-subline]")].filter((el) => el.offsetParent).map((el) => ({ text: el.textContent.trim(), size: parseFloat(getComputedStyle(el).fontSize) }))
}))()`;

const rows = (chips, top) => chips.filter((chip) => Math.abs(chip.top - top) < 4);

test("selected states and the Spent money form (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      // Spent money: no amount yet, so Save is disabled and says why; then an amount.
      await app.open("base", width, 800);
      await app.steps(["^Spent money"]);
      await sleep(300);
      let page = await app.evaluate(PAGE);
      assert.ok(page.small.some((item) => item.text === "Enter an amount"), `${width}: Enter an amount under the disabled Save`);
      await app.steps(["type:10"]);
      await sleep(300);
      page = await app.evaluate(PAGE);
      assert.equal(page.solid.length, 1, `${width}: exactly one solid green control (${page.solid})`);
      assert.match(page.solid[0], /^Save/, `${width}: it is Save`);
      assert.ok(page.scroll, `${width}: no sideways scroll`);
      assert.ok(page.small.every((item) => item.size >= 15), `${width}: helper text is 15px or more`);
      const chips = await app.evaluate(CHIPS);
      const selected = chips.filter((chip) => chip.selected);
      assert.ok(selected.length >= 2, `${width}: Yes and Cash are selected`);
      for (const chip of selected) {
        assert.equal(chip.bg, "rgb(209, 250, 229)", `${width} ${chip.text}: mint`);
        assert.equal(chip.border, "rgb(3, 84, 63)", `${width} ${chip.text}: #03543F border`);
        assert.equal(chip.borderWidth, "2px", `${width} ${chip.text}: 2px border`);
        assert.ok(chip.tick, `${width} ${chip.text}: has the tick`);
        assert.ok(chip.left >= 0 && chip.right <= width, `${width} ${chip.text}: inside the screen`);
      }
      for (const chip of chips.filter((item) => !item.selected)) {
        assert.equal(chip.bg, "rgb(255, 255, 255)", `${width} ${chip.text}: white`);
        assert.equal(chip.border, "rgb(100, 116, 139)", `${width} ${chip.text}: #64748B border`);
        assert.ok(!chip.tick, `${width} ${chip.text}: no tick`);
      }
      // My money periods are a view switch: navy.
      await app.open("base", width, 800);
      await app.steps(["^Open menu$", "^My money"]);
      await sleep(400);
      const views = (await app.evaluate(CHIPS)).filter((chip) => chip.kind === "view");
      assert.equal(views.length, 3, `${width}: three period buttons`);
      const navy = views.filter((chip) => chip.selected);
      assert.equal(navy.length, 1, `${width}: one period is selected`);
      assert.equal(navy[0].bg, "rgb(15, 23, 42)", `${width}: navy`);
      assert.ok(!navy[0].tick, `${width}: a view switch has no tick`);
      // Collect sheet: Due now and Cash are mint choices with a tick, the three of a row fit on one line.
      await app.open("base", width, 800);
      await app.steps(["^Owed$", "^Collect from Amoto"]);
      await sleep(400);
      const collect = await app.evaluate(CHIPS);
      const mint = collect.filter((chip) => chip.selected && chip.kind === "choice");
      assert.ok(mint.length >= 2, `${width}: Due now and Cash are selected choices`);
      for (const chip of mint) assert.ok(chip.tick && chip.bg === "rgb(209, 250, 229)", `${width} ${chip.text}: mint with a tick`);
      for (const chip of collect) assert.equal(rows(collect, chip.top).length <= 3, true, `${width}: at most three per row`);
      assert.ok(collect.every((chip) => chip.left >= 0 && chip.right <= width), `${width}: chips inside the screen`);
      assert.ok((await app.evaluate(PAGE)).scroll, `${width}: Collect has no sideways scroll`);
    }
  });
});

test("Payment received: the helper does not touch the dashed button; countdown inside the buttons (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("base", width, 900);
      await app.steps(["^Owed$", "^Collect from Amoto", "^Received$"]);
      await sleep(500);
      const m = await app.evaluate(`(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
        const helper = document.querySelector("[data-helper]"); const add = document.querySelector("[data-add-phone]");
        return { helper: helper && { ...box(helper), size: parseFloat(getComputedStyle(helper).fontSize) }, add: add && { ...box(add), dashed: getComputedStyle(add).borderTopStyle },
          buttons: [...document.querySelectorAll("main button")].map((b) => b.textContent.replace(/\\s+/g, " ").trim()) };
      })()`);
      assert.ok(m.helper && m.add, `${width}: helper and add-phone button are there`);
      assert.ok(m.helper.size >= 15, `${width}: helper is 15px or more`);
      assert.equal(m.add.dashed, "dashed", `${width}: the add-phone button is dashed`);
      assert.ok(m.add.top - m.helper.bottom >= 8, `${width}: the helper does not touch the dashed button (${m.add.top - m.helper.bottom}px)`);
      assert.ok(m.buttons.some((text) => /^Undo · \d+s$/.test(text)), `${width}: the countdown is inside Undo (${m.buttons})`);
      assert.ok(m.buttons.some((text) => /^WhatsApp · \d+s$/.test(text)), `${width}: and inside the WhatsApp button`);
      assert.ok(m.buttons.some((text) => /^Copy receipt · \d+s$/.test(text)), `${width}: and inside Copy receipt`);
      assert.ok((await app.evaluate(PAGE)).scroll, `${width}: no sideways scroll`);
    }
  });
});

test("Saved as credit (Add debt): the name once, no waiting line, one add-phone line (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("base", width, 900);
      await app.steps(["^Owed$", "Add debt$", "^[AK]?Amoto", "^Next", "^1$", "^0$", "^Next", "^Save · "]);
      await app.shows("See Amoto’s details");
      await sleep(300);
      const m = await app.evaluate(`(() => {
        const text = document.querySelector("main").textContent;
        const add = document.querySelector("[data-add-phone-whatsapp]");
        const lines = new Set(); if (add) { const range = document.createRange(); range.selectNodeContents(add); for (const r of range.getClientRects()) if (r.width > 0) lines.add(Math.round(r.top / 4)); }
        return { text, names: (text.match(/Amoto owes/g) ?? []).length, waiting: /waiting/i.test(text), thisSaleLine: /This sale GH/.test(text), addText: add && add.textContent.trim(), addLines: lines.size, paidRows: document.querySelectorAll("[data-event-detail='paid-today']").length, scroll: document.documentElement.scrollWidth <= innerWidth };
      })()`);
      assert.equal(m.names, 1, `${width}: the name appears once`);
      assert.ok(!m.waiting, `${width}: no waiting line`);
      assert.equal(m.addText, "+ Add phone for WhatsApp", `${width}: the add-phone label`);
      assert.equal(m.addLines, 1, `${width}: the add-phone label is one line`);
      assert.ok(m.scroll, `${width}: no sideways scroll`);
    }
  });
});

test("Suppliers: Pay is full width when no supplier has a phone (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("suppliers", width, 900);
      await app.steps(["^Open menu$", "^My money"]);
      await app.click("You owe suppliers");
      await app.shows("^Pay");
      await sleep(400);
      const m = await app.evaluate(`(() => {
        const cards = [...document.querySelectorAll("[data-supplier]")];
        return cards.map((card) => {
          const pay = [...card.querySelectorAll("button")].find((b) => /^Pay/.test(b.textContent.trim()));
          const c = card.getBoundingClientRect(); const p = pay && pay.getBoundingClientRect();
          return { slot: Boolean(card.querySelector("[data-call-slot]")), card: c.width, pay: p ? p.width : 0 };
        });
      })()`);
      assert.ok(m.length > 0, `${width}: supplier cards`);
      for (const card of m) {
        assert.ok(!card.slot, `${width}: no empty Call slot`);
        assert.ok(card.pay > card.card * 0.4, `${width}: Pay is full width, not squeezed beside an empty slot (${card.pay} of ${card.card})`);
      }
    }
  });
});

const TILES = `(() => [...document.querySelectorAll("[data-payment-tile]")].filter((el) => el.offsetParent).map((el) => {
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const tick = el.querySelector("[data-tile-tick]"); const tr = tick && tick.getBoundingClientRect();
  const label = el.querySelector("span:not([data-tile-tick])");
  return { text: el.textContent.trim(), selected: el.getAttribute("aria-pressed") === "true", disabled: el.disabled, bg: cs.backgroundColor, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, color: cs.color,
    labelSize: label ? parseFloat(getComputedStyle(label).fontSize) : 0, height: r.height, left: r.left, right: r.right, tick: Boolean(tick), tickSize: tr ? tr.width : 0, tickInside: tr ? tr.right <= r.right + 0.5 && tr.top >= r.top - 0.5 : false };
}))()`;

function checkTiles(tiles, width, where, minHeight) {
  assert.ok(tiles.length >= 3, `${width} ${where}: Cash, MoMo and Owe tiles`);
  const selected = tiles.filter((tile) => tile.selected);
  assert.equal(selected.length, 1, `${width} ${where}: one tile is selected`);
  const [tile] = selected;
  assert.equal(tile.bg, "rgb(209, 250, 229)", `${width} ${where}: mint fill`);
  assert.equal(tile.border, "rgb(3, 84, 63)", `${width} ${where}: #03543F border`);
  assert.equal(tile.borderWidth, "2px", `${width} ${where}: 2px border`);
  assert.ok(tile.tick && tile.tickInside, `${width} ${where}: the tick badge is in the top-right corner`);
  assert.equal(Math.round(tile.tickSize), 16, `${width} ${where}: the tick badge is 16px`);
  for (const item of tiles) {
    assert.ok(item.labelSize >= 15, `${width} ${where} ${item.text}: label is 15px or more (${item.labelSize})`);
    assert.ok(item.height >= minHeight - 0.5, `${width} ${where} ${item.text}: ${minHeight}px or taller (${item.height})`);
    assert.ok(item.left >= 0 && item.right <= width, `${width} ${where} ${item.text}: inside the screen`);
    if (!item.selected && !item.disabled) {
      assert.equal(item.bg, "rgb(255, 255, 255)", `${width} ${where} ${item.text}: white`);
      assert.equal(item.border, "rgb(100, 116, 139)", `${width} ${where} ${item.text}: #64748B border`);
      assert.ok(!item.tick, `${width} ${where} ${item.text}: no tick`);
    }
  }
}

test("Payment tiles on Sell and Review and pay: mint, tick, 15px label (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("base", width, 900);
      await app.steps(["^Sell$"]);
      await app.shows("Add items");
      await sleep(300);
      checkTiles(await app.evaluate(TILES), width, "Sell", 64);
      const split = await app.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Split payment" && b.offsetParent); return el && { text: el.textContent.trim(), dashed: getComputedStyle(el).borderTopStyle, svgs: el.querySelectorAll("svg").length, height: el.getBoundingClientRect().height }; })()`);
      assert.ok(split, `${width}: the Split tile is there`);
      assert.equal(split.text, "Split", `${width}: it says Split`);
      assert.equal(split.dashed, "dashed", `${width}: it stays dashed`);
      assert.equal(split.svgs, 5, `${width}: the original trio (three icons and two plus signs)`);
      assert.ok(split.height >= 64, `${width}: Split is 64px or taller`);
      assert.ok((await app.evaluate(PAGE)).scroll, `${width}: Sell has no sideways scroll`);
      await app.open("base", width, 900);
      await app.steps(["^Sell$", "Add items", "^Rice", "^Add 1", "^Next"]);
      await sleep(400);
      checkTiles(await app.evaluate(TILES), width, "Review and pay", 60);
      assert.ok((await app.evaluate(PAGE)).scroll, `${width}: Review has no sideways scroll`);
    }
  });
});

test("Saved as credit after a payment today: one Paid today row, method in the label, Now owes (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("base", width, 900);
      await app.steps(["^Sell$", "^5$", "^Owe$", "^[AK]?Amoto", "^Next", "A little at a time", "type:2", "^Today$"]);
      await sleep(300);
      await app.evaluate(`document.querySelector("[aria-label='Amount paid today']").focus()`);
      await app.type("3");
      await sleep(200);
      await app.steps(["^Save plan$"]);
      await app.shows("See Amoto’s details");
      await sleep(300);
      const m = await app.evaluate(`(() => {
        const card = document.querySelector("[data-debt-saved-rows]"); const text = card ? card.textContent : "";
        const rows = card ? [...card.querySelectorAll("[data-event-detail]")].map((el) => el.dataset.eventDetail) : [];
        const paid = [...document.querySelectorAll("[data-event-detail='paid-today']")];
        const cs = card && getComputedStyle(card);
        return { soft: cs && [cs.backgroundColor, cs.borderTopWidth], rows, paidCount: paid.length, paidInCard: paid.every((el) => card && card.contains(el)), paidText: paid[0] && paid[0].textContent.replace(/\\s+/g, " ").trim(), text, scroll: document.documentElement.scrollWidth <= innerWidth };
      })()`);
      assert.equal(m.paidCount, 1, `${width}: one Paid today row`);
      assert.ok(m.paidInCard, `${width}: it is inside the card`);
      assert.match(m.paidText, /^Paid today · Cash/, `${width}: a single method is named in the label (${m.paidText})`);
      assert.deepEqual(m.rows, ["before", "added", "paid-today", "now-owes"], `${width}: no per-method sub-rows`);
      // saved_credit_layout "a soft card" (rules_global.soft_tiles): #F1F5F9, no border.
      assert.deepEqual(m.soft, ["rgb(241, 245, 249)", "0px"], `${width}: the card is the soft tile`);
      assert.ok(!/MoMo/.test(m.text), `${width}: no MoMo row`);
      assert.match(m.text, /Now owes/, `${width}: the Now owes row`);
      assert.ok(m.scroll, `${width}: no sideways scroll`);
    }
  });
});
