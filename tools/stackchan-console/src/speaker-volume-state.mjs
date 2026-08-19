import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SPEAKER_VOLUME_MIN = 0;
export const SPEAKER_VOLUME_MAX = 150;
export const SPEAKER_VOLUME_UNITY = 100;

export function checkedSpeakerVolume(value) {
  if (!Number.isInteger(value) || value < SPEAKER_VOLUME_MIN || value > SPEAKER_VOLUME_MAX) {
    throw new RangeError("robot speaker volume must be an integer from 0 through 150");
  }
  return value;
}

// This file contains only the user-facing logical value.  The robot still
// persists its physical 0..100 codec value separately through XiaoZhi MCP.
export class SpeakerVolumeState {
  #filePath;

  constructor({ filePath } = {}) {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new TypeError("speaker volume state path must be absolute");
    this.#filePath = filePath;
  }

  load() {
    try {
      const value = JSON.parse(readFileSync(this.#filePath, "utf8"));
      return checkedSpeakerVolume(value?.volume);
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof RangeError) return SPEAKER_VOLUME_UNITY;
      throw error;
    }
  }

  save(volume) {
    checkedSpeakerVolume(volume);
    mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, volume })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#filePath);
  }
}
