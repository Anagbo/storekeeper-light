import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
// The tracked copy of the contract (tests/wiringContract.test.js proves it equals the handoff file).
import wiring from "../src/pos/wiring.json" with { type: "json" };
import * as planPayments from "../src/pos/planPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const prototypePath = new URL("../docs/handoff/pos-prototype.html", import.meta.url);

test("status labels: waiting is the title of screen 70 and failed is the name of screen 59, read from the wiring file", () => {
  assert.equal(typeof planPayments.planStatusLabel, "function");
  assert.equal(planPayments.planStatusLabel("waiting"), wiring.screens["70"].name);
  assert.equal(planPayments.planStatusLabel("waiting"), "Waiting to confirm");
  assert.equal(planPayments.planStatusLabel("failed"), wiring.screens["59"].name);
  assert.equal(planPayments.planStatusLabel("failed"), "Payment not completed");
});

test("status labels: confirmed is the word the prototype shows on My plan rows", (t) => {
  assert.equal(planPayments.planStatusLabel("confirmed"), "Confirmed");
  if (!existsSync(prototypePath)) {
    t.skip("docs/handoff/pos-prototype.html is not present");
    return;
  }
  const html = readFileSync(prototypePath, "utf8");
  const start = html.indexOf('id="s64"');
  const section = html.slice(start, html.indexOf("<section", start + 10)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(section, /Mobile money · GH₵30\.00 Confirmed/);
});

test("status labels: reversed reads 'Payment reversed' (owner wording: the wiring file, prototype and brief have none)", () => {
  assert.equal(planPayments.planStatusLabel("reversed"), "Payment reversed");
  // Every status the data model allows (PlanPaymentStatus in src/db/types.ts) now has plain wording.
  const allowed = read("src/db/types.ts").match(/export type PlanPaymentStatus = ([^;]+);/)[1].match(/"(\w+)"/g).map((value) => value.replace(/"/g, ""));
  assert.deepEqual(allowed, ["waiting", "confirmed", "failed", "reversed"]);
  for (const status of allowed) {
    assert.notEqual(planPayments.planStatusLabel(status), status, `${status} must not show as its stored word`);
  }
});

test("status labels: a value outside the data model keeps its stored word, and an empty one shows nothing", () => {
  assert.equal(planPayments.planStatusLabel("something_new"), "something_new");
  for (const missing of [undefined, null, ""]) assert.equal(planPayments.planStatusLabel(missing), "", String(missing));
  // Not a prototype key, so a stored value can never pick up an object's own property.
  assert.equal(planPayments.planStatusLabel("constructor"), "constructor");
});

test("status labels: My plan rows use the label, and 70 takes its title from the same map", () => {
  const screen = read("src/pos/PlanScreens.jsx");
  assert.match(screen, /planStatusLabel\(payment\.status\)/);
  assert.doesNotMatch(screen, /\{payment\.status\}/, "no raw stored status on a row");
  assert.match(screen, /waiting \? planStatusLabel\("waiting"\) : "Plan paid"/);
});

test("status labels: a row with no status shows no empty tag", () => {
  const screen = read("src/pos/PlanScreens.jsx");
  assert.match(screen, /planStatusLabel\(payment\.status\) && <PosStatusTag/);
});
