import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { splitPartRows } from "../src/pos/splitTender.js";
import { findButton, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// Cleanup batch, commit 1 (b): every date a person reads is day/month/year (16/11/2026, as on 53),
// written by one shared formatter (src/lib/formatDate.js). The screens keep dates as ISO text
// (2026-11-16) in params and records; only the text shown is formatted.

const pending = () => Promise.resolve();
const FAR = "2099-03-07";

// ---- the Owe row on 16 -------------------------------------------------------------------------------

test("the Owe row shows 'First payment 07/03/2099', not the ISO date", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const returned = [];
  const params = {
    flow: "split", amountPesewas: 800, customer: { name: "Ama", totalDebtPesewas: 0 },
    initialPaymentPesewas: 600, splitParts: [{ paymentMethod: "cash", amountPesewas: 200 }, { paymentMethod: "momo", amountPesewas: 400 }],
    installmentAmount: "1", frequency: "weekly", nextDueDate: FAR
  };
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onSaveCredit: pending, onBack() {}, onNavigate() {}, onReturnToSplit: (next) => returned.push(next) } });
  await findButton(view.tree, "Save plan").props.onClick();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned.length, 1, "19 returned to 16");
  assert.equal(returned[0].payBackLabel, "First payment 07/03/2099");
  const rows = splitPartRows({ paymentMethod: "owe", amountPesewas: 200 }, returned[0]);
  assert.deepEqual(rows.at(-1), { name: "first-payment", label: "First payment", value: "07/03/2099" });
  assert.doesNotMatch(JSON.stringify(rows), /2099-03-07/);
  assert.equal(returned[0].installmentPlan.nextDueDate, FAR, "the plan itself keeps the ISO date");
});

test("a plan that starts today says 'Today · next payment 07/03/2099'", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const saved = [];
  const params = {
    amountPesewas: 1000, customer: { name: "Ama", totalDebtPesewas: 0 },
    installmentAmount: "2", frequency: "weekly", nextDueDate: FAR, startToday: true, todayPaymentAmount: "2.00", paymentMethod: "cash"
  };
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onSaveCredit: (content) => { saved.push(content); return pending(); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  await findButton(view.tree, "Save plan").props.onClick();
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].payBackLabel, "Today · next payment 07/03/2099");
});

// ---- Sale recorded (30) -------------------------------------------------------------------------------

test("Sale recorded shows an older sale's date as day/month/year", async () => {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const when = new Date(2026, 10, 2, 9, 30).getTime();
  const transaction = {
    id: "t1", type: "sale", amountPesewas: 1000, total_amount: 1000, payment_method: "cash", cashReceivedPesewas: 1000, momoReceivedPesewas: 0,
    items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 1000 }]), timestamp: when, createdAt: when
  };
  const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } });
  assert.match(textOf(view.tree), /02\/11\/2026 · /);
});

// ---- the shared formatter -----------------------------------------------------------------------------

test("formatDate: ISO dates, Date objects and timestamps give dd/mm/yyyy; anything else gives an empty text", async () => {
  const { formatDate } = await import("../src/lib/formatDate.js");
  assert.equal(formatDate("2026-11-16"), "16/11/2026");
  assert.equal(formatDate("2026-01-05"), "05/01/2026", "zero padded");
  assert.equal(formatDate(new Date(2026, 10, 16, 23, 59)), "16/11/2026", "the local day, not the UTC day");
  assert.equal(formatDate(new Date(2026, 0, 1, 0, 0).getTime()), "01/01/2026");
  assert.equal(formatDate("2026-11-16T10:00:00.000Z"), formatDate(new Date("2026-11-16T10:00:00.000Z")), "an ISO date-time is read as a moment");
  for (const bad of ["", null, undefined, "2026-02-30", "16/11/2026", "abc", NaN, new Date("x"), {}]) {
    assert.equal(formatDate(bad), "", String(bad));
  }
});

// ---- nothing else formats a date ------------------------------------------------------------------------

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

test("no screen, message or helper formats a date by itself", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const allowed = new Set([join(root, "lib", "formatDate.js")]);
  const offenders = [];
  for (const path of sourceFiles(root)) {
    if (allowed.has(path)) continue;
    const code = readFileSync(path, "utf8").replace(/\/\/.*$/gm, "");
    if (/toLocaleDateString|toDateString|toLocaleString\(|\bmonth\s*:\s*["'](short|long|numeric|2-digit)["']|\bMONTHS\b/.test(code)) offenders.push(path.slice(root.length + 1));
  }
  assert.deepEqual(offenders, []);
});
