import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// One focus ring on every layout, phone included: the shared rule is not limited to wide, it is only on
// :focus-visible (no always-on outline), and on a phone a tap leaves no outline while Tab shows the ring.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("the shared focus ring rule applies to every layout and only on :focus-visible", () => {
  const rule = css.match(/\.pos-app :is\(a\[href\], button[^{]*\{[^}]*\}/);
  assert.ok(rule, "the shared rule exists without a phone exclusion");
  assert.match(rule[0], /:focus-visible/);
  assert.match(rule[0], /outline:\s*3px solid #0F172A/);
  assert.doesNotMatch(css, /data-layout="phone"\]\)\s*:is\(a\[href\]/);
  const atRest = css.split("}").filter((block) => /outline:\s*3px/.test(block) && !/focus-visible/.test(block.split("{")[0]));
  assert.equal(atRest.length, 0, "no outline rule without :focus-visible");
});

const SEEDS = { home: `await setPreference("posSetupCompleted", true);` };
const OUTLINE = `(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }; })()`;

test("phone 390: a tap leaves no outline, Tab shows the 3px #0F172A ring", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    await app.open("home", 390, 800);
    await waitFor(() => app.evaluate(`!!document.querySelector("main button")`), "a Home button");
    await sleep(300);
    const point = await app.evaluate(`(() => { const b = document.querySelector("main button:not([disabled])"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    const tapped = await app.evaluate(OUTLINE);
    assert.equal(tapped.visible, false, "a tap is not keyboard focus");
    assert.ok(tapped.style === "none" || tapped.width === "0px", `no outline after a tap, got ${tapped.style} ${tapped.width}`);
    await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const tabbed = await app.evaluate(OUTLINE);
    assert.equal(tabbed.visible, true);
    assert.equal(tabbed.width, "3px");
    assert.equal(tabbed.color, "rgb(15, 23, 42)");
    assert.equal(tabbed.style, "solid");
  });
});

// rules_global.form_fields (25 Nov 2026, real Android phone): the ring is on the text field's own rounded
// border (3px #0F172A, no offset), never a square box on the label around label, field and helper.
// Chrome gives a text field :focus-visible on a tap too, so each field is tapped, as on the phone.
const FIELDS_SEEDS = { fields: `await setPreference("posSetupCompleted", true);` };
const VISIBLE_FIELDS = `[...document.querySelectorAll("main input:not([type=hidden])")].filter((i) => i.offsetParent && !i.classList.contains("outline-none"))`;
const FIELD_RING = `(() => {
  const input = document.activeElement;
  const ring = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset, radius: cs.borderTopLeftRadius }; };
  const label = input.closest("label");
  const helpers = label ? [...label.querySelectorAll("span, p")].filter((el) => !el.contains(input)) : [];
  return { name: (label?.textContent || input.placeholder || "").replace(/\\s+/g, " ").trim().slice(0, 30), visible: input.matches(":focus-visible"), input: ring(input), label: ring(label), helpers: helpers.map(ring) };
})()`;

async function tapEachField(app) {
  const count = await app.evaluate(`${VISIBLE_FIELDS}.length`);
  const rings = [];
  for (let i = 0; i < count; i += 1) {
    const p = await app.evaluate(`(() => { const f = ${VISIBLE_FIELDS}[${i}]; f.scrollIntoView({ block: "center" }); const r = f.getBoundingClientRect(); return { x: r.x + Math.min(24, r.width / 2), y: r.y + r.height / 2 }; })()`);
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(100);
    rings.push(await app.evaluate(FIELD_RING));
  }
  return rings;
}

function assertFieldRings(fields, where) {
  assert.ok(fields.length >= 2, `${where}: found ${fields.length} text fields`);
  for (const f of fields) {
    const at = `${where} "${f.name}"`;
    assert.equal(f.visible, true, `${at}: focused`);
    assert.equal(f.input.style, "solid", `${at}: ring on the input`);
    assert.equal(f.input.width, "3px", `${at}: ring width`);
    assert.equal(f.input.color, "rgb(15, 23, 42)", `${at}: ring colour`);
    assert.equal(f.input.offset, "0px", `${at}: no offset`);
    assert.notEqual(f.input.radius, "0px", `${at}: the ring follows a rounded border`);
    const off = (r) => !r || r.style === "none" || r.width === "0px";
    assert.ok(off(f.label), `${at}: the label has no outline, got ${JSON.stringify(f.label)}`);
    f.helpers.forEach((h, i) => assert.ok(off(h), `${at}: helper ${i} has no outline`));
  }
}

test("390: New person and Stock on credit ring the input only, not the label or helper", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: FIELDS_SEEDS, env: ENV }, async (app) => {
    await app.open("fields", 390, 800);
    await app.steps(["^Owed$", "Add debt$", "New person"]);
    await waitFor(() => app.evaluate(`!!document.querySelector("main input[type=tel]")`), "New person");
    assertFieldRings(await tapEachField(app), "New person");
    await app.open("fields", 390, 800);
    await app.steps(["^Spent money", "type:10", "^Stock$", "^No$"]);
    await waitFor(() => app.evaluate(`!!document.querySelector("[data-new-supplier-fields] input[type=tel]")`), "Stock on credit");
    assertFieldRings(await tapEachField(app), "Stock on credit");
  });
});
