import assert from "node:assert/strict";
import { test } from "node:test";
import { attempt, pairCoveringOrder, sweep } from "./helpers/screenSweep.js";
import { backTo, db, nodes, onSplit, open, splitScreenEndings } from "./helpers/paymentSweeps.js";

// Crash sweep (12 Nov 2026, after 27 opened on "This screen could not load." from 19): every ordered
// pair of actions on 15 and 16, on 25 and 27, and on 26 and 27, through the real PosApp. Fails on
// the error screen or any render error (see helpers/screenSweep.js). 19 and 27: paymentSweep19*.

test("sweep 15 and 16: amount changed before and after, split, Cash and MoMo parts, Back and phone back", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  let opened = 0;
  const split = (ending) => async (app) => { await app.tap(/Split payment$/); if (app.route === "SplitPayment") opened += 1; await onSplit(app, ending); };
  const steps = await sweep(app, {
    addDigit: (app) => app.tap("5"),
    deleteDigit: (app) => app.tap("Delete last digit"),
    splitBack: split(splitScreenEndings.back),
    splitPhoneBack: split(splitScreenEndings.phoneBack),
    splitCash: split(splitScreenEndings.cashThenBack),
    splitMomo: split(splitScreenEndings.momoPickThenBack)
  }, { label: "15/16", home: (app) => backTo(app, "Sell") });
  assert.equal(steps.length, 6 * 6 + 1);
  assert.ok(opened > 10, "16 was opened many times");
});

// 26's amount pad: clear what is there, then the new digits.
async function setCollectAmount(app, digits) {
  for (let index = 0; index < 6; index += 1) await attempt(app, (app) => app.tap("Delete last digit"));
  await app.keys(digits);
}

async function toCollect(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
}

test("sweep 25 and 27: Due now, Pay all, MoMo, split, Back and forward", async () => {
  const app = await open();
  await toCollect(app);
  let opened = 0;
  const split = (ending) => async (app) => { await app.tap(/Split payment$/); if (app.route === "SplitPayment") opened += 1; await onSplit(app, ending); };
  const steps = await sweep(app, {
    dueNow: (app) => app.tap("Due now"),
    payAll: (app) => app.tap("Pay all"),
    momoThenBack: async (app) => { await app.tap(/^MoMo$/); if (app.route !== "CollectPayment") await app.tap("Back"); },
    splitBack: split(splitScreenEndings.back),
    splitPhoneBack: split(splitScreenEndings.phoneBack),
    splitCash: split(splitScreenEndings.cashThenBack),
    splitMomo: split(splitScreenEndings.momoPickThenBack)
  }, { label: "25/27", home: (app) => backTo(app, "CollectPayment") });
  assert.equal(steps.length, 7 * 7 + 1);
  assert.ok(opened > 10, "27 was opened many times");
});

test("sweep 26 and 27: amount changed before and after, MoMo, split, Back and forward", async () => {
  const app = await open();
  await toCollect(app);
  await app.tap("Pay part");
  assert.equal(app.route, "CollectPayPart");
  let opened = 0;
  const split = (ending) => async (app) => { await app.tap(/Split payment$/); if (app.route === "SplitPayment") opened += 1; await onSplit(app, ending); };
  const steps = await sweep(app, {
    amount4: (app) => setCollectAmount(app, ["4"]),
    amount6: (app) => setCollectAmount(app, ["6"]),
    amount250: (app) => setCollectAmount(app, ["2", ".", "5"]),
    momoDirectThenBack: async (app) => {
      await app.tap(/^MoMo$/);
      if (app.route === "MoMoChoice") await app.tap(/^Customer sends to my number/);
    },
    splitBack: split(splitScreenEndings.back),
    splitPhoneBack: split(splitScreenEndings.phoneBack),
    splitCash: split(splitScreenEndings.cashThenBack),
    splitMomo: split(splitScreenEndings.momoPickThenBack)
  }, { label: "26/27", home: (app) => backTo(app, "CollectPayPart") });
  assert.equal(steps.length, 8 * 8 + 1);
  assert.ok(opened > 25, "27 was opened many times");
});

test("pairCoveringOrder takes every ordered pair exactly once", () => {
  for (const n of [1, 2, 5, 13]) {
    const order = pairCoveringOrder(n);
    assert.equal(order.length, n * n + 1);
    const pairs = new Set(order.slice(1).map((value, index) => `${order[index]},${value}`));
    assert.equal(pairs.size, n * n);
  }
});
