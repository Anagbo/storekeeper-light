import { db } from "../../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../../src/db/debts.js";
import { addDueCycles, prepareInstallmentPlan } from "../../src/utils/installments.js";

// Owner replay (11 Nov 2026), "amos": a GH₵855.00 credit sale on 05/11 with a GH₵20.00 weekly
// plan, a GH₵6.00 collection, then a GH₵5.00 credit sale with "First payment Today" paying
// GH₵20.00 (GH₵5.00 for the sale, GH₵15.00 against the old debt). Built the way 19 builds it.
export async function replayAmos() {
  const first = prepareInstallmentPlan({
    amountPesewas: 85500, installmentAmountPesewas: 2000, frequency: "weekly", nextDueDate: "2026-11-12"
  });
  const { debtId } = await recordCreditSale({ name: "amos", amountPesewas: 85500, installmentPlan: first.plan });
  await recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  // 19 for the GH₵5.00 sale: owed 849 + 5 = 854, Today, GH₵20.00 paid today, next date a week on.
  const chosenNext = addDueCycles("2026-11-11", "weekly", 1);
  const prepared = prepareInstallmentPlan({
    amountPesewas: 85400, installmentAmountPesewas: 2000, frequency: "weekly",
    nextDueDate: "2026-11-11", startToday: true, initialPaymentLimitPesewas: 2000
  });
  await recordCreditSale({
    name: "amos", amountPesewas: 500,
    installmentPlan: { ...prepared.plan, nextDueDate: chosenNext },
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: prepared.initialPaymentPesewas }]
  });
  return { stored: await db.debts.get(debtId), chosenNext };
}