import { execFile, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";

export const WASAPI_BROKER_MAX_PACKET_BYTES = 1_500;
export const LOCAL_DOCK_STARTUP_PREBUFFER_MAX_FRAMES = 17;
export const LOCAL_DOCK_STARTUP_PREBUFFER_TELEMETRY_VERSION = 1;
export const LOCAL_DOCK_STARTUP_PREBUFFER_MAX_DELAY_MS = 1_000;
export const LOCAL_DOCK_PREBUFFER_PACED_FRAME_MS = 60;
export const LOCAL_DOCK_PREBUFFER_MAX_WS_BUFFERED_BYTES = WASAPI_BROKER_MAX_PACKET_BYTES * 2;
const PREBUFFER_EVENT_STARTED = 1;
const PREBUFFER_EVENT_FILL = 2;
const PREBUFFER_EVENT_RELEASED = 3;
const PREBUFFER_EVENT_CLEARED = 4;
const PREBUFFER_REASON_NONE = 0;
const PREBUFFER_REASON_THRESHOLD = 1;
const PREBUFFER_REASON_ACTIVITY_STOP = 2;
const PREBUFFER_REASON_DISCONNECTED = 3;
const PREBUFFER_REASON_DETACHED = 4;
const PREBUFFER_REASON_MAX_DELAY = 5;
const BROKER_ROUTE = Buffer.from("STACKCHAN:route");
const BROKER_RESTORE_ROUTE = Buffer.from("STACKCHAN:restore_route");
const BROKER_OUTPUT_GAIN_PREFIX = "STACKCHAN:output_gain_percent=";
const ROUTE_RETRY_DELAYS_MS = Object.freeze([100, 250, 500, 1_000]);
const AUDIO_SERVICE_ARGUMENT = /(?:^|\s)--utility-sub-type=audio\.mojom\.AudioService(?:\s|$)/i;

export function parseLocalDockStartupPrebufferFrames(value) {
  if (value === undefined || value === "") return 0;
  if (typeof value !== "string") throw new TypeError("startup prebuffer environment value must be a string");
  if (!/^(?:0|[1-9]|1[0-7])$/.test(value)) {
    throw new RangeError(`startup prebuffer frames must be an integer in range 0..${LOCAL_DOCK_STARTUP_PREBUFFER_MAX_FRAMES}`);
  }
  return Number(value);
}

export async function resolveCurrentChatGptRootPid({ execFileImpl = execFile } = {}) {
  const script = "$p=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '(^|\\s)--type='} | Select-Object ProcessId,CommandLine; $p | ConvertTo-Json -Compress";
  const output = await new Promise((resolve, reject) => {
    execFileImpl("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`ChatGPT root lookup failed: ${stderr || error.message}`));
      else resolve(String(stdout));
    });
  });
  const parsed = JSON.parse(output || "null");
  const roots = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  if (roots.length !== 1 || !Number.isInteger(roots[0]?.ProcessId) || roots[0].ProcessId <= 0) {
    throw new Error(`ChatGPT root lookup is ambiguous: count=${roots.length}`);
  }
  return roots[0].ProcessId;
}

// This is deliberately diagnostic-only. The broker continues to capture the
// configured root process tree and receives that same root PID for routing.
// A caller must explicitly opt into any future policy-target change after a
// separate HIL proves that this candidate owns the relevant render session.
export function selectAudioPolicyTargetCandidate(rootPid, processes) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) throw new TypeError("rootPid must be a positive integer");
  if (!Array.isArray(processes)) throw new TypeError("processes must be an array");

  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!Number.isInteger(process?.processId) || !Number.isInteger(process?.parentProcessId)) continue;
      if (descendants.has(process.parentProcessId) && !descendants.has(process.processId)) {
        descendants.add(process.processId);
        changed = true;
      }
    }
  }

  const candidates = processes
    .filter((process) => descendants.has(process?.processId))
    .filter((process) => typeof process.commandLine === "string" && AUDIO_SERVICE_ARGUMENT.test(process.commandLine))
    .map((process) => ({ pid: process.processId, parentPid: process.parentProcessId, name: process.name ?? null }));
  if (candidates.length !== 1) {
    return {
      status: candidates.length === 0 ? "not_found" : "ambiguous",
      rootPid,
      candidates,
      audioSessionEvidence: "none",
    };
  }
  return {
    status: "selected",
    rootPid,
    ...candidates[0],
    selectionReason: "descendant Chromium AudioService command line",
    // A process role is observable evidence of the audio service, not proof of
    // a live render session. A future route change needs HIL confirmation.
    audioSessionEvidence: "process_role_only",
  };
}

