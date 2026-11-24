import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// wide_layout.page_types.dialog in real Edge at 768x1024 and 1280x800, with GH₵12,345.00:
// the 46 Pay sheet (its opener stays on the page) and 25 Collect opened from Owed (the opener is not on
// the page behind, Home). Each is a centred 520px dialog over a dark scrim; text 15px or more and never
// 16px; targets 48px or more; Tab and Shift+Tab stay inside; Escape (46) and a scrim click (25) close
// it; focus goes back to Pay Kofi (46) or to Home's main heading (25). No sideways scroll.
const SEEDS = {
  base: `
await setPreference("posSetupCompleted", true);
await recordCreditSale({ name: "Ama", amountPesewas: 1234500, now: Date.now() - 3 * 86400000 });
await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 0, category: "stock", supplierId: "s1" });
`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const panel = document.querySelector("[data-wide-dialog]");
  if (!panel) return null;
  const scrim = panel.closest("[data-wide-dialog-scrim]");
  const r = panel.getBoundingClientRect(), s = scrim.getBoundingClientRect();
  const bad = [];
  const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest("[aria-hidden=true]") || !el.getClientRects().length) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size === 16 || size < 15) bad.push(size + "px " + n.textContent.trim().slice(0, 30));
  }
  // A field's target is its whole label tile.
  const small = [...panel.querySelectorAll("button, input, [role=radio]")].map((b) => (b.tagName === "INPUT" && b.closest("label")) || b).filter((b) => b.getClientRects().length && b.getBoundingClientRect().height < 48).map((b) => (b.getAttribute("aria-label") || b.textContent.trim()) + " " + Math.round(b.getBoundingClientRect().height));
  return {
    width: Math.round(r.width), centre: Math.abs(r.left + r.width / 2 - innerWidth / 2), middle: Math.abs(r.top + r.height / 2 - innerHeight / 2),
    scrimCovers: s.left === 0 && s.top === 0 && Math.round(s.width) === innerWidth && Math.round(s.height) === innerHeight,
    scrimColour: getComputedStyle(scrim).backgroundColor,
    scroll: document.documentElement.scrollWidth <= innerWidth, bad, small, text: panel.textContent
  };
})()`;
const FOCUS = `(() => { const a = document.activeElement; return { inside: !!a?.closest("[data-wide-dialog]"), tag: a?.tagName, name: a?.getAttribute("aria-label") || a?.textContent.trim().slice(0, 40) }; })()`;

test("wide dialogs in Edge (768, 1280): 46 Pay sheet and 25 Collect", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    const key = async (k, shift = false) => {
      const code = { Tab: 9, Escape: 27 }[k];
      await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
      await sleep(80);
    };
    const side = (route) => waitFor(() => app.evaluate(`(() => { const b = document.querySelector('[data-side-row="${route}"]'); if (!b) return false; b.click(); return true; })()`), `sidebar ${route}`);
    const checkDialog = async (at, name) => {
      let m = await waitFor(() => app.evaluate(MEASURE), `${at} ${name}: the dialog`);
      // Debt details load after the dialog opens: poll up to 10 seconds, then measure again.
      for (const start = Date.now(); /Loading debt details/.test(m.text) && Date.now() - start < 10_000;) {
        await sleep(100);
        m = (await app.evaluate(MEASURE)) || m;
      }
      assert.doesNotMatch(m.text, /Loading debt details/, `${at} ${name}: debt details loaded`);
      assert.equal(m.width, 520, `${at} ${name}: 520px wide`);
      assert.ok(m.centre < 2 && m.middle < 2, `${at} ${name}: centred (${m.centre}, ${m.middle})`);
      assert.ok(m.scrimCovers, `${at} ${name}: the scrim covers the window`);
      // slate-950 at 60% (Tailwind 4 gives it in oklab).
      assert.match(m.scrimColour, /^oklab\(0\.1\d* .*\/ 0\.6\)$/, `${at} ${name}: dark scrim`);
      assert.ok(m.scroll, `${at} ${name}: no sideways scroll`);
      assert.deepEqual(m.bad, [], `${at} ${name}: text 15px or more, never 16px`);
      assert.deepEqual(m.small, [], `${at} ${name}: targets 48px or more`);
      assert.match(m.text, /GH₵12,345\.00/, `${at} ${name}: the amount`);
      // Tab and Shift+Tab stay inside.
      for (let i = 0; i < 9; i += 1) {
        await key("Tab");
        assert.ok((await app.evaluate(FOCUS)).inside, `${at} ${name}: Tab ${i + 1} stays inside`);
      }
      for (let i = 0; i < 4; i += 1) {
        await key("Tab", true);
        assert.ok((await app.evaluate(FOCUS)).inside, `${at} ${name}: Shift+Tab ${i + 1} stays inside`);
      }
    };

    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      const at = `${width}`;
      await app.open("base", width, height);

      // 46 Pay sheet over My money > You owe suppliers: Escape is Cancel, focus back on Pay Kofi.
      await side("MyMoney");
      await waitFor(() => app.evaluate(`(() => { const card = [...document.querySelectorAll("main button")].find((b) => /You owe suppliers/.test(b.textContent + " " + (b.getAttribute("aria-label") || ""))); if (!card) return false; card.click(); return true; })()`), "You owe suppliers");
      await app.click("^Pay Kofi$");
      await checkDialog(at, "46");
      await key("Escape");
      await waitFor(() => app.evaluate(`!document.querySelector("[data-wide-dialog]")`), `${at} 46 closes on Escape`);
      await sleep(100);
      assert.deepEqual(await app.evaluate(FOCUS), { inside: false, tag: "BUTTON", name: "Pay Kofi" }, `${at} 46: focus back on Pay Kofi`);

      // 25 Collect from Owed: Home is behind it, so the opener is gone; the scrim is Close and focus
      // goes to Home's main heading.
      await side("PeopleWhoOweYou");
      await app.click("^Collect");
      await checkDialog(at, "25");
      const point = await app.evaluate(`(() => { const r = document.querySelector("[data-wide-dialog]").getBoundingClientRect(); return { x: Math.round(r.left / 2), y: Math.round(innerHeight - 8) }; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
      await waitFor(() => app.evaluate(`!document.querySelector("[data-wide-dialog]")`), `${at} 25 closes on a scrim click`);
      await sleep(100);
      const focus = await app.evaluate(`(() => { const a = document.activeElement; return { tag: a?.tagName, home: a?.closest("main") !== null, text: a?.textContent.trim() }; })()`);
      assert.equal(focus.tag, "H1", `${at} 25: focus on the main heading`);
      assert.ok(focus.home, `${at} 25: the heading of Home behind`);
    }
  });
});
