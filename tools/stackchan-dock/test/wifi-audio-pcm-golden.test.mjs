import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WIFI_AUDIO_MICROPHONE_PCM_BYTES,
  WIFI_AUDIO_UDP_HEADER_BYTES,
  WIFI_AUDIO_UDP_TAG_BYTES,
  deriveUdpSessionKey,
  encodeUdpMicrophonePacket,
  parseUdpMicrophonePacket,
  validateHello,
} from "../src/wifi-audio-receiver.mjs";

const pairingKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const deviceId = "441bf6e278a8";
const nonce = "nonce-for-lossless-golden-gate";
const session = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const sessionKey = deriveUdpSessionKey(pairingKey, session, { deviceId, nonce });

function readPcm16MonoWav(path) {
  const wav = readFileSync(path);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  let format;
  let pcm;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString("ascii", offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= wav.length, `invalid ${id} WAV chunk`);
    if (id === "fmt ") {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bitsPerSample: wav.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      pcm = wav.subarray(start, end);
    }
    offset = end + (length & 1);
  }
  assert.deepEqual(format, { encoding: 1, channels: 1, sampleRate: 24_000, bitsPerSample: 16 });
  assert.ok(pcm?.length > 0);
  return pcm;
}

test("hello accepts only lossless 24 kHz mono 20 ms PCM microphone audio", async () => {
  const hello = {
    type: "hello",
    protocol: 1,
    device_id: deviceId,
    nonce,
    auth: "", // authentication is checked separately by the existing contract tests
    format: { codec: "pcm_s16le", sample_rate: 24_000, channels: 1, frame_ms: 20 },
  };
  const { createHmac } = await import("node:crypto");
  hello.auth = createHmac("sha256", pairingKey).update(`${deviceId}\n${nonce}`).digest("hex");
  assert.deepEqual(validateHello(hello, { pairingKey, expectedDeviceId: deviceId }), { deviceId });
});

test("authenticated UDP preserves the known-clear MIC1 golden PCM byte for byte", () => {
  assert.equal(WIFI_AUDIO_MICROPHONE_PCM_BYTES, 960);
  const golden = readPcm16MonoWav(new URL(
    "../../../docs/research/evidence/rx4-golden-20260806/run2/slot0_mic1-24khz.wav",
    import.meta.url,
  ));
  const rx4 = readFileSync(new URL(
    "../../../docs/research/evidence/rx4-golden-20260806/run2/rx4-interleaved-s16le.pcm",
    import.meta.url,
  ));
  const inputChunkBytes = 240 * 4 * 2;
  assert.equal(rx4.length % inputChunkBytes, 0);
  const extractedChunks = [];
  for (let chunkOffset = 0; chunkOffset < rx4.length; chunkOffset += inputChunkBytes) {
    const mono = Buffer.allocUnsafe(240 * 2);
    for (let sample = 0; sample < 240; sample += 1) {
      rx4.copy(mono, sample * 2, chunkOffset + sample * 8, chunkOffset + sample * 8 + 2);
    }
    extractedChunks.push(mono);
  }
  assert.deepEqual(Buffer.concat(extractedChunks), golden);

  const restored = [];
  let pending = Buffer.alloc(0);
  let sequence = 1;
  for (const chunk of extractedChunks) {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length < WIFI_AUDIO_MICROPHONE_PCM_BYTES) continue;
    const pcm = pending;
    pending = Buffer.alloc(0);
    const packet = encodeUdpMicrophonePacket({
      sequence,
      captureTimeUs: BigInt((sequence - 1) * 20_000),
      pcm,
      session,
      sessionKey,
    });
    assert.equal(packet.length, WIFI_AUDIO_UDP_HEADER_BYTES + WIFI_AUDIO_MICROPHONE_PCM_BYTES + WIFI_AUDIO_UDP_TAG_BYTES);
    const parsed = parseUdpMicrophonePacket(packet, { expectedSession: session, sessionKey });
    assert.deepEqual(parsed.pcm, pcm);
    restored.push(parsed.pcm);
    sequence += 1;
  }
  assert.equal(pending.length, 480, "the 33.43 s fixture intentionally ends with one pending 10 ms chunk");
  assert.deepEqual(Buffer.concat([...restored, pending]), golden);
});
