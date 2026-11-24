import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Cost price (wiring 40/41 COST PRICE, 39 COST NOT SET, 24 Nov 2026) in real Edge: the phone at 340 and
// the wide Items pane at 1024 and 1280. The field and its helper show with no overflow, Save stays inside
// the pane, a typed cost is saved and shown again, clearing it saves as Cost not set, and a change of the
// cost alone asks the leave question.
const SEEDS = {
  items: `await setPreference("posSetupCompleted", true);
  await createProduct({ name: "Bread", pricePesewas: 500 });
  await createProduct({ name: "Sugar", pricePesewas: 800 });`,
  // One item with no cost, sold once; window.__sellBread sells it again after the cost is added on Items.
  fresh: `await setPreference("posSetupCompleted", true);
  const bread = await createProduct({ name: "Bread", pricePesewas: 500 });
  window.__sellBread = () => recordCashSale({ amountPesewas: 500, saleItems: [{ productId: bread.id, name: "Bread", quantity: 1, unitPricePesewas: 500 }] }).then(() => true);
  await window.__sellBread();`,
  // One sold line with a cost and one without: Profit counts 1 of 2 items sold.
  mixed: `await setPreference("posSetupCompleted", true);
  const bread = await createProduct({ name: "Bread", pricePesewas: 500, costPricePesewas: 300 });
  const sugar = await createProduct({ name: "Sugar", pricePesewas: 800 });
  await recordCashSale({ amountPesewas: 1800, saleItems: [{ productId: bread.id, name: "Bread", quantity: 2, unitPricePesewas: 500 }, { productId: sugar.id, name: "Sugar", quantity: 1, unitPricePesewas: 800 }] });`,
  // Every sold line has a cost.
  all: `await setPreference("posSetupCompleted", true);
  const bread = await createProduct({ name: "Bread", pricePesewas: 500, costPricePesewas: 300 });
  await recordCashSale({ amountPesewas: 500, saleItems: [{ productId: bread.id, name: "Bread", quantity: 1, unitPricePesewas: 500 }] });`
};

const COST_INPUT = `document.querySelector("[data-cost-field] input")`;
const QUESTION = `document.querySelector('[role=alertdialog][aria-labelledby="leave-draft-question"]')`;

const MEASURE_FORM = `(() => {
  const field = document.querySelector("[data-cost-field]");
  const helper = field?.querySelector("[data-cost-helper]");
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
  const pane = document.querySelector("[data-items-pane]");
  const save = [...document.querySelectorAll("main button[type=submit]")].find((b) => b.offsetParent);
  const overflows = [...(field ? field.querySelectorAll("*") : [])].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible").length;
  return {
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    label: field?.textContent || "",
    helper: helper ? { text: helper.textContent, size: getComputedStyle(helper).fontSize, color: getComputedStyle(helper).color } : null,
    field: field ? box(field) : null,
    pane: pane ? box(pane) : null,
    save: save ? box(save) : null,
    overflows
  };
})()`;

const rowText = (name) => `(() => { const row = [...document.querySelectorAll("main button")].find((b) => b.offsetParent && b.querySelector("strong")?.textContent.trim() === ${JSON.stringify(name)}); return row ? row.innerText : null; })()`;

async function typeCost(app, text) {
  await waitFor(() => app.evaluate(`(() => { const f = ${COST_INPUT}; if (!f || !f.offsetParent) return false; f.focus(); f.select(); return true; })()`), "the cost field");
  if (text) await app.type(text);
  else {
    await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  }
  await waitFor(() => app.evaluate(`${COST_INPUT}.value === ${JSON.stringify(text)}`), `the cost field reads "${text}"`);
}

const VISITS = [
  { width: 340, height: 740, wide: false, list: ["^Menu", "^Items"] },
  { width: 1024, height: 768, wide: true, list: ["^Items$"] },
  { width: 1280, height: 800, wide: true, list: ["^Items$"] }
];

