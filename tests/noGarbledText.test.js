import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The sequence a UTF-8 GH₵ sign turns into when a file is rewritten with the wrong encoding.
// Built from escapes so this file does not contain it itself.
const GARBLED = "\u00e2\u201a\u00b5";

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(jsx?|mjs|json|css|html)$/.test(entry.name) ? [path] : [];
  });
}

test("src contains no garbled GH₵ sign", () => {
  const bad = sourceFiles("src").filter((path) => readFileSync(path, "utf8").includes(GARBLED));
  assert.deepEqual(bad, []);
});
