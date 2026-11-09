export const FEATURE_FLAGS = {
  SHOW_SUBSCRIPTION_FEATURE: import.meta.env?.VITE_ENABLE_SUBSCRIPTION === "true",
  SHOW_POS_SCREENS: import.meta.env?.VITE_ENABLE_POS_SCREENS === "true",
  // One flag for every POS receipt template (sale, split credit, collection).
  SHOW_POS_RECEIPTS: import.meta.env?.VITE_ENABLE_POS_RECEIPTS === "true",
  // Paystack phone request (sales and plan). Off until a backend creates and confirms charges.
  ENABLE_MOMO_PHONE_REQUEST: import.meta.env?.VITE_ENABLE_MOMO_PHONE_REQUEST === "true"
};

export const FEATURE_SUBSCRIPTION_LOCKOUT = false;
