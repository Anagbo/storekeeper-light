import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { formatTime } from "../src/lib/formatDate.js";

// Wiring times_24h (14 Nov 2026): every time of day is HH:mm in 24-hour form, built by the app, never
// by the device language (a collection receipt used toLocaleTimeString(undefined, …), so the same
// payment read "2:05 PM" on one phone and "14:05" on another). Like formatGhs and formatDate.

const root = fileURLToPath(new URL("..", import.meta.url));
const formatterUrl = pathToFileURL(join(root, "src/lib/formatDate.js")).href;

// Local times; the child runs with TZ=UTC, so these UTC moments are the local times shown.
const CASES = [
  [Date.UTC(2026, 10, 14, 0, 0), "00:00"],
  [Date.UTC(2026, 10, 14, 0, 5), "00:05"],
  [Date.UTC(2026, 10, 14, 9, 30), "09:30"],
  [Date.UTC(2026, 10, 14, 12, 0), "12:00"],
  [Date.UTC(2026, 10, 14, 12, 56), "12:56"],
  [Date.UTC(2026, 10, 14, 14, 5), "14:05"],
  [Date.UTC(2026, 10, 14, 23, 59, 59), "23:59"]
];
const LOCALES = ["en-US", "en-GB", "it-IT", "en-GH", "fr-FR"];

// A child process whose language is `locale` and whose Date/Intl behave like a phone that has only that
// locale's data: every DateTimeFormat and toLocale*String is made in `locale`, whatever the code asks for.
function formatIn(locale) {
  const forced = JSON.stringify(locale);
  const code = `
    const Original = Intl.DateTimeFormat;
    const Forced = function DateTimeFormat(_locales, options) { return new Original(${forced}, options); };
    Forced.prototype = Original.prototype;
    Forced.supportedLocalesOf = Original.supportedLocalesOf;
    Intl.DateTimeFormat = Forced;
    for (const name of ["toLocaleTimeString", "toLocaleString", "toLocaleDateString"]) {
      const original = Date.prototype[name];
      Date.prototype[name] = function (_locales, options) { return original.call(this, ${forced}, options); };
    }
    const { formatTime } = await import(${JSON.stringify(formatterUrl)});
    const values = ${JSON.stringify(CASES.map(([value]) => value))};
    process.stdout.write(JSON.stringify(values.flatMap((v) => [formatTime(v), formatTime(new Date(v)), formatTime(new Date(v).toISOString())])));
  `;
  const posix = locale.replace("-", "_") + ".UTF-8";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, TZ: "UTC", LANG: posix, LC_ALL: posix, LANGUAGE: locale },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("formatTime gives the same 24-hour HH:mm under en-US, en-GB, it-IT, en-GH and fr-FR", () => {
  const expected = CASES.flatMap(([, text]) => [text, text, text]);
  for (const locale of LOCALES) assert.deepEqual(formatIn(locale), expected, locale);
});

test("formatTime: a timestamp, a Date or an ISO date-time; anything else gives an empty string", () => {
  const local = new Date(2026, 10, 14, 7, 3);
  assert.equal(formatTime(local), "07:03");
  assert.equal(formatTime(local.getTime()), "07:03");
  assert.equal(formatTime(new Date(2026, 10, 14, 21, 40)), "21:40");
  for (const bad of [undefined, null, NaN, Infinity, "", "abc", "14:05", "2026-11-14", new Date("x"), {}]) {
    assert.equal(formatTime(bad), "", String(bad));
  }
});

// ---- no other time formatter ---------------------------------------------------------------------

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

test("no src file shows a time with toLocaleTimeString, toLocaleString, toLocaleDateString, Intl.DateTimeFormat or hour12, and formatDate.js uses no Intl", () => {
  const offenders = [];
  for (const path of sourceFiles(join(root, "src"))) {
    const code = withoutComments(readFileSync(path, "utf8"));
    const relative = path.slice(root.length).replace(/\\/g, "/");
    const patterns = [
      /\.toLocaleTimeString\s*\(/,
      /\.toLocaleDateString\s*\(/,
      /\.toLocaleString\s*\(/,
      /Intl\s*\.\s*DateTimeFormat/,
      /\bhour12\b/,
      /["'`]\s*[AP]M\s*["'`]/
    ];
    if (relative.endsWith("src/lib/formatDate.js")) patterns.push(/\bIntl\b/, /toLocale/);
    for (const pattern of patterns) if (pattern.test(code)) offenders.push(`${relative} (${pattern})`);
  }
  assert.deepEqual(offenders, []);
});

test("every screen and message that shows a time uses formatTime", () => {
  const users = [
    "src/pos/collectionReceipt.js",
    "src/pos/receiptTemplates.js",
    "src/pos/SaleRecorded.jsx",
    "src/pos/TodaysTransactions.jsx",
    "src/pos/DebtCollection.jsx",
    "src/utils/customerDebtHistory.js"
  ];
  for (const file of users) {
    const code = withoutComments(readFileSync(join(root, file), "utf8"));
    assert.match(code, /import\s*\{[^}]*\bformatTime\b[^}]*\}\s*from\s*["'][^"']*lib\/formatDate\.js["']/, `${file} imports formatTime`);
    assert.match(code, /\bformatTime\s*\(/, `${file} calls formatTime`);
  }
});
