import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatDate } from "../src/lib/formatDate.js";
import { formatHistoryRowTimestamp, rowWhen } from "../src/pos/historyRows.js";

// rules_global.customer_proof: amounts on 72, 73 and the credit rows of 29/43 go through formatGhs, and
// dates through formatDate (dd/mm/yyyy). No other number or date formatting in those files.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
const FILES = ["src/pos/CustomerSignature.jsx", "src/pos/CustomerRecordView.jsx", "src/pos/historyRows.js", "src/pos/SignatureBox.jsx"];

test("72, 73 and the shared history rows never format money or dates by hand", () => {
  for (const file of FILES) {
    const code = read(file);
    assert.doesNotMatch(code, /toFixed|toLocale|Intl\.|\/\s*100\b/, `${file} formats by hand`);
    assert.doesNotMatch(code, /\bGHS\b|\bcedis?\b/i, `${file} writes the currency by hand`);
  }
});

test("money goes through formatGhs and dates through formatDate", () => {
  for (const file of ["src/pos/CustomerSignature.jsx", "src/pos/CustomerRecordView.jsx", "src/pos/historyRows.js"]) {
    assert.match(read(file), /import \{[^}]*\bformatGhs\b[^}]*\} from "\.\.\/lib\/money\.js"/, `${file} imports formatGhs`);
  }
  assert.match(read("src/pos/CustomerSignature.jsx"), /import \{ formatDate \} from "\.\.\/lib\/formatDate\.js"/);
  assert.match(read("src/pos/historyRows.js"), /import \{ formatDate, formatTime \} from "\.\.\/lib\/formatDate\.js"/);
  assert.match(read("src/pos/CustomerRecordView.jsx"), /rowWhen\(event\)/);
});

test("row dates are dd/mm/yyyy (a backdated debt shows the day only)", () => {
  const time = new Date(2026, 0, 5, 8, 7).getTime();
  assert.equal(formatHistoryRowTimestamp(time), "05/01/2026 08:07");
  assert.equal(rowWhen({ timestamp: time, dateOnly: true }), "05/01/2026");
  assert.equal(rowWhen({ timestamp: time }), `${formatDate(time)} 08:07`);
  assert.match(formatHistoryRowTimestamp(Date.now()), /^Today \d{2}:\d{2}$/);
});
