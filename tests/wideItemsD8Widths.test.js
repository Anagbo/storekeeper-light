import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Items (D8) in real Edge at 768x1024 and 1280x800 with 6 items: list and form visible without page
// scroll, Save pinned at the bottom of the pane, no sideways scroll, Price full width under Item name (the
// wide form has exactly the phone's fields), and 42 returning focus to the row or the heading.
const ITEMS = [["Bread", 500], ["Water", 200], ["Sugar", 800], ["Rice", 1200], ["Cooking oil", 2500], ["Soap", 300]];
const SEEDS = { items: `await setPreference("posSetupCompleted", true); ${ITEMS.map(([name, pricePesewas]) => `await createProduct({ name: ${JSON.stringify(name)}, pricePesewas: ${pricePesewas} });`).join(" ")}` };

const MEASURE = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; };
  const area = document.querySelector("[data-page-area]");
  const pane = document.querySelector("[data-items-pane]");
  const save = pane && [...pane.querySelectorAll("button[type=submit]")][0];
  const labels = pane ? [...pane.querySelectorAll("label")].map(box) : [];
  return {
    innerWidth, innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    pageScroll: area.scrollHeight - area.clientHeight,
    docScroll: document.documentElement.scrollHeight - innerHeight,
    list: box(document.querySelector("[data-items-list]")),
    rows: [...document.querySelectorAll("[data-item-row]")].map(box),
    pane: pane && box(pane),
    save: save && box(save),
    labels,
    choose: !!document.querySelector("[data-items-choose]")
  };
})()`;

const focused = `(() => { const el = document.activeElement; return { tag: el?.tagName, row: el?.getAttribute?.("data-item-row") ?? null, text: (el?.textContent ?? "").trim().slice(0, 30) }; })()`;

test("D8 at 768 and 1280: fits without page scroll, Save pinned, no sideways scroll, Price full width; 42 focus return", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      const at = `${width}x${height}`;
      await app.open("items", width, height);
      await app.click("^Items$");
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-item-row]").length === 6`), `${at}: the six rows`);
      assert.equal((await app.evaluate(MEASURE)).choose, true, `${at}: nothing selected on first opening`);
      await app.click("^Sugar");
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-items-pane]")`), `${at}: the form`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
      assert.ok(m.pageScroll <= 0 && m.docScroll <= 0, `${at}: no page scroll (${m.pageScroll}, ${m.docScroll})`);
      for (const row of m.rows) assert.ok(row.t >= 0 && row.b <= m.innerHeight && row.h >= 48, `${at}: every row visible and 48px+`);
      assert.ok(m.pane.l >= m.list.r, `${at}: form to the right of the list`);
      assert.ok(m.pane.b <= m.innerHeight && m.pane.t >= 0, `${at}: form visible`);
      assert.ok(m.save.b <= m.pane.b && m.pane.b - m.save.b <= 160, `${at}: Save at the bottom of the pane (above Delete item when stacked) (${m.pane.b - m.save.b}px above)`);
      assert.ok(m.save.r >= m.pane.r - 40, `${at}: Save at the right`);
      assert.ok((m.save.w <= 240.5 || m.save.w >= m.pane.r - m.pane.l - 60) && m.save.h >= 48, `${at}: Save 240px wide at most, 48px+`);
      if (width === 768) assert.ok(Math.abs(m.list.w - 260) <= 1, `${at}: list 260px (${m.list.w})`);
      else assert.ok(m.list.w >= 339 && m.list.w <= 400.5, `${at}: list 340 to 400px (${m.list.w})`);
      assert.equal(m.labels.length, 2, `${at}: Item name and Price only`);
      const [name, price] = m.labels;
      assert.ok(price.t >= name.b && Math.abs(price.w - name.w) <= 1, `${at}: Price full width under Item name`);

      // 42: Keep returns focus to the Sugar row; Yes, delete to the page heading (the row is gone).
      await app.click("^Delete item$");
      await app.click("^Keep Sugar$");
      await sleep(200);
      const kept = await app.evaluate(focused);
      assert.ok(kept.row && kept.text.startsWith("Sugar"), `${at}: focus on the Sugar row (${JSON.stringify(kept)})`);
      await app.click("^Delete item$");
      await app.click("^Yes, delete$");
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-item-row]").length === 5`), `${at}: Sugar removed`);
      await sleep(200);
      const gone = await app.evaluate(focused);
      assert.equal(gone.tag, "H1", `${at}: focus on the page heading (${JSON.stringify(gone)})`);
    }
  });
});
