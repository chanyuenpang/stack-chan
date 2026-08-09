import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createSocket as createUdpSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import test from "node:test";
import WebSocket from "ws";

import { WIFI_AUDIO_CONTROL_BYTES, WIFI_AUDIO_FRAME_BYTES, WIFI_AUDIO_HEADER_BYTES, WIFI_AUDIO_MICROPHONE_PCM_BYTES, WIFI_AUDIO_PROTOCOL_VERSION, WIFI_AUDIO_SPEAKER_FLAG, WIFI_AUDIO_UDP_MAX_PACKET_BYTES, WifiAudioReceiver, deriveUdpSessionKey, encodeSpeakerFrame, encodeUdpMicrophonePacket, parseAudioFrame, parseUdpMicrophonePacket, summarizePcm, udpReadyProof, validateHello } from "../src/wifi-audio-receiver.mjs";

const pairingKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const deviceId = "441bf6e278a8";
const nonce = "nonce-for-wifi-audio-poc";
const udpContractVector = JSON.parse(readFileSync(new URL("./fixtures/wifi-audio-udp-v1.json", import.meta.url), "utf8"));
const pcm20msFrame = Buffer.from(Array.from(
  { length: WIFI_AUDIO_MICROPHONE_PCM_BYTES },
  (_, index) => index & 0xff,
));

function hello() {
  return { type: "hello", protocol: 1, device_id: deviceId, nonce, auth: createHmac("sha256", pairingKey).update(`${deviceId}\n${nonce}`).digest("hex"), format: { codec: "pcm_s16le", sample_rate: 24000, channels: 1, frame_ms: 20 } };
}

function audioFrame(sequence, payload = pcm20msFrame) {
  const frame = Buffer.alloc(WIFI_AUDIO_HEADER_BYTES + payload.length);
  frame.writeUInt8(WIFI_AUDIO_PROTOCOL_VERSION, 0);
  frame.writeUInt8(2, 1);
  frame.writeUInt32BE(sequence, 2);
  frame.writeBigUInt64BE(123456n, 6);
  frame.writeUInt16BE(payload.length, 14);
  payload.copy(frame, WIFI_AUDIO_HEADER_BYTES);
  return frame;
}

function udpFrame(ready, sequence, payload = pcm20msFrame, captureTimeUs = 123456n) {
  const sessionKey = deriveUdpSessionKey(pairingKey, ready.session, { deviceId, nonce });
  return encodeUdpMicrophonePacket({
    sequence,
    captureTimeUs,
    pcm: payload,
    session: ready.session,
    sessionKey,
  });
}

function sendUdp(socket, packet, port, address = "127.0.0.1") {
  return new Promise((resolve, rejectSend) => socket.send(packet, port, address, (error) => error ? rejectSend(error) : resolve()));
}

function responseFrameOfBytes(targetBytes, { id = 1, prefix = "" } = {}) {
  const value = { v: 1, id, ok: true, result: { runtimeDiagnostic: prefix } };
  const base = JSON.stringify(value);
  const remaining = targetBytes - Buffer.byteLength(base, "utf8");
  assert.ok(remaining >= 0);
  value.result.runtimeDiagnostic += "x".repeat(remaining);
  const frame = JSON.stringify(value);
  assert.equal(Buffer.byteLength(frame, "utf8"), targetBytes);
  return frame;
}

test("hello accepts only the expected authenticated 24 kHz 20 ms PCM format", () => {
  assert.deepEqual(validateHello(hello(), { pairingKey, expectedDeviceId: deviceId }), { deviceId });
  assert.throws(() => validateHello({ ...hello(), auth: "0".repeat(64) }, { pairingKey }), /invalid hello auth/);
});

test("audio frame parser rejects malformed frames without exposing a payload", () => {
  assert.deepEqual(parseAudioFrame(audioFrame(1)).pcm, pcm20msFrame);
  assert.throws(() => parseAudioFrame(audioFrame(2, Buffer.alloc(958, 0x01))), /invalid audio frame length/);
  assert.throws(() => parseAudioFrame(audioFrame(3, Buffer.alloc(962, 0x01))), /invalid audio frame length/);
  assert.throws(() => parseAudioFrame(Buffer.alloc(1)), /invalid audio frame length/);
});

