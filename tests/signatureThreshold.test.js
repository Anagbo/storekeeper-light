import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_SIGNATURE_THRESHOLD_PESEWAS,
  SIGNATURE_THRESHOLD_PESEWAS,
  needsSignature,
  parseSignatureThreshold
} from "../src/config/features.js";
import { loadJsx } from "./helpers/renderJsx.js";

// rules_global.customer_proof.threshold: VITE_SIGNATURE_THRESHOLD_PESEWAS, default 5000, read only in
// src/config/features.js. A credit at or above it asks for a signature; below it does not.

test("the default threshold is GH₵50.00 (5000 pesewas)", () => {
  assert.equal(DEFAULT_SIGNATURE_THRESHOLD_PESEWAS, 5000);
  assert.equal(SIGNATURE_THRESHOLD_PESEWAS, 5000, "no env in node: the default");
});

test("threshold on and off: 4999 does not ask, 5000 asks", () => {
  assert.equal(needsSignature(4999), false);
  assert.equal(needsSignature(5000), true);
  assert.equal(needsSignature(5001), true);
  assert.equal(needsSignature(0), false);
  assert.equal(needsSignature(undefined), false);
  assert.equal(needsSignature(Number.NaN), false);
  assert.equal(needsSignature(4999, 4999), true, "an explicit threshold");
  assert.equal(needsSignature(4998, 4999), false);
});

test("a missing or invalid value uses the default; digits only are read exactly", () => {
  for (const raw of [undefined, null, "", " ", "abc", "-5", "0", "50.00", "1e4", "05000", "99999999999999999999"]) {
    assert.equal(parseSignatureThreshold(raw), 5000, `raw ${JSON.stringify(raw)}`);
  }
  assert.equal(parseSignatureThreshold("10000"), 10000);
  assert.equal(parseSignatureThreshold(" 2500 "), 2500);
});

test("the env value reaches the app through features.js", async () => {
  const on = await loadJsx("src/config/features.js", { VITE_SIGNATURE_THRESHOLD_PESEWAS: "20000" });
  assert.equal(on.SIGNATURE_THRESHOLD_PESEWAS, 20000);
  assert.equal(on.needsSignature(19999), false);
  assert.equal(on.needsSignature(20000), true);
  const off = await loadJsx("src/config/features.js", {});
  assert.equal(off.SIGNATURE_THRESHOLD_PESEWAS, 5000);
});

test("VITE_SIGNATURE_THRESHOLD_PESEWAS is read only in src/config/features.js", () => {
  const src = fileURLToPath(new URL("../src/", import.meta.url));
  const readers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|jsx|ts)$/.test(entry.name) && readFileSync(path, "utf8").includes("VITE_SIGNATURE_THRESHOLD_PESEWAS")) readers.push(path.slice(src.length).replace(/\\/g, "/"));
    }
  };
  walk(src);
  assert.deepEqual(readers, ["config/features.js"]);
});
