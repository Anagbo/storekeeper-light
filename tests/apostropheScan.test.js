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

// Straight apostrophes (U+0027) in what the app shows (16 Nov 2026): "You don’t owe any suppliers.",
// "Customer’s network" use the curly ’ (U+2019). A straight ' is also JavaScript's quote character, so a
// line scan cannot tell text from code. The source is parsed instead (@babel/parser, already installed
// with @vitejs/plugin-react) and only text is checked: string literals, template text and JSX text
// (where &apos; becomes '). Comments are not in the tree. Text that never reaches the screen is skipped:
// console messages, and messages of thrown errors other than TypeError (screens show a TypeError's
// message, never the others) and of planError (the screen shows its own words for each code).
// starter-items.json is seed data (stored product names), not checked here.

const STRAIGHT_APOSTROPHE = /\p{L}'\p{L}/u;
const NOT_SHOWN_CALLS = new Set(["planError"]);

function hiddenFromScreen(node) {
  if (node.type === "CallExpression") {
    const callee = node.callee;
    if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "console") return true;
    if (callee.type === "Identifier" && NOT_SHOWN_CALLS.has(callee.name)) return true;
  }
  if (node.type === "NewExpression" && node.callee.type === "Identifier" && /Error$/.test(node.callee.name) && node.callee.name !== "TypeError") return true;
  return node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" && node.source || node.type === "ExportAllDeclaration";
}

function findStraightApostrophes(code, parse) {
  const found = [];
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  const visit = (node) => {
    if (!node || typeof node.type !== "string" || hiddenFromScreen(node)) return;
    const text = node.type === "StringLiteral" || node.type === "JSXText" ? node.value
      : node.type === "TemplateElement" ? node.value.cooked ?? node.value.raw : null;
    if (text !== null && STRAIGHT_APOSTROPHE.test(text)) found.push({ line: node.loc.start.line, text: text.trim().slice(0, 120) });
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  return found;
}

const loadParser = async () => {
  const { createRequire } = await import("node:module");
  return createRequire(join(root, "package.json"))("@babel/parser").parse;
};

test("no straight apostrophe (') in text the app shows: screens, i18n, Home and the menu use ’", async () => {
  const parse = await loadParser();
  const files = appFiles().filter((file) => /\.jsx?$/.test(file));
  assert.ok(files.includes("src/pos/i18n.js") && files.includes("src/pos/MoMoScreens.jsx"), "the scan covers i18n and the screens");
  const problems = files.flatMap((file) => findStraightApostrophes(readFileSync(join(root, file), "utf8"), parse).map((hit) => `${file}:${hit.line} ${hit.text}`));
  assert.deepEqual(problems, []);
});

test("the straight apostrophe scan catches text and JSX, and skips code, comments and hidden messages", async () => {
  const parse = await loadParser();
  const hits = (code) => findStraightApostrophes(code, parse).map((hit) => hit.text);
  assert.deepEqual(hits(`const a = { "supplier.empty": "You don't owe any suppliers." };`), ["You don't owe any suppliers."]);
  assert.deepEqual(hits("const b = <p>Customer&apos;s network</p>;"), ["Customer's network"]);
  assert.deepEqual(hits(`const c = <input aria-label="Customer's MoMo number" />;`), ["Customer's MoMo number"]);
  assert.deepEqual(hits("const d = `We sent it to ${phone || \"the customer's number\"}`;"), ["the customer's number"]);
  assert.deepEqual(hits("const e = `Check Today's transactions`;"), ["Check Today's transactions"]);
  assert.deepEqual(hits(`throw new TypeError("This item's price is not valid.");`), ["This item's price is not valid."]);
  assert.deepEqual(hits([
    "// The customer's debt (a comment).",
    "/* the owner's choice */",
    `const q = document.querySelector("[data-x='y']");`,
    `const s = 'single quotes';`,
    `console.error("Could not save this item's price.", error);`,
    `throw new RangeError("The customer's current debt has an invalid amount.");`,
    `throw planError(CODE, "Initial payment cannot exceed the customer's total debt.");`,
    "const ok = <p>You don’t owe any suppliers.</p>;"
  ].join("\n")), []);
});
