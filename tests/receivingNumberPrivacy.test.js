import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { saveReceivingNumber } from "../src/pos/momoConfig.js";
import { TABLES as SYNC_TABLES } from "../src/lib/syncPayload.js";

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await db.settings.clear();
});

const srcDirectory = fileURLToPath(new URL("../src/", import.meta.url));
function readTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${directory.endsWith("\\") || directory.endsWith("/") ? "" : "/"}${entry.name}`;
    if (entry.isDirectory()) return readTree(path);
    return /\.(js|jsx|ts)$/.test(entry.name) ? [{ name: path.slice(srcDirectory.length), contents: readFileSync(path, "utf8") }] : [];
  });
}
const sources = readTree(srcDirectory);
const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");

// Not 024 123 4567: that is the fixed sample number in the "Enter a Ghana mobile number" message.
const NUMBERS = ["0209876543", "0558765432"];
function captureConsole() {
  const lines = [];
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  }
  return { lines, restore: () => Object.assign(console, originals) };
}
function containsNumber(text) {
  const digits = String(text).replace(/\D/g, "");
  return NUMBERS.some((number) => digits.includes(number.slice(1)));
}

test("privacy: the local record keeps the full old and new numbers", async () => {
  await saveReceivingNumber({ enabled: true, number: NUMBERS[0], network: "MTN" });
  await saveReceivingNumber({ enabled: true, number: NUMBERS[1], network: "Telecel" });
  const entries = JSON.parse((await db.settings.get("momoReceivingNumberLog")).value);
  assert.equal(entries.at(-1).oldNumber, NUMBERS[0]);
  assert.equal(entries.at(-1).newNumber, NUMBERS[1]);
});

test("privacy: saving and failing to save never write a number to the console or into an error message", async () => {
  const capture = captureConsole();
  const errors = [];
  try {
    await saveReceivingNumber({ enabled: true, number: NUMBERS[0], network: "MTN" });
    await saveReceivingNumber({ enabled: true, number: NUMBERS[1], network: "Telecel" });
    for (const attempt of [
      { enabled: true, number: `${NUMBERS[0]}9`, network: "MTN" },
      { enabled: true, number: NUMBERS[1], network: "Vodafone" }
    ]) {
      try { await saveReceivingNumber(attempt); } catch (error) { errors.push(error); }
    }
  } finally {
    capture.restore();
  }
  assert.equal(errors.length, 2);
  for (const error of errors) assert.equal(containsNumber(error.message), false, error.message);
  // The messages are fixed text: they do not change with the number typed.
  let otherError;
  try { await saveReceivingNumber({ enabled: true, number: "05487654321", network: "MTN" }); } catch (error) { otherError = error; }
  assert.equal(otherError.message, errors[0].message);
  for (const line of capture.lines) assert.equal(containsNumber(line), false, line);
});

test("privacy: only momoConfig.js touches the record; nothing displays it", () => {
  const readers = sources.filter((file) => file.contents.includes("momoReceivingNumberLog")).map((file) => file.name.replace(/\\/g, "/"));
  assert.deepEqual(readers, ["pos/momoConfig.js"]);
});

test("privacy: no console call anywhere passes a receiving number", () => {
  const pattern = /console\.(log|info|warn|error|debug)\([^)]*\b(settings\.number|numberInput|normalizedNumber|oldNumber|newNumber|momoReceivingNumber)\b/;
  for (const file of sources) assert.doesNotMatch(file.contents, pattern, file.name);
});

test("privacy: settings (which hold the record) are never synced or put in a backup", () => {
  assert.equal(SYNC_TABLES.includes("settings"), false);
  const backupSource = readFileSync(new URL("../src/utils/backup.js", import.meta.url), "utf8");
  const backupTables = backupSource.match(/const BACKUP_TABLES = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(backupTables, /settings/);
});

test("privacy: no custom analytics events are sent (page views only)", () => {
  for (const file of sources) {
    assert.doesNotMatch(file.contents, /\btrack\(|from "@vercel\/analytics"[^\n]*\btrack\b/, file.name);
  }
});

test("privacy: screen 63 shows the saved number masked; only 62 shows it in full, for the customer to send to", () => {
  const settings = momoSource.slice(momoSource.indexOf("export function PaymentSettings"), momoSource.indexOf("export function MoMoSetup"));
  assert.match(settings, /On · \$\{settings\.number \? maskPhoneNumber\(settings\.number\) : "number not set"\}/);
  assert.doesNotMatch(settings, /\$\{settings\.number \|\|/);
});
