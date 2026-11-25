import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Sell must never fall into the error boundary ("This screen could not load.") or log an error, at phone
// and wide width, with an empty keypad, with an amount, and on Review and pay.

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const HOOK = `(() => { window.__errs = []; const old = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(" ").slice(0, 300)); old.apply(console, a); }; window.addEventListener("error", (e) => window.__errs.push("page error: " + e.message)); window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + e.reason)); })()`;

async function check(app, where) {
  await sleep(400);
  const state = await app.evaluate(`({ text: document.body.innerText, errs: window.__errs || [] })`);
  assert.ok(!state.text.includes("This screen could not load."), `${where}: error screen shown`);
  assert.deepEqual(state.errs, [], `${where}: console or page errors`);
}

test("Sell, keypad with an amount and Review and pay never crash (390, 1856px)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    await app.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    for (const [width, height] of [[390, 900], [1856, 1000]]) {
      await app.open("base", width, height);
      await app.steps(["^Sell$"]);
      await app.shows("Add items");
      await check(app, `${width} empty keypad`);
      await app.steps(["^5$"]);
      await check(app, `${width} keypad with an amount`);
      await app.open("base", width, height);
      await app.steps(["^Sell$", "Add items", "^Rice", "^Add 1", width >= 960 ? "^Cash" : "^Next"]);
      await check(app, `${width} Review and pay`);
    }
  });
});