export function encodeBrokerPacket(packet) {
  const payload = Buffer.from(packet ?? []);
  if (payload.length > WASAPI_BROKER_MAX_PACKET_BYTES) {
    throw new RangeError("WASAPI broker packet exceeds 1500 bytes");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class BrokerPacketParser {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (incoming.length === 0) return [];
    this.#buffer = this.#buffer.length === 0 ? incoming : Buffer.concat([this.#buffer, incoming]);
    const packets = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length > WASAPI_BROKER_MAX_PACKET_BYTES) {
        throw new RangeError("WASAPI broker packet exceeds 1500 bytes");
      }
      if (this.#buffer.length < 4 + length) break;
      packets.push(this.#buffer.subarray(4, 4 + length));
      this.#buffer = this.#buffer.subarray(4 + length);
    }
    return packets;
  }

  finish() {
    if (this.#buffer.length !== 0) throw new Error("truncated WASAPI broker frame");
  }
}

export class XiaozhiWasapiBroker extends EventEmitter {
  #binaryPath;
  #pid;
  #renderDevice;
  #outputGainPercent;
  #spawn;
  #child = null;
  #parser = new BrokerPacketParser();
  #stderr = "";

  constructor({ binaryPath, pid, renderDevice = "CABLE Input", outputGainPercent = 100, spawnImpl = spawn } = {}) {
    super();
    if (typeof binaryPath !== "string" || binaryPath.length === 0) throw new TypeError("binaryPath is required");
    if (!Number.isInteger(pid) || pid <= 0) throw new TypeError("pid must be a positive integer");
    if (typeof renderDevice !== "string" || renderDevice.length === 0) throw new TypeError("renderDevice is required");
    if (!Number.isInteger(outputGainPercent) || outputGainPercent < 100 || outputGainPercent > 150) throw new RangeError("output gain percent must be an integer in range 100..150");
    if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
    this.#binaryPath = binaryPath;
    this.#pid = pid;
    this.#renderDevice = renderDevice;
    this.#outputGainPercent = outputGainPercent;
    this.#spawn = spawnImpl;
  }

  get running() {
    return this.#child !== null && this.#child.exitCode === null;
  }

  get rootPid() { return this.#pid; }
  get processId() { return this.#child?.pid ?? null; }

  get stderr() {
    return this.#stderr;
  }

  start() {
    if (this.#child) throw new Error("WASAPI broker is already started");
    let pidAlive = true;
    let pidError = null;
    try { process.kill(this.#pid, 0); }
    catch (error) { pidAlive = false; pidError = error?.message ?? String(error); }
    // This is diagnostic-only.  Do not treat a live process as proof that it
    // owns an audio session, and do not alter routing here.  The broker's
    // subsequent ready/stderr output is the authority for WASAPI readiness.
    this.emit("startupPreflight", {
      pid: this.#pid,
      pidAlive,
      pidError,
      audioSession: "unobservable",
      renderDevice: this.#renderDevice,
    });
    this.#stderr = "";
    const child = this.#spawn(this.#binaryPath, [
      "--pid", String(this.#pid),
      "--render-device", this.#renderDevice,
      "--output-gain-percent", String(this.#outputGainPercent),
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.#child = child;
    child.stdout.on("data", (chunk) => {
      try {
        for (const packet of this.#parser.push(chunk)) {
          if (packet.length === 0) this.emit("activityStop");
          else this.emit("downlinkOpus", Buffer.from(packet));
        }
      } catch (error) {
        this.emit("error", error);
        child.kill();
      }
    });
    child.stdout.on("end", () => {
      try {
        this.#parser.finish();
      } catch (error) {
        this.emit("error", error);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = Buffer.from(chunk).toString("utf8");
      this.#stderr = (this.#stderr + text).slice(-64 * 1024);
      this.emit("diagnostic", text);
      if (this.#stderr.includes("WASAPI capture ready") && this.#stderr.includes("WASAPI render ready")) {
        this.emit("ready", { pid: this.#pid });
      }
    });
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => {
      this.#child = null;
      this.emit("exit", { code, signal, stderr: this.#stderr });
    });
    return child;
  }

  async writeMicrophoneOpus(opus) {
    const packet = Buffer.from(opus ?? []);
    if (packet.length === 0) throw new TypeError("microphone Opus packet must not be empty");
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) throw new Error("WASAPI broker is not running");
    if (!child.stdin.write(encodeBrokerPacket(packet))) await once(child.stdin, "drain");
  }

  async setCodexOutputRouted(routed) {
    if (typeof routed !== "boolean") throw new TypeError("routed must be a boolean");
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) throw new Error("WASAPI broker is not running");
    if (!child.stdin.write(encodeBrokerPacket(routed ? BROKER_ROUTE : BROKER_RESTORE_ROUTE))) await once(child.stdin, "drain");
  }

  async setOutputGainPercent(percent) {
    if (!Number.isInteger(percent) || percent < 100 || percent > 150) throw new RangeError("output gain percent must be an integer in range 100..150");
    const child = this.#child;
    if (!child || child.exitCode !== null || child.stdin.destroyed) throw new Error("WASAPI broker is not running");
    this.#outputGainPercent = percent;
    if (!child.stdin.write(encodeBrokerPacket(Buffer.from(`${BROKER_OUTPUT_GAIN_PREFIX}${percent}`, "ascii")))) await once(child.stdin, "drain");
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    const exited = once(child, "exit");
    child.stdin.end();
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!graceful && child.exitCode === null) {
      child.kill();
      await exited;
    }
  }
}

export class XiaozhiWasapiBridge extends EventEmitter {
  #server;
  #broker;
  #speaking = false;
  #listeners = [];
  #routeRetryTimers = new Set();
  #brokerListeners = [];
  #resolveRootPid;
  #brokerFactory;
  #replacement = null;
  #startupPrebufferFrames;
  #startupBuffer = [];
  #prebufferFirstFrameAtMs = 0;
  #prebufferSegmentSeq = 0;
  #activePrebufferSegmentSeq = 0;
  #now;
  #setTimeout;
  #clearTimeout;
  #startupPrebufferTimer = null;
  #pacedQueue = [];
  #pacedSendInFlight = false;
  #pacedPumpTimer = null;
  #pendingStop = false;
  #playbackGeneration = 0;

  constructor({
    server,
    broker,
    resolveRootPid = async () => broker.rootPid,
    brokerFactory = null,
    startupPrebufferFrames = 0,
    now = Date.now,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {}) {
    super();
    if (!server || typeof server.sendDownlinkOpus !== "function") throw new TypeError("server is required");
    if (!broker || typeof broker.writeMicrophoneOpus !== "function" || typeof broker.setCodexOutputRouted !== "function") throw new TypeError("broker is required");
    this.#server = server;
    this.#broker = broker;
    if (typeof resolveRootPid !== "function") throw new TypeError("resolveRootPid must be a function");
    if (brokerFactory !== null && typeof brokerFactory !== "function") throw new TypeError("brokerFactory must be a function or null");
    if (!Number.isInteger(startupPrebufferFrames)) throw new TypeError("startupPrebufferFrames must be an integer");
    if (startupPrebufferFrames < 0 || startupPrebufferFrames > LOCAL_DOCK_STARTUP_PREBUFFER_MAX_FRAMES) {
      throw new RangeError(`startupPrebufferFrames must be in range 0..${LOCAL_DOCK_STARTUP_PREBUFFER_MAX_FRAMES}`);
    }
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof setTimeoutImpl !== "function" || typeof clearTimeoutImpl !== "function") {
      throw new TypeError("timer dependencies must be functions");
    }
    this.#resolveRootPid = resolveRootPid;
    this.#brokerFactory = brokerFactory;
    this.#startupPrebufferFrames = startupPrebufferFrames;
    this.#now = now;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
  }

  get broker() { return this.#broker; }

  attach() {
    if (this.#listeners.length > 0) throw new Error("WASAPI bridge is already attached");
    // A previous Dock can be terminated before it closes the broker. Clear any
    // persisted route before accepting a new robot connection.
    this.#broker.setCodexOutputRouted(false).catch((error) => this.emit("error", error));
    this.#listen(this.#server, "microphoneOpus", ({ opus }) => {
      this.#broker.writeMicrophoneOpus(opus).catch((error) => this.emit("error", error));
    });
    this.#listen(this.#server, "authenticated", () => {
      this.#ensureOutputRoute("authenticated");
      this.#scheduleRouteRetries();
    });
    this.#listen(this.#server, "disconnected", () => {
      this.#clearRouteRetries();
      this.#resetPlayback(PREBUFFER_REASON_DISCONNECTED);
      this.#broker.setCodexOutputRouted(false).catch((error) => this.emit("error", error));
    });
    this.#bindBroker(this.#broker);
    return this;
  }

  #bindBroker(broker) {
    this.#listenBroker(broker, "startupPreflight", (details) => this.emit("brokerPreflight", details));
    this.#listenBroker(broker, "diagnostic", (message) => this.emit("brokerDiagnostic", message));
    this.#listenBroker(broker, "error", (error) => this.emit("brokerError", error));
    this.#listenBroker(broker, "exit", (details) => {
      this.emit("brokerExit", details);
      // A broker can be terminated independently of Electron (for example by
      // an audio-device reset).  The authenticated Dock remains the owner, so
      // restore its child instead of leaving microphone, audio routing, and
      // volume IPC permanently bound to a dead process.
      if (this.#server.connected === true) this.#ensureOutputRoute("broker_exit");
    });
    this.#listenBroker(broker, "downlinkOpus", (opus) => {
      try {
        this.#onDownlinkOpus(opus);
      } catch (error) {
        this.emit("error", error);
      }
    });
    this.#listenBroker(broker, "activityStop", () => {
      if (!this.#speaking && this.#startupBuffer.length === 0 && this.#pacedQueue.length === 0) return;
      try {
        if (this.#startupPrebufferFrames > 0) {
          this.#pendingStop = true;
          if (!this.#speaking) this.#releaseStartupPrebuffer(PREBUFFER_REASON_ACTIVITY_STOP);
          this.#pumpPacedQueue();
          return;
        }
        this.#server.sendTtsStop();
      } catch (error) {
        this.emit("error", error);
      } finally {
        if (this.#startupPrebufferFrames === 0) {
          this.#resetPlayback();
          this.emit("speaking", false);
        }
      }
    });
  }

  detach() {
    for (const [emitter, event, listener] of this.#listeners) emitter.off(event, listener);
    this.#listeners = [];
    this.#unbindBroker();
    this.#clearRouteRetries();
    this.#broker.setCodexOutputRouted(false).catch((error) => this.emit("error", error));
    this.#resetPlayback(PREBUFFER_REASON_DETACHED);
  }

  #listen(emitter, event, listener) {
    emitter.on(event, listener);
    this.#listeners.push([emitter, event, listener]);
  }

  #listenBroker(emitter, event, listener) {
    emitter.on(event, listener);
    this.#brokerListeners.push([emitter, event, listener]);
  }

  #unbindBroker() {
    for (const [emitter, event, listener] of this.#brokerListeners) emitter.off(event, listener);
    this.#brokerListeners = [];
  }

  #onDownlinkOpus(opus) {
    this.emit("downlinkOpusReceived");
    // The broker can keep receiving the desktop application's output for a
    // short period after the robot session closes.  Do not let those packets
    // re-apply the per-process CABLE route after disconnect: restore must
    // leave the Codex process on the PC's normal endpoint until authentication
    // has completed again.
    if (this.#server.connected !== true) {
      this.emit("downlinkDropped", { reason: "robot_not_authenticated", bytes: opus.length });
      return;
    }
    if (!this.#speaking) this.#ensureOutputRoute("first_downlink_opus");
    if (this.#speaking) {
      if (this.#startupPrebufferFrames > 0) {
        this.#pendingStop = false;
        this.#pacedQueue.push(Buffer.from(opus));
        this.#pumpPacedQueue();
      } else {
        this.#server.sendDownlinkOpus(opus);
      }
      return;
    }
    if (this.#startupPrebufferFrames > 0) {
      this.#bufferStartupPacket(opus);
      return;
    }
    this.#startSegment([opus]);
  }

  #bufferStartupPacket(opus) {
    const observedAtMs = this.#timestamp();
    if (this.#startupBuffer.length === 0) {
      this.#prebufferFirstFrameAtMs = observedAtMs;
      this.#activePrebufferSegmentSeq = ++this.#prebufferSegmentSeq;
      this.#startupPrebufferTimer = this.#setTimeout(() => {
        this.#startupPrebufferTimer = null;
        try {
          if (this.#server.connected === true) this.#releaseStartupPrebuffer(PREBUFFER_REASON_MAX_DELAY);
          else this.#clearStartupPrebuffer(PREBUFFER_REASON_DISCONNECTED);
        } catch (error) {
          this.emit("error", error);
        }
      }, LOCAL_DOCK_STARTUP_PREBUFFER_MAX_DELAY_MS);
    }
    this.#startupBuffer.push(Buffer.from(opus));
    this.#emitPrebufferTiming(
      this.#startupBuffer.length === 1 ? PREBUFFER_EVENT_STARTED : PREBUFFER_EVENT_FILL,
      observedAtMs,
      PREBUFFER_REASON_NONE,
      0,
    );
    if (this.#startupBuffer.length >= this.#startupPrebufferFrames) {
      this.#releaseStartupPrebuffer(PREBUFFER_REASON_THRESHOLD, observedAtMs);
    }
  }

  #releaseStartupPrebuffer(reason, observedAtMs = this.#timestamp()) {
    if (this.#startupBuffer.length === 0) return false;
    const packets = this.#startupBuffer;
    const bufferedFrames = packets.length;
    const firstFrameAtMs = this.#prebufferFirstFrameAtMs;
    const segmentSeq = this.#activePrebufferSegmentSeq;
    this.#cancelStartupPrebufferTimer();
    this.#startupBuffer = [];
    this.#prebufferFirstFrameAtMs = 0;
    this.#activePrebufferSegmentSeq = 0;
    this.#startSegment(packets);
    this.#emitPrebufferTiming(
      PREBUFFER_EVENT_RELEASED,
      observedAtMs,
      reason,
      Math.max(0, observedAtMs - firstFrameAtMs),
      { bufferedFrames, firstFrameAtMs, segmentSeq },
    );
    return true;
  }

  #clearStartupPrebuffer(reason) {
    if (this.#startupBuffer.length === 0) return;
    const observedAtMs = this.#timestamp();
    const bufferedFrames = this.#startupBuffer.length;
    const firstFrameAtMs = this.#prebufferFirstFrameAtMs;
    const segmentSeq = this.#activePrebufferSegmentSeq;
    this.#cancelStartupPrebufferTimer();
    this.#startupBuffer = [];
    this.#prebufferFirstFrameAtMs = 0;
    this.#activePrebufferSegmentSeq = 0;
    this.#emitPrebufferTiming(PREBUFFER_EVENT_CLEARED, observedAtMs, reason, 0, {
      bufferedFrames, firstFrameAtMs, segmentSeq,
    });
  }

  #emitPrebufferTiming(eventCode, observedAtMs, reason, addedLatencyMs, override = {}) {
    const firstFrameAtMs = override.firstFrameAtMs ?? this.#prebufferFirstFrameAtMs;
    this.emit("prebufferTiming", {
      version: LOCAL_DOCK_STARTUP_PREBUFFER_TELEMETRY_VERSION,
      event_code: eventCode,
      segment_seq: override.segmentSeq ?? this.#activePrebufferSegmentSeq,
      target_frames: this.#startupPrebufferFrames,
      buffered_frames: override.bufferedFrames ?? this.#startupBuffer.length,
      first_frame_at_ms: firstFrameAtMs,
      observed_at_ms: observedAtMs,
      fill_elapsed_ms: Math.max(0, observedAtMs - firstFrameAtMs),
      added_latency_ms: addedLatencyMs,
      release_reason_code: reason,
    });
  }

  #timestamp() {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("now must return a non-negative safe integer timestamp");
    return value;
  }

  #cancelStartupPrebufferTimer() {
    if (this.#startupPrebufferTimer === null) return;
    this.#clearTimeout(this.#startupPrebufferTimer);
    this.#startupPrebufferTimer = null;
  }

  #startSegment(opusPackets) {
    this.#server.sendTtsStart();
    this.#speaking = true;
    this.#pendingStop = false;
    this.emit("speaking", true);
    if (this.#startupPrebufferFrames === 0) {
      for (const opus of opusPackets) this.#server.sendDownlinkOpus(opus);
      return;
    }
    this.#pacedQueue.push(...opusPackets.map((opus) => Buffer.from(opus)));
    this.#pumpPacedQueue();
  }

  #pumpPacedQueue() {
    if (this.#startupPrebufferFrames === 0 || this.#pacedSendInFlight || this.#pacedPumpTimer !== null) return;
    if (!this.#speaking || this.#server.connected !== true) return;
    if (this.#pacedQueue.length === 0) {
      this.#finishPacedStop();
      return;
    }
    const bufferedAmount = this.#server.downlinkBufferedAmount ?? 0;
    if (!Number.isFinite(bufferedAmount) || bufferedAmount < 0) {
      throw new TypeError("server downlinkBufferedAmount must be a non-negative finite number");
    }
    if (bufferedAmount > LOCAL_DOCK_PREBUFFER_MAX_WS_BUFFERED_BYTES) {
      this.#schedulePacedPump(LOCAL_DOCK_PREBUFFER_PACED_FRAME_MS);
      return;
    }
    const packet = this.#pacedQueue.shift();
    const generation = this.#playbackGeneration;
    const dispatchedAtMs = this.#timestamp();
    this.#pacedSendInFlight = true;
    this.emit("downlinkOpusSent");
    this.#server.sendDownlinkOpus(packet, (error = undefined) => {
      if (generation !== this.#playbackGeneration) return;
      this.#pacedSendInFlight = false;
      if (error) {
        this.emit("error", error);
        this.#resetPlayback(PREBUFFER_REASON_DISCONNECTED);
        return;
      }
      const elapsedMs = Math.max(0, this.#timestamp() - dispatchedAtMs);
      this.#schedulePacedPump(Math.max(0, LOCAL_DOCK_PREBUFFER_PACED_FRAME_MS - elapsedMs));
    });
  }

  #schedulePacedPump(delayMs) {
    if (this.#pacedPumpTimer !== null) return;
    const generation = this.#playbackGeneration;
    this.#pacedPumpTimer = this.#setTimeout(() => {
      this.#pacedPumpTimer = null;
      if (generation === this.#playbackGeneration) this.#pumpPacedQueue();
    }, delayMs);
  }

  #finishPacedStop() {
    if (!this.#pendingStop || this.#pacedSendInFlight || this.#pacedQueue.length > 0) return;
    this.#server.sendTtsStop();
    this.#pendingStop = false;
    this.#speaking = false;
    this.emit("speaking", false);
  }

  #resetPlayback(prebufferClearReason = PREBUFFER_REASON_NONE) {
    if (prebufferClearReason !== PREBUFFER_REASON_NONE) this.#clearStartupPrebuffer(prebufferClearReason);
    this.#playbackGeneration += 1;
    if (this.#pacedPumpTimer !== null) {
      this.#clearTimeout(this.#pacedPumpTimer);
      this.#pacedPumpTimer = null;
    }
    this.#pacedQueue = [];
    this.#pacedSendInFlight = false;
    this.#pendingStop = false;
    this.#speaking = false;
  }

  async #ensureOutputRoute(reason) {
    try {
      await this.#ensureBrokerRoot(reason);
      // A delayed authentication/replacement must not re-route desktop audio
      // after the robot disconnected while it was resolving the live root.
      if (this.#server.connected !== true) return;
      await this.#broker.setCodexOutputRouted(true);
      this.emit("routeEnsure", { reason, rootPid: this.#broker.rootPid ?? null });
    } catch (error) {
      this.emit("error", error);
    }
  }

  async #ensureBrokerRoot(reason) {
    const expectedPid = await this.#resolveRootPid();
    const currentBrokerRunning = this.#broker.running;
    if (expectedPid === this.#broker.rootPid && currentBrokerRunning !== false) return;
    if (!this.#brokerFactory) throw new Error(`WASAPI broker root PID drift detected (${this.#broker.rootPid} -> ${expectedPid}) but replacement is unavailable`);
    if (this.#replacement) return this.#replacement;
    this.#replacement = this.#replaceBroker(expectedPid, reason).finally(() => { this.#replacement = null; });
    return this.#replacement;
  }

  async #replaceBroker(expectedPid, reason) {
    const oldBroker = this.#broker;
    const replacement = this.#brokerFactory(expectedPid);
    if (!replacement || typeof replacement.start !== "function" || typeof replacement.stop !== "function") {
      throw new Error("WASAPI broker replacement factory returned an invalid broker");
    }
    const ready = once(replacement, "ready");
    replacement.start();
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("WASAPI replacement broker readiness timed out")), 2_000)),
      ]);
    } catch (error) {
      await replacement.stop().catch(() => {});
      throw error;
    }
    // The replacement is ready but not yet wired to the robot.  Switch its
    // listeners before stopping the old capture process, so at most one broker
    // forwards downlink audio and the old process remains active until ready.
    this.#unbindBroker();
    this.#broker = replacement;
    this.#bindBroker(replacement);
    await oldBroker.stop();
    this.emit("brokerReplaced", { previousRootPid: oldBroker.rootPid ?? null, rootPid: expectedPid, reason });
  }

  #scheduleRouteRetries() {
    this.#clearRouteRetries();
    for (const delay of ROUTE_RETRY_DELAYS_MS) {
      const timer = setTimeout(() => {
        this.#routeRetryTimers.delete(timer);
        this.#ensureOutputRoute(`authenticated_retry_${delay}ms`);
      }, delay);
      this.#routeRetryTimers.add(timer);
    }
  }

  #clearRouteRetries() {
    for (const timer of this.#routeRetryTimers) clearTimeout(timer);
    this.#routeRetryTimers.clear();
  }

  async stopBroker() {
    await this.#broker.stop();
  }

  async ensureBroker() {
    await this.#ensureBrokerRoot("explicit_health_check");
    return this.#broker;
  }

}
