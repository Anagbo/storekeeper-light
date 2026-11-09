import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const transactionsSource = readFileSync(
  new URL("../src/pos/TodaysTransactions.jsx", import.meta.url),
  "utf8"
);
const owedSource = readFileSync(
  new URL("../src/pos/OwedScreens.jsx", import.meta.url),
  "utf8"
);

test("today's transactions has separate loading, error, and retry states", () => {
  assert.match(transactionsSource, /status: "loading"/);
  assert.match(transactionsSource, /status: "error"/);
  assert.match(transactionsSource, /transactions\.loadFailed/);
  assert.match(transactionsSource, /transactions\.retry/);
  assert.match(transactionsSource, /setReloadKey/);
  assert.match(transactionsSource, /animate-pulse/);
});

test("people who owe you handles initial and incremental loading failures", () => {
  assert.match(owedSource, /Could not load outstanding debts/);
  assert.match(owedSource, /Could not load customer details for outstanding debts/);
  assert.match(owedSource, /Could not load more outstanding debts/);
  assert.match(owedSource, /loadError/);
  assert.match(owedSource, /Try again/);
  assert.match(owedSource, /animate-pulse/);
});
