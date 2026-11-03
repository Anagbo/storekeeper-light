export const FEATURE_FLAGS = {
  SHOW_SUBSCRIPTION_FEATURE: import.meta.env?.VITE_ENABLE_SUBSCRIPTION === "true",
  SHOW_POS_SCREENS: import.meta.env?.VITE_ENABLE_POS_SCREENS === "true"
};

export const FEATURE_SUBSCRIPTION_LOCKOUT = false;
