// Shared setup and screen actions for the payment crash sweeps (paymentSweep*.test.js). Importing
// this registers the database setup hooks for the test file.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach } from "node:test";
import { db } from "../../src/db/db.js";
import { recordCreditSale } from "../../src/db/debts.js";
import { setPreference } from "../../src/db/preferences.js";
import { resetBrowserBack } from "../../src/pos/browserBack.js";
import { openPosApp } from "./posAppHarness.js";
import { setLiveQuery, walk } from "./renderJsx.js";
import { sweepPairs } from "./screenSweep.js";

globalThis.HTMLElement ??= class {};

let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);

// Type into an input only when the owner could (a locked field is skipped).
async function typeIfOpen(app, name, value) {
  if (app.input(name).props.disabled) return;
  await app.type(name, value);
}

// Leave whatever screen the walk is on until `route` is reached (Back, as the owner would).
async function backTo(app, route) {
  for (let index = 0; index < 6 && app.route !== route; index += 1) await app.tap("Back");
  assert.equal(app.route, route, `back on ${route}`);
}

// What can be done on 27 (and 16): each ends back on the split screen or its hub.
const splitScreenEndings = {
  back: (app) => app.tap("Back"),
  phoneBack: (app) => app.phoneBack(),
  cashThenBack: async (app) => { await app.tap(/^Cash$/); await app.tap("Back"); },
  momoPickThenBack: async (app) => {
    await app.tap(/^MoMo$/);
    await typeIfOpen(app, "split-draft-amount", "1.00");
    await app.tap(/^Save$/);
    if (app.route === "MoMoChoice") await app.tap(/^Customer sends to my number/);
    await app.tap("Back");
  }
};

async function onSplit(app, ending) {
  if (app.route !== "SplitPayment") return;
  await ending(app);
}

export { db, open, nodes, typeIfOpen, backTo, splitScreenEndings, onSplit };

// 19 and 27 (Sell GH₵8.00 > Owe > new customer > 18 > 19): every ordered pair of actions whose first
// action is in firstNames (the pairs are split over two files so they run in parallel).
export async function sweep19(firstNames) {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  nodes(app.view.tree).find((node) => node.type === "input" && node.props.placeholder === "e.g. Kofi Mensah").props.onChange({ target: { value: "Ama Owusu" } });
  await app.settle();
  await nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "2");
  const visits = new Map();
  const count = (route) => visits.set(route, (visits.get(route) ?? 0) + 1);
  let splitTaps = 0;
  const split = (ending) => async (app) => { splitTaps += 1; await app.tap(/Split payment$/); count(app.route); await onSplit(app, ending); };
  // Phone back on 27 is swept from 16, 25 and 26 (paymentSweep16And27Collect); Today is part of every pair's start.
  const actions = {
    // Next cycle drops the payment recorded on 27; Today again opens the payment section.
    nextCycleThenToday: async (app) => { await app.tap(/^Next cycle/); await app.tap("Today"); },
    amount1: (app) => typeIfOpen(app, "Amount paid today", "1.00"),
    amount3: (app) => typeIfOpen(app, "Amount paid today", "3.00"),
    amountCleared: (app) => typeIfOpen(app, "Amount paid today", ""),
    each4: (app) => app.type("How much each time?", "4"),
    cash: (app) => app.tap(/^Cash$/),
    momo: async (app) => { await app.tap(/^MoMo$/); count(app.route); if (app.route === "MoMoChoice") await app.tap(/^Customer sends to my number/); },
    momoThenBack: async (app) => { await app.tap(/^MoMo$/); if (app.route === "MoMoChoice") await app.tap("Back"); },
    splitBack: split(splitScreenEndings.back),
    splitCashDone: split(async (app) => { await app.tap(/^Cash$/); if (!app.button(/^Done$/).props.disabled) await app.tap(/^Done$/); else await app.tap("Back"); }),
    splitMomoPick: split(splitScreenEndings.momoPickThenBack)
  };
  const pairs = await sweepPairs(app, actions, {
    firstNames,
    label: "19/27",
    home: (app) => backTo(app, "ALittleAtATime"),
    // Same start for each pair: Today with GH₵2.00 paid today and no parts. A MoMo pick from an
    // earlier pair stays in the params on purpose (the crash came from such a stale pick).
    reset: async (app) => {
      await app.tap(/^Next cycle/);
      await app.tap("Today");
      await app.type("Amount paid today", "2.00");
    }
  });
  assert.equal(pairs, firstNames.length * Object.keys(actions).length);
  assert.deepEqual(Object.keys(actions), SWEEP_19_ACTIONS);
  // Split is refused only with the amount cleared, or once parts are recorded (the buttons go).
  const opened = visits.get("SplitPayment") ?? 0;
  assert.ok(opened >= splitTaps * 0.75, `27 opened on ${opened} of ${splitTaps} split taps`);
  assert.ok((visits.get("MoMoChoice") ?? 0) > 5, "61 was opened");
}

export const SWEEP_19_ACTIONS = ["nextCycleThenToday", "amount1", "amount3", "amountCleared", "each4", "cash", "momo", "momoThenBack", "splitBack", "splitCashDone", "splitMomoPick"];
