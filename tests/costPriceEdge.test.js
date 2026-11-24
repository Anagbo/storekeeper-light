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
  await createProduct({ name: "Sugar", pricePesewas: 800 });`
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
