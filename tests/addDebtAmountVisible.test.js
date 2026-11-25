import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Phone review item 5 (25 Nov 2026), Add debt (53): with "What for?" focused the phone keyboard opens
// and the on-screen keypad pushed the amount out of view. While the note has focus the keypad hides, so
// the amount stays on screen. Real Edge at 340x640; the keyboard is emulated by shrinking the viewport
// to 340px high and scrolling the focused field into view, as the phone does.
const STATE = `(() => {
  const amount = document.querySelector("[data-debt-amount]").getBoundingClientRect();
  const note = [...document.querySelectorAll("main input")].find((i) => /What for/.test(i.placeholder)).getBoundingClientRect();
  const header = document.querySelector("header")?.getBoundingClientRect();
  return { amountTop: amount.top, amountBottom: amount.bottom, noteTop: note.top, noteBottom: note.bottom, headerBottom: header ? Math.max(0, header.bottom) : 0, height: innerHeight, keypad: !!document.querySelector("[aria-label='Amount keypad']"), focused: document.activeElement?.placeholder || "" };
})()`;

test("Add debt 340x640: with the note focused and the keyboard open, the amount stays in view; the keypad is back after", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    await app.open("base", 340, 640);
    await app.steps(["^Owed$", "Add debt$", "^[AK]?Amoto", "^Next", "^1$", "^5$"]);
    await waitFor(() => app.evaluate(`!!document.querySelector("[data-debt-amount]")`), "53 Add debt amount");
    assert.equal((await app.evaluate(STATE)).keypad, true, "the keypad shows before typing a note");
    await app.evaluate(`[...document.querySelectorAll("main input")].find((i) => /What for/.test(i.placeholder)).focus()`);
    await app.type("Rice");
    await app.send("Emulation.setDeviceMetricsOverride", { width: 340, height: 340, deviceScaleFactor: 2, mobile: true });
    await sleep(200);
    await app.evaluate(`document.activeElement.scrollIntoView({ block: "nearest" })`);
    await sleep(200);
    const open = await app.evaluate(STATE);
    assert.equal(open.focused, "What for? (optional)");
    assert.equal(open.keypad, false, "the keypad hides while the note has focus");
    assert.ok(open.amountTop >= open.headerBottom - 0.5, `the amount is below the header (${open.amountTop} vs ${open.headerBottom})`);
    assert.ok(open.amountBottom <= open.height, `the amount is inside the viewport (${open.amountBottom} > ${open.height})`);
    assert.ok(open.noteBottom <= open.height && open.noteTop >= open.headerBottom - 0.5, "the note is in view too");
    assert.match(await app.evaluate(`document.querySelector("[data-debt-amount]").textContent`), /GH₵15\.00/);
    await app.send("Emulation.setDeviceMetricsOverride", { width: 340, height: 640, deviceScaleFactor: 2, mobile: true });
    await app.evaluate("document.activeElement.blur()");
    await waitFor(() => app.evaluate(`!!document.querySelector("[aria-label='Amount keypad']")`), "the keypad back after the note loses focus");
  });
});
