import { randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";

import { WebSocket, WebSocketServer } from "ws";

export const XIAOZHI_PROTOCOL_VERSION = 1;
export const XIAOZHI_UPLINK_AUDIO = Object.freeze({
  format: "opus",
  sample_rate: 16_000,
  channels: 1,
  frame_duration: 60,
});
export const XIAOZHI_DOWNLINK_AUDIO = Object.freeze({
  format: "opus",
  sample_rate: 24_000,
  channels: 1,
  frame_duration: 60,
});
export const XIAOZHI_WEBSOCKET_PATH = "/xiaozhi/v1";

function reject(message) {
  throw new TypeError(message);
}

function safeEqual(left, right) {
  const actual = Buffer.from(String(left ?? ""), "utf8");
  const expected = Buffer.from(String(right ?? ""), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesAudioParams(value, expected) {
  return isPlainObject(value) && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

export function validateXiaozhiDeviceHello(value) {
  if (!isPlainObject(value)) reject("XiaoZhi hello must be an object");
  if (value.type !== "hello" || value.version !== XIAOZHI_PROTOCOL_VERSION || value.transport !== "websocket") {
    reject("unsupported XiaoZhi hello");
  }
  if (!matchesAudioParams(value.audio_params, XIAOZHI_UPLINK_AUDIO)) {
    reject("unsupported XiaoZhi microphone audio parameters");
  }
  if (value.features !== undefined && !isPlainObject(value.features)) {
    reject("XiaoZhi hello features must be an object");
  }
  return {
    supportsMcp: value.features?.mcp === true,
    supportsServerAec: value.features?.aec === true,
  };
}

export function createXiaozhiServerHello(sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) reject("session id is required");
  return {
    type: "hello",
    transport: "websocket",
    session_id: sessionId,
    audio_params: { ...XIAOZHI_DOWNLINK_AUDIO },
  };
}

export class XiaozhiWebSocketServer extends EventEmitter {
  #token;
  #expectedDeviceId;
  #handshakeTimeoutMs;
  #webSocketServer = null;
  #socket = null;
  #deviceId = null;
  #sessionId = null;
  #handshakeTimer = null;
  #stats = {
    connections: 0,
    authenticatedConnections: 0,
    replacedConnections: 0,
    microphoneOpusFrames: 0,
    microphoneOpusBytes: 0,
    downlinkOpusFrames: 0,
    downlinkOpusBytes: 0,
    jsonMessages: 0,
    protocolErrors: 0,
  };

  constructor({ token, expectedDeviceId, handshakeTimeoutMs = 10_000 } = {}) {
    super();
    if (typeof token !== "string" || token.length < 32) reject("XiaoZhi bearer token must contain at least 32 characters");
    if (expectedDeviceId !== undefined && (typeof expectedDeviceId !== "string" || expectedDeviceId.length === 0)) {
      reject("expectedDeviceId must be a non-empty string");
    }
    if (!Number.isInteger(handshakeTimeoutMs) || handshakeTimeoutMs < 1) reject("handshakeTimeoutMs must be positive");
    this.#token = token;
    this.#expectedDeviceId = expectedDeviceId;
    this.#handshakeTimeoutMs = handshakeTimeoutMs;
  }

  get connected() {
    return this.#socket?.readyState === WebSocket.OPEN && this.#sessionId !== null;
  }

  get sessionId() { return this.#sessionId; }
  get deviceId() { return this.#deviceId; }
  get stats() { return structuredClone(this.#stats); }

  async listen({ host = "0.0.0.0", port = 0, path = XIAOZHI_WEBSOCKET_PATH } = {}) {
    if (this.#webSocketServer) reject("XiaoZhi server is already listening");
    if (!Number.isInteger(port) || port < 0 || port > 65_535) reject("port is invalid");
    if (typeof path !== "string" || !path.startsWith("/")) reject("path must be absolute");
    this.#webSocketServer = new WebSocketServer({ host, port, path });
    this.#webSocketServer.on("connection", this.#onConnection);
    this.#webSocketServer.on("error", (error) => this.emit("serverError", error));
    await new Promise((resolve, rejectListen) => {
      this.#webSocketServer.once("listening", resolve);
      this.#webSocketServer.once("error", rejectListen);
    });
    const address = this.#webSocketServer.address();
    return typeof address === "object" && address !== null
      ? { host: address.address, port: address.port, path }
      : { host, port, path };
  }

  async close() {
    clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = null;
    const server = this.#webSocketServer;
    this.#webSocketServer = null;
    if (this.#socket) {
      this.#socket.terminate();
      this.#clearActive(this.#socket);
    }
    if (!server) return;
    server.off("connection", this.#onConnection);
    await new Promise((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
  }

  sendJson(message) {
    if (!isPlainObject(message)) reject("XiaoZhi JSON message must be an object");
    this.#send(JSON.stringify({ session_id: this.#sessionId, ...message }), false);
  }

  sendTtsStart() {
    this.sendJson({ type: "tts", state: "start" });
  }

  sendTtsSentence(text) {
    if (typeof text !== "string" || text.length === 0) reject("TTS sentence text is required");
    this.sendJson({ type: "tts", state: "sentence_start", text });
  }

  sendTtsStop() {
    this.sendJson({ type: "tts", state: "stop" });
  }

  sendEmotion(emotion, text = undefined) {
    if (typeof emotion !== "string" || emotion.length === 0) reject("emotion is required");
    this.sendJson({ type: "llm", emotion, ...(text === undefined ? {} : { text }) });
  }

  sendMcp(payload) {
    if (!isPlainObject(payload) || payload.jsonrpc !== "2.0") reject("MCP payload must be JSON-RPC 2.0");
    this.sendJson({ type: "mcp", payload });
  }

  sendDownlinkOpus(opus) {
    const packet = Buffer.from(opus ?? []);
    if (packet.length === 0) reject("downlink Opus packet must not be empty");
    this.#send(packet, true);
    this.#stats.downlinkOpusFrames += 1;
    this.#stats.downlinkOpusBytes += packet.length;
  }

  #send(payload, binary) {
    if (!this.connected) throw new Error("XiaoZhi device is not authenticated");
    this.#socket.send(payload, { binary });
  }

  #onConnection = (socket, request) => {
    this.#stats.connections += 1;
    const authorization = request.headers.authorization;
    const protocolVersion = request.headers["protocol-version"];
    const deviceId = request.headers["device-id"];
    const clientId = request.headers["client-id"];
    if (!safeEqual(authorization, `Bearer ${this.#token}`) || protocolVersion !== String(XIAOZHI_PROTOCOL_VERSION) ||
        typeof deviceId !== "string" || deviceId.length === 0 ||
        (this.#expectedDeviceId !== undefined && deviceId !== this.#expectedDeviceId)) {
      this.#protocolError(socket, "invalid XiaoZhi upgrade identity");
      return;
    }

    if (this.#socket && this.#socket !== socket) {
      this.#stats.replacedConnections += 1;
      this.#socket.close(1001, "replaced by newer StackChan connection");
    }
    clearTimeout(this.#handshakeTimer);
    this.#socket = socket;
    this.#deviceId = deviceId;
    this.#sessionId = null;
    this.#handshakeTimer = setTimeout(() => this.#protocolError(socket, "XiaoZhi hello timeout"), this.#handshakeTimeoutMs);
    socket.on("message", (message, isBinary) => this.#onMessage(socket, message, isBinary, { deviceId, clientId }));
    socket.on("close", (code, reason) => {
      const wasActive = socket === this.#socket;
      this.#clearActive(socket);
      if (wasActive) this.emit("disconnected", { deviceId, code, reason: Buffer.from(reason).toString("utf8") });
    });
    socket.on("error", (error) => this.emit("socketError", error));
  };

  #onMessage(socket, message, isBinary, identity) {
    if (socket !== this.#socket) return;
    if (this.#sessionId === null) {
      if (isBinary) {
        this.#protocolError(socket, "XiaoZhi hello must be text");
        return;
      }
      try {
        const hello = JSON.parse(Buffer.from(message).toString("utf8"));
        const capabilities = validateXiaozhiDeviceHello(hello);
        const sessionId = randomUUID();
        this.#sessionId = sessionId;
        clearTimeout(this.#handshakeTimer);
        this.#handshakeTimer = null;
        socket.send(JSON.stringify(createXiaozhiServerHello(sessionId)));
        this.#stats.authenticatedConnections += 1;
        this.emit("authenticated", { ...identity, sessionId, hello, capabilities });
      } catch (error) {
        this.#protocolError(socket, error.message);
      }
      return;
    }

    if (isBinary) {
      const opus = Buffer.from(message);
      if (opus.length === 0) {
        this.#protocolError(socket, "empty microphone Opus packet");
        return;
      }
      this.#stats.microphoneOpusFrames += 1;
      this.#stats.microphoneOpusBytes += opus.length;
      this.emit("microphoneOpus", { opus, sessionId: this.#sessionId, deviceId: this.#deviceId });
      return;
    }

    try {
      const value = JSON.parse(Buffer.from(message).toString("utf8"));
      if (!isPlainObject(value) || typeof value.type !== "string") reject("invalid XiaoZhi JSON message");
      if (value.session_id !== undefined && value.session_id !== this.#sessionId) reject("stale XiaoZhi session id");
      this.#stats.jsonMessages += 1;
      this.emit("message", value);
      if (value.type === "listen") this.emit("listen", value);
      if (value.type === "mcp") this.emit("mcp", value.payload);
      if (value.type === "abort") this.emit("abort", value);
    } catch (error) {
      this.#protocolError(socket, error.message);
    }
  }

  #protocolError(socket, message) {
    this.#stats.protocolErrors += 1;
    const error = new Error(message);
    this.emit("protocolError", error);
    socket.close(1008, message.slice(0, 123));
  }

  #clearActive(socket) {
    if (socket !== this.#socket) return;
    clearTimeout(this.#handshakeTimer);
    this.#handshakeTimer = null;
    this.#socket = null;
    this.#deviceId = null;
    this.#sessionId = null;
  }
}
