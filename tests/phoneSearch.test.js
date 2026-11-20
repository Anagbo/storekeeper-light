import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSearchText, matchesSearch, nationalNumber } from "../src/lib/phoneSearch.js";

// rules_global.phone_search: every typed form finds the person stored in every form.
const TYPED = ["0241234567", "024 123 4567", "24 123 4567", "+233 24 123 4567", "233241234567", "00233 24 123 4567", "(024) 123-4567"];
const STORED = ["+233241234567", "0241234567", "233241234567", "024 123 4567", "00233241234567", "+233 24 123 4567"];

test("national number", () => {
  for (const form of [...TYPED, ...STORED]) assert.equal(nationalNumber(form), "241234567", form);
});

test("each typed form finds the person stored in each form", () => {
  for (const typed of TYPED) for (const stored of STORED) {
    assert.equal(matchesSearch(typed, "Ama Mensah", stored), true, `${typed} vs ${stored}`);
  }
});

test("last digits, middle digits and a different number", () => {
  assert.equal(matchesSearch("4567", "Ama", "+233241234567"), true);
  assert.equal(matchesSearch("1234", "Ama", "+233241234567"), true);
  assert.equal(matchesSearch("0551112222", "Ama", "+233241234567"), false);
  assert.equal(matchesSearch("024 999", "Ama", "0241234567"), false);
});

test("0, +, 233, 00233 and spaces hide nobody", () => {
  for (const typed of ["0", "+", "233", "00233", "  ", "", "0 "]) {
    assert.equal(hasSearchText(typed), false, JSON.stringify(typed));
    assert.equal(matchesSearch(typed, "Ama", "+233241234567"), true);
    assert.equal(matchesSearch(typed, "Ama", ""), true);
  }
});

test("a person with no phone is found by name only", () => {
  assert.equal(matchesSearch("Ama", "Ama Mensah", ""), true);
  assert.equal(matchesSearch("ama m", "Ama Mensah", undefined), true);
  assert.equal(matchesSearch("024", "Ama Mensah", ""), false);
});

test("letters are a name search; a digits-only text also matches a name containing it", () => {
  assert.equal(matchesSearch("KOFI b", "Kofi Boateng", "0551112222"), true);
  assert.equal(matchesSearch("kofi 024", "Kofi Boateng", "0241234567"), false);
  assert.equal(matchesSearch("24", "Table 24 Chop", ""), true);
});
