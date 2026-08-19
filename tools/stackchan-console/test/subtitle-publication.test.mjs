import test from "node:test";
import assert from "node:assert/strict";

import { SubtitlePublication } from "../src/subtitle-publication.mjs";

test("subtitle publication mirrors only the latest presented subtitle and keeps no history", () => {
  const publication = new SubtitlePublication();
  publication.begin();
  publication.publish({ text: "第一句", subtitleId: 1 });
  publication.publish({ text: "第一句，已提交给机器人。", subtitleId: 1 });
  publication.complete();
  assert.deepEqual(publication.current, {
    availability: "available", enabled: true, phase: "complete", text: "第一句，已提交给机器人。", subtitleId: 1,
    updatedAt: publication.current.updatedAt,
  });
  publication.begin();
  assert.equal(publication.current.text, "");
  assert.equal(publication.current.subtitleId, null);
});

test("turning the Dock subtitle switch off clears the public mirror after delivery is stopped", () => {
  const publication = new SubtitlePublication();
  publication.publish({ text: "已经显示", subtitleId: 1 });
  publication.setEnabled(false);
  publication.publish({ text: "不能公开", subtitleId: 2 });
  assert.deepEqual(publication.current, { availability: "disabled", enabled: false, phase: "disabled", text: "", subtitleId: null, updatedAt: publication.current.updatedAt });
  publication.setEnabled(true);
  assert.deepEqual(publication.current, { availability: "available", enabled: true, phase: "idle", text: "", subtitleId: null, updatedAt: publication.current.updatedAt });
});

test("subtitle publication bounds a single live mirror by Unicode codepoints", () => {
  const publication = new SubtitlePublication();
  publication.publish({ text: "🙂".repeat(2_001), subtitleId: 2 });
  assert.equal(Array.from(publication.current.text).length, 2_000);
  assert.equal(publication.current.text, "🙂".repeat(2_000));
});
