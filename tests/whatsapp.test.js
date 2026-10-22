import assert from "node:assert/strict";
import { test } from "node:test";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../src/utils/whatsapp.js";

test("normalizes common Ghana phone number formats to +233", () => {
  for (const phone of [
    "024 123 4567",
    "024-123-4567",
    "+233 24 123 4567",
    "00233 (24) 123 4567",
    "233241234567",
    "241234567"
  ]) {
    assert.equal(normalizeWhatsAppPhone(phone), "+233241234567");
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
