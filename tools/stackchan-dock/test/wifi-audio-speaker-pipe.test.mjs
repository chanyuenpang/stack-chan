import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { connect } from "node:net";
import test from "node:test";
import WebSocket from "ws";

import { WIFI_AUDIO_FRAME_BYTES, WIFI_AUDIO_SPEAKER_FLAG, WifiAudioReceiver } from "../src/wifi-audio-receiver.mjs";
import { attachSpeakerPipe } from "../src/wifi-audio-speaker-pipe.mjs";

const pairingKey = "0123456789abcdef0123456789abcdef";

async function waitUntil(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached before timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("local speaker pipe forwards one exact PCM frame to the authenticated robot", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\stackchan-speaker-test-${randomUUID()}`
    : `/tmp/stackchan-speaker-test-${randomUUID()}.sock`;
  const speaker = attachSpeakerPipe(receiver, { path: pipePath });
  const robot = new WebSocket(`ws://127.0.0.1:${address.port}`);
  t.after(async () => {
    robot.terminate();
    await speaker.close();
    await receiver.close();
  });
  await new Promise((resolve, reject) => { robot.once("error", reject); robot.once("open", resolve); });
  const deviceId = "test-device";
  const nonce = "speaker-pipe-nonce";
  const auth = createHmac("sha256", pairingKey).update(`${deviceId}\n${nonce}`).digest("hex");
  robot.send(JSON.stringify({ type: "hello", protocol: 1, device_id: deviceId, nonce, auth, format: { codec: "pcm_s16le", sample_rate: 24000, channels: 1, frame_ms: 20 } }));
  await new Promise((resolve) => robot.once("message", resolve));

  const received = new Promise((resolve) => robot.once("message", (message, isBinary) => resolve({ message, isBinary })));
  const writer = connect(pipePath);
  await new Promise((resolve, reject) => { writer.once("error", reject); writer.once("connect", resolve); });
  writer.end(Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, 0x2a));
  const frame = await received;
  assert.equal(frame.isBinary, true);
  assert.equal(Buffer.from(frame.message).readUInt8(1), WIFI_AUDIO_SPEAKER_FLAG);
  assert.deepEqual(Buffer.from(frame.message).subarray(16), Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, 0x2a));
});

test("speaker pipe bounds latency by dropping the oldest pending frames", async (t) => {
  let releaseFirst;
  const firstSend = new Promise((resolve) => { releaseFirst = resolve; });
  const received = [];
  const receiver = {
    async sendSpeakerPcm(frame) {
      received.push(frame[0]);
      if (received.length === 1) await firstSend;
    },
  };
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\stackchan-speaker-bounded-${randomUUID()}`
    : `/tmp/stackchan-speaker-bounded-${randomUUID()}.sock`;
  const speaker = attachSpeakerPipe(receiver, { path: pipePath, maxPendingFrames: 2 });
  t.after(async () => speaker.close());

  const writer = connect(pipePath);
  await new Promise((resolve, reject) => { writer.once("error", reject); writer.once("connect", resolve); });
  writer.end(Buffer.concat([1, 2, 3, 4, 5].map((value) => Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, value))));
  await waitUntil(() => speaker.stats.droppedFrames === 2);
  assert.deepEqual(received, [1]);
  assert.equal(speaker.stats.pendingFrames, 2);
  releaseFirst();
  await waitUntil(() => received.length === 3);
  assert.deepEqual(received, [1, 4, 5]);
  assert.equal(speaker.stats.maxPendingFrames, 2);
});
