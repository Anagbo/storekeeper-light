import { recordReminderSent } from "../db/reminders.js";

// rules_global.reminders: ONE shared path for every WhatsApp reminder button (Home Collect first 22,
// Owed rows 32, debtor detail 29/43, wide D3). A tap that hands over to WhatsApp records a local
// "reminder sent" event for the person (works offline: it is only written on this phone). Receipts
// never come through here, so they never record a reminder.
//
// Each screen calls useReminderCheck() once and passes every reminder control's tap to onReminder:
//   <a href={waLink} onClick={(event) => reminders.onReminder(event, { person, lastReminderAt })}>
//   <button onClick={(event) => reminders.onReminder(event, { person, lastReminderAt, share })}>
// `person` is { customerId, name }. `share` (no valid phone) opens the share sheet and returns
// "cancelled" when the merchant closed it; nothing is recorded then.
export function useReminderCheck({ record = recordReminderSent } = {}) {
  async function save(person) {
    try {
      await record({ customerId: person?.customerId ?? "", customerName: person?.name ?? "" });
    } catch (error) {
      console.error("Could not record the reminder.", error);
    }
  }

  async function handOver({ person, share }) {
    if (!share) return save(person);
    let result;
    try {
      result = await share();
    } catch (error) {
      console.error("Could not open WhatsApp for the reminder.", error);
      return undefined;
    }
    if (result !== "cancelled") await save(person);
    return result;
  }

  function onReminder(_event, request) {
    return handOver(request);
  }

  return { onReminder, sheet: null };
}