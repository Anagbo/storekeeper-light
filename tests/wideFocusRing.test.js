import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// One focus ring on the wide layout: a button (Add debt) and the search field, focused by keyboard,
// show the same ring width and colour (3px #0F172A). The field has no offset (ring on its border).
const SEEDS = { owed: `await setPreference("posSetupCompleted", true); await recordCreditSale({ name: "Yaw", phone: "0244123456", amountPesewas: 1200, dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 });` };
const RING = `(() => {
  const read = (el) => { el.focus(); const cs = getComputedStyle(el); return { visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset }; };
  const button = [...document.querySelectorAll("main button")].find((el) => /Add debt/.test(el.textContent));
  const field = document.querySelector('main input[aria-label="Search by name or phone"]');
  return { button: read(button), field: read(field.closest("label")), fieldFocus: document.activeElement === field };
})()`;

test("wide layout: a button and the search field show the same keyboard focus ring", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    await app.open("owed", 1280, 800);
    await app.steps(["^Owed$"]);
    await waitFor(() => app.evaluate(`!!document.querySelector("[data-owed-detail]")`), "the wide page");
    await sleep(300);
    await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const r = await app.evaluate(RING);
    assert.equal(r.button.width, "3px");
    assert.equal(r.button.color, "rgb(15, 23, 42)");
    assert.equal(r.button.style, "solid");
    assert.equal(r.button.offset, "2px");
    assert.equal(r.field.width, r.button.width, "same width");
    assert.equal(r.field.color, r.button.color, "same colour");
    assert.equal(r.field.offset, "0px", "no offset on the field");
  });
});
