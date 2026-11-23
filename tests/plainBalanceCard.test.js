import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 29/43 "Balance card" (decided 22 Nov 2026), real Edge at 340, 360 and 393px: a plain white card
// (2px #CBD5E1 border, 20px radius, no pink), the amount whole on one line, the label two lines at most.

const NAME = "Nana Akosua Frimpomaa Asamoah-Boatengxx".slice(0, 40);
const SEED = `await setPreference("posSetupCompleted", true); await recordCreditSale({ name: ${JSON.stringify(NAME)}, phone: "0244123456", amountPesewas: 9884543, now: Date.now() - 86400000 * 3 });`;

const MEASURE = `(() => {
  const card = document.querySelector("[data-balance-card]");
  const ps = [...card.querySelectorAll("p")];
  const cs = getComputedStyle(card);
  const label = ps[0], amount = ps[1];
  const lh = parseFloat(getComputedStyle(label).lineHeight) || label.getBoundingClientRect().height / 1;
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth,
    bg: cs.backgroundColor, border: cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius,
    labelLines: Math.round(label.getBoundingClientRect().height / lh), amountText: amount.textContent,
    amountFits: amount.scrollWidth <= amount.clientWidth + 0.5, amountHeight: amount.getBoundingClientRect().height,
    amountColor: getComputedStyle(amount).color, amountSize: getComputedStyle(amount).fontSize, amountWeight: getComputedStyle(amount).fontWeight,
    cardRight: card.getBoundingClientRect().right };
})()`;

test("29: the plain balance card holds a 40-character name and GH₵98,845.43 at 340/360/393", { skip: browser ? false : "no Chrome or Edge found", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: { one: SEED }, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      await app.open("one", width, 740);
      await app.shows("^Collect");
      await app.steps(["^Owed$"]);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-person-open]").length === 1`), "owed row");
      await app.steps([NAME.slice(0, 10)]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-balance-card]")`), "detail");
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      const at = `${width}px`;
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.equal(m.bg, "rgb(241, 245, 249)", at);
      assert.match(m.border, /^0px /, at);
      assert.equal(m.radius, "20px", at);
      assert.equal(m.amountColor, "rgb(15, 23, 42)", at);
      assert.equal(m.amountSize, "40px", at);
      assert.equal(m.amountWeight, "700", at);
      assert.ok(m.amountText.includes("98,845.43") && m.amountFits && m.amountHeight < 60, `${at}: amount on one line (${m.amountText})`);
      assert.ok(m.labelLines <= 2, `${at}: label ${m.labelLines} lines`);
    }
  });
});
