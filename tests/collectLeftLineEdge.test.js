import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 25 rule 0: the Due now line "{n} payments left after this" is one text line at 340, 360 and 393px.
const SEEDS = {
  plan: `
    await setPreference("posSetupCompleted", true);
    const { prepareInstallmentPlan, localDateString } = await import("./src/utils/installments.js");
    const first = prepareInstallmentPlan({ amountPesewas: 85500, installmentAmountPesewas: 2000, frequency: "weekly", nextDueDate: localDateString(new Date(Date.now() + 5 * 86400000)) });
    await recordCreditSale({ name: "amos", amountPesewas: 85500, installmentPlan: first.plan });
  `
};
const LINE = `(() => {
  const p = [...document.querySelectorAll("p, div, span")].filter((el) => /payments? left after this/.test(el.textContent) && ![...el.children].some((c) => /left after this/.test(c.textContent)))[0];
  if (!p) return null;
  const range = document.createRange();
  range.selectNodeContents(p);
  const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4)));
  return { text: p.textContent.trim(), lines: tops.size, overflow: p.scrollWidth > p.clientWidth + 0.5 };
})()`;

test("25 Due now line reads '41 payments left after this' on one line at 340, 360 and 393px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      await app.open("plan", width, 800);
      await app.click("Owed|owe");
      await app.click("^Collect from Amos");
      const line = await waitFor(() => app.evaluate(LINE), `${width}: the Due now line`);
      assert.match(line.text, /^\d+ payments left after this$/, `${width}: wording`);
      assert.equal(line.lines, 1, `${width}: one text line`);
      assert.equal(line.overflow, false, `${width}: no overflow`);
    }
  });
});