test("UDP PCM packet is session-bound, authenticated, and below the no-fragment boundary", () => {
  const session = Buffer.from(udpContractVector.sessionHex, "hex");
  const sessionKey = deriveUdpSessionKey(pairingKey, session, { deviceId, nonce });
  assert.equal(pairingKey, udpContractVector.pairingKey);
  assert.equal(deviceId, udpContractVector.deviceId);
  assert.equal(nonce, udpContractVector.nonce);
  assert.equal(sessionKey.toString("hex"), udpContractVector.sessionKeyHex);
  assert.equal(udpReadyProof(pairingKey, { deviceId, nonce, port: udpContractVector.port, session }), udpContractVector.readyProofHex);
  const vectorPcm = Buffer.from(Array.from({ length: udpContractVector.pcmBytes }, (_, index) => index & 0xff));
  const vectorPacket = encodeUdpMicrophonePacket({ sequence: udpContractVector.sequence, captureTimeUs: BigInt(udpContractVector.captureTimeUs), pcm: vectorPcm, session, sessionKey });
  assert.equal(vectorPacket.length, udpContractVector.packetBytes);
  assert.equal(createHash("sha256").update(vectorPacket).digest("hex"), udpContractVector.packetSha256);
  const packet = encodeUdpMicrophonePacket({ sequence: 7, captureTimeUs: 1234n, pcm: pcm20msFrame, session, sessionKey });
  assert.ok(packet.length <= WIFI_AUDIO_UDP_MAX_PACKET_BYTES);
  assert.deepEqual(parseUdpMicrophonePacket(packet, { expectedSession: session, sessionKey }), {
    sequence: 7,
    captureTimeUs: 1234n,
    pcm: pcm20msFrame,
  });
  const tampered = Buffer.from(packet);
  tampered[36] ^= 0x01;
  assert.throws(() => parseUdpMicrophonePacket(tampered, { expectedSession: session, sessionKey }), /authentication/);
  assert.throws(() => parseUdpMicrophonePacket(packet, { expectedSession: Buffer.alloc(16, 0xff), sessionKey }), /stale UDP session/);
  assert.throws(() => parseUdpMicrophonePacket(packet.subarray(0, packet.length - 1), { expectedSession: session, sessionKey }), /packet|header/);
  assert.equal(packet.length, 1012);
  assert.ok(packet.length <= WIFI_AUDIO_UDP_MAX_PACKET_BYTES);
  assert.throws(() => encodeUdpMicrophonePacket({ sequence: 9, captureTimeUs: 1n, pcm: Buffer.alloc(WIFI_AUDIO_MICROPHONE_PCM_BYTES + 2), session, sessionKey }), /payload length/);
});

test("speaker frame encoder marks an exact 10 ms downlink frame", () => {
  const pcm = Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, 0x5a);
  const frame = encodeSpeakerFrame(pcm, 7, 1234n);
  assert.equal(frame.length, WIFI_AUDIO_HEADER_BYTES + WIFI_AUDIO_FRAME_BYTES);
  assert.equal(frame.readUInt8(1), WIFI_AUDIO_SPEAKER_FLAG);
  assert.equal(frame.readUInt32BE(2), 7);
  assert.equal(frame.readBigUInt64BE(6), 1234n);
  assert.deepEqual(frame.subarray(WIFI_AUDIO_HEADER_BYTES), pcm);
  assert.throws(() => encodeSpeakerFrame(Buffer.alloc(2), 1), /exactly one 10 ms frame/);
});

test("PCM summary reports samples, peak, and RMS without retaining audio", () => {
  const pcm = Buffer.alloc(8);
  pcm.writeInt16LE(-100, 0);
  pcm.writeInt16LE(100, 2);
  const summary = summarizePcm(pcm);
  assert.equal(summary.samples, 4);
  assert.equal(summary.peak, 100);
  assert.ok(Math.abs(summary.rms - Math.sqrt(5000)) < 0.001);
});