test("cost price in Edge: Edit item field, saving, clearing, Cost not set and the leave question", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const visit of VISITS) {
      const at = `${visit.width}px`;
      await app.open("items", visit.width, visit.height);
      await app.steps(visit.list);
      await waitFor(() => app.evaluate(rowText("Bread")), `${at}: the Bread row`);
      assert.match(await app.evaluate(rowText("Bread")), /Cost not set/, `${at}: a new item shows Cost not set`);
      assert.doesNotMatch(await app.evaluate(rowText("Bread")), /GH₵\s?0\.00\s*$/, `${at}: no cost amount on the list`);

      await app.click("^Bread");
      await waitFor(() => app.evaluate(`!!${COST_INPUT}`), `${at}: the cost field`);
      await sleep(300);
      const m = await app.evaluate(MEASURE_FORM);
      assert.match(m.label, /What you paid for one\s*\(optional\)/, `${at}: label and tag`);
      assert.equal(m.helper?.text, "Only you see this. We use it to work out your profit.", `${at}: helper`);
      assert.equal(m.helper.size, "15px", `${at}: helper 15px`);
      assert.equal(m.helper.color, "rgb(71, 85, 105)", `${at}: helper #475569`);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.equal(m.overflows, 0, `${at}: nothing in the cost field overflows`);
      assert.ok(m.field.l >= 0 && m.field.r <= m.innerWidth + 0.5, `${at}: the field is inside the screen`);
      if (visit.wide) {
        assert.ok(m.save.l >= m.pane.l && m.save.r <= m.pane.r + 0.5 && m.save.b <= m.pane.b + 0.5, `${at}: Save stays inside the pane`);
        assert.ok(m.field.w <= (m.pane.w / 2) + 1, `${at}: the cost field takes half the pane (${m.field.w} of ${m.pane.w})`);
        assert.ok(m.save.t >= m.field.b, `${at}: Save is on its own row below the field`);
      }

      // Only the cost changed: leaving asks first; Stay keeps the typed cost.
      await typeCost(app, "7");
      if (visit.wide) await app.click("^Sugar");
      else await app.click("^Back$");
      await waitFor(() => app.evaluate(`!!${QUESTION}`), `${at}: the leave question for a cost change`);
      await app.click("^Stay$");
      await waitFor(() => app.evaluate(`!${QUESTION}`), `${at}: Stay closes the question`);
      assert.equal(await app.evaluate(`${COST_INPUT}.value`), "7", `${at}: Stay keeps the cost`);

      // Save, then reopen: the cost is shown again and the list no longer says Cost not set.
      await app.click("^Save$");
      if (visit.wide) {
        await waitFor(() => app.evaluate(`!!document.querySelector("[data-items-saved]")?.textContent.trim()`), `${at}: Saved`);
        await app.click("^Sugar");
        await waitFor(() => app.evaluate(`!!document.querySelector("#item-pane-title")?.textContent.includes("Sugar")`), `${at}: Sugar open`);
        await app.click("^Bread");
        await waitFor(() => app.evaluate(`!!document.querySelector("#item-pane-title")?.textContent.includes("Bread")`), `${at}: Bread open again`);
      } else {
        await waitFor(() => app.evaluate(rowText("Bread")), `${at}: back on the list`);
        assert.doesNotMatch(await app.evaluate(rowText("Bread")), /Cost not set/, `${at}: Bread has a cost now`);
        await app.click("^Bread");
      }
      await waitFor(() => app.evaluate(`${COST_INPUT}?.value === "7.00"`), `${at}: the saved cost shows again`);
      if (visit.wide) assert.doesNotMatch(await app.evaluate(rowText("Bread")), /Cost not set/, `${at}: Bread has a cost now`);

      // Clearing the cost saves it as Cost not set.
      await typeCost(app, "");
      await app.click("^Save$");
      if (visit.wide) await waitFor(() => app.evaluate(`!!document.querySelector("[data-items-saved]")?.textContent.trim()`), `${at}: Saved again`);
      await waitFor(async () => /Cost not set/.test(await app.evaluate(rowText("Bread")) || ""), `${at}: cleared cost shows Cost not set`);
    }
  });
});

