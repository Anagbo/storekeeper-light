import assert from "node:assert/strict";
import { test } from "node:test";
import { dumpDom, isStartupFailure } from "./helpers/browserLayout.js";

// The shared --dump-dom launch (browserLayout.dumpDom, used by measureInFrames and headerAlwaysVisible):
// Edge's start-up failure "LoadEnclaveImageW failed" with no page output is retried once with a fresh
// profile; any other failure is not retried, and a second start-up failure is returned as it is.

const OK = { status: 0, stdout: '<html><pre id="out">[]</pre></html>', stderr: "" };
const ENCLAVE = { status: 0, stdout: "", stderr: "[2468:26116:1116/231017.133:ERROR:components\\edge_ess\\vbs_encoder.cc:100] LoadEnclaveImageW failed, error code 577" };
const OTHER = { status: 1, stdout: "", stderr: "something else went wrong" };

const runs = (...results) => {
  const profiles = [];
  const run = (_browser, args) => {
    profiles.push(args.find((arg) => arg.startsWith("--user-data-dir=")));
    return results[profiles.length - 1];
  };
  return { run, profiles };
};

test("the start-up failure is retried once with a fresh profile", () => {
  const { run, profiles } = runs(ENCLAVE, OK);
  assert.equal(dumpDom("page.html", "dir", { run, wait: 0 }), OK);
  assert.equal(profiles.length, 2);
  assert.notEqual(profiles[0], profiles[1], "the retry uses a fresh profile");
});

test("a second start-up failure is returned (the test then fails)", () => {
  const { run, profiles } = runs(ENCLAVE, ENCLAVE, OK);
  assert.equal(dumpDom("page.html", "dir", { run, wait: 0 }), ENCLAVE);
  assert.equal(profiles.length, 2, "only one retry");
});

test("any other failure is not retried", () => {
  const { run, profiles } = runs(OTHER, OK);
  assert.equal(dumpDom("page.html", "dir", { run, wait: 0 }), OTHER);
  assert.equal(profiles.length, 1);
});

test("the start-up message alone is not a failure when the page was measured", () => {
  assert.equal(isStartupFailure({ ...OK, stderr: ENCLAVE.stderr }), false);
  assert.equal(isStartupFailure(ENCLAVE), true);
  assert.equal(isStartupFailure(OTHER), false);
});