test("receiver authenticates, emits lossless UDP PCM, routes WebSocket Dock commands, and records sequence gaps", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const udp = createUdpSocket("udp4");
  const receivedAudio = [];
  const audio = new Promise((resolve) => receiver.on("audio", (frame) => {
    receivedAudio.push(frame);
    if (receivedAudio.length === 2) resolve();
  }));
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  t.after(async () => {
    udp.close();
    socket.terminate();
    await receiver.close();
  });
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.once("open", resolve); });
  socket.send(JSON.stringify(hello()));
  const ready = JSON.parse(await new Promise((resolve) => socket.once("message", (message) => resolve(String(message)))));
  assert.equal(ready.microphone_transport.type, "udp");
  assert.equal(ready.microphone_transport.port, address.udpPort);
  assert.match(ready.microphone_transport.session, /^[a-f0-9]{32}$/);
  assert.equal(ready.microphone_transport.proof, udpReadyProof(pairingKey, {
    deviceId,
    nonce,
    port: ready.microphone_transport.port,
    session: ready.microphone_transport.session,
  }));
  const speakerMessage = new Promise((resolve) => socket.once("message", (message, isBinary) => resolve({ message, isBinary })));
  const sentSpeaker = receiver.sendSpeakerPcm(Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, 0x33));
  const speaker = await speakerMessage;
  assert.equal(speaker.isBinary, true);
  assert.equal(Buffer.from(speaker.message).readUInt8(1), WIFI_AUDIO_SPEAKER_FLAG);
  assert.deepEqual(await sentSpeaker, { sequence: 1 });
  const command = new Promise((resolve) => socket.once("message", (message) => resolve(JSON.parse(message))));
  const result = receiver.transport.request("get_status", {});
  assert.deepEqual(await command, { v: 1, id: 1, cmd: "get_status", args: {} });
  assert.equal(WIFI_AUDIO_CONTROL_BYTES, 1500);
  const statusFrame = responseFrameOfBytes(1172, { prefix: "你" });
  socket.send(statusFrame);
  assert.deepEqual(await result, JSON.parse(statusFrame).result);
  const orphanResponse = new Promise((resolve) => receiver.transport.once("orphanResponse", resolve));
  receiver.transport.receive(responseFrameOfBytes(WIFI_AUDIO_CONTROL_BYTES, { id: 99, prefix: "你" }));
  assert.equal((await orphanResponse).id, 99);
  const protocolError = new Promise((resolve) => receiver.transport.once("protocolError", resolve));
  receiver.transport.receive(responseFrameOfBytes(WIFI_AUDIO_CONTROL_BYTES + 1, { prefix: "你" }));
  assert.match((await protocolError).message, /frame exceeds 1500 bytes/);
  await sendUdp(udp, udpFrame(ready.microphone_transport, 1), ready.microphone_transport.port);
  await sendUdp(udp, udpFrame(ready.microphone_transport, 3), ready.microphone_transport.port);
  await audio;
  assert.deepEqual(receivedAudio.map((frame) => frame.sequence), [1, 3]);
  assert.deepEqual(receiver.stats, {
    connections: 1,
    authenticatedConnections: 1,
    rejectedConnections: 0,
    frames: 2,
    udpPackets: 2,
    udpMicrophoneFrames: 2,
    udpRejectedPackets: 0,
    udpAuthenticationFailures: 0,
    udpSourceMismatches: 0,
    staleSessionPackets: 0,
    legacyWebsocketMicrophoneFrames: 0,
    pcmBytes: pcm20msFrame.length * 2,
    bytes: pcm20msFrame.length * 2,
    sequenceGaps: 1,
    duplicateFrames: 0,
    outOfOrderFrames: 0,
    invalidFrames: 0,
    reconnects: 0,
  });
});

