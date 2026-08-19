import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AttachedDockStatusController, requestLocalDockStatus } from "./local-dock-status-client.mjs";
import { StackchanConsoleController } from "./console-controller.mjs";
import { SpeakerVolumeController } from "./speaker-volume-controller.mjs";
import { SpeakerVolumeState } from "./speaker-volume-state.mjs";
import { SpeakerModeState } from "./speaker-mode-state.mjs";
import { SpeakerModeController } from "./speaker-mode-controller.mjs";
import { createSubtitleTraceSink } from "./subtitle-trace.mjs";
import { CodexVoiceStatusIndicator } from "./codex-voice-status-indicator.mjs";
import { OwnerLedArbiter } from "./owner-led-arbiter.mjs";
import { CodexVoiceTranscriptSource } from "../../stackchan-dock/src/codex-voice-transcript-source.mjs";
import { XiaozhiTranscriptPresenter } from "../../stackchan-dock/src/xiaozhi-transcript-presenter.mjs";
import { XiaozhiLocalAdmin } from "../../stackchan-dock/src/xiaozhi-local-admin.mjs";
import { AudioPerformanceSummaryWriter, isLocalAbsoluteFilePath } from "../../stackchan-dock/src/xiaozhi-audio-performance-summary.mjs";
import { XiaozhiDockRuntime } from "../../stackchan-dock/src/xiaozhi-runtime.mjs";
import { parseLocalDockStartupPrebufferFrames } from "../../stackchan-dock/src/xiaozhi-wasapi-bridge.mjs";
import { HostCpuCorrelationSampler, createWindowsCpuCapture } from "./host-cpu-correlation.mjs";
import { SubtitlePublication } from "./subtitle-publication.mjs";
import { SubtitleVisibilityState } from "./subtitle-visibility-state.mjs";
import { DockEventJournal } from "./dock-event-journal.mjs";
import { installBrokenPipeGuards } from "./broken-pipe-guard.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
let controller = null;
let window = null;
let speakerVolume = null;
let speakerMode = null;
let tray = null;
let quitting = false;
let subtitlePublication = null;
let setSubtitleDeliveryEnabled = null;
let recordOutputPipeEvent = () => {};

installBrokenPipeGuards({
  onClosedPeer: (details) => recordOutputPipeEvent("closed_peer", details),
  onUnexpectedError: (details) => recordOutputPipeEvent("stdio_error", details),
});

function stackchanIcon() {
  return nativeImage.createFromPath(path.join(directory, "stackchan-icon.ico"));
}

function speakerVolumeState() {
  return new SpeakerVolumeState({ filePath: path.join(app.getPath("userData"), "speaker-volume-state.json") });
}

function subtitleVisibilityState() {
  return new SubtitleVisibilityState({ filePath: path.join(app.getPath("userData"), "subtitle-visibility-state.json") });
}

