import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { formatGhs, formatGhsAmount, formatGhsCompactAmount } from "../src/lib/formatGhs.js";

// Phone test 14 Nov 2026: Chrome on Android showed "GHS 5.00" where the laptop showed "GH₵5.00".
// Intl.NumberFormat gives GH₵ only where the device's ICU data has en-GH; otherwise it falls back to
// the device language. formatGhs now builds the text itself, so the output is the same everywhere.

const root = fileURLToPath(new URL("..", import.meta.url));
const formatterUrl = pathToFileURL(join(root, "src/lib/formatGhs.js")).href;

const EXPECTED = {
  0: "GH₵0.00",
  5: "GH₵0.05",
  100: "GH₵1.00",
  12345: "GH₵123.45",
  100000: "GH₵1,000.00",
  123456789: "GH₵1,234,567.89",
  [-5]: "-GH₵0.05",
  [-100]: "-GH₵1.00",
  [-12345]: "-GH₵123.45",
  [-100000]: "-GH₵1,000.00",
  [-123456789]: "-GH₵1,234,567.89"
};
const VALUES = Object.keys(EXPECTED).map(Number);
const LOCALES = ["en-US", "en-GB", "it-IT", "en-GH", "fr-FR"];

// A child process whose language is `locale` and whose Intl behaves like a phone that has only that
// locale's data: every NumberFormat / toLocaleString is made in `locale`, whatever locale the code asks for.
function formatIn(locale) {
  const code = `
    const Original = Intl.NumberFormat;
    const Forced = function NumberFormat(_locales, options) { return new Original(${JSON.stringify(locale)}, options); };
    Forced.prototype = Original.prototype;
    Forced.supportedLocalesOf = Original.supportedLocalesOf;
    Intl.NumberFormat = Forced;
    const toLocale = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (_locales, options) { return toLocale.call(this, ${JSON.stringify(locale)}, options); };
    const { formatGhs, formatGhsAmount, formatGhsCompactAmount } = await import(${JSON.stringify(formatterUrl)});
    const values = ${JSON.stringify(VALUES)};
    process.stdout.write(JSON.stringify(values.map((v) => [formatGhs(v), formatGhsAmount(v), formatGhsCompactAmount(v)])));
  `;
  const posix = locale.replace("-", "_") + ".UTF-8";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, LANG: posix, LC_ALL: posix, LANGUAGE: locale },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("formatGhs gives the same text under en-US, en-GB, it-IT, en-GH and fr-FR", () => {
  const byLocale = LOCALES.map((locale) => [locale, formatIn(locale)]);
  for (const [locale, rows] of byLocale) {
    VALUES.forEach((value, index) => {
      assert.equal(rows[index][0], EXPECTED[value], `${locale}: formatGhs(${value})`);
    });
    assert.deepEqual(rows, byLocale[0][1], `${locale} matches ${LOCALES[0]} for every formatter`);
  }
});

test("formatGhs: GH₵, a comma every three digits, exactly two decimals, minus before GH₵", () => {
  for (const value of VALUES) assert.equal(formatGhs(value), EXPECTED[value]);
  assert.equal(formatGhs(), "GH₵0.00");
  assert.equal(formatGhs(null), "GH₵0.00");
  assert.equal(formatGhs("abc"), "GH₵0.00");
  assert.equal(formatGhs(-0), "GH₵0.00");
  assert.equal(formatGhs("1250"), "GH₵12.50");
  assert.equal(formatGhs(99999999), "GH₵999,999.99");
  // A fraction of a pesewa rounds half away from zero, as the Intl formatter did.
  assert.equal(formatGhs(0.5), "GH₵0.01");
  assert.equal(formatGhs(100.5), "GH₵1.01");
  assert.equal(formatGhs(-0.5), "-GH₵0.01");
  assert.equal(formatGhs(0.4), "GH₵0.00");
});

test("the symbol-less helpers use the same digits", () => {
  assert.equal(formatGhsAmount(123456789), "1,234,567.89");
  assert.equal(formatGhsAmount(-500), "-5.00");
  assert.equal(formatGhsAmount(0), "0.00");
  assert.equal(formatGhsCompactAmount(500), "5");
  assert.equal(formatGhsCompactAmount(550), "5.5");
  assert.equal(formatGhsCompactAmount(505), "5.05");
  assert.equal(formatGhsCompactAmount(123400), "1,234");
  assert.equal(formatGhsCompactAmount(0), "0");
});

// ---- no other money formatter ------------------------------------------------------------------

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx|ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

function withoutComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

test("no src file formats money with Intl.NumberFormat or currency options, and formatGhs uses no Intl", () => {
  const offenders = [];
  for (const path of sourceFiles(join(root, "src"))) {
    const code = withoutComments(readFileSync(path, "utf8"));
    const relative = path.slice(root.length).replace(/\\/g, "/");
    const patterns = [
      /Intl\s*\.\s*NumberFormat/,
      /\bcurrencyDisplay\b/,
      /\bstyle\s*:\s*["'`]currency["'`]/,
      /\bcurrency\s*:\s*["'`]GHS["'`]/,
      /\.toLocaleString\s*\(/
    ];
    if (relative.endsWith("src/lib/formatGhs.js")) patterns.push(/\bIntl\b/);
    for (const pattern of patterns) if (pattern.test(code)) offenders.push(`${relative} (${pattern})`);
  }
  assert.deepEqual(offenders, []);
});
