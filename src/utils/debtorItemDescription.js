const CREDIT_EVENT_TYPES = new Set(["credit", "addon"]);
const GENERATED_DESCRIPTIONS = new Set(["Credit extended", "Debt add-on"]);

export function getDebtorItemDescription(event) {
  if (!CREDIT_EVENT_TYPES.has(event?.type)) return "";
  const description = typeof event.itemDescription === "string"
    ? event.itemDescription.trim()
    : typeof event.detail === "string"
      ? event.detail.trim()
      : "";
  return description && !GENERATED_DESCRIPTIONS.has(description) ? description : "";
}