const PROFIT = `(() => {
  const card = document.querySelector("[data-card=profit]");
  if (!card) return null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; };
  const parts = [...card.children].map(box);
  const button = card.querySelector("[data-add-costs]");
  const others = [...document.querySelectorAll("main section, main [data-tiles]")].filter((el) => el !== card && !card.contains(el) && !el.contains(card)).map(box);
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    items: card.getAttribute("data-profit-view") === "items",
    text: card.innerText,
    card: box(card), parts, button: button ? box(button) : null, others
  };
})()`;

const overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

async function openMyMoney(app, caseName, width, height) {
  await app.open(caseName, width, height);
  await app.steps(width < 768 ? ["^Open menu$", "^My money"] : ["^My money$"]);
  await waitFor(() => app.evaluate(PROFIT), `${width}px: the profit card`);
  await sleep(300);
  return app.evaluate(PROFIT);
}

test("profit view in Edge at 340, 768 and 1280: N of M, all counted, button, no overlap, the old card until a cost", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[340, 740], [768, 1024], [1280, 800]]) {
      const at = `${width}px`;
      const m = await openMyMoney(app, "mixed", width, height);
      assert.ok(m.items, `${at}: the item-level card`);
      assert.match(m.text, /^Profit today/, `${at}: the title follows the period`);
      // Bread (5.00 - 3.00) x 2; Sugar has no cost and is not counted.
      assert.match(m.text, /GH₵\s?4\.00/, `${at}: profit of the costed line only`);
      assert.match(m.text, /Profit counts 1 of 2 items sold/, `${at}: N of M`);
      assert.match(m.text, /A good guess, not exact/, `${at}: helper`);
      assert.ok(m.button && m.button.h >= 48, `${at}: Add costs to the rest is 48px or taller`);
      assert.ok(m.card.l >= 0 && m.card.r <= m.innerWidth + 0.5 && m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      for (let i = 1; i < m.parts.length; i += 1) assert.ok(m.parts[i].t >= m.parts[i - 1].b - 0.5, `${at}: card lines do not overlap`);
      for (const other of m.others) assert.ok(!overlaps(m.card, other), `${at}: the profit card overlaps no other card`);
      assert.ok(m.button.l >= m.card.l && m.button.r <= m.card.r + 0.5, `${at}: the button is inside the card`);

      await app.click("^This week$");
      await waitFor(() => app.evaluate(`document.querySelector("[data-card=profit]")?.innerText.startsWith("Profit this week")`), `${at}: Profit this week`);
      await app.click("^Hide amounts$");
      await waitFor(() => app.evaluate(`/GH₵ ••••/.test(document.querySelector("[data-card=profit]").innerText)`), `${at}: hidden profit`);
      await app.click("^Show amounts$");

      await app.click("^Add costs to the rest$");
      await waitFor(() => app.evaluate(`!document.querySelector("[data-card=profit]") && /Sugar/.test(document.querySelector("main").innerText) && /Cost not set/.test(document.querySelector("main").innerText)`), `${at}: Add costs to the rest opens Items`);

      const all = await openMyMoney(app, "all", width, height);
      assert.match(all.text, /Profit counts the 1 item sold\. A good guess, not exact\./, `${at}: all counted`);
      assert.equal(all.button, null, `${at}: no button when all are counted`);
    }

    // A fresh item with no cost sold once: the old Estimated profit card. After a cost is added on Items
    // and the item is sold again, the item-level card counts 1 of 2.
    const fresh = await openMyMoney(app, "fresh", 340, 740);
    assert.equal(fresh.items, false, "no cost yet: the old card");
    assert.match(fresh.text, /^Estimated profit/, "no cost yet: Estimated profit");
    await app.click("^Back$");
    await app.steps(["^Open menu$", "^Items", "^Bread"]);
    await typeCost(app, "3");
    await app.click("^Save$");
    await waitFor(() => app.evaluate(rowText("Bread")), "back on the list");
    assert.equal(await app.evaluate("window.__sellBread()"), true);
    await app.click("^Back$");
    await app.steps(["^Open menu$", "^My money"]);
    await waitFor(() => app.evaluate(`/Profit counts 1 of 2 items sold/.test(document.querySelector("[data-card=profit]")?.innerText || "")`), "the item-level card after the second sale");
  });
});
