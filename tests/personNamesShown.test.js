import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { buildWhatsAppReminderText } from "../src/utils/whatsapp.js";
import { reminderAgainText } from "../src/pos/reminderLabel.js";

// Person names go through displayName (rules_global.person_names): a stored lower-case name shows in
// Title Case in the WhatsApp text and the reminder warning, and no screen prints a stored name in JSX.
test("a lower-case stored name is Title Case in the WhatsApp text and the reminder warning", () => {
  assert.match(buildWhatsAppReminderText("kofi mensah", 5000, "Shop"), /\*Kofi Mensah\*/);
  assert.match(reminderAgainText("KOFI MENSAH", Date.now() - 3600_000), /Kofi Mensah/);
});

test("no screen renders a stored person name straight into JSX text", () => {
  const dir = new URL("../src/pos/", import.meta.url);
  const raw = /(?<!=)\{(?:(?:supplier|customer|debtor|person)\??\.name|customerName|supplierName)\}/;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsx"))) {
    readFileSync(new URL(file, dir), "utf8").split(/\r?\n/).forEach((line, i) => {
      assert.doesNotMatch(line, raw, `${file}:${i + 1} prints a stored name without displayName`);
    });
  }
});
