import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Phone validation (26 Nov 2026), real Edge at 360px on 45 Stock on credit, + New supplier: the owner
// once saved 369999955258444785 as a phone. Now leaving the field and Save show the message under it
// and nothing is saved; a valid number saves; an empty phone saves (the field is optional).

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const MESSAGE = "Enter a valid mobile number, like 024 123 4567";

const SUPPLIERS = `new Promise((resolve, reject) => {
  const request = indexedDB.open("StoreKeeperLight");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const all = database.transaction("suppliers").objectStore("suppliers").getAll();
    all.onsuccess = () => { resolve(all.result.map((row) => ({ name: row.name, phone: row.phone }))); database.close(); };
    all.onerror = () => reject(all.error);
  };
})`;

const FIELD = (label) => `[...document.querySelectorAll("main label")].find((el) => el.textContent.includes(${JSON.stringify(label)}))?.querySelector("input")`;

const PHONE_STATE = `(() => {
  const input = ${FIELD("Phone (optional)")};
  const id = input?.getAttribute("aria-describedby");
  const message = id ? document.getElementById(id) : null;
  return input && {
    value: input.value,
    invalid: input.getAttribute("aria-invalid"),
    message: message?.textContent.trim() ?? "",
    size: message ? parseFloat(getComputedStyle(message).fontSize) : 0,
    border: getComputedStyle(input).borderTopColor,
    scroll: document.documentElement.scrollWidth <= innerWidth
  };
})()`;

async function fill(app, label, text) {
  await waitFor(() => app.evaluate(`(() => { const field = ${FIELD(label)}; if (!field) return false; field.focus(); return true; })()`), label);
  await app.type(text);
  await sleep(100);
}

async function openForm(app) {
  await app.open("fields", 360, 800);
  await app.steps(["^Spent money", "type:10", "^Stock$", "^No$"]);
  await fill(app, "Supplier name", "Kofi Wholesale");
}

test("Edge 360: a bad supplier phone shows the message and saves nothing; a valid or empty phone saves", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: { fields: `await setPreference("posSetupCompleted", true);` }, env: ENV }, async (app) => {
    await openForm(app);
    await fill(app, "Phone (optional)", "369999955258444785");
    let state = await app.evaluate(PHONE_STATE);
    assert.equal(state.message, "", "no message while typing");
    await app.click("^Save$");
    state = await waitFor(async () => { const s = await app.evaluate(PHONE_STATE); return s?.message ? s : null; }, "the phone message");
    assert.equal(state.message, MESSAGE);
    assert.equal(state.invalid, "true");
    assert.ok(state.size >= 15, `message ${state.size}px`);
    assert.equal(state.value, "369999955258444785", "what was typed stays");
    assert.equal(state.scroll, true, "no sideways scroll");
    await sleep(300);
    assert.deepEqual(await app.evaluate(SUPPLIERS), [], "nothing saved");

    // Fixed: the message goes, and Save saves.
    await app.evaluate(`(() => { const f = ${FIELD("Phone (optional)")}; f.select(); })()`);
    await app.type("024 123 4567");
    state = await app.evaluate(PHONE_STATE);
    assert.equal(state.message, "", "gone once valid");
    await app.click("^Save$");
    const saved = await waitFor(async () => { const rows = await app.evaluate(SUPPLIERS); return rows.length ? rows : null; }, "the saved supplier");
    assert.deepEqual(saved, [{ name: "Kofi Wholesale", phone: "024 123 4567" }]);

    // Empty phone: saves.
    await openForm(app);
    await app.click("^Save$");
    const empty = await waitFor(async () => { const rows = await app.evaluate(SUPPLIERS); return rows.length ? rows : null; }, "the supplier without a phone");
    assert.deepEqual(empty, [{ name: "Kofi Wholesale", phone: "" }]);
  });
});
