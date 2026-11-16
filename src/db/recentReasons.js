import { db } from "./db.js";
import { cleanCreditReason } from "../lib/creditReason.js";

const DAY_MS = 86_400_000;
const GENERATED = new Set(["sale", "other amount", "credit extended", "debt add-on", "debt added", "credit entry"]);

// rules_global.credit_reason chips: the owner's typed reasons (18 for a keypad sale or split, the note
// on 53 for a debt added by hand; never an item list) from the last 30 days, newest first, distinct
// ignoring case, three at most.
export async function loadRecentCreditReasons({ now = Date.now(), limit = 3 } = {}) {
  const records = await db.transactions.where("createdAt").aboveOrEqual(now - 30 * DAY_MS).toArray();
  records.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const seen = new Set();
  const reasons = [];
  for (const record of records) {
    const typed = record.type === "manual_debt" ? (record.creditReason ?? record.note) : record.creditReason;
    const reason = cleanCreditReason(typed);
    const key = reason.toLowerCase();
    if (!reason || GENERATED.has(key) || seen.has(key)) continue;
    seen.add(key);
    reasons.push(reason);
    if (reasons.length >= limit) break;
  }
  return reasons;
}
