import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { posText } from "../src/pos/i18n.js";

// rules_global.no_text_chevrons (16 Nov 2026): no chevron characters anywhere in the app text, labels,
// i18n strings or tests. Buttons and links are words only; the Back arrow is a drawn icon. The arrow
// → between two amounts is not a chevron and stays. src/pos/wiring.json is the contract itself and
// names the characters in that rule, so it is the one file not scanned. The characters are written here
// as escapes so this file does not contain them either.

const root = fileURLToPath(new URL("..", import.meta.url));
const CHEVRONS = /[\u203A\u2039\u00BB\u00AB\u276F\u276E\u27E9\u27E8\uFF1E]|&(?:rsaquo|lsaquo|raquo|laquo|gt);/;
// ">" written as an arrow: alone in JSX text (<span>></span>), after a word at the end of JSX text
// (Next ></button>), or at the end of a string literal ("Next >").
const GT_ARROWS = [
  [/>[ \t]*>[ \t]*</, "a lone > in JSX text"],
  [/[\w.)][ \t]+>[ \t]*<\//, "a > after a word at the end of JSX text"],
  [/["'`][^"'`\n]*[\w)][ \t]*>[ \t]*["'`]/, "a > at the end of a string"]
];

function files(dir, extensions) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [path] : [];
  });
}

const posFiles = files(join(root, "src/pos"), [".js", ".jsx", ".css", ".json"]).filter((path) => !path.endsWith("wiring.json"));

test("no chevron character (\u203A, \u00BB, \u2039, \u00AB and look-alikes) in src/pos", () => {
  assert.ok(posFiles.length > 50, "the scan sees the src/pos files");
  const hits = [];
  for (const path of posFiles) {
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      if (CHEVRONS.test(line)) hits.push(`${relative(root, path)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("no > used as an arrow in src/pos (JSX text or string literals)", () => {
  const hits = [];
  for (const path of posFiles.filter((file) => /\.jsx?$/.test(file))) {
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return;
      for (const [pattern, what] of GT_ARROWS) if (pattern.test(line.replace(/=>/g, "=→"))) hits.push(`${relative(root, path)}:${index + 1} (${what}): ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("no i18n string contains a chevron or a >", () => {
  const entries = [...readFileSync(join(root, "src/pos/i18n.js"), "utf8").matchAll(/^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map(([, key, value]) => [key, value]);
  assert.ok(entries.length > 500, `the scan reads the strings (${entries.length})`);
  assert.equal(posText("home.seeAll"), "See all", "the strings read here are the ones the app shows");
  const bad = entries.filter(([, value]) => CHEVRONS.test(value) || value.includes(">"));
  assert.deepEqual(bad, []);
});

test("the tests contain no chevron character either", () => {
  const hits = files(join(root, "tests"), [".js", ".jsx", ".mjs"]).filter((path) => CHEVRONS.test(readFileSync(path, "utf8").replace(/&gt;/g, "")));
  assert.deepEqual(hits.map((path) => relative(root, path)), []);
});

test("the scan catches each kind of chevron", () => {
  for (const sample of ["See all \u203A", "Next \u00BB", "Back \u2039", "Set up &" + "rsaquo;"]) assert.match(sample, CHEVRONS);
  const caught = (line) => GT_ARROWS.some(([pattern]) => pattern.test(line.replace(/=>/g, "=→")));
  assert.ok(caught('<span className="x">></span>'));
  assert.ok(caught("<button>Next ></button>"));
  assert.ok(caught('"home.seeAll": "See all >",'));
  assert.ok(!caught("const add = (a, b) => a + b;"));
  assert.ok(!caught('<span className="x">GH₵10.00 → GH₵8.00</span>'));
  assert.ok(!caught("if (a > b) return;"));
});
