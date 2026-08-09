import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createSocket as createUdpSocket } from "node:dgram";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { DeviceCommandError, encodeRequest, parseFrame } from "./protocol.mjs";
export const WIFI_AUDIO_PROTOCOL_VERSION = 1;
export const WIFI_AUDIO_FRAME_BYTES = 480;
export const WIFI_AUDIO_HEADER_BYTES = 16;
export const WIFI_AUDIO_CONTROL_BYTES = 1500;
export const WIFI_AUDIO_MICROPHONE_FLAG = 2;
export const WIFI_AUDIO_SPEAKER_FLAG = 1;
export const WIFI_AUDIO_MICROPHONE_PCM_BYTES = 960;
export const WIFI_AUDIO_UDP_MAGIC = "SCAU";
export const WIFI_AUDIO_UDP_SESSION_BYTES = 16;
export const WIFI_AUDIO_UDP_HEADER_BYTES = 36;
export const WIFI_AUDIO_UDP_TAG_BYTES = 16;
export const WIFI_AUDIO_UDP_MAX_PACKET_BYTES = 1200;
export const WIFI_AUDIO_UDP_MAX_PCM_BYTES =
  WIFI_AUDIO_UDP_MAX_PACKET_BYTES - WIFI_AUDIO_UDP_HEADER_BYTES - WIFI_AUDIO_UDP_TAG_BYTES;
const WIFI_AUDIO_UDP_KEY_LABEL = Buffer.from("stackchan-wifi-audio-udp-v1\n", "utf8");
const WIFI_AUDIO_UDP_READY_LABEL = "stackchan-wifi-audio-udp-ready-v1";

function reject(message) {
  throw new TypeError(message);
}

function expectedAuth(pairingKey, deviceId, nonce) {
  return createHmac("sha256", pairingKey).update(`${deviceId}\n${nonce}`, "utf8").digest("hex");
}

function sameAuth(actual, expected) {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function udpReject(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function sessionBytes(value) {
  const session = typeof value === "string" ? Buffer.from(value, "hex") : Buffer.from(value ?? []);
  if (session.length !== WIFI_AUDIO_UDP_SESSION_BYTES ||
      (typeof value === "string" && !/^[a-f0-9]{32}$/i.test(value))) {
    udpReject("SESSION", "invalid UDP session");
  }
  return session;
}

export function deriveUdpSessionKey(pairingKey, session, { deviceId, nonce } = {}) {
  if (typeof pairingKey !== "string" || Buffer.byteLength(pairingKey, "utf8") < 32) {
    reject("pairingKey must contain at least 256 bits");
  }
  if (typeof deviceId !== "string" || deviceId.length === 0 || typeof nonce !== "string" || nonce.length === 0) {
    reject("deviceId and nonce are required for UDP session key derivation");
  }
  const token = sessionBytes(session);
  return createHmac("sha256", pairingKey)
    .update(WIFI_AUDIO_UDP_KEY_LABEL)
    .update(deviceId, "utf8")
    .update("\n", "utf8")
    .update(nonce, "utf8")
    .update("\n", "utf8")
    .update(token)
    .digest();
}

export function udpReadyProof(pairingKey, { deviceId, nonce, port, session }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) reject("invalid UDP port");
  const sessionHex = sessionBytes(session).toString("hex");
  return createHmac("sha256", pairingKey)
    .update(`${WIFI_AUDIO_UDP_READY_LABEL}\n${deviceId}\n${nonce}\n${port}\n${sessionHex}`, "utf8")
    .digest("hex");
}

export function encodeUdpMicrophonePacket({ sequence, captureTimeUs, pcm, session, sessionKey }) {
  const payload = Buffer.from(pcm ?? []);
  const token = sessionBytes(session);
  const key = Buffer.from(sessionKey ?? []);
  if (key.length !== 32) reject("invalid UDP session key");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff) reject("invalid microphone sequence");
  if (payload.length !== WIFI_AUDIO_MICROPHONE_PCM_BYTES) reject("invalid UDP PCM payload length");
  const packet = Buffer.allocUnsafe(WIFI_AUDIO_UDP_HEADER_BYTES + payload.length + WIFI_AUDIO_UDP_TAG_BYTES);
  packet.write(WIFI_AUDIO_UDP_MAGIC, 0, 4, "ascii");
  packet.writeUInt8(WIFI_AUDIO_PROTOCOL_VERSION, 4);
  packet.writeUInt8(WIFI_AUDIO_MICROPHONE_FLAG, 5);
  packet.writeUInt32BE(sequence, 6);
  packet.writeBigUInt64BE(BigInt(captureTimeUs), 10);
  packet.writeUInt16BE(payload.length, 18);
  token.copy(packet, 20);
  payload.copy(packet, WIFI_AUDIO_UDP_HEADER_BYTES);
  const authenticatedBytes = packet.length - WIFI_AUDIO_UDP_TAG_BYTES;
  createHmac("sha256", key).update(packet.subarray(0, authenticatedBytes)).digest().copy(packet, authenticatedBytes, 0, WIFI_AUDIO_UDP_TAG_BYTES);
  return packet;
}

