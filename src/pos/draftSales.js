import { db } from "../db/db.js";
import { createId } from "../lib/ids.js";

const MODES = new Set(["cash", "momo", "owe"]);

export function validatePaymentParts(parts, totalPesewas) {
  if (!Array.isArray(parts) || !Number.isSafeInteger(totalPesewas) || totalPesewas <= 0) {
    throw new TypeError("A valid draft sale total and parts are required.");
  }
  for (const part of parts) {
    if (!MODES.has(part?.mode) || !Number.isSafeInteger(part.amount) || part.amount <= 0) {
      throw new TypeError("Draft sale payment parts are invalid.");
    }
  }
  if (parts.reduce((sum, part) => sum + part.amount, 0) !== totalPesewas) {
    throw new RangeError("Draft sale payment parts must add up to the total.");
  }
  return parts;
}

export async function createDraftSale({ total, parts = [], flow = "sale" }) {
  validatePaymentParts(parts, total);
  const draft = { id: createId(), total, parts, flow, status: "draft", createdAt: Date.now(), updatedAt: Date.now() };
  await db.draftSales.add(draft);
  return draft;
}

export async function updateDraftSale(id, patch) {
  const current = await db.draftSales.get(id);
  if (!current || current.status !== "draft") throw new Error("The draft sale is not editable.");
  const next = { ...current, ...patch, updatedAt: Date.now() };
  if (next.parts) validatePaymentParts(next.parts, next.total);
  await db.draftSales.put(next);
  return next;
}

export async function finishDraftSale(id, status) {
  if (!["committed", "cancelled"].includes(status)) throw new TypeError("Invalid draft sale final status.");
  const current = await db.draftSales.get(id);
  if (!current) throw new Error("The draft sale was not found.");
  const next = { ...current, status, updatedAt: Date.now() };
  await db.draftSales.put(next);
  return next;
}
