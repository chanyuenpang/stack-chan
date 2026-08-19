import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SubtitleVisibilityState } from "../src/subtitle-visibility-state.mjs";

test("subtitle visibility defaults open and preserves the user's switch choice", () => {
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), "stackchan-subtitle-visibility-")), "state.json");
  const state = new SubtitleVisibilityState({ filePath });
  assert.equal(state.load(), true);
  state.save(false);
  assert.equal(state.load(), false);
});

test("malformed subtitle visibility state fails open", () => {
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), "stackchan-subtitle-visibility-")), "state.json");
  writeFileSync(filePath, "{not json", "utf8");
  assert.equal(new SubtitleVisibilityState({ filePath }).load(), true);
});