function speakerModeState() {
  return new SpeakerModeState({ filePath: path.join(app.getPath("userData"), "speaker-mode-state.json") });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to start the StackChan Dock runtime`);
  return value;
}

function createController() {
  if (process.env.STACKCHAN_CONSOLE_MODE === "owner") {
    const token = requiredEnvironment("STACKCHAN_XIAOZHI_TOKEN");
    const journal = new DockEventJournal({ filePath: path.join(app.getPath("userData"), "logs", "dock-events.ndjson") });
    recordOutputPipeEvent = (event, details) => journal.write("owner_stdio", event, details);
    journal.write("owner", "starting", { pid: process.pid, mode: "electron_owner" });
    const savedSpeakerVolume = speakerVolumeState().load();
    const runtime = new XiaozhiDockRuntime({
      token, expectedDeviceId: requiredEnvironment("STACKCHAN_DEVICE_ID"),
      advertiseHost: requiredEnvironment("STACKCHAN_DOCK_HOST"), binaryPath: requiredEnvironment("STACKCHAN_WASAPI_BROKER"),
      codexPid: Number(requiredEnvironment("CODEX_ROOT_PID")), renderDevice: process.env.STACKCHAN_RENDER_DEVICE || "CABLE Input",
      outputGainPercent: savedSpeakerVolume > 100 ? savedSpeakerVolume : 100,
      startupPrebufferFrames: parseLocalDockStartupPrebufferFrames(process.env.STACKCHAN_LOCAL_DOCK_STARTUP_PREBUFFER_FRAMES),
    });
    const transcripts = new CodexVoiceTranscriptSource({ trace: process.env.STACKCHAN_SUBTITLE_TRACE === "1" });
    const presenter = new XiaozhiTranscriptPresenter(runtime.server);
    const subtitles = new SubtitlePublication();
    let blackScreenFlightRecord = null;
    const subtitleVisibility = subtitleVisibilityState();
    const subtitleEnabled = subtitleVisibility.load();
    presenter.setEnabled(subtitleEnabled);
    subtitles.setEnabled(subtitleEnabled);
    setSubtitleDeliveryEnabled = (enabled) => {
      const accepted = presenter.setEnabled(enabled);
      subtitleVisibility.save(accepted);
      return subtitles.setEnabled(accepted);
    };
    subtitlePublication = subtitles;
    const subtitleTraceEnabled = process.env.STACKCHAN_SUBTITLE_TRACE === "1";
    const subtitleTrace = createSubtitleTraceSink({
      enabled: subtitleTraceEnabled,
      filePath: process.env.STACKCHAN_SUBTITLE_TRACE_PATH || path.join(directory, "..", "logs", "subtitle-trace-live.ndjson"),
      onError: (error) => console.error("StackChan subtitle trace error:", error.message),
    });
    const audioPerformancePath = process.env.STACKCHAN_AUDIO_PERF_SUMMARY_PATH;
    if (audioPerformancePath && !isLocalAbsoluteFilePath(audioPerformancePath)) {
      throw new Error("STACKCHAN_AUDIO_PERF_SUMMARY_PATH must be an absolute local file path");
    }
    const audioPerformance = audioPerformancePath
      ? new AudioPerformanceSummaryWriter({ filePath: audioPerformancePath })
      : null;
    const cpuCorrelationEnabled = process.env.STACKCHAN_CPU_CORRELATION_DIAGNOSTICS === "1";
    let cpuCorrelation = null;
    let activeTurnId = null;
    let activeSubtitleId = null;
    const ledArbiter = new OwnerLedArbiter({ dock: runtime.dock });
    ledArbiter.on("requested", (details) => journal.write("led", "requested", details));
    ledArbiter.on("applied", (details) => journal.write("led", "applied", details));
    ledArbiter.on("failed", (details) => journal.write("led", "failed", details));
    ledArbiter.on("skipped", (details) => journal.write("led", "skipped", details));
    // The bridge can replace a crashed broker without restarting Electron.
    // Resolve through the runtime on every volume transaction so the renderer
    // never retains a dead broker object.
    const speaker = new SpeakerVolumeController({
      token,
      gain: {
        setOutputGainPercent: async (percent) => {
          await runtime.ensureBroker();
          return runtime.broker.setOutputGainPercent(percent);
        },
      },
      state: speakerVolumeState(),
    });
    speakerVolume = speaker;
    const mode = new SpeakerModeController({ dock: runtime.dock, state: speakerModeState() });
    speakerMode = mode;
    mode.on("state", (details) => {
      journal.write("speaker_mode", details.pending ? "requested" : details.error ? "failed" : "synchronized", details);
      window?.webContents.send("stackchan:speaker-mode", details);
    });
    const recordTrace = (details) => { subtitleTrace.write(details); console.error("StackChan subtitle trace:", JSON.stringify(details)); };
    const voiceStatus = new CodexVoiceStatusIndicator({
      dock: { get connected() { return runtime.dock.connected; }, setLed: (red, green, blue) => ledArbiter.setAutomatic(red, green, blue, "voice_status") },
      transcripts,
      runtime,
      trace: subtitleTraceEnabled ? recordTrace : null,
    });
    const localAdmin = new XiaozhiLocalAdmin({
      dock: runtime.dock, token, ledController: ledArbiter,
      statusProvider: () => ({
        dock: { connected: runtime.dock.connected, device_id: runtime.dock.deviceId, session_id: runtime.dock.sessionId },
        subtitle: subtitles.current,
        black_screen_flight_record: blackScreenFlightRecord,
      }),
    });
    runtime.server.on("mcp", (payload) => {
      if (payload?.method === "notifications/black_screen_flight_record" &&
          payload?.params?.type === "black_screen_flight_record") {
        blackScreenFlightRecord = structuredClone(payload.params);
        console.error("StackChan black-screen flight record:", JSON.stringify(blackScreenFlightRecord));
      }
      if (payload?.method === "notifications/stackchan_input_mute_changed" &&
          typeof payload?.params?.input_muted === "boolean") {
        mode.setInputMuted(payload.params.input_muted);
        journal.write("speaker_mode", "input_mute_changed", { input_muted: payload.params.input_muted });
      }
    });
    runtime.on("authenticated", ({ deviceId, sessionId }) => {
      journal.write("dock_session", "authenticated", { device_id: deviceId, session_id: sessionId });
      mode.sync().catch((error) => journal.write("speaker_mode", "sync_failed", { message: error.message }));
    });
    runtime.on("disconnected", ({ deviceId, code, reason }) => journal.write("dock_session", "disconnected", { device_id: deviceId, close_code: code, close_reason: reason }));
    runtime.on("brokerPreflight", (details) => journal.write("broker", "startup_preflight", details));
    runtime.on("brokerExit", (details) => journal.write("broker", "exit", details));
    runtime.on("brokerReplaced", (details) => journal.write("broker", "replaced", details));
    runtime.on("runtimeError", (error) => journal.write("runtime", "error", error));
    runtime.on("speaking", (speaking) => journal.write("audio_session", speaking ? "speaking_started" : "speaking_stopped"));
    runtime.on("routeEnsure", (details) => journal.write("audio_route", "ensure", details));
    runtime.on("downlinkDropped", (details) => journal.write("audio_session", "downlink_dropped", details));
    if (audioPerformance) {
      runtime.on("authenticated", () => audioPerformance.beginSession());
      runtime.on("disconnected", () => audioPerformance.endSession());
      runtime.on("audioPerformanceSummary", (summary) => audioPerformance.offer(summary));
      audioPerformance.on("error", (error) => console.error("StackChan audio performance write error:", error.message));
      audioPerformance.on("dropped", ({ reason }) => console.error("StackChan audio performance summary dropped:", reason));
    }
    transcripts.on("assistantResponseStarted", ({ turnId }) => {
      activeTurnId = turnId ?? null;
      activeSubtitleId = null;
      subtitles.begin();
      presenter.beginAssistantResponse();
    });
    transcripts.on("assistantTextDelta", ({ text }) => presenter.appendAssistantText(text));
    transcripts.on("assistantTextDone", ({ text }) => {
      presenter.completeAssistantText(text);
      subtitles.complete();
      activeTurnId = null;
      activeSubtitleId = null;
    });
    transcripts.on("sourceError", (error) => console.error("StackChan transcript source error:", error.message));
    presenter.on("presentationError", (error) => console.error("StackChan transcript display error:", error.message));
    presenter.on("presented", (details) => subtitles.publish(details));
    runtime.on("authenticated", () => subtitles.ready());
    runtime.on("disconnected", () => subtitles.unavailable());
    if (subtitleTraceEnabled) {
      transcripts.on("lifecycleTrace", recordTrace);
      presenter.on("subtitleTrace", recordTrace);
      presenter.on("presented", ({ subtitleId }) => {
        if (activeTurnId && activeSubtitleId !== subtitleId) {
          activeSubtitleId = subtitleId;
          recordTrace({ source: "mapping", event: "turn_subtitle_bound", turnId: activeTurnId, subtitleId });
        }
      });
      runtime.server.on("subtitleTrace", recordTrace);
      runtime.server.on("subtitleAck", (details) => recordTrace({ source: "device", event: "subtitle_ack", ...details }));
      runtime.on("brokerPreflight", (details) => recordTrace({ source: "broker", event: "startup_preflight", ...details }));
      runtime.on("diagnostic", (message) => recordTrace({ source: "broker", event: "stderr", message: String(message).slice(-4096) }));
      runtime.on("brokerExit", (details) => recordTrace({ source: "broker", event: "exit", ...details, stderr: String(details?.stderr ?? "").slice(-64 * 1024) }));
      runtime.on("prebufferTiming", (details) => recordTrace({ source: "audio_prebuffer", ...details }));
      runtime.on("authenticated", ({ deviceId, sessionId }) => recordTrace({ source: "dock_session", event: "authenticated", at: Date.now(), device_id: deviceId, session_id: sessionId, voice_phase: voiceStatus.phase }));
      runtime.on("disconnected", ({ deviceId, code, reason }) => recordTrace({ source: "dock_session", event: "disconnected", at: Date.now(), device_id: deviceId, close_code: code, close_reason: reason, voice_phase: voiceStatus.phase }));
    }
    const start = runtime.start.bind(runtime);
    const stop = runtime.stop.bind(runtime);
    runtime.start = async () => {
      const result = await start();
      try { await localAdmin.start(); }
      catch (error) { await stop(); throw error; }
      if (cpuCorrelationEnabled) {
        const brokerPid = runtime.broker.processId;
        if (!Number.isInteger(brokerPid) || brokerPid <= 0) throw new Error("WASAPI broker PID is unavailable for CPU correlation");
        cpuCorrelation = new HostCpuCorrelationSampler({ capture: createWindowsCpuCapture({ chatgptPid: runtime.broker.rootPid, ownerPid: process.pid, brokerPid }) });
        cpuCorrelation.on("sample", recordTrace);
        cpuCorrelation.on("error", (error) => console.error("StackChan CPU correlation error:", error.message));
        runtime.on("brokerDownlinkOpus", () => cpuCorrelation.noteBrokerEmit());
        runtime.on("downlinkOpusSent", () => cpuCorrelation.noteWebSocketSend());
      }
      voiceStatus.attach();
      transcripts.start();
      cpuCorrelation?.start();
      return result;
    };
    runtime.stop = async () => { journal.write("owner", "stopping"); cpuCorrelation?.stop(); voiceStatus.detach(); transcripts.stop(); presenter.dispose(); await localAdmin.stop(); await stop(); await audioPerformance?.close(); await subtitleTrace.close(); journal.write("owner", "stopped"); journal.close(); };
    voiceStatus.on("error", (error) => console.error("StackChan voice status LED error:", error.message));
    return new StackchanConsoleController({ runtime, voiceStatus, ledArbiter, speakerVolume: speaker, subtitlePublication: subtitles });
  }
  const token = requiredEnvironment("STACKCHAN_XIAOZHI_TOKEN");
  return new AttachedDockStatusController({ request: () => requestLocalDockStatus({ token }) });
}

function sendState(state) { window?.webContents.send("stackchan:state", structuredClone(state)); }
function currentSubtitle() { return subtitlePublication?.current ?? { availability: "unavailable", phase: "unavailable", text: "", subtitleId: null, updatedAt: null }; }

async function startController() {
  if (controller) return controller;
  controller = createController();
  controller.on("state", sendState);
  subtitlePublication?.on("update", (subtitle) => window?.webContents.send("stackchan:subtitle", structuredClone(subtitle)));
  await controller.start();
  return controller;
}

function speakerVolumeController() {
  if (!speakerVolume) throw new Error("speaker volume control is unavailable until the Owner runtime starts");
  return speakerVolume;
}

function speakerModeController() {
  if (!speakerMode) throw new Error("speaker mode control is unavailable until the Owner runtime starts");
  return speakerMode;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    icon: stackchanIcon(),
    webPreferences: { preload: path.join(directory, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadFile(path.join(directory, "index.html"));
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
}

function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createTray() {
  tray = new Tray(stackchanIcon());
  tray.setToolTip("StackChan Dock");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示 Dock", click: showWindow },
    { type: "separator" },
    { label: "退出 Dock", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);
}

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  ipcMain.handle("stackchan:get-state", () => controller?.state ?? { health: { runtime: "offline", lastError: "Dock has not started" } });
  ipcMain.handle("stackchan:get-subtitle", currentSubtitle);
  ipcMain.handle("stackchan:set-subtitle-enabled", (_event, enabled) => {
    if (!setSubtitleDeliveryEnabled) throw new Error("subtitle delivery is unavailable until the Owner runtime starts");
    return setSubtitleDeliveryEnabled(enabled);
  });
  ipcMain.handle("stackchan:refresh", async () => {
    const activeController = await startController();
    return typeof activeController.refresh === "function"
      ? activeController.refresh()
      : activeController.dispatch("refresh");
  });
  ipcMain.handle("stackchan:get-speaker-volume", () => speakerVolumeController().get());
  ipcMain.handle("stackchan:set-speaker-volume", (_event, volume) => speakerVolumeController().set(volume));
  ipcMain.handle("stackchan:get-speaker-mode", () => speakerModeController().current);
  ipcMain.handle("stackchan:set-speaker-mode", (_event, enabled) => speakerModeController().set(enabled));
  createWindow();
  createTray();
  startController().catch((error) => sendState({ health: { runtime: "offline", lastError: error.message } }));
});
app.on("before-quit", () => {
  quitting = true;
  return controller?.stop();
});