test("receiver drops duplicate, out-of-order, tampered, and stale UDP microphone packets without closing control", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const udp = createUdpSocket("udp4");
  const otherUdp = createUdpSocket("udp4");
  t.after(async () => {
    udp.close();
    otherUdp.close();
    socket.terminate();
    await receiver.close();
  });
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.once("open", resolve); });
  socket.send(JSON.stringify(hello()));
  const ready = JSON.parse(await new Promise((resolve) => socket.once("message", (message) => resolve(String(message)))));
  assert.equal(ready.microphone_transport.type, "udp");
  const transport = ready.microphone_transport;
  const firstAudio = new Promise((resolve) => receiver.once("audio", resolve));
  await sendUdp(udp, udpFrame(transport, 5), transport.port);
  await firstAudio;
  await sendUdp(udp, udpFrame(transport, 5), transport.port);
  await sendUdp(udp, udpFrame(transport, 4), transport.port);
  const tampered = udpFrame(transport, 6);
  tampered[36] ^= 1;
  await sendUdp(udp, tampered, transport.port);
  const stale = { ...transport, session: "ff".repeat(16) };
  await sendUdp(udp, udpFrame(stale, 7), transport.port);
  await sendUdp(otherUdp, udpFrame(transport, 6), transport.port);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(receiver.stats.frames, 1);
  assert.equal(receiver.stats.udpMicrophoneFrames, 1);
  assert.equal(receiver.stats.duplicateFrames, 1);
  assert.equal(receiver.stats.outOfOrderFrames, 1);
  assert.equal(receiver.stats.invalidFrames, 2);
  assert.equal(receiver.stats.udpAuthenticationFailures, 1);
  assert.equal(receiver.stats.staleSessionPackets, 1);
  assert.equal(receiver.stats.udpSourceMismatches, 1);
  assert.equal(receiver.transport.connected, true);
});

test("legacy WebSocket microphone binary is rejected and cannot bypass the UDP session", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  t.after(async () => {
    socket.terminate();
    await receiver.close();
  });
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.once("open", resolve); });
  socket.send(JSON.stringify(hello()));
  await new Promise((resolve) => socket.once("message", resolve));
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.send(audioFrame(1));
  await closed;
  assert.equal(receiver.stats.frames, 0);
  assert.equal(receiver.stats.legacyWebsocketMicrophoneFrames, 1);
  assert.equal(receiver.stats.invalidFrames, 1);
});

test("receiver sustains 5000 authenticated UDP PCM frames while a WebSocket control request completes", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const udp = createUdpSocket("udp4");
  t.after(async () => {
    udp.close();
    socket.terminate();
    await receiver.close();
  });
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.once("open", resolve); });
  socket.send(JSON.stringify(hello()));
  const ready = JSON.parse(String(await new Promise((resolve) => socket.once("message", resolve)))).microphone_transport;

  let receivedFrames = 0;
  const allAudio = new Promise((resolve) => receiver.on("audio", () => {
    receivedFrames += 1;
    if (receivedFrames === 5000) resolve();
  }));
  const sendBatch = async (first, last) => {
    for (let batchStart = first; batchStart <= last; batchStart += 10) {
      const batchEnd = Math.min(last, batchStart + 9);
      await Promise.all(Array.from(
        { length: batchEnd - batchStart + 1 },
        (_, index) => sendUdp(udp, udpFrame(ready, batchStart + index), ready.port),
      ));
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  await sendBatch(1, 2500);
  const command = new Promise((resolve) => socket.once("message", (message) => resolve(JSON.parse(String(message)))));
  const status = receiver.transport.request("get_status", {});
  const request = await command;
  assert.deepEqual(request, { v: 1, id: 1, cmd: "get_status", args: {} });
  socket.send(JSON.stringify({ v: 1, id: request.id, ok: true, result: { ready: true } }));
  assert.deepEqual(await status, { ready: true });

  await sendBatch(2501, 5000);
  let pressureTimeout;
  await Promise.race([
    allAudio,
    new Promise((_, reject) => {
      pressureTimeout = setTimeout(() => reject(new Error("5000-frame pressure gate timed out")), 10000);
    }),
  ]);
  clearTimeout(pressureTimeout);
  assert.deepEqual(receiver.stats, {
    connections: 1,
    authenticatedConnections: 1,
    rejectedConnections: 0,
    frames: 5000,
    udpPackets: 5000,
    udpMicrophoneFrames: 5000,
    udpRejectedPackets: 0,
    udpAuthenticationFailures: 0,
    udpSourceMismatches: 0,
    staleSessionPackets: 0,
    legacyWebsocketMicrophoneFrames: 0,
    pcmBytes: pcm20msFrame.length * 5000,
    bytes: pcm20msFrame.length * 5000,
    sequenceGaps: 0,
    duplicateFrames: 0,
    outOfOrderFrames: 0,
    invalidFrames: 0,
    reconnects: 0,
  });
});

