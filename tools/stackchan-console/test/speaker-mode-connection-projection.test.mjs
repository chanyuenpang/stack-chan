import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const renderer = readFileSync(new URL("../src/renderer.mjs", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../src/renderer.css", import.meta.url), "utf8");

test("input-muted speaker mode reuses the disconnected red projection without disconnecting", () => {
  assert.match(renderer, /microphone-muted/);
  assert.match(renderer, /badge: "已关闭麦克风"/);
  assert.match(renderer, /开启后，屏幕关闭仅关闭麦克风输入；喇叭播放和 Dock 连接保持。/);
  assert.match(renderer, /phase === "connected"[\s\S]*enabled === true[\s\S]*input_muted === true/);
  assert.match(renderer, /state\.connection\?\.phase/);
  assert.match(stylesheet, /body\[data-connection="disconnected"\][^\n]*body\[data-connection="microphone-muted"\]/);
  assert.match(stylesheet, /body\[data-connection="microphone-muted"\] \.(?:connection-badge )?i/);
});
