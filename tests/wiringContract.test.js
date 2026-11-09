import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const codeWiringPath = fileURLToPath(new URL("../src/pos/wiring.json", import.meta.url));
const handoffWiringPath = fileURLToPath(new URL("../docs/handoff/journey-wiring.json", import.meta.url));

test("src/pos/wiring.json is identical to the handoff contract when it is present", (t) => {
  if (!existsSync(handoffWiringPath)) {
    t.skip("docs/handoff/journey-wiring.json is not present");
    return;
  }
  // Compare text with line endings normalised: git may check files out with CRLF on Windows.
  const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  assert.ok(
    read(codeWiringPath) === read(handoffWiringPath),
    "src/pos/wiring.json differs from docs/handoff/journey-wiring.json. The handoff file wins: copy it over src/pos/wiring.json."
  );
});