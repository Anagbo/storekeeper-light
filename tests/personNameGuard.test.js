import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Guard for wiring rules_global.person_names: a customer or supplier name is never put on screen (text,
// accessible names, messages, WhatsApp and receipt text) without the shared displayName helper.
// It scans the POS screens and the message builders for a raw stored name in a rendering position:
//   - a JSX child  >{customer.name}<
//   - an attribute shown to people (aria-label, title, alt, placeholder)
//   - a {name} value given to t() or a template literal ${...}
// The stored value is still used raw where it must be (allowlist below): edit fields and inputs,
// search matching, route params and the database.

const ROOTS = ["src/pos", "src/utils", "src/lib"];
const FILES = ROOTS.flatMap((root) => readdirSync(new URL(`../${root}/`, import.meta.url))
  .filter((file) => /\.(jsx|js)$/.test(file) && file !== "i18n.js")
  .map((file) => `${root}/${file}`));

// A person's stored name: customerName / supplierName (any case style), display_name, or .name on an
// object that holds a customer, a supplier, a debt or the debtor data.
const PERSON_OBJECT = String.raw`(?:customer|supplier|selectedSupplier|debtor|person|party|debt|urgentDebt|selectedDebt|data|result|row|transaction|matching\[0\]|existingDebtor|savedCustomer|current)`;
const RAW_NAME = String.raw`(?:[\w$]+\??\.)*(?:${PERSON_OBJECT}\??\.name|[\w$]*\??\.?(?:customerName|customer_name|supplierName|supplier_name|display_name))\b`;

const PATTERNS = [
  ["JSX child", new RegExp(String.raw`>\s*\{\s*${RAW_NAME}\s*\}|\{\s*${RAW_NAME}\s*\}\s*<`)],
  ["shown attribute", new RegExp(String.raw`(?:aria-label|title|alt|placeholder)=\{\s*${RAW_NAME}\s*\}`)],
  ["t() name", new RegExp(String.raw`\bname:\s*${RAW_NAME}\s*[,}]`)],
  ["template literal", new RegExp(String.raw`\$\{\s*${RAW_NAME}\s*\}`)]
];

// Places that must keep the raw stored value. Each entry: file, a fragment of the line, the reason.
const ALLOWLIST = [
  // The contact editor and the saved-customer lookups pass the stored record on, not text.
  ["src/pos/CreditScreens.jsx", "name: result?.customerName ?? params.customer?.name", "stored record for the contact editor"],
  ["src/pos/CreditScreens.jsx", "name: savedCustomer.name ?? current.name", "stored record for the contact editor"],
  ["src/pos/CreditScreens.jsx", "name: (matching[0].customerName ?? matching[0].customer_name).trim()", "stored match for the existing-debtor check"],
  ["src/pos/DebtCollection.jsx", "name: result.customerName,", "stored record for the contact editor"],
  ["src/pos/DebtCollection.jsx", "name: savedCustomer.name ?? current.name", "stored record for the contact editor"],
  ["src/pos/DebtCollection.jsx", "name: data.name,", "stored customer passed to Add debt (route params)"],
  ["src/pos/CustomerContactEditor.jsx", "name: customer.name,", "stored value written back to the database"],
  ["src/pos/ManualDebtScreens.jsx", "customerName: params.customer?.name", "route params"],
  ["src/pos/PosApp.jsx", "name: details.customer?.name", "save payload (database)"],
  ["src/pos/SupplierScreens.jsx", "newSupplier: isNew ? { name: supplierName", "typed supplier saved to the database"],
  ["src/pos/DebtCollection.jsx", "const reminderPerson = data ? { customerId: data.customerId ?? \"\", name: data.name }", "person key for the reminder log (database); the sheet shows it through displayName"],
  ["src/pos/OwedScreens.jsx", "const person = { customerId: customer.customerId ?? \"\", name: customer.customerName }", "person key for the reminder log (database); the sheet shows it through displayName"]
];

function allowed(file, line) {
  return ALLOWLIST.some(([path, fragment]) => path === file && line.includes(fragment));
}

// A bare variable (customerName, supplierName) is fine when its nearest declaration above is made
// with displayName, e.g. `const customerName = displayName(params.customer?.name)`.
const BARE = /^(customerName|supplierName|customer_name|supplier_name|display_name)$/;
function declaredWithDisplayName(lines, index, line, pattern) {
  const matched = line.match(pattern)?.[0] ?? "";
  const bare = matched.match(/[\w$?.]+(?=\s*[},]\s*<?$)/)?.[0];
  if (!bare || !BARE.test(bare)) return false;
  for (let at = index; at >= 0; at -= 1) {
    const declaration = lines[at].match(new RegExp(String.raw`\b(?:const|let)\s+${bare}\s*=(.*)`));
    if (declaration) return /\bdisplayName\(/.test(declaration[1]);
  }
  return false;
}

function scan(file, source) {
  const found = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const [kind, pattern] of PATTERNS) {
      if (pattern.test(line) && !allowed(file, line) && !declaredWithDisplayName(lines, index, line, pattern)) found.push(`${file}:${index + 1} (${kind}) ${line.trim().slice(0, 160)}`);
    }
  });
  return found;
}

