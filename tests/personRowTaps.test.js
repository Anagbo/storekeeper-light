import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// rules_global.person_row (chunk C, item 1f, 21 Nov 2026), real Edge at 340, 360 and 393px with real mouse
// taps. Home 22 "Collect first" and the Owed list 32 draw the same row. Every area that opened the detail
// on Home before chunk C opens it on both screens: the name, the due tag, the amount, the space between
// the name and the amount, and the empty space under the amount. 43 opens when the debt is late, 29
// otherwise; Back returns to the screen the tap came from. The "Collect first" heading, the gap above the
// buttons, Collect, WhatsApp, Call and "+ Add contact" never open the detail. The top row has a visible
// pressed state. Layout with 1 and 5 people, a long name and a large amount: no sideways scroll, the
// amount stays whole on the name's line, 32 scrolls. The font is the machine's (Segoe UI), not a phone font.

const due = (days) => `new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10)`;
const sale = (name, amount, days, phone = "") => `await recordCreditSale({ name: ${JSON.stringify(name)}, phone: ${JSON.stringify(phone)}, amountPesewas: ${amount}, dueDate: ${due(days)}, now: Date.now() - 86400000 * 40 });`;
const head = `await setPreference("posSetupCompleted", true);`;
const LONG = "Nana Akosua Frimpomaa Asamoah-Boateng";
const SEEDS = {
  late: `${head} ${sale("Ama", 2000, -3, "0244123456")}`,
  notLate: `${head} ${sale("Amoto", 2700, 6)}`,
  invalid: `${head} ${sale("Kofi", 2500, -1, "12345")}`,
  five: `${head} ${sale(LONG, 1234567, -9, "0244123456")} ${sale("Kofi", 2500, 0, "12345")} ${sale("Akosua", 1800, 5)} ${sale("Yaw", 1200, 12, "+233241234567")} ${sale("Efua", 800, 14, "0201112222")}`
};
const WIDTHS = [340, 360, 393];

// The open button and its parts, scrolled into view, as viewport points (for one person by name).
const POINTS = (name) => `(() => {
  const open = [...document.querySelectorAll("[data-person-open]")].find((b) => b.getAttribute("aria-label") === "Open " + ${JSON.stringify(name)} + "’s details");
  if (!open) return null;
  open.scrollIntoView({ block: "center" });
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };
  const nameEl = open.querySelector("[data-party-name]");
  const amount = box(open.querySelector("[data-party-amount]"));
  const tagEl = open.querySelector("[data-party-tag] > *");
  const nameLines = [...nameEl.getClientRects()];
  const nameRight = Math.max(...nameLines.map((r) => r.right));
  const first = nameLines[0];
  const card = open.parentElement;
  const buttons = [...card.querySelectorAll("button, a[href]")].filter((b) => b !== open).map((b) => ({ label: b.getAttribute("aria-label"), ...box(b) }));
  const button = box(open);
  return {
    button,
    name: { x: (first.left + first.right) / 2, y: (first.top + first.bottom) / 2 },
    tag: tagEl ? box(tagEl) : null,
    amount,
    between: { x: (nameRight + amount.left) / 2, y: amount.y },
    underAmount: { x: amount.x, y: Math.min(button.bottom - 3, amount.bottom + (button.bottom - amount.bottom) / 2) },
    gap: { x: button.x, y: button.bottom + 5 },
    buttons
  };
})()`;
// What sits under a point: inside the open button, or the label of the control there.
const HIT = (x, y) => `(() => { const el = document.elementFromPoint(${x}, ${y}); return { open: !!el?.closest("[data-person-open]"), control: el?.closest("button, a[href]")?.getAttribute("aria-label") ?? null, tag: el?.tagName ?? null }; })()`;

const SCREEN = `(() => {
  const actions = document.querySelector("[data-row=debtor-actions]");
  if (actions) return actions.className.includes("grid-cols-2") ? "43" : "29";
  if (document.querySelector("[data-owed-card]")) return "22";
  if (document.querySelector("[aria-label='Total owed to you'][role=list], section[aria-label='Total owed to you']")) return "32";
  return "other";
})()`;

async function tap(app, { x, y }) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await app.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  }
}
const screen = (app) => app.evaluate(SCREEN);

