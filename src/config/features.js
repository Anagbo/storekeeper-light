export const FEATURE_FLAGS = {
  SHOW_SUBSCRIPTION_FEATURE: import.meta.env?.VITE_ENABLE_SUBSCRIPTION === "true",
  SHOW_POS_SCREENS: import.meta.env?.VITE_ENABLE_POS_SCREENS === "true",
  // One flag for every POS receipt template (sale, split credit, collection).
  SHOW_POS_RECEIPTS: import.meta.env?.VITE_ENABLE_POS_RECEIPTS === "true"
};

export const FEATURE_SUBSCRIPTION_LOCKOUT = false;
