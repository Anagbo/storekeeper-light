import assert from "node:assert/strict";
import { test } from "node:test";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../src/utils/whatsapp.js";

test("normalizes common Ghana phone number formats to +233", () => {
  for (const phone of [
    "024 123 4567",
    "024-123-4567",
    "024.123.4567",
    "+233 24 123 4567",
    "+233 (24) 123 4567",
    "00233 (24) 123 4567",
    "233241234567",
    "241234567"
  ]) {
    assert.equal(normalizeWhatsAppPhone(phone), "+233241234567");
  }
  assert.equal(normalizeWhatsAppPhone("050 123 4567"), "+233501234567");
  assert.equal(normalizeWhatsAppPhone("233123456"), "+233233123456");
});

test("accepts Ghana mobile prefixes and rejects non-mobile, malformed, or wrong-length numbers", () => {
  for (const prefix of [
    "020", "021", "022", "023", "024", "025", "026", "027", "028", "029",
    "050", "051", "052", "053", "054", "055", "056", "057", "058", "059"
  ]) {
    const nationalNumber = `${prefix}1234567`;
    assert.equal(normalizeWhatsAppPhone(nationalNumber), `+233${nationalNumber.slice(1)}`, prefix);
  }

  for (const phone of [
    "0301234567",
    "0401234567",
    "0701234567",
    "020123456",
    "02012345678",
    "+233 20 123 456",
    "+233 30 123 4567",
    "00234 24 123 4567",
    "++233241234567",
    "024+1234567",
    "024 123 4567 ext 2",
    "(024 123 4567",
    "024)123(4567",
    "024 () 4567",
    "０２４１２３４５６７"
  ]) {
    assert.equal(normalizeWhatsAppPhone(phone), null, phone);
  }
});

test("rejects invalid or unsupported phone number input", () => {
  for (const phone of ["", "123", "02412345678", "024abc4567", "+1 415 555 2671"]) {
    assert.equal(normalizeWhatsAppPhone(phone), null);
  }
  assert.equal(normalizeWhatsAppPhone(null), null);
});

test("generates a WhatsApp link with the localized, encoded reminder", () => {
  const link = generateWhatsAppLink("024 123 4567", "Ama Mensah", 12.5, "Market Shop");
  const url = new URL(link);

  assert.equal(url.origin + url.pathname, "https://wa.me/233241234567");
  assert.equal(url.searchParams.get("text"), "Hello *Ama Mensah*, this is a gentle reminder from *Market Shop* regarding your outstanding balance of *GH₵ 12.50*. Kindly arrange payment at your earliest convenience. Thank you!");
});

test("uses the default shop name and rejects invalid reminder details", () => {
  const link = generateWhatsAppLink("+233241234567", "Ama", 1);
  assert.match(decodeURIComponent(link), /from \*StoreKeeper Light\*/);
  assert.equal(generateWhatsAppLink("invalid", "Ama", 1), null);
  assert.equal(generateWhatsAppLink("0241234567", "Ama", 0), null);
  assert.equal(generateWhatsAppLink("0241234567", "", 1), null);
});
