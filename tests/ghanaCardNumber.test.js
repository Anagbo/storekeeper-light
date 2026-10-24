import test from "node:test";
import assert from "node:assert/strict";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../src/lib/ghanaCardNumber.js";
import { formatGhanaCard } from "../src/utils/formatters.js";

test("normalizes Ghana Card numbers to uppercase without whitespace", () => {
  assert.equal(normalizeGhanaCardNumber(" gha-123456789-0 "), "GHA-123456789-0");
  assert.equal(normalizeGhanaCardNumber("123 456 7890"), "1234567890");
});

test("accepts blank, formatted Ghana Card numbers, and raw digits", () => {
  assert.equal(isValidGhanaCardNumber(""), true);
  assert.equal(isValidGhanaCardNumber("GHA-123456789-0"), true);
  assert.equal(isValidGhanaCardNumber("1234567890"), true);
});

test("rejects malformed Ghana Card numbers", () => {
  assert.equal(isValidGhanaCardNumber("GHA-123-0"), false);
  assert.equal(isValidGhanaCardNumber("GHA-123456789-XX"), false);
  assert.equal(isValidGhanaCardNumber("123456789"), false);
});

test("formats Ghana Card input as the user types or pastes", () => {
  assert.equal(formatGhanaCard("gha1234567890"), "GHA-123456789-0");
  assert.equal(formatGhanaCard("1234567890"), "GHA-123456789-0");
  assert.equal(formatGhanaCard("gha-712 345 678-9"), "GHA-712345678-9");
  assert.equal(formatGhanaCard("gha"), "");
  assert.equal(formatGhanaCard("GHA-"), "");
  assert.equal(formatGhanaCard("7"), "GHA-7");
  assert.equal(formatGhanaCard("GHA-712345678-9"), "GHA-712345678-9");
  assert.equal(formatGhanaCard(""), "");
});
