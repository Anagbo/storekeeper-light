import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// rules_global.leave_question (24 Nov 2026), real Edge at 390 and 1280: a device or browser Back
// (history.back) on a changed Edit item shows the leave question and Stay keeps the values; on Home a
// Back still leaves the app as before.

const SEEDS = {
  items: `
    await setPreference("posSetupCompleted", true);
    await createProduct({ name: "Bread", pricePesewas: 500 });
    await createProduct({ name: "Sugar", pricePesewas: 800 });
  `
};

const NAME_FIELD = `document.querySelector('input[maxlength="80"]')`;
const QUESTION = `document.querySelector('[role=alertdialog][aria-labelledby="leave-draft-question"]')`;

async function typeName(app, text) {
  await waitFor(() => app.evaluate(`(() => { const field = ${NAME_FIELD}; if (!field || !field.offsetParent) return false; field.focus(); field.select(); return true; })()`), "the item name field");
  await app.type(text);
  await waitFor(() => app.evaluate(`${NAME_FIELD}.value === ${JSON.stringify(text)}`), "the typed name");
}

const VISITS = [
  { width: 390, height: 800, steps: ["^Menu", "^Items", "^Sugar"], home: ["^Back$", "^Leave$", "^Back$"] },
  { width: 1280, height: 800, steps: ["^Items$", "^Sugar"], home: ["^Home$", "^Leave$"] }
];

test("leave question in Edge at 390 and 1280: history Back on a changed Edit item asks, Stay keeps the values; Back on Home leaves", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    for (const visit of VISITS) {
      const label = `${visit.width}px`;
      await app.open("items", visit.width, visit.height);
      await app.steps(visit.steps);
      await typeName(app, "Sugar cubes");

      await app.evaluate("history.back()");
      await waitFor(() => app.evaluate(`!!${QUESTION}`), `${label}: the leave question`);
      const text = await app.evaluate(`${QUESTION}.textContent`);
      assert.match(text, /Your changes to this item are not saved\. Leave without saving\?/, `${label}: the wording`);
      await app.click("^Stay$");
      await waitFor(() => app.evaluate(`!${QUESTION}`), `${label}: Stay closes the question`);
      await sleep(200);
      assert.equal(await app.evaluate(`${NAME_FIELD}.value`), "Sugar cubes", `${label}: Stay keeps the values`);

      // Back to Home (asking once, Leave), then a Back at Home leaves the app as before.
      await app.steps(visit.home);
      await app.shows("Spent money");
      await app.evaluate("window.__leaveMarker = 1");
      await app.evaluate("history.back()");
      await waitFor(() => app.evaluate("window.__leaveMarker !== 1"), `${label}: Back on Home leaves the app`);
    }
  });
});
