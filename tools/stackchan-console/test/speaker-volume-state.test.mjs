import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { SpeakerVolumeState } from "../src/speaker-volume-state.mjs";

test("speaker volume state defaults safely and atomically round-trips boost", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stackchan-volume-"));
  try {
    const filePath = path.join(directory, "speaker-volume-state.json");
    const state = new SpeakerVolumeState({ filePath });
    assert.equal(state.load(), 100);
    state.save(150);
    assert.equal(state.load(), 150);
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), { version: 1, volume: 150 });
    assert.throws(() => state.save(151), /0 through 150/);
    writeFileSync(filePath, "{not json", "utf8");
    assert.equal(state.load(), 100);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
