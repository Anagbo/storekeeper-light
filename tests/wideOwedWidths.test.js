import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Owed (32 with 29/43, D3) in real Edge: phone 340, 360, 393 (unchanged phone layout) and wide 768x1024,
// 1024x768, 1280x800, 1440x900 (list with detail). A 40-character late name with GH₵12,345.00 and a
// valid number, plus two short names. No sideways scroll, no clipped or wrapped amount, no wrapped
// button label, focus rings visible, wide targets 48px or taller.
const LONG = "Abena Konadu Asantewaa Mensah-Bonsu Ofor";
const sale = (name, amount, days, phone = "0244123456") => `await recordCreditSale({ name: ${JSON.stringify(name)}, ${phone ? `phone: ${JSON.stringify(phone)}, ` : ""}amountPesewas: ${amount}, dueDate: new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 * 40 });`;
const SEEDS = { owed: `await setPreference("posSetupCompleted", true); ${sale(LONG, 1234500, -9)} ${sale("Yaw", 1200, 5)} ${sale("Kofi", 900, 12, "")}` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const amounts = [...document.querySelectorAll("main [data-party-amount], main [data-owed-total], main .amount-fit")].filter((el) => el.getClientRects().length).map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, ...box(el) }));
  const area = document.querySelector("[data-owed-columns]");
  const controls = [...document.querySelectorAll("main button, main a[href]")].filter((el) => el.getClientRects().length && !el.closest("[data-owed-row]") && !el.hasAttribute("data-owed-row") && !el.hasAttribute("data-person-open") && !el.hasAttribute("data-show-record"))
    .map((el) => ({ label: el.getAttribute("aria-label") || el.textContent.replace(/\\s+/g, " ").trim(), lines: lines(el), overflow: el.scrollWidth > el.clientWidth + 0.5, ...box(el) }));
  const rows = [...document.querySelectorAll("main [data-owed-row]")].map((el) => ({ ...box(el), current: el.getAttribute("aria-current") }));
  return { innerWidth, scrollWidth: document.documentElement.scrollWidth, wide: !!area, list: area && box(document.querySelector("[data-owed-list]")), detail: area && box(document.querySelector("[data-owed-detail]")), amounts, controls, rows, detailText: document.querySelector("[data-owed-detail]")?.textContent ?? "" };
})()`;

// Keyboard focus: one Tab so the page is in keyboard mode, then focus each control and read its ring.
const FOCUS = `(() => {
  const picks = [...document.querySelectorAll("main [data-owed-row], main [role=tab], main [data-owed-detail] button, main [data-owed-detail] a[href]")].filter((el) => el.getClientRects().length && !el.disabled).slice(0, 12);
  return picks.map((el) => { el.focus(); const cs = getComputedStyle(el); return { label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30), visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
})()`;

const SIZES = [[340, 740], [360, 740], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1440, 900]];

test("Owed at phone and wide sizes: fits, amounts whole, labels on one line, focus rings, 48px wide targets", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("owed", width, height);
      await app.steps(["^Owed$"]);
      if (width >= 768) await waitFor(() => app.evaluate(`!!document.querySelector("[data-owed-detail] [data-row=debtor-actions]")`), `${at}: the detail pane`);
      else await waitFor(() => app.evaluate(`document.querySelectorAll("main article").length === 3`), `${at}: the phone rows`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
      assert.equal(m.wide, width >= 768, `${at}: wide layout only from 768`);
      assert.ok(m.amounts.some((a) => a.text === "GH₵12,345.00"), `${at}: the long amount is shown`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth, `${at}: amount ${a.text} whole on one line (${a.lines} lines, clipped ${a.clipped})`);
      for (const c of m.controls) {
        assert.ok(!c.overflow && c.r <= m.innerWidth + 0.5, `${at}: "${c.label}" not clipped`);
        assert.ok(c.lines <= 1, `${at}: "${c.label}" label on one line (${c.lines})`);
        assert.ok(c.h >= 48, `${at}: "${c.label}" 48px or taller (${c.h})`);
      }
      if (width < 768) continue;
      assert.ok(m.list.w <= 400.5 && m.list.w >= 250, `${at}: list column about 400px (${m.list.w})`);
      assert.ok(m.detail.l >= m.list.r, `${at}: detail on the right`);
      assert.equal(m.rows[0].current, "true", `${at}: the first person is selected`);
      for (const row of m.rows) assert.ok(row.h >= 48, `${at}: row 48px or taller`);
      assert.match(m.detailText, /Send reminder on WhatsApp/, `${at}: late state`);
      // Selecting Yaw (29, on time) changes only the right column.
      await app.click("^Open Yaw’s details$");
      await waitFor(() => app.evaluate(`/Yaw/.test(document.querySelector("[data-owed-detail]")?.textContent ?? "")`), `${at}: Yaw in the pane`);
      await sleep(200);
      const y = await app.evaluate(MEASURE);
      assert.ok(y.scrollWidth <= y.innerWidth, `${at} Yaw: no sideways scroll`);
      assert.equal(y.rows.find((row) => row.current === "true") !== undefined, true);
      for (const c of y.controls) assert.ok(c.lines <= 1 && !c.overflow && c.h >= 48, `${at} Yaw: "${c.label}" fits (${c.lines} lines, ${c.h}px)`);
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const rings = await app.evaluate(FOCUS);
      assert.ok(rings.length >= 6, `${at}: controls to focus`);
      for (const ring of rings) assert.ok(ring.visible && ring.style !== "none" && ring.width >= 2, `${at}: focus ring on "${ring.label}" (${ring.style} ${ring.width}px)`);
    }
  });
});
