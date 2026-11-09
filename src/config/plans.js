// Client subscription prices: ONE table, in whole pesewas. The server (api/subscription/plans.js)
// is the authority for what is charged; this table only decides what the screens show, so keep
// the VITE_ values equal to the server's SUBSCRIPTION_*_AMOUNT_PESEWAS values. The price,
// billing period and lapse rule are the owner's decisions and are not set here.
export const PLAN_DEFAULTS_PESEWAS = Object.freeze({ monthly: 1500, six_months: 7500, yearly: 15000 });

const PLAN_ENV_KEYS = Object.freeze({
  monthly: "VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS",
  six_months: "VITE_SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS",
  yearly: "VITE_SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS"
});

// A price must be a positive whole number of pesewas ("1500", not "15.00"). Anything else
// falls back to the default and is reported, so a bad setting cannot show a wrong price.
export function readPlanPrices(env = {}) {
  const prices = {};
  const invalid = [];
  for (const id of Object.keys(PLAN_DEFAULTS_PESEWAS)) {
    const raw = env[PLAN_ENV_KEYS[id]];
    if (raw === undefined || raw === "") {
      prices[id] = PLAN_DEFAULTS_PESEWAS[id];
    } else if (/^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0) {
      prices[id] = Number(raw);
    } else {
      prices[id] = PLAN_DEFAULTS_PESEWAS[id];
      invalid.push(id);
    }
  }
  return { prices, invalid };
}

const { prices, invalid } = readPlanPrices(import.meta.env ?? {});
if (invalid.length > 0) {
  console.error(`Subscription price settings for ${invalid.join(", ")} must be whole pesewas; the default is shown.`);
}

export const PLAN_PRICES_PESEWAS = Object.freeze(prices);

export const SUBSCRIPTION_PLANS = Object.freeze([
  Object.freeze({ id: "monthly", label: "Monthly", months: 1, amountPesewas: PLAN_PRICES_PESEWAS.monthly }),
  Object.freeze({ id: "six_months", label: "6 months", months: 6, amountPesewas: PLAN_PRICES_PESEWAS.six_months }),
  Object.freeze({ id: "yearly", label: "Yearly", months: 12, amountPesewas: PLAN_PRICES_PESEWAS.yearly })
]);