import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Settings (D13) in real Edge at 768x1024 and 1280x800: the list and the pane side by side with no
// page or sideways scroll, every section row there (60px+, status on one line), each section in the pane,
// Save inside the MoMo pane at its bottom, the backup arrows visible, text 15px+ and never 16px, and the
// dialogs (63 confirmation, 65) returning focus to the button that opened them; Escape closes them.
const SEEDS = { settings: `await setPreference("posSetupCompleted", true);` };

const MEASURE = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; };
  const area = document.querySelector("[data-page-area]");
  const pane = document.querySelector("[data-settings-pane]");
  const footer = pane?.querySelector("[data-settings-pane-footer]");
  const sizes = new Set();
  const root = document.querySelector("[data-settings-columns]");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (node.textContent.trim() && el.getClientRects().length && !el.closest(".sr-only")) sizes.add(parseFloat(getComputedStyle(el).fontSize));
  }
  return {
    innerWidth, innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    pageScroll: area.scrollHeight - area.clientHeight,
    list: box(document.querySelector("[data-settings-list]")),
    rows: [...document.querySelectorAll("[data-settings-row]")].map((el) => ({ id: el.dataset.settingsRow, ...box(el) })),
    details: [...document.querySelectorAll("[data-settings-row-detail]")].map((el) => ({ text: el.textContent, cut: el.scrollWidth > el.clientWidth + 0.5 })),
    pane: pane && { id: pane.dataset.settingsPane, ...box(pane) },
    footer: footer && box(footer),
    save: footer && box(footer.querySelector("button")),
    icons: [...(pane?.querySelectorAll("svg[data-icon]") ?? [])].map((el) => ({ name: el.dataset.icon, ...box(el) })),
    sizes: [...sizes].sort((a, b) => a - b)
  };
})()`;

const focused = `(() => { const el = document.activeElement; return { tag: el?.tagName, text: (el?.textContent ?? "").trim().slice(0, 30) }; })()`;

test("D13 at 768 and 1280: list and pane visible, no sideways scroll, Save in the pane, arrows visible, focus returns from dialogs", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    const escape = async () => {
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    };
    // A real mouse click (focus moves to the button, as with a mouse or a keyboard), at the button's centre.
    const realClick = async (label) => {
      const at = await waitFor(() => app.evaluate(`(() => { const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)} && b.offsetParent && !b.disabled); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), label);
      for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    };
    const dialogOpen = () => app.evaluate(`!!document.querySelector("[data-wide-dialog]")`);
    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      const at = `${width}x${height}`;
      await app.open("settings", width, height);
      await app.click("^Settings$");
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-settings-row]").length === 4`), `${at}: the four rows`);
      for (const id of ["shop", "momo", "plan", "backup"]) {
        await app.click(`^${{ shop: "Shop", momo: "MoMo payments", plan: "My plan", backup: "Backup and restore" }[id]}`);
        await waitFor(() => app.evaluate(`document.querySelector("[data-settings-pane]")?.dataset.settingsPane === ${JSON.stringify(id)}`), `${at}: the ${id} pane`);
        await sleep(300);
        const m = await app.evaluate(MEASURE);
        assert.ok(m.scrollWidth <= m.innerWidth, `${at} ${id}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
        assert.ok(m.pageScroll <= 0, `${at} ${id}: no page scroll (${m.pageScroll})`);
        assert.deepEqual(m.rows.map((row) => row.id), ["shop", "momo", "plan", "backup"], `${at} ${id}: no section lost`);
        for (const row of m.rows) assert.ok(row.t >= 0 && row.b <= m.innerHeight && row.h >= 60, `${at} ${id}: row ${row.id} visible and 60px+ (${row.h})`);
        for (const detail of m.details) assert.ok(!detail.cut, `${at}: "${detail.text}" on one line, not cut`);
        assert.ok(m.pane.l >= m.list.r && m.pane.t >= 0 && m.pane.b <= m.innerHeight, `${at} ${id}: the pane beside the list, inside the window`);
        assert.ok(m.sizes[0] >= 15 && !m.sizes.includes(16), `${at} ${id}: text 15px+ and never 16px (${m.sizes.join(", ")})`);
        if (id === "momo") {
          assert.ok(m.save && m.save.b <= m.pane.b && m.footer.b <= m.pane.b && m.pane.b - m.footer.b <= 4, `${at}: Save in the footer at the bottom of the pane`);
          assert.ok(m.save.w <= 240.5 && m.save.h >= 48, `${at}: Save 240px wide at most, 48px+ (${m.save.w}x${m.save.h})`);
        }
        if (id === "backup") {
          assert.deepEqual(m.icons.map((icon) => icon.name), ["download", "upload"], `${at}: both arrows`);
          for (const icon of m.icons) assert.ok(icon.w >= 20 && icon.t >= m.pane.t && icon.b <= m.pane.b, `${at}: the ${icon.name} arrow visible`);
        }
      }

      // 63 confirmation: Change, then Escape, return focus to Save.
      await app.click("^MoMo payments");
      await app.click("Customer sends to my number");
      await waitFor(() => app.evaluate(`(() => { const el = document.querySelector('input[aria-label="My MoMo number"]'); if (!el) return false; el.focus(); return true; })()`), `${at}: the number field`);
      await app.type("0241234567");
      await sleep(200);
      for (const close of [() => app.click("^Change$"), escape]) {
        await realClick("Save");
        await waitFor(dialogOpen, `${at}: the confirmation`);
        await close();
        await waitFor(async () => !(await dialogOpen()), `${at}: the confirmation closed`);
        await sleep(200);
        const back = await app.evaluate(focused);
        assert.equal(back.text, "Save", `${at}: focus back on Save (${JSON.stringify(back)})`);
      }

      // 65 over the My plan pane: Escape and Close return focus to Pay now.
      await app.click("^My plan");
      for (const close of [escape, () => app.click("^Close$")]) {
        await realClick("Pay now");
        await waitFor(dialogOpen, `${at}: 65`);
        await close();
        await waitFor(async () => !(await dialogOpen()), `${at}: 65 closed`);
        await sleep(200);
        const back = await app.evaluate(focused);
        assert.equal(back.text, "Pay now", `${at}: focus back on Pay now (${JSON.stringify(back)})`);
      }
    }
  });
});
