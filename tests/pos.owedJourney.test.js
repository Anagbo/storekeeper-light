import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POS_LINKS, POS_ROUTES } from "../src/pos/routes.js";

const owedSource = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");

test("Owed customer actions reach detail and collection routes", () => {
  assert.ok(POS_LINKS.some((link) => (
    link.from === POS_ROUTES.PeopleWhoOweYou &&
    link.action === "debtor" &&
    link.to === POS_ROUTES.DebtorDetail
  )));
  assert.ok(POS_LINKS.some((link) => (
    link.from === POS_ROUTES.PeopleWhoOweYou &&
    link.action === "collect" &&
    link.to === POS_ROUTES.CollectPayment
  )));
  assert.match(owedSource, /onNavigate\("DebtorDetail", \{/);
  assert.match(owedSource, /editContact: true, returnToOwed: true/);
  assert.match(owedSource, /onCollect\(\{ id: customer\.representativeDebtId/);
  assert.match(owedSource, /<PersonRow\b/);
  assert.match(appSource, /route === POS_ROUTES\.DebtorDetail/);
  assert.match(appSource, /route === POS_ROUTES\.CollectPayment/);
});

test("Owed detail and collection actions preserve customer and debt identity", () => {
  assert.match(owedSource, /customerId: customer\.customerId/);
  assert.match(owedSource, /debtId: customer\.representativeDebtId/);
  assert.match(owedSource, /amountPesewas: customer\.balancePesewas/);
  assert.match(appSource, /navigate\(POS_ROUTES\.CollectPayment, \{ debtId: debt\.id/);
});

test("owed-list contact edits return to the originating list after saving", () => {
  const detailSource = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
  assert.match(detailSource, /onSave=\{async \(details\) => \{/);
  assert.match(detailSource, /await onSaveCustomerContact\(details\)/);
  assert.match(detailSource, /if \(params\?\.returnToOwed\) onBack\(\)/);
});
