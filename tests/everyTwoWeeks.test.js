import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { posText as t } from "../src/pos/i18n.js";
import { PAYMENT_FREQUENCIES } from "../src/utils/installments.js";

// The words on screen are "Every 2 weeks" (as on 19). "bi-weekly" stays only as the stored frequency value.
test("no on-screen string says bi-weekly", () => {
  assert.equal(t("kv.paymentEvery.bi-weekly", { amount: "GH₵1.00" }), "GH₵1.00 every 2 weeks");
  assert.equal(t("credit.frequency.bi-weekly"), "Every 2 weeks");
  const values = readFileSync(new URL("../src/pos/i18n.js", import.meta.url), "utf8").split(/\r?\n/).filter((l) => /:\s*"[^"]*bi-?weekly/i.test(l.replace(/^\s*"[^"]*":/, "")));
  assert.deepEqual(values, []);
  for (const option of PAYMENT_FREQUENCIES) assert.doesNotMatch(option.label, /bi-?weekly|fortnight/i);
});
