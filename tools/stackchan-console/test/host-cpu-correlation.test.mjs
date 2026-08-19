import assert from "node:assert/strict";
import test from "node:test";
import { HostCpuCorrelationSampler, parseHostCpuCorrelationSnapshot } from "../src/host-cpu-correlation.mjs";

test("CPU sampler rejects malformed snapshots", () => {
  assert.throws(() => parseHostCpuCorrelationSnapshot({ system: 1, cores: [], chatgpt: 1, owner: 1 }), /broker/);
  assert.throws(() => parseHostCpuCorrelationSnapshot({ system: 1, cores: [-1], chatgpt: 1, owner: 1, broker: 1 }), /cores/);
});

test("CPU sampler emits numeric CPU and per-window cadence only", async () => {
  const sampler = new HostCpuCorrelationSampler({ capture: async () => ({ system: 22, cores: [10, 34], chatgpt: 4, owner: 2, broker: 1 }) });
  sampler.noteBrokerEmit(); sampler.noteBrokerEmit(); sampler.noteWebSocketSend();
  const sample = await new Promise((resolve, reject) => { sampler.once("sample", resolve); sampler.once("error", reject); sampler.start(); });
  sampler.stop();
  assert.deepEqual(sample, { source: "host_cpu", at: sample.at, interval_ms: 5_000, system: 22, cores: [10, 34], chatgpt: 4, owner: 2, broker: 1, broker_emit_count: 2, ws_send_count: 1 });
  assert.ok(Number.isSafeInteger(sample.at));
});
