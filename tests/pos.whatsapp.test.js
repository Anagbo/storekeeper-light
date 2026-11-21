import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildWhatsAppReminderText } from "../src/utils/whatsapp.js";

const detailSource = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");

test("POS debtor detail opens the reminder through the shared WhatsApp opener", () => {
  const text = buildWhatsAppReminderText("Ama Mensah", 1250, "Market Shop");
  assert.match(text, /Ama Mensah/);
  assert.match(text, /\*GH₵12\.50\*/);
  assert.match(detailSource, /buildWhatsAppReminderText/);
  assert.match(detailSource, /openWhatsApp\(\{ text: reminderText, phone: phone \?\? ""/);
  assert.doesNotMatch(detailSource, /href=\{reminderLink\}/);
});

test("POS debtor detail does not expose the legacy WhatsApp Business action", () => {
  assert.doesNotMatch(detailSource, /WhatsApp Business/);
  assert.doesNotMatch(detailSource, /sendReminder/);
});
