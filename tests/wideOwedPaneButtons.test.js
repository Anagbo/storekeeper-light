import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Owed detail pane (E): row 1 Collect | Reminder | Call with the icon beside the label, row 2 Edit contact,
// Correct balance and Show {Name} the record, row 3 the receipt button and Copy receipt. At 768 (rail) and
// 1024 nothing wraps or clips, including "Receipt for GH₵12,345.00 payment"; the two receipt buttons may stack.
const SEEDS = { owed: `await setPreference("posSetupCompleted", true);
  const { recordDebtPayment } = await import("./src/db/debts.js");
  const { debtId } = await recordCreditSale({ name: "Ama Boateng", phone: "0244123456", amountPesewas: 2000000, dueDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 * 5 });
  await recordDebtPayment({ debtId, amountPesewas: 1234500, paymentMethod: "cash" });` };
const MEASURE = `(() => {
  const pane = document.querySelector("[data-owed-detail]");
  const r = (el) => { const b = el.getBoundingClientRect(); return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), r: b.right }; };
  const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || 20));
  const rowOf = (sel) => pane.querySelector(sel);
  const row1 = [...pane.querySelectorAll("[data-row=debtor-actions] > *")];
  const row2 = [...pane.querySelectorAll("[data-row=debtor-secondary] > *")];
  const row3 = [...pane.querySelectorAll("[data-row=debtor-receipt] button")];
  const all = [...pane.querySelectorAll("button, a[href]")].filter((el) => el.getClientRects().length);
  const grey = [...pane.querySelectorAll("p")].find((p) => /owes/.test(p.textContent));
  return {
    pane: r(pane),
    row1: row1.map((el) => ({ ...r(el), flexDir: getComputedStyle(el).flexDirection })),
    row2: row2.map((el) => r(el)), row3: row3.map((el) => r(el)),
    overflow: all.filter((el) => el.scrollWidth > el.clientWidth + 0.5 || el.getBoundingClientRect().right > pane.getBoundingClientRect().right + 0.5).map((el) => el.textContent.trim()),
    wrapped: all.filter((el) => { const kids = [...el.querySelectorAll("span")]; return kids.some((k) => k.getBoundingClientRect().height > parseFloat(getComputedStyle(k).lineHeight || 20) * 1.5); }).map((el) => el.textContent.trim()),
    greySize: grey && getComputedStyle(grey).fontSize,
    receipt: row3[0]?.textContent.trim(),
  };
})()`;

test("wide Owed pane: grouped rows, nothing wraps or clips at 768 and 1024", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1024, 768], [1280, 800]]) {
      const at = `${width}x${height}`;
      await app.open("owed", width, height);
      await app.steps(["^Owed$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-owed-detail] [data-row=debtor-receipt]")`), `${at}: the pane with a receipt`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.deepEqual(m.overflow, [], `${at}: nothing clipped`);
      assert.deepEqual(m.wrapped, [], `${at}: no label wraps`);
      assert.equal(m.greySize, "17px", `${at}: grey label 17px`);
      assert.match(m.receipt, /Receipt for GH₵12,345\.00 payment/);
      assert.equal(m.row1.length, 3, `${at}: Collect, Reminder, Call`);
      assert.ok(m.row1.every((b) => b.t === m.row1[0].t && b.flexDir === "row"), `${at}: row 1 one line, icon beside label`);
      assert.equal(m.row2.length, 3, `${at}: three row-2 buttons`);
      if (m.row2.every((b) => b.t === m.row2[0].t)) assert.ok(m.row2.every((b) => Math.abs(b.w - m.row2[0].w) <= 1), `${at}: equal width in one row`);
      assert.equal(m.row3.length, 2);
    }
  });
});
