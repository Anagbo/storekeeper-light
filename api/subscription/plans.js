const DEFAULT_PLANS = {
  monthly: { months: 1, amountPesewas: 1500 },
  six_months: { months: 6, amountPesewas: 7500 },
  yearly: { months: 12, amountPesewas: 15000 }
};

const ENV_KEYS = {
  monthly: "SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS",
  six_months: "SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS",
  yearly: "SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS"
};

function configuredAmount(planId) {
  const rawAmount = process.env[ENV_KEYS[planId]]?.trim();
  if (!rawAmount) return DEFAULT_PLANS[planId].amountPesewas;
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`${ENV_KEYS[planId]} must be a positive integer in pesewas.`);
  }
  return amount;
}

export function getSubscriptionPlan(planId = "monthly") {
  const plan = DEFAULT_PLANS[planId];
  if (!plan) return null;
  return { id: planId, months: plan.months, amountPesewas: configuredAmount(planId) };
}

export { addSubscriptionMonths };
import { addSubscriptionMonths } from "../../src/lib/subscriptionDates.js";
