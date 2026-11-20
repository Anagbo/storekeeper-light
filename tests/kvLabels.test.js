import assert from "node:assert/strict";
import { test } from "node:test";
import { posText as t } from "../src/pos/i18n.js";

// rules_global.kv_labels (decided 17 Nov 2026), item 0: key-value labels are short, about 14 characters at most,
// and always one line at 340px (the one-line check runs in a real browser in tests/kvRowsLayout.test.js and, for
// the What happened cards, tests/eventCardsLayout.test.js). The period words (this week, in these 2 weeks, this
// month) are never part of a label.
const LABELS = [
  // What happened cards (29, 43, 73)
  "event.time", "event.reason", "event.signature", "event.paidWith", "event.was", "event.newBalance",
  // 29, 43, 54
  "kv.lastReminder", "kv.payment", "kv.paidSoFar", "kv.nextPayment", "kv.wasDue",
  // 53
  "kv.debt", "kv.due", "kv.paid", "kv.stillNeeded", "kv.paymentsLeft",
  // 56, 68
  "kv.fee", "kv.youReceive", "kv.youPay",
  // 69
  "kv.planRunsTo", "kv.paidBy", "kv.status",
  // 64
  "kv.activeUntil", "kv.daysLeft",
  // 16 and 27 status rows (Status, Person, Payment, First payment, Due)
  "kv.person", "kv.firstPayment"
];

test("every key-value label built for these screens is 14 characters or fewer and has no period words", () => {
  for (const key of LABELS) {
    const label = t(key);
    assert.notEqual(label, key, `${key} is in the translation file`);
    assert.ok(label.length <= 14, `${key}: "${label}" is ${label.length} characters`);
    assert.doesNotMatch(label, /this week|2 weeks|this month|every/i, `${key}: no period words`);
  }
});

test("the Payment value carries the frequency word after the amount: weekly, bi-weekly, monthly", () => {
  for (const frequency of ["weekly", "bi-weekly", "monthly"]) {
    assert.equal(t(`kv.paymentEvery.${frequency}`, { amount: "GH₵2.00" }), `GH₵2.00 ${frequency}`);
  }
});
