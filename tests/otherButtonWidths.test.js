import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS, checkControls } from "./helpers/lookChecks.js";

// rules_global.button_system.secondary_component (17 Nov 2026): the shared outlined button
// (PosSecondaryButton) is the exact "other" look: 2px #0F172A border, 52px or taller, 18px bold. Real
// Edge at 340, 360 and 393px on every screen that uses it and can be reached with seeded data: each
// "other" button sits inside the screen, its content never overflows, its label takes at most two lines
// (a third line is fixed with padding, never a shorter label), and the page never scrolls sideways.
// Not reached here: 59 (needs a failed phone request), 60 Change (needs the MoMo setup confirm), 71
// restore confirm (needs a backup file) and 32 Retry / Show more (an error or 25+ people); their labels
// (Pay another way, Cancel sale, Change, Restore, Cancel, Retry, Show more) are shorter than the ones
// checked here in the same or a wider column.
// The font is the machine's (Segoe UI on Windows), not a phone font.

// Each visit: the seed, the taps that reach the screen (regex sources), and the "other" labels it must show.
const VISITS = [
  { name: "31 Saved as credit", seed: "base", steps: ["^Sell$", "^5$", "^Owe$", "^[AK]?Amoto", "^Next", "^Save · "], expect: ["See Amoto’s details"] },
  { name: "31 Saved as credit, long name", seed: "longName", steps: ["^Sell$", "^5$", "^Owe$", "Nana Akosua", "^Next", "^Save · "], expect: ["See Nana Akosua Frimpomaa Asamoah-Boateng’s details"] },
  { name: "29 Edit contact", seed: "base", steps: ["^Owed$", "^Amoto", "^Edit contact"], expect: ["Cancel"] },
  { name: "54 Correct balance", seed: "base", steps: ["^Owed$", "^Amoto", "^Correct balance"], expect: ["Cancel"] },
  { name: "25 Collect", seed: "base", steps: ["^Owed$", "^Collect from Amoto"], expect: [] },
  { name: "28 Payment received", seed: "base", steps: ["^Owed$", "^Collect from Amoto", "^Received$"], expect: ["Undo"] },
  { name: "28 Payment received, long name", seed: "longName", steps: ["^Owed$", "^Collect from Nana", "^Received$"], expect: ["Undo"] },
  { name: "39 My items", seed: "base", steps: ["^Menu", "^Items"], expect: [] },
  { name: "40 Edit item", seed: "base", steps: ["^Menu", "^Items", "^Rice"], expect: ["Delete"] },
  { name: "36 Your starter list from 39", seed: "base", steps: ["^Menu", "^Items", "Add from starter list"], expect: [] },
  { name: "35 What do you sell?", seed: "fresh", steps: ["^With items", "^Continue"], expect: ["More categories", "Skip for now"] },
  { name: "36 Your starter list (setup)", seed: "fresh", steps: ["^With items", "^Continue", "^Provisions shop", "^Continue"], expect: [] },
  { name: "Debt saved", seed: "base", steps: ["^Owed$", "Add debt$", "^[AK]?Amoto", "^Next", "^1$", "^0$", "^Next", "^Save"], expect: [] },
  { name: "30 Sale recorded", seed: "base", steps: ["^Sell$", "^5$", "^Done"], expect: [] },
  { name: "16 Split, editing a part", seed: "base", steps: ["^Sell$", "^5$", "^Split", "^Cash$", "^Edit Cash amount"], expect: ["Cancel"] }
];

const WIDTHS = [340, 360, 393];

test("the other look (PosSecondaryButton) fits at 340, 360 and 393px on every screen that uses it", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  const notes = [];
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const visit of VISITS) {
      for (const width of WIDTHS) {
        try {
          await app.open(visit.seed, width, 800);
          for (const step of visit.steps) {
            await app.click(step);
            await sleep(150);
          }
          for (const expected of visit.expect) await app.shows(expected);
        } catch (error) {
          throw new Error(`${visit.name} ${width}px: ${error.message}`);
        }
        await sleep(300);
        const m = await app.measure();
        const label = `${visit.name} ${width}px`;
        for (const expected of visit.expect) {
          assert.ok(m.controls.some((c) => c.look === "other" && c.text.includes(expected)), `${label}: "${expected}" is an other button`);
        }
        notes.push(...checkControls(m, label));
      }
    }
  });
  if (notes.length) console.log(notes.join("\n"));
});
