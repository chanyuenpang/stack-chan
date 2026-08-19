import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SpeakerModeState } from "../src/speaker-mode-state.mjs";

test("speaker mode defaults to legacy close behavior and atomically persists only an acknowledged choice", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stackchan-speaker-mode-"));
  try {
    const filePath = path.join(directory, "speaker-mode-state.json");
    const state = new SpeakerModeState({ filePath });
    assert.equal(state.load(), false);
    state.save(true);
    assert.equal(state.load(), true);
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), { version: 1, enabled: true });
    writeFileSync(filePath, "{broken", "utf8");
    assert.equal(state.load(), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
