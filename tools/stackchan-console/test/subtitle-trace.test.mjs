import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSubtitleTraceSink } from "../src/subtitle-trace.mjs";

test("enabled subtitle trace persists an ordered, readable NDJSON event stream", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-subtitle-trace-"));
  const filePath = join(directory, "subtitle.ndjson");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const trace = createSubtitleTraceSink({ enabled: true, filePath });
  trace.write({ source: "transcript", event: "turn_created", turnId: "turn_1" });
  trace.write({ source: "presenter", event: "turn_subtitle_bound", turnId: "turn_1", subtitleId: 7 });
  trace.write({ source: "device", event: "subtitle_ack", subtitle_id: 7, result: "display_accepted" });
  await trace.close();
  assert.deepEqual(readFileSync(filePath, "utf8").trim().split("\n").map(JSON.parse).map(({ at, ...event }) => event), [
    { source: "transcript", event: "turn_created", turnId: "turn_1" },
    { source: "presenter", event: "turn_subtitle_bound", turnId: "turn_1", subtitleId: 7 },
    { source: "device", event: "subtitle_ack", subtitle_id: 7, result: "display_accepted" },
  ]);
});

test("disabled subtitle trace performs no filesystem write", async () => {
  const trace = createSubtitleTraceSink();
  trace.write({ source: "transcript", event: "turn_created" });
  await trace.close();
});
