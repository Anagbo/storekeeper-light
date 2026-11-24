import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Items polish (24 Nov 2026) in real Edge at 768 (rail) and 1280 (sidebar), and the phone at 390:
// title Items (phone My items); Save and Delete item inside the pane, 12px apart or Save full width above
// Delete item; + New item solid green and pressed while its form is open; field text 17px or more;
// the starter dialog says Close and keeps its action visible while the list scrolls by itself.
const LONG = "Extra long item name that keeps going to test the wide form pane ".repeat(2).trim().slice(0, 80);
const SEEDS = { items: `await setPreference("posSetupCompleted", true); await createProduct({ name: ${JSON.stringify(LONG)}, pricePesewas: 123456 }); await createProduct({ name: "Bread", pricePesewas: 500 });` };

const PANE = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width }; };
  const pane = document.querySelector("[data-items-pane]");
  const save = pane.querySelector("button[type=submit]");
  const del = pane.querySelector("[data-delete-item]");
  const inputs = [...pane.querySelectorAll("input")];
  const prefix = [...pane.querySelectorAll("span")].filter((s) => s.textContent.trim() === "GH₵").pop();
  const size = (e) => parseFloat(getComputedStyle(e).fontSize);
  return { pane: box(pane), save: box(save), del: box(del), scroll: document.documentElement.scrollWidth <= innerWidth, inputs: inputs.map(size), prefix: size(prefix) };
})()`;

const TOP = `(() => {
  const btn = (re) => [...document.querySelectorAll("[data-items-top] button")].find((b) => re.test(b.getAttribute("aria-label") || b.textContent.trim()));
  const nw = btn(/New item/), st = btn(/starter list|Starter list/i);
  const s = (b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, border: c.borderTopColor, pressed: b.getAttribute("aria-pressed"), shadow: c.boxShadow, label: b.textContent.trim() }; };
  const save = document.querySelector("[data-items-pane] button[type=submit]");
  return { saveBg: save ? getComputedStyle(save).backgroundColor : null, title: document.querySelector("h1")?.textContent.trim(), newItem: s(nw), starter: s(st) };
})()`;

const DIALOG = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const p = document.querySelector("[data-wide-dialog]");
  if (!p) return null;
  const head = p.querySelector("h2").previousElementSibling;
  const act = [...p.querySelectorAll("button")].find((b) => /^(Add \d+ items?|Add 1 item|Add items?)/i.test(b.textContent.trim()));
  const scrollers = [...p.querySelectorAll("*")].filter((e) => getComputedStyle(e).overflowY === "auto" && e.scrollHeight > e.clientHeight);
  return { header: head?.textContent.trim(), actionBottom: act ? act.getBoundingClientRect().bottom : null, innerHeight, panelScroll: p.scrollHeight - p.clientHeight, inner: scrollers.length, doc: document.documentElement.scrollHeight - innerHeight };
})()`;

test("wide Items polish in Edge (768, 1280) and the phone title", { skip: browser ? false : "no Chrome or Edge found", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      const at = String(width);
      await app.open("items", width, height);
      await app.click("^Items$");
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-item-row]").length === 2`), `${at}: rows`);
      assert.equal((await app.evaluate(TOP)).title, "Items", `${at}: wide title Items`);
      await app.click("^Extra long");
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-items-pane]")`), `${at}: form`);
      await sleep(300);
      const m = await app.evaluate(PANE);
      for (const [name, b] of [["Save", m.save], ["Delete item", m.del]]) assert.ok(b.l >= m.pane.l && b.r <= m.pane.r, `${at}: ${name} inside the pane (${b.l}-${b.r} in ${m.pane.l}-${m.pane.r})`);
      const sameRow = Math.abs(m.save.t - m.del.t) < 4;
      if (sameRow) assert.ok(m.save.l - m.del.r >= 12 || m.del.l - m.save.r >= 12, `${at}: 12px between Delete item and Save`);
      else assert.ok(m.save.b <= m.del.t && Math.abs(m.save.w - (m.pane.r - m.pane.l - 100)) < 60, `${at}: Save full width above Delete item`);
      assert.ok(m.scroll, `${at}: no sideways scroll`);
      for (const size of [...m.inputs, m.prefix]) assert.ok(size >= 17, `${at}: field text 17px or more (${JSON.stringify([m.inputs, m.prefix])})`);

      // New item: solid green, and pressed while its form is open.
      const before = await app.evaluate(TOP);
      assert.equal(before.newItem.bg, before.saveBg, `${at}: New item has the solid green of the primary button (${before.newItem.bg})`);
      assert.ok(!/rgba?(255, 255, 255|, 0)$/.test(before.newItem.bg), `${at}: New item is filled`);
      assert.ok(before.starter.bg === "rgb(255, 255, 255)" && before.starter.border === "rgb(15, 23, 42)" && before.starter.pressed === null, `${at}: starter button outlined`);
      await app.click("New item$");
      await sleep(200);
      const active = await app.evaluate(TOP);
      assert.equal(active.newItem.pressed, "true", `${at}: New item pressed`);
      assert.ok(active.newItem.bg !== before.newItem.bg || active.newItem.shadow !== "none", `${at}: pressed look is visible`);

      // The starter dialog: Close, action visible, the list scrolls inside.
      await app.click("tarter list");
      const d = await waitFor(() => app.evaluate(DIALOG), `${at}: starter dialog`);
      await sleep(300);
      const d2 = await app.evaluate(DIALOG);
      assert.match(d2.header, /^Close$/, `${at}: dialog header button reads Close`);
      assert.ok(d2.panelScroll <= 1 && d2.doc <= 0, `${at}: the dialog and page do not scroll`);
      assert.ok(d2.inner >= 1, `${at}: the list scrolls by itself`);
    }
    await app.open("items", 390, 844);
    await app.steps(["^Menu", "^Items"]);
    await waitFor(() => app.evaluate(`document.body.innerText.includes("My items")`), "phone title My items");
  });
});
