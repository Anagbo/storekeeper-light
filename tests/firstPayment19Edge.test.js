import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// 19 A little at a time, First payment, in real Edge at 340 and 390px (replaces two source regexes in
// pos.routes.test.js). A payment taken today before 19 (GH₵30.00 cash on the Sell split): Today is disabled
// (aria-disabled, the disabled chip look), Next cycle is chosen and "Already paid GH₵30.00 today" is under
// the chips. No payment taken: Today can be chosen and becomes the selected chip.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const WIDTHS = [340, 390];

const STATE = `(() => {
  const chips = [...document.querySelectorAll("main button")].filter((b) => b.offsetParent);
  const today = chips.find((b) => b.textContent.trim() === "Today");
  const next = chips.find((b) => /^Next cycle/.test(b.textContent.trim()));
  if (!today || !next) return null;
  const why = document.querySelector("[data-first-payment-why]");
  const look = (b) => { const cs = getComputedStyle(b); return { disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), pressed: b.getAttribute("aria-pressed"), border: cs.borderTopColor, color: cs.color }; };
  return { today: look(today), next: look(next), why: why ? why.textContent.trim() : null, describedBy: today.getAttribute("aria-describedby") };
})()`;

async function read19(app) {
  for (let round = 0; round < 40; round += 1) {
    const s = await app.evaluate(STATE);
    if (s) return s;
    await sleep(150);
  }
  throw new Error("19 First payment chips did not show");
}

test("19 First payment: paid today on the Sell split, Today is disabled with Already paid; none paid, Today can be chosen (340, 390px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      await app.open("base", width, 900);
      await app.steps(["^Sell$", "^8$", "^0$", "^Split$", "^Ca", "^Edit Cash amount$", "type:30", "^Save$", "^Owe$", "^[AK]?Amoto", "^Next", "A little at a time"]);
      const paid = await read19(app);
      assert.deepEqual([paid.today.disabled, paid.today.ariaDisabled, paid.today.pressed], [true, "true", "false"], `${width}: Today is disabled`);
      assert.deepEqual([paid.today.border, paid.today.color], ["rgb(203, 213, 225)", "rgb(148, 163, 184)"], `${width}: Today has the disabled chip look`);
      assert.equal(paid.next.pressed, "true", `${width}: Next cycle is the first payment`);
      assert.equal(paid.why, "Already paid GH₵30.00 today", `${width}: the reason line`);
      assert.equal(paid.describedBy, "first-payment-today-why", `${width}: Today is described by the reason line`);

      await app.open("base", width, 900);
      await app.steps(["^Sell$", "^5$", "^Owe$", "^[AK]?Amoto", "^Next", "A little at a time"]);
      const none = await read19(app);
      assert.equal(none.today.disabled, false, `${width}: nothing paid, Today can be chosen`);
      assert.equal(none.why, null, `${width}: no Already paid line`);
      await app.steps(["^Today$"]);
      await sleep(200);
      const chosen = await read19(app);
      assert.deepEqual([chosen.today.pressed, chosen.next.pressed], ["true", "false"], `${width}: Today is chosen`);
    }
  });
});