test("no screen or message shows a stored customer or supplier name without displayName", () => {
  const found = FILES.flatMap((file) => scan(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.deepEqual(found, []);
});

test("the guard catches a raw name in each rendering position", () => {
  const bad = [
    `<strong>{customer.name}</strong>`,
    `<b>{debt.customerName}</b>`,
    `<span aria-label={supplier.name} />`,
    `t("credit.whatsapp", { name: data.name })`,
    `t("x", { name: row.supplierName, amount })`,
    "`Hello ${params.customer?.name}`",
    "`Pay ${selectedSupplier.name}`"
  ];
  for (const line of bad) assert.notDeepEqual(scan("src/pos/Fake.jsx", line), [], line);
  // A bare variable: caught when it holds the stored name, accepted when it was made with displayName.
  assert.notDeepEqual(scan("src/pos/Fake.jsx", "const customerName = debt.customerName;\nconst text = `From: ${customerName}`;"), []);
  assert.notDeepEqual(scan("src/pos/Fake.jsx", "const customerName = debt.customerName;\n<h1>{t(\"x\", { name: customerName })}</h1>"), []);
  assert.deepEqual(scan("src/pos/Fake.jsx", "const customerName = displayName(debt.customerName);\nconst text = `From: ${customerName}`;"), []);
  const good = [
    `<strong>{displayName(customer.name)}</strong>`,
    `t("credit.whatsapp", { name: displayName(data.name) })`,
    `<input value={supplierName} />`,
    `matchesSearch(query, customer.name, customer.phone)`,
    `<span>{item.name} × {item.quantity}</span>`
  ];
  for (const line of good) assert.deepEqual(scan("src/pos/Fake.jsx", line), [], line);
});

// The guard bites on the real files: taking displayName out of a real line is caught.
test("the guard catches displayName removed from real screens and messages", () => {
  const cases = [
    ["src/pos/OwedScreens.jsx", "collectLabel={`Collect from ${displayName(customer.customerName)}`}", "collectLabel={`Collect from ${customer.customerName}`}"],
    ["src/pos/SupplierScreens.jsx", "t(\"supplier.payTitle\", { name: displayName(selectedSupplier.name) })", "t(\"supplier.payTitle\", { name: selectedSupplier.name })"],
    ["src/pos/CreditScreens.jsx", "const customerName = displayName(params.customer?.name);", "const customerName = params.customer?.name;"],
    ["src/pos/collectionReceipt.js", "const customerName = displayName(result.customerName);", "const customerName = result.customerName;"]
  ];
  for (const [file, from, to] of cases) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(source.includes(from), `${file}: line to mutate not found`);
    assert.notDeepEqual(scan(file, source.replace(from, to)), [], `${file}: not caught`);
  }
});
