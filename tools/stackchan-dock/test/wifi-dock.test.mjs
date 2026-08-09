import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { COMMAND, validateCommand } from "../src/protocol.mjs";
import {
  WIFI_HEAD_MOTION_DISABLED_CODE,
  WifiStackchanDock,
  normalizeWifiStatus,
} from "../src/wifi-dock.mjs";

const wifiStatus = (eventSequence = 0, microphoneEnabled = true) => ({
  device: "stackchan-wifi-companion",
  protocol_version: 1,
  event_sequence: eventSequence,
  sample_rate: 24000,
  audio: {
    microphone_enabled: microphoneEnabled,
    speaker_enabled: true,
    revision: 1,
  },
});

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

class FakeWifiTransport extends EventEmitter {
  connected = true;
  requests = [];
  statuses = [wifiStatus()];

  async request(command, args) {
    validateCommand(command, args);
    this.requests.push({ command, args });
    if (command === COMMAND.GET_STATUS) {
      const status = this.statuses.shift() ?? wifiStatus();
      if (status instanceof Error) throw status;
      return structuredClone(status);
    }
    if (command === COMMAND.SET_AUDIO) {
      return { ...wifiStatus().audio, ...args, revision: 2 };
    }
    if (command === COMMAND.GET_HEAD) return { yaw: 0, pitch: 20 };
    return structuredClone(args);
  }
}

class FakeReceiver extends EventEmitter {
  constructor() {
    super();
    this.transport = new FakeWifiTransport();
  }
}

async function connectedDock(statuses = [wifiStatus()]) {
  const receiver = new FakeReceiver();
  receiver.transport.statuses = [...statuses];
  const dock = new WifiStackchanDock({ receiver });
  await dock.start();
  receiver.emit("authenticated", { deviceId: "stackchan-001", remoteAddress: "192.168.0.2" });
  await waitFor(() => dock.state !== null);
  return { receiver, dock };
}

test("Wi-Fi status is normalized to the existing Dock schema with explicit transport identity", () => {
  const status = normalizeWifiStatus(wifiStatus(7), "stackchan-001");
  assert.equal(status.device, "stackchan-codex-companion");
  assert.equal(status.event_sequence, 7);
  assert.deepEqual(status.connection, {
    transport: "wifi",
    connected: true,
    device_id: "stackchan-001",
  });
  assert.throws(() => normalizeWifiStatus({ ...wifiStatus(), device: "other" }, "stackchan-001"), /incompatible/);
});

test("Wi-Fi Dock retries initial status while the authenticated connection remains open", async () => {
  const { receiver, dock } = await connectedDock([
    new Error("request 1 timed out after 1500 ms"),
    wifiStatus(12),
  ]);
  assert.equal(dock.state.event_sequence, 12);
  assert.equal(
    receiver.transport.requests.filter(({ command }) => command === COMMAND.GET_STATUS).length,
    2,
  );
  await dock.stop();
});

test("Wi-Fi Dock exposes typed methods, tracks independent events, and has no raw request API", async () => {
  const { receiver, dock } = await connectedDock([wifiStatus(10)]);
  assert.equal(dock.state.event_sequence, 10);
  receiver.transport.emit("event", {
    type: "event",
    seq: 11,
    event: "audio_state",
    data: { microphone_enabled: false, speaker_enabled: true, revision: 2 },
  });
  await waitFor(() => dock.state?.event_sequence === 11);
  assert.equal(dock.state.audio.microphone_enabled, false);

  await dock.setAudioEndpoints({ microphone_enabled: true });
  await dock.setExpression("happy");
  await dock.setTalking(true);
  await dock.setLed(1, 2, 3);
  await dock.getHead();
  assert.equal(dock.request, undefined);
  assert.deepEqual(receiver.transport.requests.slice(-5).map(({ command }) => command), [
    "set_audio", "set_expression", "set_talking", "set_led", "get_head",
  ]);
  await dock.stop();
});

test("Wi-Fi Dock rejects head motion before sending anything to the robot", async () => {
  const { receiver, dock } = await connectedDock();
  const requestsBefore = receiver.transport.requests.length;
  await assert.rejects(
    dock.setHead(10, 20, 180),
    (error) => error.code === WIFI_HEAD_MOTION_DISABLED_CODE && /servo power-loss bug/.test(error.message),
  );
  assert.equal(receiver.transport.requests.length, requestsBefore);
  await dock.stop();
});

test("Wi-Fi Dock resynchronizes after an event sequence gap", async () => {
  const { receiver, dock } = await connectedDock([wifiStatus(10), wifiStatus(13, false)]);
  receiver.transport.emit("event", {
    type: "event",
    seq: 12,
    event: "touch",
    data: { gesture: "swipe_backward" },
  });
  await waitFor(() => dock.state?.event_sequence === 13);
  assert.equal(dock.state.audio.microphone_enabled, false);
  assert.equal(receiver.transport.requests.filter(({ command }) => command === COMMAND.GET_STATUS).length, 2);
  await dock.stop();
});
