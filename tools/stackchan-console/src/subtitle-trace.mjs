import { mkdirSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";

export function createSubtitleTraceSink({ enabled = false, filePath, onError = () => {} } = {}) {
  if (!enabled) return Object.freeze({ write() {}, close: async () => {} });
  if (typeof filePath !== "string" || !filePath) throw new TypeError("subtitle trace filePath is required when enabled");
  mkdirSync(dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  stream.on("error", onError);
  return Object.freeze({
    write(entry) { stream.write(`${JSON.stringify({ at: Date.now(), ...entry })}\n`); },
    close: () => new Promise((resolve) => stream.end(resolve)),
  });
}