test("a newly authenticated robot replaces and closes the previous connection", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const sockets = [];
  const udp = createUdpSocket("udp4");
  t.after(async () => {
    udp.close();
    for (const socket of sockets) socket.terminate();
    await receiver.close();
  });

  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once("error", reject); socket.once("open", resolve); });
    socket.send(JSON.stringify(hello()));
    const ready = JSON.parse(String(await new Promise((resolve) => socket.once("message", resolve))));
    return { socket, ready: ready.microphone_transport };
  };

  const first = await connect();
  const firstClosed = new Promise((resolve) => first.socket.once("close", resolve));
  const second = await connect();
  await Promise.race([
    firstClosed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("previous robot connection remained open")), 500)),
  ]);

  assert.notEqual(first.ready.session, second.ready.session);
  await sendUdp(udp, udpFrame(first.ready, 1), first.ready.port);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(receiver.stats.staleSessionPackets, 1);
  const newAudio = new Promise((resolve) => receiver.once("audio", resolve));
  await sendUdp(udp, udpFrame(second.ready, 1), second.ready.port);
  assert.equal((await newAudio).sequence, 1);

  const speakerMessage = new Promise((resolve) => second.socket.once("message", (message, isBinary) => resolve({ message, isBinary })));
  await receiver.sendSpeakerPcm(Buffer.alloc(WIFI_AUDIO_FRAME_BYTES, 0x44));
  const speaker = await speakerMessage;
  assert.equal(speaker.isBinary, true);
  assert.equal(Buffer.from(speaker.message).readUInt8(1), WIFI_AUDIO_SPEAKER_FLAG);
  assert.equal(receiver.transport.connected, true);
  assert.equal(receiver.stats.reconnects, 1);
});

test("simultaneous robot authentication leaves exactly one lossless audio owner", async (t) => {
  const receiver = new WifiAudioReceiver({ pairingKey, expectedDeviceId: deviceId });
  const address = await receiver.listen({ host: "127.0.0.1" });
  const udp = createUdpSocket("udp4");
  const sockets = [
    new WebSocket(`ws://127.0.0.1:${address.port}`),
    new WebSocket(`ws://127.0.0.1:${address.port}`),
  ];
  t.after(async () => {
    udp.close();
    for (const socket of sockets) socket.terminate();
    await receiver.close();
  });
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.once("open", resolve);
  })));
  let authenticated = 0;
  const ownerAuthenticated = new Promise((resolve) => receiver.on("authenticated", () => {
    authenticated += 1;
    resolve();
  }));
  const readyMessages = sockets.map((socket) => new Promise((resolve) => socket.once("message", (message) => resolve(JSON.parse(String(message))))));
  sockets[0].send(JSON.stringify(hello()));
  sockets[1].send(JSON.stringify(hello()));
  await ownerAuthenticated;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(authenticated >= 1);
  assert.equal(receiver.stats.authenticatedConnections, authenticated);

  const owner = sockets.find((socket) => socket.readyState === socket.OPEN);
  assert.ok(owner, "one authenticated socket remains open");
  const ownerIndex = sockets.indexOf(owner);
  const ready = (await readyMessages[ownerIndex]).microphone_transport;
  const audio = new Promise((resolve) => receiver.once("audio", resolve));
  await sendUdp(udp, udpFrame(ready, 1), ready.port);
  assert.equal((await audio).sequence, 1);
  assert.equal(receiver.stats.frames, 1);
});