async function openScreen(app, seed, width, which) {
  await app.open(seed, width, 740);
  await app.shows("^Collect");
  if (which === "32") {
    await app.steps(["^Owed$"]);
    await waitFor(async () => (await screen(app)) === "32" && app.evaluate("!!document.querySelector('[data-person-open]')"), "32 with its rows");
  }
  await app.evaluate("document.getAnimations().forEach((a) => a.finish()); true");
  await sleep(200);
}

test("22 and 32: every area that opened the detail still opens it; buttons, heading and gap never do; Back returns", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      for (const which of ["22", "32"]) {
        for (const [seed, name, expected] of [["late", "Ama", "43"], ["notLate", "Amoto", "29"]]) {
          const label = `${which} ${seed} ${width}px`;
          await openScreen(app, seed, width, which);
          for (const area of ["name", "tag", "amount", "between", "underAmount"]) {
            await openScreen(app, seed, width, which);
            const p = await app.evaluate(POINTS(name));
            assert.ok(p, `${label}: the row for ${name}`);
            assert.ok(p[area], `${label}: ${area} is shown`);
            const hit = await app.evaluate(HIT(p[area].x, p[area].y));
            assert.ok(hit.open, `${label}: ${area} is inside the open button (${JSON.stringify(hit)})`);
            await tap(app, p[area]);
            await waitFor(async () => (await screen(app)) === expected, `${label}: tapping the ${area} opens ${expected}`, 8000);
            await app.click("^Back$");
            await waitFor(async () => (await screen(app)) === which, `${label}: Back from ${expected} returns to ${which}`, 8000);
          }
          // The buttons row: never inside the open button.
          const p = await app.evaluate(POINTS(name));
          for (const control of p.buttons) {
            const hit = await app.evaluate(HIT(control.x, control.y));
            assert.ok(!hit.open, `${label}: ${control.label} is not part of the open button`);
            assert.equal(hit.control, control.label, `${label}: ${control.label} gets its own tap`);
          }
          // The gap above the buttons does nothing.
          await tap(app, p.gap);
          await sleep(400);
          assert.equal(await screen(app), which, `${label}: the gap above the buttons does not open the detail`);
          // Collect opens 25, not the detail.
          await app.click(which === "22" ? `^Collect payment from ${name}$` : `^Collect from ${name}$`);
          await sleep(500);
          assert.ok(!["43", "29"].includes(await screen(app)), `${label}: Collect does not open the detail`);
        }
      }
      // 22: the "Collect first" heading does nothing.
      await openScreen(app, "late", width, "22");
      const heading = await app.evaluate(`(() => { const el = [...document.querySelectorAll("[data-owed-card] p")].find((p) => /collect first/i.test(p.textContent)); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + 10, y: (r.top + r.bottom) / 2 }; })()`);
      await tap(app, heading);
      await sleep(400);
      assert.equal(await screen(app), "22", `22 ${width}px: the Collect first heading does not open the detail`);
    }
  });
});

