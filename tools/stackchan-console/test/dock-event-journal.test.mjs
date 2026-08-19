import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DockEventJournal } from "../src/dock-event-journal.mjs";

test("journal persists ordered local and monotonic lifecycle records", () => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-journal-"));
  const filePath = join(directory, "dock.ndjson");
  try {
    const journal = new DockEventJournal({ filePath });
    journal.write("owner", "starting", { pid: 42 });
    journal.write("dock_session", "authenticated", { session_id: "session-1" });
    journal.close();
    const entries = readFileSync(filePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(entries.map(({ domain, event }) => ({ domain, event })), [
      { domain: "owner", event: "starting" }, { domain: "dock_session", event: "authenticated" },
    ]);
    assert.ok(entries.every((entry) => typeof entry.at === "string" && Number.isInteger(entry.monotonic_ms)));
    assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("journal rolls bounded files before exceeding its active-file limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-journal-"));
  const filePath = join(directory, "dock.ndjson");
  try {
    const journal = new DockEventJournal({ filePath, maxBytes: 160, maxFiles: 3 });
    for (let index = 0; index < 8; index += 1) journal.write("led", "applied", { index, detail: "x".repeat(20) });
    assert.ok(existsSync(filePath));
    assert.ok(existsSync(`${filePath}.1`));
    assert.ok(existsSync(`${filePath}.2`));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