export function parseUdpMicrophonePacket(message, { expectedSession, sessionKey } = {}) {
  const packet = Buffer.from(message);
  if (packet.length < WIFI_AUDIO_UDP_HEADER_BYTES + 1 + WIFI_AUDIO_UDP_TAG_BYTES ||
      packet.length > WIFI_AUDIO_UDP_MAX_PACKET_BYTES) udpReject("LENGTH", "invalid UDP audio packet length");
  if (packet.toString("ascii", 0, 4) !== WIFI_AUDIO_UDP_MAGIC ||
      packet.readUInt8(4) !== WIFI_AUDIO_PROTOCOL_VERSION ||
      packet.readUInt8(5) !== WIFI_AUDIO_MICROPHONE_FLAG) udpReject("HEADER", "invalid UDP audio packet header");
  const sequence = packet.readUInt32BE(6);
  const captureTimeUs = packet.readBigUInt64BE(10);
  const payloadLength = packet.readUInt16BE(18);
  if (sequence === 0 || payloadLength !== WIFI_AUDIO_MICROPHONE_PCM_BYTES ||
      packet.length !== WIFI_AUDIO_UDP_HEADER_BYTES + payloadLength + WIFI_AUDIO_UDP_TAG_BYTES) {
    udpReject("HEADER", "invalid UDP audio packet header");
  }
  const expectedToken = sessionBytes(expectedSession);
  const actualToken = packet.subarray(20, WIFI_AUDIO_UDP_HEADER_BYTES);
  if (!timingSafeEqual(actualToken, expectedToken)) udpReject("SESSION", "stale UDP session");
  const key = Buffer.from(sessionKey ?? []);
  if (key.length !== 32) reject("invalid UDP session key");
  const authenticatedBytes = packet.length - WIFI_AUDIO_UDP_TAG_BYTES;
  const expectedTag = createHmac("sha256", key).update(packet.subarray(0, authenticatedBytes)).digest().subarray(0, WIFI_AUDIO_UDP_TAG_BYTES);
  if (!timingSafeEqual(packet.subarray(authenticatedBytes), expectedTag)) udpReject("AUTH", "invalid UDP audio authentication");
  return {
    sequence,
    captureTimeUs,
    pcm: packet.subarray(WIFI_AUDIO_UDP_HEADER_BYTES, authenticatedBytes),
  };
}

function normalizedRemoteAddress(value) {
  return String(value ?? "").replace(/^::ffff:/i, "");
}

function forwardSequenceDistance(previous, current) {
  return current > previous ? current - previous : 0xffffffff - previous + current;
}

export function validateHello(value, { pairingKey, expectedDeviceId } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject("hello must be an object");
  const keys = Object.keys(value).sort();
  const allowed = ["auth", "device_id", "format", "nonce", "protocol", "type"];
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) reject("hello has invalid fields");
  if (value.type !== "hello" || value.protocol !== WIFI_AUDIO_PROTOCOL_VERSION) reject("unsupported hello protocol");
  if (typeof value.device_id !== "string" || value.device_id.length === 0 || value.device_id.length > 64) reject("invalid device_id");
  if (expectedDeviceId && value.device_id !== expectedDeviceId) reject("unexpected device_id");
  if (typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value.nonce)) reject("invalid nonce");
  const { format } = value;
  if (!format || typeof format !== "object" || Array.isArray(format) ||
      format.codec !== "pcm_s16le" || format.sample_rate !== 24000 || format.channels !== 1 || format.frame_ms !== 20) {
    reject("unsupported audio format");
  }
  if (typeof pairingKey !== "string" || Buffer.byteLength(pairingKey, "utf8") < 32) reject("pairingKey must contain at least 256 bits");
  if (!sameAuth(value.auth, expectedAuth(pairingKey, value.device_id, value.nonce))) reject("invalid hello auth");
  return { deviceId: value.device_id };
}