test("22 and 32: pressed state, any saved number shows WhatsApp and Call, layout with 1 and 5 people", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  const notes = [];
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      for (const which of ["22", "32"]) {
        const label = `${which} ${width}px`;
        // Pressed: a light grey tint while :active, nothing at rest.
        await openScreen(app, "late", width, which);
        const { root } = await app.send("DOM.getDocument", { depth: 0 });
        const { nodeId } = await app.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-person-open]" });
        await app.send("CSS.enable");
        const bg = () => app.evaluate(`getComputedStyle(document.querySelector("[data-person-open]")).backgroundColor`);
        assert.equal(await bg(), "rgba(0, 0, 0, 0)", `${label}: no fill at rest`);
        await app.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["active"] });
        assert.notEqual(await bg(), "rgba(0, 0, 0, 0)", `${label}: a tint while pressed`);
        await app.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
        await app.send("CSS.disable");

        // A saved number that fails the WhatsApp check still shows WhatsApp and Call.
        await openScreen(app, "invalid", width, which);
        const invalid = await app.evaluate(POINTS("Kofi"));
        assert.deepEqual(invalid.buttons.map((b) => b.label), [which === "22" ? "Collect payment from Kofi" : "Collect from Kofi", "WhatsApp Kofi", "Call Kofi"], label);
        await openScreen(app, "notLate", width, which);
        const none = await app.evaluate(POINTS("Amoto"));
        assert.deepEqual(none.buttons.map((b) => b.label), [which === "22" ? "Collect payment from Amoto" : "Collect from Amoto", "Add phone or WhatsApp contact for Amoto"], label);

        // Layout with 1 and 5 people.
        for (const seed of ["late", "five"]) {
          await openScreen(app, seed, width, which);
          const m = await app.evaluate(`(() => {
            const rows = [...document.querySelectorAll("[data-person-open]")].map((open) => {
              const card = open.closest("article") ?? open.closest("[data-owed-card]");
              const amount = open.querySelector("[data-party-amount]");
              const name = open.querySelector("[data-party-name]");
              const a = amount.getBoundingClientRect();
              const c = card.getBoundingClientRect();
              const n = name.getBoundingClientRect();
              const style = getComputedStyle(name);
              const lineHeight = parseFloat(style.lineHeight);
              // Words that fit on a line of the name column must not be split across two lines (only the
              // visible part counts; words after the cut are hidden).
              const text = name.firstChild;
              const probe = document.createElement("span");
              probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:" + style.font;
              document.body.append(probe);
              const split = [];
              for (const match of text.textContent.matchAll(/\\S+/g)) {
                probe.textContent = match[0];
                if (probe.getBoundingClientRect().width > name.clientWidth) continue;
                const range = document.createRange();
                range.setStart(text, match.index);
                range.setEnd(text, match.index + match[0].length);
                const visible = [...range.getClientRects()].filter((r) => r.width > 0 && r.top < n.bottom - 1);
                if (new Set(visible.map((r) => Math.round(r.top))).size > 1) split.push(match[0]);
              }
              probe.remove();
              const nameRight = Math.max(...[...name.getClientRects()].map((r) => r.right));
              return {
                name: name.textContent, amountLines: amount.getClientRects().length, amountWhole: amount.scrollWidth <= amount.clientWidth + 0.5,
                amountInside: a.right <= c.right + 0.5 && a.left >= c.left - 0.5, nameBeforeAmount: nameRight <= a.left + 0.5,
                amountOnFirstLine: Math.abs(a.top - n.top) < lineHeight / 2, amountAtRight: Math.abs(a.right - open.getBoundingClientRect().right) < 1,
                nameLines: Math.round(n.height / lineHeight), cut: name.scrollHeight > name.clientHeight + 1,
                clamp: style.webkitLineClamp, overflow: style.overflow, textOverflow: style.textOverflow, split
              };
            });
            const area = document.querySelector("[data-page-area]");
            const before = area.scrollTop;
            area.scrollTop = area.scrollHeight;
            const scrolled = area.scrollTop > before;
            area.scrollTop = before;
            return { rows, scrollWidth: document.documentElement.scrollWidth, innerWidth, areaOverflowX: area.scrollWidth > area.clientWidth, scrolls: area.scrollHeight > area.clientHeight, scrolled };
          })()`);
          const what = `${label} ${seed}`;
          assert.ok(m.scrollWidth <= m.innerWidth, `${what}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
          assert.ok(!m.areaOverflowX, `${what}: the page area does not scroll sideways`);
          for (const row of m.rows) {
            assert.equal(row.amountLines, 1, `${what} ${row.name}: the amount on one line`);
            assert.ok(row.amountWhole && row.amountInside, `${what} ${row.name}: the amount is whole and inside the card`);
            assert.ok(row.nameBeforeAmount, `${what} ${row.name}: the name never runs under the amount`);
            // Long names (decided 21 Nov 2026): two lines at most, cut with an ellipsis, the amount whole on
            // the first line at the right, no word split that fits on a line.
            assert.ok(row.nameLines <= 2, `${what} ${row.name}: at most two lines (${row.nameLines})`);
            assert.equal(row.clamp, "2", `${what} ${row.name}: the two-line clamp applies`);
            assert.ok(row.amountOnFirstLine && row.amountAtRight, `${what} ${row.name}: the amount on the first line at the right`);
            assert.deepEqual(row.split, [], `${what} ${row.name}: no word that fits is broken`);
            if (row.cut) notes.push(`${what}: "${row.name}" cut at ${row.nameLines} lines with an ellipsis`);
          }
          if (seed === "five") assert.ok(m.rows.some((row) => row.name === LONG && row.cut), `${what}: the long name is cut`);
          if (which === "32" && seed === "five") {
            assert.equal(m.rows.length, 5, `${what}: five rows`);
            assert.ok(m.scrolls && m.scrolled, `${what}: the list scrolls`);
          }
        }
      }
    }
  });
  if (notes.length) console.log(`person row notes:\n  ${notes.join("\n  ")}`);
});
