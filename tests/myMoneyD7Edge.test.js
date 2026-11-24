import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// My money (33, D7) in real Edge at 340 (phone), 768 and 1280 (wide): no sideways scroll, no label touching
// its amount (credit row gap 12px or more), no comparison text, the hero label follows the period, the link
// buttons are 48px or taller on wide and open screens 32 and 46, and hiding amounts covers the new total.
const SEEDS = { money: `await setPreference("posSetupCompleted", true);
  await recordCashSale({ amountPesewas: 1234500 });
  await recordCreditSale({ name: "Abena Konadu", phone: "0244123456", amountPesewas: 1234500, dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), now: Date.now() });
  await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 0, category: "stock", newSupplier: { name: "Kofi" }, paidWith: "cash", payBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });` };

const MEASURE = `(() => {
  const rows = [...document.querySelectorAll("main [data-row]")].map((row) => {
    const [label, amount] = row.children;
    const l = label.getBoundingClientRect();
    const a = amount.getBoundingClientRect();
    return { name: row.getAttribute("data-row"), gap: a.left - l.right, labelRight: l.right, amountRight: a.right };
  });
  const links = [...document.querySelectorAll("main button")].filter((b) => /See (who|list)$/.test(b.textContent.replace(/\\s+/g, " ").trim())).map((b) => ({ height: b.getBoundingClientRect().height, text: b.textContent.trim() }));
  return {
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    rows,
    links,
    hero: (document.querySelector("[data-block=money-left] p") || {}).textContent || "",
    text: document.querySelector("main").innerText
  };
})()`;

const openMyMoney = async (app, width, height) => {
  await app.open("money", width, height);
  await app.steps(width < 768 ? ["^Open menu$", "^My money"] : ["^My money$"]);
  await waitFor(() => app.evaluate(`!!document.querySelector("[data-card=money-in]") && !!document.querySelector("[data-row=on-credit]")`), "My money with its rows");
  await sleep(300);
};

test("My money D7: fits, no comparison, hero follows the period, links, hidden amounts", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[340, 740], [768, 1024], [1280, 800]]) {
      const at = `${width}px`;
      await openMyMoney(app, width, height);
      for (const [button, label] of [["^Today$", "Money left today"], ["^This week$", "Money left this week"], ["^This month$", "Money left this month"]]) {
        await app.click(button);
        await waitFor(() => app.evaluate(`document.querySelector("[data-block=money-left] p").textContent.trim() === ${JSON.stringify(label)}`), `${at}: ${label}`);
        const m = await app.evaluate(MEASURE);
        assert.ok(m.scrollWidth <= m.innerWidth, `${at} ${label}: no sideways scroll`);
        assert.doesNotMatch(m.text, /more than|less than/, `${at} ${label}: no comparison line`);
        for (const row of m.rows) assert.ok(row.gap >= 0, `${at} ${label}: ${row.name} label does not overlap its amount`);
      }
      await app.click("^Today$");
      await sleep(200);
      const m = await app.evaluate(MEASURE);
      const credit = m.rows.find((row) => row.name === "on-credit");
      assert.ok(credit, `${at}: the credit row is shown`);
      assert.ok(credit.gap >= 12 - 0.5, `${at}: credit label is at least 12px from its amount (${credit.gap})`);
      assert.match(m.text, /On credit, not paid/);
      assert.match(m.text, /Where your money should be/);
      assert.equal(m.links.length, 2, `${at}: both link buttons`);
      if (width >= 1024) for (const link of m.links) assert.ok(link.height >= 48, `${at}: ${link.text} is ${link.height}px high`);

      // Hide amounts: every figure, the new total included, becomes the fixed GH₵ •••• .
      await app.click("^Hide amounts$");
      await waitFor(() => app.evaluate(`!/GH₵\\s?[0-9]/.test(document.querySelector("main").innerText)`), `${at}: amounts hidden`);
      const hidden = await app.evaluate(`document.querySelector("[data-card=should-have-left]").innerText`);
      assert.match(hidden, /GH₵ ••••/, `${at}: the Where your money should be total is hidden`);
      await app.click("^Show amounts$");

      // The link buttons (the whole card on the phone) open 32 and 46.
      for (const [link, heading] of [["See who$", /Total owed to you/], ["See list$", /You owe suppliers/]]) {
        await openMyMoney(app, width, height);
        await app.click(link);
        await waitFor(() => app.evaluate(`!document.querySelector("[data-card=money-in]")`), `${at}: ${link} leaves My money`);
        await waitFor(() => app.evaluate(`document.querySelector("main").innerText`).then((text) => heading.test(text)), `${at}: ${link} opens its screen`);
      }
    }
  });
});
