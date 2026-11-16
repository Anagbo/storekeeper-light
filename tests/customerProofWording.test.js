import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { hasPosText, posText } from "../src/pos/i18n.js";

// rules_global.customer_proof / wiring 72: a signature shows the customer saw and accepted the amount;
// it is not a legal record. The app never says "legal", "proof" or "guaranteed".
const FORBIDDEN = /\blegal(?:ly)?\b|proof|guarantee/i;
const src = fileURLToPath(new URL("../src/", import.meta.url));
// Shop item names in the starter catalogue ("Burglar proof", "Waterproof paint") are goods a shop
// sells, not app wording; the wiring file is the contract itself.
const NOT_APP_TEXT = new Set(["data/starter-items.json", "pos/wiring.json"]);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(js|jsx|ts|json|html|css)$/.test(entry.name) ? [path] : [];
  });
}

const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("no app text in src says legal, proof or guaranteed (comments aside)", () => {
  const problems = [];
  for (const path of sourceFiles(src)) {
    const name = path.slice(src.length).replace(/\\/g, "/");
    if (NOT_APP_TEXT.has(name)) continue;
    withoutComments(readFileSync(path, "utf8")).split(/\r?\n/).forEach((line, index) => {
      if (FORBIDDEN.test(line)) problems.push(`${name}:${index + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  for (const page of ["index.html", "public/manifest.json"]) {
    if (FORBIDDEN.test(readFileSync(new URL(`../${page}`, import.meta.url), "utf8"))) problems.push(page);
  }
  assert.deepEqual(problems, []);
});

test("the strings 72, 73 and the credit rows show", () => {
  const keys = [
    "signature.title", "signature.owes", "signature.for", "signature.taken", "signature.payBy", "signature.box", "signature.signHere",
    "signature.clear", "signature.done", "signature.skip", "signature.alreadySigned", "signature.saveFailed", "signature.notFound",
    "creditRow.noReason", "creditRow.signed", "creditRow.notSigned", "creditRow.getSignature",
    "record.show", "record.youOwe", "record.tookOnCredit", "record.corrected", "record.reason", "record.caption", "record.backToShop",
    "record.nothingYet", "record.notFound", "backup.signaturesLeftOutOne", "backup.signaturesLeftOutMany"
  ];
  for (const key of keys) {
    assert.ok(hasPosText(key), key);
    assert.doesNotMatch(posText(key), FORBIDDEN, key);
  }
  assert.equal(posText("signature.signHere"), "Sign here with your finger");
  assert.equal(posText("signature.skip"), "Skip for now");
  assert.equal(posText("record.caption"), "Read only. Please hand the phone back when you are done.");
  assert.equal(posText("record.show", { name: "Amoto" }), "Show Amoto the record ›");
});

test("the scan catches the words", () => {
  for (const text of ["This is legal proof", "Guaranteed", "legally binding", "Proof of credit"]) assert.match(text, FORBIDDEN);
  for (const text of ["Signed ✓", "Not signed", "Please sign", "allegation-free"]) assert.doesNotMatch(text, FORBIDDEN);
});
