import assert from "node:assert/strict";

// Shared by the real-Edge look checks (tests/otherButtonWidths, addButtonWidths, ...): the seeds, the
// feature flags they run with, and the per-control checks.

export const SEEDS = {
  base: `await setPreference("posSetupCompleted", true);
    await recordCreditSale({ name: "Amoto", amountPesewas: 2700, now: Date.now() - 86400000 });
    await recordCreditSale({ name: "Kwabena Asamoah-Boateng", amountPesewas: 9000, dueDate: "2026-01-02", now: Date.now() - 86400000 * 30 });
    await createProduct({ name: "Rice", default_price: 12 });`,
  // A long name that is still one word per part: the longest "See {Name}’s details" a shop is likely to type.
  longName: `await setPreference("posSetupCompleted", true);
    await recordCreditSale({ name: "Nana Akosua Frimpomaa Asamoah-Boateng", amountPesewas: 2700, now: Date.now() - 86400000 });`,
  // Five suppliers: 45 lists four and offers "Show all 5 suppliers".
  suppliers: `await setPreference("posSetupCompleted", true);
    for (const [index, name] of ["Kofi Wholesale", "Nana Akosua Frimpomaa-Boateng Wholesale Distributors", "Ama Rice", "Yaw Oil", "Esi Sugar"].entries()) {
      await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 0, category: "stock", newSupplier: { name }, paidWith: "cash", now: Date.now() - 60000 * (index + 1) });
    }`,
  fresh: ""
};

export const ENV = { VITE_ENABLE_POS_RECEIPTS: "true", VITE_ENABLE_SUBSCRIPTION: "true", VITE_ENABLE_MOMO_PHONE_REQUEST: "true" };

export function checkControls(m, label, { looks = ["other"], minHeight = 52 } = {}) {
  const notes = [];
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
  for (const c of m.controls.filter((control) => looks.includes(control.look))) {
    const what = `${label}: [${c.look}] "${c.text || c.label}"`;
    assert.ok(c.left >= -0.5 && c.right <= m.innerWidth + 0.5, `${what} is inside the screen (${c.left}-${c.right} of ${m.innerWidth})`);
    assert.ok(!c.overflow, `${what} does not overflow`);
    assert.ok(c.lines <= 2, `${what} takes at most two lines (${c.lines})`);
    // Icon-only tiles (Collect, WhatsApp, Call on 32) keep their own size; they are left as they are.
    if (c.text) assert.ok(c.height >= minHeight - 0.5, `${what} is ${minHeight}px or taller (${c.height})`);
    if (c.lines === 2) notes.push(`${what} wraps to 2 lines at ${m.innerWidth}px`);
  }
  return notes;
}
