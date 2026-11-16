import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { recalculateCustomerDebtBalance } from "../src/db/debtLedger.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 54 Correct balance (decided 16 Nov 2026): zero is a valid new balance. The only limits are no
// negative amount and no increase. Typing 0 (or 0.00) is accepted, shows "This lowers the debt by
// GH₵{all of it}", and Save correction works once a reason is chosen. An empty field shows no message
// at all (not "New balance must be lower."); Save correction is only disabled. With several open
// entries (Correct this entry) the same rule applies to that entry.

globalThis.HTMLElement ??= class {};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  const liveResults = new Map();
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps)}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
});

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);

// One person with one debt of GH₵200.00, or with two open entries (GH₵150.00 and GH₵50.00).
async function seed({ several = false } = {}) {
  await recordCreditSale({ name: "Ama", amountPesewas: several ? 15000 : 20000, now: Date.now() - 3 * 86_400_000 });
  const first = (await db.debts.toArray())[0];
  if (several) {
    await db.debts.add({ ...first, id: "second-entry", amountPesewas: 5000, total_owed: 5000, note: "Second entry", createdAt: Date.now() - 86_400_000, updatedAt: Date.now() - 86_400_000 });
    await recalculateCustomerDebtBalance({ customerId: first.customerId });
  }
  return first;
}

async function openSheet({ several = false } = {}) {
  const first = await seed({ several });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("DebtorDetail", { debtId: first.id, customerName: "Ama" });
  await app.settle();
  if (several) {
    // The GH₵50.00 entry: its own Correct this entry button.
    const row = nodes(app.view.tree).find((node) => node.type === "li" && /GH₵50\.00/.test(textOf(node)) && [...walk(node)].some((kid) => kid.type === "button" && textOf(kid) === "Correct this entry"));
    assert.ok(row, "the GH₵50.00 entry with Correct this entry");
    await [...walk(row)].find((kid) => kid.type === "button" && textOf(kid) === "Correct this entry").props.onClick();
    await app.settle();
  } else {
    await app.tap("Correct balance");
  }
  const sheet = () => nodes(app.view.tree).find((node) => node.props["aria-labelledby"] === "pos-correction-title");
  const field = () => nodes(sheet()).find((node) => node.type === "input" && node.props.id === "pos-correction-amount");
  const line = () => {
    const p = nodes(sheet()).find((node) => node.type === "p" && /lowers the debt|cannot increase|must be lower/.test(textOf(node)));
    return p ? textOf(p) : "";
  };
  const save = () => app.button("Save correction");
  const type = async (value) => { field().props.onChange({ target: { value } }); await app.settle(); return field().props.value; };
  return { app, sheet, field, line, save, type };
}

for (const several of [false, true]) {
  const where = several ? "one entry among several (Correct this entry)" : "a single debt";
  const all = several ? "GH₵50.00" : "GH₵200.00";

  test(`54 on ${where}: 0 and 0.00 are accepted and lower the debt by all of it`, async () => {
    const sheet = await openSheet({ several });
    assert.ok(sheet.sheet(), "the sheet is open");
    for (const zero of ["0", "0.00"]) {
      await sheet.type("");
      assert.equal(await sheet.type(zero), zero, `${zero} stays in the field`);
      assert.equal(sheet.line(), `This lowers the debt by ${all}`);
      if (zero === "0") {
        assert.equal(sheet.save().props.disabled, true, "no reason chosen yet");
        await sheet.app.tap("Debt forgiven");
      }
      assert.equal(sheet.save().props.disabled, false, `${zero}: Save correction works once a reason is chosen`);
      assert.equal(nodes(sheet.sheet()).filter((node) => node.props.role === "alert").length, 0, "no error");
    }
  });

  test(`54 on ${where}: an empty field shows no message and only disables Save`, async () => {
    const sheet = await openSheet({ several });
    await sheet.app.tap("Debt forgiven");
    assert.equal(await sheet.type(""), "");
    assert.equal(sheet.line(), "", "no line under the field");
    assert.doesNotMatch(textOf(sheet.sheet()), /New balance must be lower|cannot increase|lowers the debt/);
    assert.equal(nodes(sheet.sheet()).filter((node) => node.props.role === "alert").length, 0, "no error box");
    assert.equal(sheet.save().props.disabled, true);
  });

  test(`54 on ${where}: an increase and a negative number stay refused`, async () => {
    const sheet = await openSheet({ several });
    await sheet.app.tap("Debt forgiven");
    await sheet.type("999");
    assert.equal(sheet.line(), "Corrections cannot increase debt. Use Add to debt.");
    assert.equal(sheet.save().props.disabled, true);
    await sheet.type("5");
    assert.equal(await sheet.type("-5"), "5", "a sign is refused: the field keeps what it had");
    assert.equal(await sheet.type("-0"), "5");
  });
}
