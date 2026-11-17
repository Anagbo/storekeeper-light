import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS, checkControls } from "./helpers/lookChecks.js";

// rules_global.button_system.add (17 Nov 2026), real Edge at 340, 360 and 393px: every action that adds
// something is the shared AddButton: dashed 2px dark-green border, 14px corners, bold dark-green text,
// no fill, the "+" and the word on one line, inside the screen, no overflow. Standard size is full width
// and 52px; the 20 tile keeps 72px in the grid (taller only when the item tile beside it is). Every other control with a look on the same screen
// (main, other, leave) also fits: inside the screen, no overflow, at most two lines.
// The font is the machine's (Segoe UI on Windows), not a phone font.

// Tailwind 4 gives emerald-900 (the app's dark green) as oklch.
const GREEN = /^(oklch\(0\.378 0\.077 168\.94\)|rgb\(6, 78, 59\))$/;

// Each visit: the seed, the taps that reach the screen, and the add buttons it must show
// (text as shown, height, and whether it spans the screen's content width).
const VISITS = [
  { name: "20 Sell with items", seed: "base", steps: ["^Sell$", "Add items"], add: [{ text: "+ New item", height: 72, atLeast: true }] },
  { name: "32 People who owe you", seed: "base", steps: ["^Owed$"], add: [{ text: "+ Add debt", height: 52, full: true }] },
  { name: "17 Who owes you", seed: "base", steps: ["^Sell$", "^5$", "^Owe$"], add: [{ text: "+ New person", height: 52, full: true }] },
  { name: "17 Who owes you (Add debt)", seed: "base", steps: ["^Owed$", "Add debt$"], add: [{ text: "+ New person", height: 52, full: true }] },
  // 45: "+ New supplier" is the add radio variant (60px like the rows), "Show all 5 suppliers" is other.
  { name: "45 Stock on credit", seed: "suppliers", steps: ["^Spent money", "type:10", "^Stock$", "^No$"], add: [{ text: "+ New supplier", height: 60, sameWidthAs: "Kofi Wholesale" }], other: ["Show all 5 suppliers"] },
  // 39: both actions add (no solid green button on 39, accepted 17 Nov 2026).
  { name: "39 My items", seed: "base", steps: ["^Menu", "^Items"], add: [{ text: "+ New item", height: 52, full: true }, { text: "+ Add from starter list", height: 52, full: true }] },
  // 28 (receipts on, no phone saved): "+ Add phone".
  { name: "28 Payment received", seed: "base", steps: ["^Owed$", "^Collect from Amoto", "^Received$"], add: [{ text: "+ Add phone", height: 52, full: true }] },
  // 29: "+ Add to debt" on its own line under What happened; GH₵27 is under the signature threshold.
  { name: "29 Debtor detail", seed: "base", steps: ["^Owed$", "^Amoto"], add: [{ text: "+ Add to debt", height: 52, full: true }], other: ["Correct balance", "Show Amoto the record"] },
  // 43 (late): GH₵90 unsigned is at or above the threshold, so its card offers Get signature (no "+").
  { name: "43 Debtor detail (late)", seed: "base", steps: ["^Owed$", "^Kwabena"], add: [{ text: "+ Add to debt", height: 52, full: true }, { text: "Get signature", height: 52 }], other: ["Correct balance", "Show Kwabena Asamoah-Boateng the record"] },
  // 22 Home: "+ Add contact" beside Collect (the late person has no phone); Collect still fits on one line.
  { name: "22 Home", seed: "base", steps: [], add: [{ text: "+ Add contact", height: 52 }], fit: ["Collect"] },
  // 25: "+ Split payment" is a tile in the row of payment tiles: the "+" above the words, like the icons beside it.
  { name: "25 Collect", seed: "base", steps: ["^Owed$", "^Collect from Amoto"], add: [{ text: "+ Split payment", height: 56, atLeast: true, lines: 2 }] }
];

const WIDTHS = [340, 360, 393];

test("the add look fits at 340, 360 and 393px: dashed 2px green, 14px corners, no fill, one line", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  const notes = [];
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const visit of VISITS) {
      for (const width of WIDTHS) {
        const label = `${visit.name} ${width}px`;
        try {
          await app.open(visit.seed, width, 800);
          await app.steps(visit.steps);
          for (const { text } of visit.add) await app.shows(text.replace(/[+]/g, "\\+"));
        } catch (error) {
          throw new Error(`${label}: ${error.message}`);
        }
        await sleep(300);
        const m = await app.measure();
        const content = m.innerWidth - 32;
        for (const expected of visit.add) {
          const c = m.controls.find((control) => control.look === "add" && control.text === expected.text);
          assert.ok(c, `${label}: "${expected.text}" is an add button (${m.controls.filter((x) => x.look === "add").map((x) => x.text).join(", ")})`);
          const what = `${label}: "${expected.text}"`;
          assert.match(c.border, /^dashed 2px /, `${what}: dashed 2px border`);
          assert.match(c.border.replace(/^dashed 2px /, ""), GREEN, `${what}: dark-green border`);
          assert.equal(c.radius, "14px", `${what}: 14px corners`);
          assert.match(c.color, GREEN, `${what}: dark-green text`);
          assert.ok(Number(c.fontWeight) >= 700, `${what}: bold`);
          assert.equal(c.background, "rgba(0, 0, 0, 0)", `${what}: no fill`);
          assert.ok(!c.underline, `${what}: not underlined`);
          assert.equal(c.lines, expected.lines ?? 1, `${what}: ${expected.lines ?? 1} line(s): the words on one line`);
          assert.ok(!c.overflow, `${what}: no overflow`);
          assert.ok(c.left >= -0.5 && c.right <= m.innerWidth + 0.5, `${what}: inside the screen`);
          assert.ok(Math.abs(c.height - expected.height) < 0.5 || ((expected.atLeast || expected.height === 52) && c.height >= expected.height), `${what}: ${expected.height}px (${c.height})`);
          if (expected.sameWidthAs) {
            const row = m.controls.find((control) => control.text === expected.sameWidthAs);
            assert.ok(row && Math.abs(row.width - c.width) < 0.5 && Math.abs(row.left - c.left) < 0.5, `${what}: as wide as the "${expected.sameWidthAs}" row`);
          }
          if (expected.full) assert.ok(c.width >= content - 16.5, `${what}: full width (${c.width} of about ${content})`);
        }
        for (const text of visit.fit ?? []) {
          const c = m.controls.find((control) => control.text === text);
          assert.ok(c && !c.overflow && c.lines === 1 && c.right <= m.innerWidth + 0.5, `${label}: "${text}" still fits on one line (${c?.width}px)`);
        }
        for (const text of visit.other ?? []) assert.ok(m.controls.some((c) => c.look === "other" && c.text === text), `${label}: "${text}" is an other button`);
        notes.push(...checkControls(m, label, { looks: ["main", "other", "leave"] }));
        const adds = m.controls.filter((control) => control.look === "add");
        for (const c of adds) assert.ok(!c.overflow && c.lines <= (visit.add.find((a) => a.text === c.text)?.lines ?? 1), `${label}: add "${c.text}" on one line without overflow`);
      }
    }
  });
  if (notes.length) console.log(notes.join("\n"));
});
