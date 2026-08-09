#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStackchanMcpServer } from "../src/mcp.mjs";
import { CodexVoiceTranscriptSource } from "../src/codex-voice-transcript-source.mjs";
import { TalkingAnimationController } from "../src/talking-animation-controller.mjs";
import { summarizePcm, WifiAudioReceiver } from "../src/wifi-audio-receiver.mjs";
import { attachVbCableSink } from "../src/wifi-audio-vb-cable.mjs";
import { attachSpeakerPipe } from "../src/wifi-audio-speaker-pipe.mjs";
import { WifiStackchanDock } from "../src/wifi-dock.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const pairingKey = value("--pairing-key", process.env.STACKCHAN_WIFI_PAIRING_KEY);
const port = Number(value("--port", "8765"));
const microphoneEnabledValue = value("--microphone-enabled", undefined);
const mcpStdio = args.includes("--mcp-stdio");
if (!pairingKey || !Number.isInteger(port) || port < 1 || port > 65535 ||
    (microphoneEnabledValue !== undefined && !["true", "false"].includes(microphoneEnabledValue))) {
  throw new Error(
    "Usage: wifi-audio-dock --pairing-key <32+ byte key> [--port 8765] " +
    "[--microphone-enabled true|false] [--mcp-stdio]",
  );
}
const writeDiagnostic = (message) => (mcpStdio ? process.stderr : process.stdout).write(message);
const microphoneEnabled = microphoneEnabledValue === undefined ? undefined : microphoneEnabledValue === "true";
const receiver = new WifiAudioReceiver({ pairingKey });
const dock = new WifiStackchanDock({ receiver });
const talking = new TalkingAnimationController(dock);
const transcriptSource = new CodexVoiceTranscriptSource({
  databasePath: process.env.CODEX_LOGS_DATABASE || undefined,
});
await dock.start();
const sink = attachVbCableSink(receiver, { diagnosticFd: mcpStdio ? 2 : 1 });
const speaker = attachSpeakerPipe(receiver, {
  onDrop: ({ droppedFrames, pendingFrames }) => {
    if (droppedFrames === 1 || droppedFrames % 100 === 0) {
      process.stderr.write(`Speaker pipe dropped_frames=${droppedFrames} pending_frames=${pendingFrames}\n`);
    }
  },
});
let speakerFrames = 0;
let speakerSlowSends = 0;
let speakerMaxSendLatencyMs = 0;
let lastSpeakerActivityFrames = 0;
let lastSpeakerStatusReceivedFrames = 0;
let speakerIdlePolls = 0;
let pcmWindowFrames = 0;
let pcmWindowSamples = 0;
let pcmWindowSumSquares = 0;
let pcmWindowPeak = 0;
let idleGateStatusRequested = false;
receiver.on("authenticated", ({ deviceId }) => {
  writeDiagnostic(`Stack-chan ${deviceId} connected\n`);
});
dock.on("connected", () => {
  const configure = microphoneEnabled === undefined
    ? Promise.resolve()
    : dock.setAudioEndpoints({ microphone_enabled: microphoneEnabled });
  configure
    .then(() => dock.getStatus())
    .then((status) => writeDiagnostic(`Dock status ${JSON.stringify(status)}\n`))
    .catch((error) => process.stderr.write(`Dock status probe failed: ${error.message}\n`));
});
dock.on("state", ({ state }) => talking.handleDeviceState(state));
talking.on("animationError", (error) => {
  process.stderr.write(`Talking lifecycle error: ${error.message}\n`);
});
talking.on("changed", ({ enabled, result }) => {
  writeDiagnostic(`Half-duplex lifecycle ${JSON.stringify({ enabled, phase: result?.phase })}\n`);
});
transcriptSource.on("started", ({ databasePath }) => {
  writeDiagnostic(`Codex Voice lifecycle source ${databasePath}\n`);
});
transcriptSource.on("assistantResponseStarted", () => talking.start());
transcriptSource.on("assistantTextDone", () => talking.stop());
transcriptSource.on("sourceError", (error) => {
  process.stderr.write(`Codex Voice lifecycle source error: ${error.message}\n`);
  talking.stop();
});
receiver.on("audio", ({ pcm }) => {
  const summary = summarizePcm(pcm);
  pcmWindowFrames += 1;
  pcmWindowSamples += summary.samples;
  pcmWindowSumSquares += summary.rms * summary.rms * summary.samples;
  pcmWindowPeak = Math.max(pcmWindowPeak, summary.peak);
  if (!idleGateStatusRequested && receiver.stats.frames >= 5000) {
    idleGateStatusRequested = true;
    dock.getStatus()
      .then((status) => writeDiagnostic(
        `Idle PCM gate ${JSON.stringify({ receiver: receiver.stats, device: status.audio?.microphone_stats })}\n`,
      ))
      .catch((statusError) => process.stderr.write(`Idle PCM gate status probe failed: ${statusError.message}\n`));
  }
  if (receiver.stats.frames !== 1 && pcmWindowFrames < 500) return;
  const rms = Math.sqrt(pcmWindowSumSquares / pcmWindowSamples);
  const stats = receiver.stats;
  writeDiagnostic(
    `PCM frames=${stats.frames} websocket_frames=${stats.websocketMicrophoneFrames} ` +
    `pcm_payload_bytes=${stats.pcmBytes} pcm_bytes=${stats.bytes} ` +
    `peak=${pcmWindowPeak} rms=${rms.toFixed(2)} gaps=${stats.sequenceGaps} ` +
    `duplicates=${stats.duplicateFrames} out_of_order=${stats.outOfOrderFrames} invalid=${stats.invalidFrames}\n`,
  );
  pcmWindowFrames = 0;
  pcmWindowSamples = 0;
  pcmWindowSumSquares = 0;
  pcmWindowPeak = 0;
});
receiver.on("protocolError", (error) => process.stderr.write(`Wi-Fi Audio protocol error: ${error.message}\n`));
receiver.on("connectionDiagnostic", (diagnostic) => {
  writeDiagnostic(`Wi-Fi Audio connection ${JSON.stringify(diagnostic)}\n`);
});
receiver.transport.on("binarySend", ({ latencyMs, error }) => {
  speakerFrames += 1;
  speakerMaxSendLatencyMs = Math.max(speakerMaxSendLatencyMs, latencyMs);
  if (latencyMs >= 20) speakerSlowSends += 1;
  if (error || speakerFrames === 1 || speakerFrames % 100 === 0 || latencyMs >= 100) {
    writeDiagnostic(
      `Speaker TX frames=${speakerFrames} latency_ms=${latencyMs.toFixed(3)} ` +
      `max_latency_ms=${speakerMaxSendLatencyMs.toFixed(3)} slow_sends=${speakerSlowSends}` +
      `${error ? ` error=${error.message}` : ""}\n`,
    );
  }
});
const speakerStatusInterval = setInterval(() => {
  const pipe = speaker.stats;
  if (pipe.receivedFrames !== lastSpeakerActivityFrames) {
    lastSpeakerActivityFrames = pipe.receivedFrames;
    speakerIdlePolls = 0;
    return;
  }
  if (pipe.receivedFrames <= lastSpeakerStatusReceivedFrames || pipe.sending || pipe.pendingFrames > 0) {
    speakerIdlePolls = 0;
    return;
  }
  speakerIdlePolls += 1;
  // Natural speech pauses can exceed one second. Wait for three seconds of a
  // fully drained pipe so this diagnostic request cannot contend with audio.
  if (speakerIdlePolls < 12) return;
  lastSpeakerStatusReceivedFrames = pipe.receivedFrames;
  speakerIdlePolls = 0;
  dock.getStatus()
    .then((status) => writeDiagnostic(
      `Speaker status ${JSON.stringify({ ...status.audio?.speaker_stats, pipe })}\n`,
    ))
    .catch((statusError) => process.stderr.write(`Speaker status probe failed: ${statusError.message}\n`));
}, 250);
dock.on("dockError", (error) => process.stderr.write(`Wi-Fi Dock state error: ${error.message}\n`));
const address = await receiver.listen({ port });
try {
  transcriptSource.start();
} catch (error) {
  // Keep first-frame speaker fallback available if Codex log discovery is
  // unavailable, but report that reply-boundary half duplex is degraded.
  process.stderr.write(`Codex Voice lifecycle unavailable: ${error.message}\n`);
}
let mcpServer = null;
if (mcpStdio) {
  mcpServer = createStackchanMcpServer(dock);
  await mcpServer.connect(new StdioServerTransport());
}
writeDiagnostic(`Listening on ws://${address.host}:${address.port}/stackchan/audio/v1\n`);
writeDiagnostic(`Microphone PCM shares ws://${address.host}:${address.port}/stackchan/audio/v1\n`);
writeDiagnostic(`Speaker PCM pipe ${speaker.path}\n`);
async function stop() {
  clearInterval(speakerStatusInterval);
  transcriptSource.stop();
  await talking.close();
  await mcpServer?.close();
  await dock.stop();
  await speaker.close();
  await sink.close();
  await receiver.close();
}
process.once("SIGINT", () => stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => stop().finally(() => process.exit(0)));
