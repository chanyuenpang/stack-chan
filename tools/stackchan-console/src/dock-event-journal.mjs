import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 5;

function checkedPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function safeDetails(value) {
  if (value instanceof Error) return { message: String(value.message).slice(0, 1_024), name: value.name };
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 4_096) : item]));
}

// A tiny synchronous append-only journal is intentional: lifecycle events are
// infrequent, and a power loss immediately after a device disconnect must not
// leave the only host-side evidence stranded in an unwritten stream buffer.
export class DockEventJournal {
  #filePath; #maxBytes; #maxFiles; #sequence = 0; #startedAt = performance.now(); #closed = false;

  constructor({ filePath, maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES } = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("journal filePath is required");
    this.#filePath = filePath;
    this.#maxBytes = checkedPositiveInteger(maxBytes, "maxBytes");
    this.#maxFiles = checkedPositiveInteger(maxFiles, "maxFiles");
    mkdirSync(dirname(filePath), { recursive: true });
  }

  write(domain, event, details = {}) {
    if (this.#closed) return;
    if (typeof domain !== "string" || !domain || typeof event !== "string" || !event) throw new TypeError("journal domain and event are required");
    const entry = {
      version: 1,
      sequence: ++this.#sequence,
      at: new Date().toISOString(),
      monotonic_ms: Math.round(performance.now() - this.#startedAt),
      domain,
      event,
      details: safeDetails(details),
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (existsSync(this.#filePath) && statSync(this.#filePath).size + Buffer.byteLength(line) > this.#maxBytes) this.#rotate();
    appendFileSync(this.#filePath, line, { encoding: "utf8" });
  }

  close() { this.#closed = true; }

  #rotate() {
    // maxFiles includes the active file, so retain at most maxFiles - 1
    // archived generations alongside it.
    const oldestArchive = `${this.#filePath}.${this.#maxFiles - 1}`;
    if (this.#maxFiles > 1 && existsSync(oldestArchive)) rmSync(oldestArchive);
    for (let index = this.#maxFiles - 2; index >= 1; index -= 1) {
      const from = `${this.#filePath}.${index}`;
      const to = `${this.#filePath}.${index + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    if (this.#maxFiles > 1 && existsSync(this.#filePath)) renameSync(this.#filePath, `${this.#filePath}.1`);
    else if (this.#maxFiles === 1 && existsSync(this.#filePath)) rmSync(this.#filePath);
  }
}
