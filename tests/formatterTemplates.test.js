import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generateWhatsAppLink } from "../src/utils/whatsapp.js";
import { createInstallmentReminderLink } from "../src/utils/installments.js";
import { buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";
import { buildPaymentReceipt, buildSaleReceipt } from "../src/pos/receiptTemplates.js";
import { posText } from "../src/pos/i18n.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const textOf = (link) => new URL(link).searchParams.get("text");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) return walk(`${path}/`);
    return /\.(js|jsx)$/.test(entry.name) ? [{ path: path.slice(root.length), contents: readFileSync(path, "utf8") }] : [];
  });
}

test("F4/Q5: the reminder takes pesewas and shows the amount through the formatter as GH₵12.00", () => {
  const link = generateWhatsAppLink("024 123 4567", "Ama Mensah", 1200, "Market Shop");
  assert.match(textOf(link), /outstanding balance of \*GH₵12\.00\*\./);
  assert.doesNotMatch(textOf(link), /GH₵ /, "no space after the symbol");
});

test("F4: the reminder formats larger amounts like every other screen (thousands separator)", () => {
  assert.match(textOf(generateWhatsAppLink("024 123 4567", "Ama", 123450, "Shop")), /\*GH₵1,234\.50\*/);
});

test("F4: the reminder refuses an amount that is not whole pesewas, so a stale cedi caller fails loudly", () => {
  for (const bad of [12.5, 0.5, 0, -100, NaN, "1200", null, undefined]) {
    assert.equal(generateWhatsAppLink("024 123 4567", "Ama", bad, "Shop"), null, String(bad));
  }
});

test("F4: no caller passes cedis (amount / 100) to the reminder", () => {
  for (const file of walk(`${root}src/`)) {
    let from = file.contents.indexOf("generateWhatsAppLink(");
    while (from >= 0) {
      const call = file.contents.slice(from, from + 400);
      const end = call.search(/\)\s*(;|\n|,|&&|\?|:|\})/);
      assert.doesNotMatch(end > 0 ? call.slice(0, end) : call, /\/ ?100\b/, `${file.path} passes cedis to generateWhatsAppLink`);
      from = file.contents.indexOf("generateWhatsAppLink(", from + 1);
    }
  }
});

test("F4: the installment reminder shows the amount through the formatter", () => {
  assert.match(textOf(createInstallmentReminderLink("024 123 4567", "Ama Mensah", 123450)), /installment of GH₵1,234\.50 /);
  assert.match(textOf(createInstallmentReminderLink("024 123 4567", "Ama Mensah", 2500)), /installment of GH₵25\.00 /);
});

test("F4: the default collection receipt shows amounts through the formatter and still rejects bad amounts", () => {
  const result = {
    customerName: "Kofi", createdAt: Date.UTC(2026, 10, 9, 12), amountPesewas: 123450, remainingPesewas: 250000,
    parts: [{ paymentMethod: "cash", amountPesewas: 100000 }, { paymentMethod: "momo", amountPesewas: 23450 }]
  };
  const text = buildCollectionReceiptMessage(result, "Shop");
  assert.match(text, /Amount: GH₵1,234\.50 \(Cash GH₵1,000\.00, MoMo GH₵234\.50\)/);
  assert.match(text, /Still owed: GH₵2,500\.00/);
  assert.throws(() => buildCollectionReceiptMessage({ ...result, remainingPesewas: -1 }), TypeError);
  assert.throws(() => buildCollectionReceiptMessage({ ...result, remainingPesewas: 10.5 }), TypeError);
});

test("F4: the receipt templates show amounts through the formatter and still reject bad amounts", () => {
  const payment = buildPaymentReceipt({ shopName: "Shop", customerName: "Kofi", timestamp: Date.UTC(2026, 10, 9, 12), cashPesewas: 100000, momoPesewas: 23450, remainingPesewas: 250000 });
  assert.match(payment, /Amount: GH₵1,234\.50 \(Cash GH₵1,000\.00, MoMo GH₵234\.50\)/);
  const sale = buildSaleReceipt({ shopName: "Shop", timestamp: Date.UTC(2026, 10, 9, 12), totalPesewas: 123450, cashPesewas: 123450 });
  assert.match(sale, /Total: GH₵1,234\.50/);
  assert.throws(() => buildPaymentReceipt({ shopName: "Shop", customerName: "Kofi", timestamp: Date.now(), cashPesewas: 100, remainingPesewas: 0.5 }), TypeError);
});

test("F4: the formatter lives in one dependency-free file that money.js re-exports, so the server can use it", async () => {
  const pure = await import("../src/lib/formatGhs.js");
  const money = await import("../src/lib/money.js");
  assert.equal(pure.formatGhs(26820), "GH₵268.20");
  assert.equal(money.formatGhs, pure.formatGhs);
  assert.equal(money.formatGhsAmount, pure.formatGhsAmount);
  assert.doesNotMatch(read("src/lib/formatGhs.js"), /^import /m, "formatGhs.js must not import anything (no database)");
  assert.doesNotMatch(read("src/lib/money.js"), /new Intl\.NumberFormat/, "the formatter is defined once");
});

test("Q5: no amount is hard-coded with GH₵ in a component, template or message", () => {
  const allowed = new Set(["src/lib/formatGhs.js", "src/lib/money.js"]);
  const isComment = (line) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
  const violations = [];
  for (const file of [...walk(`${root}src/`), ...walk(`${root}api/`)]) {
    if (allowed.has(file.path)) continue;
    file.contents.split(/\r?\n/).forEach((line, index) => {
      // GH₵ directly followed by a digit, "{" or "$" builds or hard-codes an amount.
      // "(GH₵)" and a lone "GH₵" beside an input are currency labels and stay.
      if (!isComment(line) && /GH₵\s?(?:\d|\{|\$)/.test(line)) violations.push(`${file.path}:${index + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(violations, []);
});

test("Q5: messages that name a zero amount take it from the formatter", () => {
  assert.equal(posText("sellItems.invalidPrice", { zero: "GH₵0.00" }), "Enter a valid price greater than GH₵0.00.");
  assert.equal(posText("credit.splitCashRequired", { zero: "GH₵0.00" }), "Enter a cash amount greater than GH₵0.00.");
  assert.equal(posText("credit.splitCashTooHigh", { amount: "GH₵5.00" }), "Cash must be less than GH₵5.00.");
  assert.match(read("src/pos/SetupScreens.jsx"), /t\("sellItems\.invalidPrice", \{ zero: formatGhs\(0\) \}\)/);
  assert.match(read("src/db/products.js"), /\$\{formatGhs\(0\)\}/);
  assert.match(read("src/utils/addDebt.js"), /\$\{formatGhs\(0\)\}/);
});

test("Q5: the screens that showed GH₵ plus a number now use the formatter", () => {
  assert.match(read("src/pos/ManualDebtScreens.jsx"), /\{formatGhs\(amountPesewas\)\}<\/strong>/);
});