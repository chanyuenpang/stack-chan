import assert from "node:assert/strict";
import test from "node:test";

import { OwnerLedArbiter } from "../src/owner-led-arbiter.mjs";

test("manual LED override is sticky, serial, and releases automatic control only after clear", async () => {
  const writes = [];
  const dock = { connected: true, async setLed(red, green, blue) { writes.push({ red, green, blue }); } };
  const arbiter = new OwnerLedArbiter({ dock });

  await arbiter.setManual(120, 0, 168);
  assert.deepEqual(await arbiter.setAutomatic(0, 168, 0, "listening"), { applied: false, manual_override: true });
  assert.deepEqual(await arbiter.clearManual(), { cleared: true });
  assert.deepEqual(await arbiter.setAutomatic(0, 168, 0, "listening"), { applied: true, manual_override: false });
  assert.deepEqual(writes, [{ red: 120, green: 0, blue: 168 }, { red: 0, green: 168, blue: 0 }]);
});

test("failed or unauthenticated manual writes do not create a sticky override", async () => {
  const dock = { connected: false, async setLed() { throw new Error("not expected"); } };
  const arbiter = new OwnerLedArbiter({ dock });
  await assert.rejects(() => arbiter.setManual(1, 2, 3), /not authenticated/);
  assert.equal(arbiter.manualOverride, null);
  assert.throws(() => arbiter.setAutomatic(169, 0, 0, "invalid"), /0 through 168/);
});
