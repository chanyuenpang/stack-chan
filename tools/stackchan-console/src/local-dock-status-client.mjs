import { EventEmitter } from "node:events";
import { createConnection } from "node:net";

export const DEFAULT_LOCAL_DOCK_PIPE = "\\\\.\\pipe\\stackchan-xiaozhi-admin";

export function requestLocalDockStatus({ token, pipePath = DEFAULT_LOCAL_DOCK_PIPE, connect = createConnection, timeoutMs = 1_500 } = {}) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) throw new TypeError("local Dock token is invalid");
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath);
    let data = "";
    const timer = setTimeout(() => socket.destroy(new Error("local Dock status request timed out")), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("data", (chunk) => { data += chunk; });
    socket.once("end", () => {
      clearTimeout(timer);
      try {
        const response = JSON.parse(data.trim());
        if (!response.ok) throw new Error(response.error || "local Dock status request failed");
        if (response.result?.protocol_version !== 1) throw new Error("unsupported local Dock status protocol");
        resolve(response.result);
      } catch (error) { reject(error); }
    });
    socket.once("connect", () => socket.end(`${JSON.stringify({ token, operation: "get-console-status" })}\n`));
  });
}

export class AttachedDockStatusController extends EventEmitter {
  #request;
  #timer = null;
  #state = { connection: { phase: "connecting", deviceId: null, sessionId: null, lastSeen: null }, voice: { phase: "idle", subtitle: { phase: "unavailable", detail: null } }, robot: {}, health: { runtime: "attaching", lastError: null } };

  constructor({ request, pollIntervalMs = 1_000 } = {}) {
    super();
    if (typeof request !== "function") throw new TypeError("read-only local Dock status request is required");
    this.#request = request;
    this.pollIntervalMs = pollIntervalMs;
  }
  get state() { return structuredClone(this.#state); }
  async start() { await this.refresh(); this.#timer = setInterval(() => this.refresh().catch(() => {}), this.pollIntervalMs); }
  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
  async refresh() {
    try {
      const status = await this.#request();
      this.#state = {
        connection: { phase: status.dock?.connected ? "connected" : "disconnected", deviceId: status.dock?.device_id ?? null, sessionId: status.dock?.session_id ?? null, lastSeen: new Date().toISOString() },
        voice: { phase: status.voice ?? "idle", subtitle: { phase: status.subtitle ?? "unavailable", detail: null } },
        robot: {}, health: { runtime: status.runtime ?? "unknown", lastError: status.last_error ?? null },
      };
    } catch (error) { this.#state = { ...this.#state, connection: { ...this.#state.connection, phase: "unavailable" }, health: { runtime: "unavailable", lastError: error.message } }; }
    this.emit("state", this.state);
    return this.state;
  }
}
