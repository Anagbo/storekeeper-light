import { test } from "node:test";
import { SWEEP_19_ACTIONS, sweep19 } from "./helpers/paymentSweeps.js";

// Crash sweep on 19 and 27 (12 Nov 2026): every ordered pair of actions, from the same start each
// time (Today, GH₵2.00 paid today), through the real PosApp. Split over two files (by the first
// action) so the halves run in parallel; see helpers/paymentSweeps.js.

test("sweep 19 and 27, pairs starting with Next cycle, amounts, Cash: no error screen", async () => {
  await sweep19(SWEEP_19_ACTIONS.slice(0, 6));
});
