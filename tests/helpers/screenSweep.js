// Crash sweep for the payment screens (19/27, 15/16, 25/26/27). A walk through the real PosApp
// that takes every ordered pair of actions at least once (an Eulerian circuit over all pairs,
// n*n + 1 steps), so "A then B" is tried for every A and B, including the same action twice.
// After every step the walk fails on the error screen, on a render error logged by the error
// boundary, or on any exception other than a button or input that is not there or is disabled
// at that moment (those are normal: e.g. the amount field is locked once parts are recorded).

export const SCREEN_ERROR = "This screen could not load.";

// Every ordered pair (a, b) of 0..n-1 appears as consecutive items exactly once.
export function pairCoveringOrder(n) {
  const next = Array.from({ length: n }, () => 0);
  const stack = [0];
  const order = [];
  while (stack.length) {
    const top = stack.at(-1);
    if (next[top] < n) {
      stack.push(next[top]);
      next[top] += 1;
    } else {
      order.push(stack.pop());
    }
  }
  return order.reverse();
}

const HARMLESS = /^(No button|Button "[^"]*" is disabled|No input)/;

export function crashesOn(app) {
  const shown = app.text().includes(SCREEN_ERROR);
  const logged = app.errors.filter((args) => args.some((arg) => typeof arg === "string" && /failed to render/.test(arg)));
  return shown || logged.length > 0
    ? { shown, logged: logged.map((args) => String(args[1]?.stack ?? args[1]).split("\n").slice(0, 3).join(" | ")) }
    : null;
}

// Runs one action; a missing or disabled control is skipped, anything else is a failure.
export async function attempt(app, action) {
  try {
    await action(app);
  } catch (error) {
    if (!HARMLESS.test(error?.message ?? "")) throw error;
    if (process.env.SWEEP_DEBUG) console.log("  skipped:", error.message.slice(0, 160));
  }
}

// actions: { name: async (app) => ... }. home: async (app) => brings the app back to the hub screen
// (called before every step, so each action starts from the hub). Returns the steps taken.
export async function sweep(app, actions, { home, label }) {
  const names = Object.keys(actions);
  const order = pairCoveringOrder(names.length);
  const steps = [];
  for (const index of order) {
    const name = names[index];
    steps.push(name);
    await home(app);
    await attempt(app, actions[name]);
    if (process.env.SWEEP_DEBUG) console.log(label, name, "->", app.route);
    const crash = crashesOn(app);
    if (crash) {
      throw new Error(`${label}: error screen after ${steps.slice(-6).join(" > ")} (step ${steps.length}, route ${app.route}): ${JSON.stringify(crash)}`);
    }
  }
  return steps;
}

// Every ordered pair (A, B), each from the same starting point: reset, A, B. For a screen whose state
// can get stuck (19: on Next cycle, or with the amount cleared, nothing below it can be tried), so
// one long walk would skip most pairs. reset should not clean what the bug lives in (stale params).
export async function sweepPairs(app, actions, { home, reset, label, firstNames }) {
  const names = Object.keys(actions);
  let pairs = 0;
  for (const first of firstNames ?? names) {
    for (const second of names) {
      pairs += 1;
      await home(app);
      await attempt(app, reset);
      for (const name of [first, second]) {
        await home(app);
        await attempt(app, actions[name]);
        const crash = crashesOn(app);
        if (crash) {
          throw new Error(`${label}: error screen after ${first} > ${second} (at ${name}, route ${app.route}): ${JSON.stringify(crash)}`);
        }
      }
    }
  }
  return pairs;
}
