import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS, checkControls } from "./helpers/lookChecks.js";

// Wiring ManualDebtSaved rules (17 Nov 2026), real Edge at 340, 360 and 393px. The card under the
// headline is only label-value rows in the What happened row style: "Before", "Added to debt", and "For"
// only when a reason was written (never a bold "What for: ..." line); grey label left on one line, bold
// value right, a long reason wraps inside the right column. "WhatsApp {Name}" and "See {Name}’s details"
// are other buttons, full width, 52px or taller, stacked one above the other; Done is the main button.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const LONG_REASON = "Rice, palm oil, sugar and two tins of milk for the week";

const MEASURE = `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const card = document.querySelector("[data-debt-saved-rows]");
  const rows = [...card.querySelectorAll("[data-event-detail]")].map((row) => {
    const dt = row.querySelector("dt"); const dd = row.querySelector("dd");
    return { label: dt.textContent, value: dd.textContent, labelLines: lines(dt), labelBox: box(dt), valueBox: box(dd), valueWeight: getComputedStyle(dd).fontWeight, labelColor: getComputedStyle(dt).color, valueColor: getComputedStyle(dd).color, align: getComputedStyle(dd).textAlign };
  });
  const actions = [...document.querySelectorAll("[data-debt-saved-actions] > *")].map((el) => ({ text: el.textContent.trim(), look: el.getAttribute("data-look"), lines: lines(el), ...box(el) }));
  return { text: document.querySelector("main").textContent, card: box(card), rows, actions };
})()`;

test("debt saved: Before, Added to debt, For rows; WhatsApp and See details stacked, full width, 52px (340/360/393px)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      for (const reason of [LONG_REASON, ""]) {
        const label = `${width}px ${reason ? "with a reason" : "no reason"}`;
        await app.open("base", width, 800);
        await app.steps(["^Owed$", "Add debt$", "^[AK]?Amoto", "^Next", "^1$", "^0$", ...(reason ? [`type:${reason}`] : []), "^Next", "^Save · "]);
        await app.shows("See Amoto’s details");
        await sleep(300);
        const m = await app.evaluate(MEASURE);
        assert.doesNotMatch(m.text, /What for:/, `${label}: no "What for:" line`);
        assert.deepEqual(m.rows.map((row) => row.label), ["Before", "Added to debt", "Now owes"], `${label}: the rows`);
        assert.equal(m.rows[0].value, "GH₵27.00", `${label}: Before`);
        assert.equal(m.rows[1].value, "GH₵10.00", `${label}: Added to debt`);
        assert.equal(m.rows[2].value, "GH₵37.00", `${label}: Now owes`);
        if (reason) assert.match(m.text, new RegExp(`For: ${reason}`), `${label}: the reason is the line under the headline`);
        assert.equal((m.text.match(/Amoto owes/g) ?? []).length, 1, `${label}: the name appears once`);
        for (const row of m.rows) {
          assert.equal(row.labelLines, 1, `${label} ${row.label}: the label never wraps`);
          assert.equal(row.valueWeight, "700", `${label} ${row.label}: the value is bold`);
          assert.notEqual(row.labelColor, row.valueColor, `${label} ${row.label}: the label is grey`);
          assert.equal(row.align, "right", `${label} ${row.label}: the value is right-aligned`);
          assert.ok(row.valueBox.left >= row.labelBox.right - 0.5, `${label} ${row.label}: the value stays right of the label`);
          assert.ok(row.valueBox.right <= m.card.right, `${label} ${row.label}: inside the card`);
        }
        // saved_credit_layout (25 Nov 2026): Send receipt is always there; Amoto has no phone, so the dashed add-phone button sits under it.
        assert.deepEqual(m.actions.map((a) => a.text), ["Send receipt", "+ Add phone number", "See Amoto’s details"], `${label}: the three buttons, Send receipt first`);
        const [, whatsapp, details] = m.actions;
        for (const action of m.actions) {
          if (action.text !== "Send receipt") assert.equal(action.look, action === whatsapp ? "add" : "other", `${label} "${action.text}": look`);
          assert.ok(action.height >= 51.5, `${label} "${action.text}": 52px or taller (${action.height})`);
          assert.equal(action.lines, 1, `${label} "${action.text}": one line`);
          assert.ok(Math.abs(action.width - (width - 32)) < 1, `${label} "${action.text}": full width (${action.width})`);
        }
        assert.ok(details.top >= whatsapp.bottom - 0.5, `${label}: stacked, See details under WhatsApp`);
        checkControls(await app.measure(), label, { looks: ["main", "other"] });
      }
    }
  });
});
