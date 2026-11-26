import assert from "node:assert/strict";
import test from "node:test";
import { hasUsablePhone, isValidPhone } from "../src/lib/phoneNumber.js";

test("isValidPhone: empty is valid, the field is optional", () => {
  for (const value of ["", "   ", undefined, null]) assert.equal(isValidPhone(value), true, JSON.stringify(value));
  assert.equal(hasUsablePhone(""), false);
});

test("isValidPhone: Ghana mobile numbers in every accepted form", () => {
  for (const value of ["024 123 4567", "0241234567", "+233 24 123 4567", "233241234567", "00233241234567", "241234567", "(024) 123-4567"]) {
    assert.equal(isValidPhone(value), true, value);
    assert.equal(hasUsablePhone(value), true, value);
  }
});

test("isValidPhone: too long, too short, letters, wrong start, landline", () => {
  for (const value of ["369999955258444785", "12345", "abc", "024 123 456a", "02412345678", "030 123 4567", "+44 24 123 4567"]) {
    assert.equal(isValidPhone(value), false, value);
    assert.equal(hasUsablePhone(value), false, value);
  }
});
