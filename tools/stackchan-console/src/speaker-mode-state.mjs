import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// This is a Dock preference, not a device setting. The device always boots
// with legacy close semantics and receives the preference after authentication.
export class SpeakerModeState {
  #filePath;

  constructor({ filePath } = {}) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new TypeError("speaker mode state path must be absolute");
    this.#filePath = filePath;
  }

  load() {
    try {
      const value = JSON.parse(readFileSync(this.#filePath, "utf8"));
      if (typeof value?.enabled !== "boolean") throw new TypeError("speaker mode state is invalid");
      return value.enabled;
    } catch (error) {
      // Missing, legacy, or malformed state deliberately preserves the old
      // screen-close behavior: close the complete audio channel.
      if (error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError) return false;
      throw error;
    }
  }

  save(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("speaker mode must be a boolean");
    mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, enabled })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#filePath);
  }
}
