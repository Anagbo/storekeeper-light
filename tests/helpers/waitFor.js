// Waits for a real condition instead of a fixed time. `check` runs again every few milliseconds
// until it returns something truthy (its value is returned) or stops throwing; if the time runs out
// the last problem is thrown, so a test fails with the reason, not with a bare timeout.
//
//   await waitFor(async () => (await db.transactions.count()) === 2, "both sales are saved");
export async function waitFor(check, description = "the condition", { timeout = 5000, interval = 5 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  for (;;) {
    try {
      const result = await check();
      if (result) return result;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError ?? new Error(`Timed out after ${timeout} ms waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