export function parseAudioFrame(message) {
  const frame = Buffer.from(message);
  if (frame.length !== WIFI_AUDIO_HEADER_BYTES + WIFI_AUDIO_MICROPHONE_PCM_BYTES) {
    reject("invalid audio frame length");
  }
  const version = frame.readUInt8(0);
  const flags = frame.readUInt8(1);
  const sequence = frame.readUInt32BE(2);
  const captureTimeUs = frame.readBigUInt64BE(6);
  const payloadLength = frame.readUInt16BE(14);
  if (version !== WIFI_AUDIO_PROTOCOL_VERSION || flags !== WIFI_AUDIO_MICROPHONE_FLAG || sequence === 0 ||
      payloadLength !== WIFI_AUDIO_MICROPHONE_PCM_BYTES || frame.length !== WIFI_AUDIO_HEADER_BYTES + payloadLength) {
    reject("invalid audio frame header");
  }
  return { sequence, captureTimeUs, pcm: frame.subarray(WIFI_AUDIO_HEADER_BYTES) };
}

export function encodeSpeakerFrame(pcm, sequence, playbackTimeUs = process.hrtime.bigint() / 1000n) {
  const payload = Buffer.from(pcm);
  if (payload.length !== WIFI_AUDIO_FRAME_BYTES) reject("speaker PCM must contain exactly one 10 ms frame");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff) reject("invalid speaker sequence");
  const frame = Buffer.allocUnsafe(WIFI_AUDIO_HEADER_BYTES + WIFI_AUDIO_FRAME_BYTES);
  frame.writeUInt8(WIFI_AUDIO_PROTOCOL_VERSION, 0);
  frame.writeUInt8(WIFI_AUDIO_SPEAKER_FLAG, 1);
  frame.writeUInt32BE(sequence, 2);
  frame.writeBigUInt64BE(BigInt(playbackTimeUs), 6);
  frame.writeUInt16BE(WIFI_AUDIO_FRAME_BYTES, 14);
  payload.copy(frame, WIFI_AUDIO_HEADER_BYTES);
  return frame;
}

export function summarizePcm(pcm) {
  const bytes = Buffer.from(pcm);
  if (bytes.length === 0 || bytes.length % 2 !== 0) reject("PCM payload must contain 16-bit samples");
  let peak = 0;
  let sumSquares = 0;
  const samples = bytes.length / 2;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const value = bytes.readInt16LE(offset);
    peak = Math.max(peak, Math.abs(value));
    sumSquares += value * value;
  }
  return { samples, peak, rms: Math.sqrt(sumSquares / samples) };
}

export class WifiDockTransport extends EventEmitter {
  #socket;
  #opened = false;
  #nextRequestId = 1;
  #pending = new Map();
  #requestTimeoutMs;

