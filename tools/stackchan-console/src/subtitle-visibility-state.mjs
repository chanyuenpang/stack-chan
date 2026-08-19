import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export class SubtitleVisibilityState {
  #filePath;

  constructor({ filePath } = {}) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new TypeError("subtitle visibility state path must be absolute");
    this.#filePath = filePath;
  }

  load() {
    try {
      const value = JSON.parse(readFileSync(this.#filePath, "utf8"));
      if (typeof value?.enabled !== "boolean") throw new TypeError("subtitle visibility state is invalid");
      return value.enabled;
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError) return true;
      throw error;
    }
  }

  save(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("subtitle visibility must be a boolean");
    mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, enabled })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#filePath);
  }
}
