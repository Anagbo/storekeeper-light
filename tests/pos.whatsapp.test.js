import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { generateWhatsAppLink } from "../src/utils/whatsapp.js";

const detailSource = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");

test("POS debtor detail keeps the direct WhatsApp reminder link", () => {
  const link = generateWhatsAppLink("024 123 4567", "Ama Mensah", 12.5, "Market Shop");
  assert.match(link, /^https:\/\/wa\.me\/233241234567\?text=/);
  assert.match(decodeURIComponent(link), /Ama Mensah/);
  assert.match(decodeURIComponent(link), /12\.50/);
  assert.match(detailSource, /generateWhatsAppLink/);
  assert.match(detailSource, /href=\{reminderLink\}/);
});

test("POS debtor detail does not expose the legacy WhatsApp Business action", () => {
  assert.doesNotMatch(detailSource, /WhatsApp Business/);
  assert.doesNotMatch(detailSource, /sendReminder/);
});
