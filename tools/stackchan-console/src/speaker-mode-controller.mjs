import { EventEmitter } from "node:events";

const TOOL_NAME = "self.stackchan.set_speaker_mode";

function isSpeakerModeAcknowledged(result) {
  if (result === true) return true;
  if (!result || typeof result !== "object" || result.isError !== false || !Array.isArray(result.content)) return false;
  return result.content.length === 1 &&
    result.content[0]?.type === "text" &&
    result.content[0]?.text === "true";
}

function snapshot({ enabled, synchronized = false, pending = false, error = null, inputMuted = null }) {
  return { enabled, synchronized, pending, error, input_muted: inputMuted };
}

export class SpeakerModeController extends EventEmitter {
  #dock; #stateStore; #state;

  constructor({ dock, state } = {}) {
    super();
    if (!dock || typeof dock.callTool !== "function") throw new TypeError("an authenticated Dock MCP client is required");
    if (!state || typeof state.load !== "function" || typeof state.save !== "function") throw new TypeError("speaker mode persistence is required");
    this.#dock = dock;
    this.#stateStore = state;
    this.#state = snapshot({ enabled: state.load() });
  }

  get current() { return structuredClone(this.#state); }

  async sync() {
    return this.#apply(this.#state.enabled, { persist: false });
  }

  async set(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("speaker mode must be a boolean");
    return this.#apply(enabled, { persist: true });
  }

  setInputMuted(inputMuted) {
    if (typeof inputMuted !== "boolean") throw new TypeError("speaker input-muted state must be a boolean");
    this.#publish({ ...this.#state, input_muted: inputMuted });
  }

  async #apply(enabled, { persist }) {
    if (!this.#dock.connected) {
      const error = "机器人尚未认证，喇叭模式未修改";
      this.#publish({ ...this.#state, pending: false, error, synchronized: false });
      throw new Error(error);
    }
    this.#publish({ ...this.#state, pending: true, error: null, synchronized: false });
    try {
      const result = await this.#dock.callTool(TOOL_NAME, { enabled });
      if (!isSpeakerModeAcknowledged(result)) throw new Error("机器人未确认喇叭模式设置");
      if (persist) this.#stateStore.save(enabled);
      this.#publish(snapshot({ enabled, synchronized: true, inputMuted: this.#state.input_muted }));
      return this.current;
    } catch (error) {
      this.#publish({ ...this.#state, pending: false, synchronized: false, error: error.message });
      throw error;
    }
  }

  #publish(next) {
    this.#state = next;
    this.emit("state", this.current);
  }
}
