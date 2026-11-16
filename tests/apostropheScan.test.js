import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Wiring 24 (header): "Today’s transactions" uses the curly apostrophe ’ (U+2019), never ´ (U+00B4). An
// acute accent or a backtick (U+0060) used as an apostrophe must never reach what the app shows: every
// file under src (i18n strings, screens, Home tile and menu labels), index.html and the manifest are
// scanned. src/pos/wiring.json is the rule text itself (it names ´ to forbid it) and is never shown.

const root = fileURLToPath(new URL("..", import.meta.url));
const ACUTE = "´";
const BACKTICK_APOSTROPHE = /\p{L}`\p{L}/u;
const RULE_FILES = new Set(["src/pos/wiring.json"]);

function appFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(jsx?|json|css|html)$/.test(entry.name)) files.push(relative(root, path).replace(/\\/g, "/"));
    }
  };
  walk(join(root, "src"));
  return [...files.filter((file) => !RULE_FILES.has(file)), "index.html", "public/manifest.json"];
}

function findBadApostrophes(text) {
  const found = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(ACUTE)) found.push({ line: index + 1, kind: "U+00B4", text: line.trim().slice(0, 120) });
    if (BACKTICK_APOSTROPHE.test(line)) found.push({ line: index + 1, kind: "U+0060", text: line.trim().slice(0, 120) });
  });
  return found;
}

test("no ´ (U+00B4) and no backtick used as an apostrophe anywhere in the app's text", () => {
  const files = appFiles();
  assert.ok(files.includes("src/pos/i18n.js") && files.includes("src/pos/Home.jsx") && files.includes("src/pos/MenuDrawer.jsx"), "the scan covers i18n, Home and the menu");
  const problems = files.flatMap((file) => findBadApostrophes(readFileSync(join(root, file), "utf8")).map((hit) => `${file}:${hit.line} ${hit.kind} ${hit.text}`));
  assert.deepEqual(problems, []);
});

test("24, the Home link and the menu say Today’s with U+2019", async () => {
  const { posText } = await import("../src/pos/i18n.js");
  for (const key of ["transactions.title", "home.transactionsLink", "menu.transactions", "planned.titles.TodaysTransactions"]) {
    const text = posText(key);
    assert.equal(text, "Today’s transactions", key);
    assert.equal(findBadApostrophes(text).length, 0, key);
  }
});

test("the scan itself catches Today´s and Today`s, and passes Today’s and template literals", () => {
  assert.equal(findBadApostrophes("Today´s transactions")[0]?.kind, "U+00B4");
  assert.equal(findBadApostrophes("Today`s transactions")[0]?.kind, "U+0060");
  assert.deepEqual(findBadApostrophes("Today’s transactions"), []);
  assert.deepEqual(findBadApostrophes("const label = `${name} owes`;"), []);
});
