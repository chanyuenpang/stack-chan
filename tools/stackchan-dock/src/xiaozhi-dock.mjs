import { EventEmitter } from "node:events";

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const EXPRESSIONS = new Set(["neutral", "happy", "angry", "sad", "doubtful"]);

function reject(message) {
  throw new TypeError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeToolJsonResult(result) {
  // XiaoZhi MCP wraps a tool's JSON return value in the standard content text
  // block. Keep direct-object compatibility for older test doubles and tools
  // that already return a JSON object.
  if (!isPlainObject(result) || !Array.isArray(result.content)) return result;
  const text = result.content.find((entry) => isPlainObject(entry) && entry.type === "text" && typeof entry.text === "string")?.text;
  if (text === undefined) throw new Error("StackChan MCP status response has no text content");
  try {
    const decoded = JSON.parse(text);
    if (!isPlainObject(decoded)) throw new Error("not an object");
    return decoded;
  } catch {
    throw new Error("StackChan MCP status response contains invalid JSON");
  }
}

export class XiaozhiMcpError extends Error {
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = "XiaozhiMcpError";
    this.code = code;
    this.data = data;
  }
}

export class XiaozhiStackchanDock extends EventEmitter {
  #server;
  #requestTimeoutMs;
  #nextRequestId = 1;
  #pending = new Map();
  #listeners = [];

  capabilities = Object.freeze({ audioControl: false });

  constructor({ server, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    super();
    if (!server || typeof server.sendMcp !== "function" || typeof server.sendEmotion !== "function") {
      reject("XiaoZhi server is required");
    }
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) reject("requestTimeoutMs must be positive");
    this.#server = server;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get connected() {
    return this.#server.connected === true;
  }

  get sessionId() {
    return this.#server.sessionId ?? null;
  }

  get deviceId() {
    return this.#server.deviceId ?? null;
  }

  attach() {
    if (this.#listeners.length > 0) throw new Error("XiaoZhi Dock is already attached");
    this.#listen("authenticated", (identity) => {
      this.#rejectPending(new Error("StackChan XiaoZhi session was replaced"));
      this.emit("connected", identity);
    });
    this.#listen("disconnected", (details) => {
      this.#rejectPending(new Error("StackChan XiaoZhi session disconnected"));
      this.emit("disconnected", details);
    });
    this.#listen("mcp", (payload) => this.#handleMcp(payload));
    return this;
  }

  detach() {
    for (const [event, listener] of this.#listeners) this.#server.off(event, listener);
    this.#listeners = [];
    this.#rejectPending(new Error("StackChan XiaoZhi Dock detached"));
  }

  async callTool(name, argumentsValue = {}) {
    if (typeof name !== "string" || name.length === 0) reject("tool name is required");
    if (!isPlainObject(argumentsValue)) reject("tool arguments must be an object");
    if (!this.connected) throw new Error("StackChan XiaoZhi device is not authenticated");

    const id = this.#allocateRequestId();
    const sessionId = this.sessionId;
    const response = new Promise((resolve, rejectRequest) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectRequest(new Error(`StackChan MCP request timed out: ${name}`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject: rejectRequest, timer, sessionId, name });
    });

    try {
      this.#server.sendMcp({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: argumentsValue },
      });
    } catch (error) {
      const pending = this.#pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        pending.reject(error);
      }
    }
    return response;
  }

  async getStatus() {
    const device = decodeToolJsonResult(await this.callTool("self.get_device_status"));
    return {
      transport: "xiaozhi-websocket-v1",
      connected: true,
      device_id: this.deviceId,
      session_id: this.sessionId,
      device,
    };
  }

  async setExpression(expression) {
    if (!EXPRESSIONS.has(expression)) reject("unsupported StackChan expression");
    if (!this.connected) throw new Error("StackChan XiaoZhi device is not authenticated");
    this.#server.sendEmotion(expression);
    return { ok: true, expression, delivery: "xiaozhi-websocket" };
  }

  setAudioEndpoints() {
    throw new Error("XiaoZhi audio endpoints are controlled by the official half-duplex session and StackChan touch UI");
  }

  async setLed(red, green, blue) {
    return this.callTool("self.robot.set_led_color", { red, green, blue });
  }

  async getHead() {
    return this.callTool("self.robot.get_head_angles");
  }

  async setHead(yaw, pitch, speed) {
    return this.callTool("self.robot.set_head_angles", { yaw, pitch, speed });
  }

  async celebrate({ style = "cheer", duration_ms = 4_000, intensity = 2, sound = false } = {}) {
    return this.callTool("self.robot.celebrate", { style, duration_ms, intensity, sound });
  }

  #allocateRequestId() {
    const id = this.#nextRequestId;
    this.#nextRequestId = id >= 0x7fff_ffff ? 1 : id + 1;
    return id;
  }

  #listen(event, listener) {
    this.#server.on(event, listener);
    this.#listeners.push([event, listener]);
  }

  #handleMcp(payload) {
    if (!isPlainObject(payload) || payload.jsonrpc !== "2.0") {
      this.emit("protocolError", new Error("invalid StackChan MCP response"));
      return;
    }
    if (typeof payload.method === "string" && payload.method.startsWith("notifications/")) {
      this.emit("notification", structuredClone(payload));
      return;
    }
    if (!Number.isInteger(payload.id)) {
      this.emit("protocolError", new Error("invalid StackChan MCP response"));
      return;
    }
    const pending = this.#pending.get(payload.id);
    if (!pending) {
      this.emit("unmatchedMcp", payload);
      return;
    }
    this.#pending.delete(payload.id);
    clearTimeout(pending.timer);
    if (pending.sessionId !== this.sessionId) {
      pending.reject(new Error("stale StackChan MCP response"));
      return;
    }
    if (isPlainObject(payload.error)) {
      pending.reject(new XiaozhiMcpError(
        typeof payload.error.message === "string" ? payload.error.message : "StackChan MCP request failed",
        { code: payload.error.code, data: payload.error.data },
      ));
      return;
    }
    if (!Object.hasOwn(payload, "result")) {
      pending.reject(new Error("StackChan MCP response has no result"));
      return;
    }
    pending.resolve(payload.result);
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