  constructor({ requestTimeoutMs = 1500 } = {}) {
    super();
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get connected() { return this.#opened && this.#socket?.readyState === this.#socket.OPEN; }
  async open() { if (!this.connected) throw new Error("Wi-Fi Dock is not authenticated"); }
  async close() { this.#detach(new Error("Wi-Fi Dock transport closed")); }

  async request(command, args = {}) {
    if (!this.connected) throw new Error("Wi-Fi Dock transport is not open");
    const id = this.#nextRequestId++;
    const frame = encodeRequest(id, command, args);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`request ${id} timed out after ${this.#requestTimeoutMs} ms`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(frame, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  async sendBinary(frame) {
    if (!this.connected) throw new Error("Wi-Fi Dock is not authenticated");
    const started = process.hrtime.bigint();
    await new Promise((resolve, rejectSend) => this.#socket.send(frame, (error) => {
      const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      this.emit("binarySend", { latencyMs, bytes: Buffer.byteLength(frame), error });
      if (error) rejectSend(error);
      else resolve();
    }));
  }

  attach(socket) {
    this.#detach(new Error("Wi-Fi Dock reconnected"));
    this.#socket = socket;
    this.#opened = true;
    socket.once("close", () => {
      if (this.#socket === socket) this.#detach(new Error("Wi-Fi Dock disconnected"));
    });
    this.emit("open");
  }

  receive(message) {
    try {
      const parsed = parseFrame(message, { maxFrameBytes: WIFI_AUDIO_CONTROL_BYTES });
      if (parsed.type === "event") {
        this.emit("event", parsed);
        return;
      }
      const pending = this.#pending.get(parsed.id);
      if (!pending) {
        this.emit("orphanResponse", parsed);
        return;
      }
      clearTimeout(pending.timer);
      this.#pending.delete(parsed.id);
      if (parsed.ok) pending.resolve(parsed.result);
      else pending.reject(new DeviceCommandError(parsed.error.code, parsed.error.message));
    } catch (error) {
      this.emit("protocolError", error);
    }
  }

  #detach(error, close = true) {
    const socket = this.#socket;
    this.#socket = undefined;
    const wasOpened = this.#opened;
    this.#opened = false;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    if (close && socket && socket.readyState === socket.OPEN) socket.close();
    if (wasOpened) this.emit("close", error);
  }
}

export class WifiAudioReceiver extends EventEmitter {
  #pairingKey;
  #expectedDeviceId;
  #server;
  #webSocketServer;
  #udpSocket;
  #activeSocket;
  #activeUdpSession;
  #authenticationBarrier = Promise.resolve();
  #authenticationGeneration = 0;
  #transport = new WifiDockTransport();
  #handshakeTimeoutMs;
  #stats = {
    connections: 0,
    authenticatedConnections: 0,
    rejectedConnections: 0,
    frames: 0,
    udpPackets: 0,
    udpMicrophoneFrames: 0,
    udpRejectedPackets: 0,
    udpAuthenticationFailures: 0,
    udpSourceMismatches: 0,
    staleSessionPackets: 0,
    legacyWebsocketMicrophoneFrames: 0,
    pcmBytes: 0,
    bytes: 0,
    sequenceGaps: 0,
    duplicateFrames: 0,
    outOfOrderFrames: 0,
    invalidFrames: 0,
    reconnects: 0,
  };
  #lastSequence;
  #speakerSequence = 1;

  constructor({ pairingKey, expectedDeviceId, handshakeTimeoutMs = 5000 } = {}) {
    super();
    if (typeof pairingKey !== "string" || Buffer.byteLength(pairingKey, "utf8") < 32) throw new TypeError("pairingKey must contain at least 256 bits");
    this.#pairingKey = pairingKey;
    this.#expectedDeviceId = expectedDeviceId;
    this.#handshakeTimeoutMs = handshakeTimeoutMs;
  }

  get stats() { return { ...this.#stats }; }
  get transport() { return this.#transport; }

  async sendSpeakerPcm(pcm) {
    const sequence = this.#speakerSequence++;
    if (this.#speakerSequence > 0xffffffff) this.#speakerSequence = 1;
    await this.#transport.sendBinary(encodeSpeakerFrame(pcm, sequence));
    return { sequence };
  }

  async listen({ host = "0.0.0.0", port = 0, tls } = {}) {
    if (this.#server || this.#udpSocket) throw new Error("receiver is already listening");
    this.#udpSocket = createUdpSocket("udp4");
    this.#udpSocket.on("message", (message, remote) => this.#onUdpMessage(message, remote));
    this.#udpSocket.on("error", (error) => this.emit("protocolError", error));
    try {
      await new Promise((resolve, rejectBind) => {
        this.#udpSocket.once("error", rejectBind);
        this.#udpSocket.bind(port, host, () => {
          this.#udpSocket.off("error", rejectBind);
          try { this.#udpSocket.setRecvBufferSize(1024 * 1024); } catch {}
          resolve();
        });
      });
    } catch (error) {
      const udpSocket = this.#udpSocket;
      this.#udpSocket = undefined;
      try { udpSocket.close(); } catch {}
      throw error;
    }
    this.#server = tls ? createHttpsServer(tls) : createServer();
    this.#webSocketServer = new WebSocketServer({
      server: this.#server,
      maxPayload: WIFI_AUDIO_CONTROL_BYTES,
    });
    this.#webSocketServer.on("connection", (socket, request) => this.#onConnection(socket, request));
    try {
      await new Promise((resolve, rejectListen) => {
        this.#server.once("error", rejectListen);
        this.#server.listen(port, host, () => { this.#server.off("error", rejectListen); resolve(); });
      });
    } catch (error) {
      const udpSocket = this.#udpSocket;
      this.#server = undefined;
      this.#webSocketServer = undefined;
      this.#udpSocket = undefined;
      await new Promise((resolve) => udpSocket.close(resolve));
      throw error;
    }
    return this.address;
  }

  get address() {
    const address = this.#server?.address();
    const udpAddress = this.#udpSocket?.address();
    return address && typeof address === "object" ? {
      host: address.address,
      port: address.port,
      udpPort: udpAddress && typeof udpAddress === "object" ? udpAddress.port : null,
    } : null;
  }

  async close() {
    if (!this.#server) return;
    const server = this.#server;
    this.#activeSocket = undefined;
    this.#activeUdpSession = undefined;
    await this.#transport.close();
    for (const client of this.#webSocketServer?.clients ?? []) client.terminate();
    this.#server = undefined;
    this.#webSocketServer = undefined;
    const udpSocket = this.#udpSocket;
    this.#udpSocket = undefined;
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      udpSocket ? new Promise((resolve) => udpSocket.close(resolve)) : Promise.resolve(),
    ]);
  }

  async #claimAuthenticatedSocket(socket, generation) {
    let release;
    const previousClaim = this.#authenticationBarrier;
    this.#authenticationBarrier = new Promise((resolve) => { release = resolve; });
    await previousClaim;
    try {
      if (socket.readyState !== socket.OPEN) throw new Error("robot connection closed during authentication");
      const previousSocket = this.#activeSocket;
      this.#activeSocket = undefined;
      this.#activeUdpSession = undefined;
      if (previousSocket && previousSocket !== socket && previousSocket.readyState === previousSocket.OPEN) {
        previousSocket.close(1000, "replaced by new robot connection");
      }
      if (generation !== this.#authenticationGeneration) return false;
      this.#activeSocket = socket;
      return true;
    } finally {
      release();
    }
  }

  #processMicrophoneFrame(frame) {
    if (this.#lastSequence !== undefined) {
      if (frame.sequence === this.#lastSequence) {
        this.#stats.duplicateFrames += 1;
        return;
      }
      const distance = forwardSequenceDistance(this.#lastSequence, frame.sequence);
      if (distance > 0x7fffffff) {
        this.#stats.outOfOrderFrames += 1;
        return;
      }
      if (distance > 1) this.#stats.sequenceGaps += distance - 1;
    }
    const pcm = frame.pcm;
    this.#lastSequence = frame.sequence;
    this.#stats.frames += 1;
    this.#stats.udpMicrophoneFrames += 1;
    this.#stats.pcmBytes += pcm.length;
    this.#stats.bytes += pcm.length;
    this.emit("audio", { ...frame, pcm });
  }

  #onUdpMessage(message, remote) {
    this.#stats.udpPackets += 1;
    const active = this.#activeUdpSession;
    if (!active) {
      this.#stats.udpRejectedPackets += 1;
      this.#stats.staleSessionPackets += 1;
      return;
    }
    if (normalizedRemoteAddress(remote.address) !== active.remoteAddress) {
      this.#stats.udpRejectedPackets += 1;
      this.#stats.udpSourceMismatches += 1;
      return;
    }
    try {
      const frame = parseUdpMicrophonePacket(message, {
        expectedSession: active.session,
        sessionKey: active.key,
      });
      if (active.remotePort === undefined) active.remotePort = remote.port;
      else if (active.remotePort !== remote.port) {
        this.#stats.udpRejectedPackets += 1;
        this.#stats.udpSourceMismatches += 1;
        return;
      }
      this.#processMicrophoneFrame(frame);
    } catch (error) {
      this.#stats.invalidFrames += 1;
      this.#stats.udpRejectedPackets += 1;
      if (error.code === "AUTH") this.#stats.udpAuthenticationFailures += 1;
      if (error.code === "SESSION") this.#stats.staleSessionPackets += 1;
      this.emit("protocolError", error);
    }
  }

  #onConnection(socket, request) {
    this.#stats.connections += 1;
    const remoteAddress = request.socket.remoteAddress;
    const connectedAt = performance.now();
    const diagnostic = (phase, details = {}) => this.emit("connectionDiagnostic", {
      phase,
      remoteAddress,
      elapsedMs: Number((performance.now() - connectedAt).toFixed(3)),
      ...details,
    });
    diagnostic("accepted");
    let authenticated = false;
    let authenticating = false;
    let timeout = setTimeout(() => socket.close(1008, "hello timeout"), this.#handshakeTimeoutMs);
    socket.on("message", async (message, isBinary) => {
      try {
        if (!authenticated) {
          if (authenticating) reject("hello is already being authenticated");
          if (isBinary) reject("hello must be text");
          authenticating = true;
          const hello = JSON.parse(Buffer.from(message).toString("utf8"));
          const { deviceId } = validateHello(hello, { pairingKey: this.#pairingKey, expectedDeviceId: this.#expectedDeviceId });
          diagnostic("hello_validated", { deviceId });
          const authenticationGeneration = ++this.#authenticationGeneration;
          const claimStartedAt = performance.now();
          if (!await this.#claimAuthenticatedSocket(socket, authenticationGeneration)) {
            authenticating = false;
            clearTimeout(timeout);
            timeout = undefined;
            socket.close(1000, "superseded by newer robot connection");
            return;
          }
          diagnostic("authentication_claimed", {
            deviceId,
            claimMs: Number((performance.now() - claimStartedAt).toFixed(3)),
          });
          authenticated = true;
          authenticating = false;
          clearTimeout(timeout);
          timeout = undefined;
          if (this.#stats.authenticatedConnections > 0) this.#stats.reconnects += 1;
          this.#stats.authenticatedConnections += 1;
          this.#lastSequence = undefined;
          const udpSession = randomBytes(WIFI_AUDIO_UDP_SESSION_BYTES);
          const udpKey = deriveUdpSessionKey(this.#pairingKey, udpSession, { deviceId, nonce: hello.nonce });
          const udpPort = this.address.udpPort;
          const proof = udpReadyProof(this.#pairingKey, {
            deviceId,
            nonce: hello.nonce,
            port: udpPort,
            session: udpSession,
          });
          this.#activeUdpSession = {
            socket,
            generation: authenticationGeneration,
            session: udpSession,
            key: udpKey,
            remoteAddress: normalizedRemoteAddress(request.socket.remoteAddress),
          };
          socket.send(JSON.stringify({
            type: "ready",
            protocol: WIFI_AUDIO_PROTOCOL_VERSION,
            microphone_transport: {
              type: "udp",
              port: udpPort,
              session: udpSession.toString("hex"),
              proof,
            },
          }));
          this.#transport.attach(socket);
          this.emit("authenticated", { deviceId, remoteAddress: request.socket.remoteAddress });
          return;
        }
        if (this.#activeSocket !== socket) return;
        if (!isBinary) {
          this.#transport.receive(Buffer.from(message).toString("utf8"));
          return;
        }
        this.#stats.legacyWebsocketMicrophoneFrames += 1;
        reject("microphone audio must use the negotiated UDP session");
      } catch (error) {
        authenticating = false;
        if (authenticated) this.#stats.invalidFrames += 1;
        else this.#stats.rejectedConnections += 1;
        socket.close(1008, "invalid audio protocol");
        this.emit("protocolError", error);
      }
    });
    socket.once("close", (code, reason) => {
      diagnostic("closed", {
        code,
        reason: Buffer.from(reason).toString("utf8"),
        authenticated,
        authenticating,
      });
      if (timeout) clearTimeout(timeout);
      if (this.#activeSocket === socket) {
        this.#activeSocket = undefined;
        if (this.#activeUdpSession?.socket === socket) this.#activeUdpSession = undefined;
      }
    });
  }
}
