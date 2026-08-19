import test from "node:test";

test("closing the Dock window hides it to the notification area while the tray offers an explicit exit", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /window\.on\("close", \(event\) => \{/);
  assert.match(main, /event\.preventDefault\(\);\s*\n\s*window\.hide\(\);/);
  assert.match(main, /new Tray\(stackchanIcon\(\)\)/);
  assert.match(main, /label: "退出 Dock", click: \(\) => \{ quitting = true; app\.quit\(\); \}/);
  assert.doesNotMatch(main, /app\.on\("window-all-closed", \(\) => app\.quit\(\)\)/);
});

test("Dock uses the classic StackChan two-dot-and-line expression for window and tray icons", async () => {
  const [main, icon] = await Promise.all([
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/stackchan-icon.svg", import.meta.url), "utf8"),
  ]);
  const ico = new URL("../src/stackchan-icon.ico", import.meta.url);
  assert.match(main, /icon: stackchanIcon\(\)/);
  assert.match(main, /new Tray\(stackchanIcon\(\)\)/);
  assert.match(main, /nativeImage\.createFromPath\(path\.join\(directory, "stackchan-icon\.ico"\)\)/);
  assert.doesNotMatch(main, /nativeImage\.createFromDataURL/);
  const icoBytes = await readFile(ico);
  assert.deepEqual([...icoBytes.subarray(0, 4)], [0, 0, 1, 0]);
  assert.match(icon, /<circle cx="22" cy="27" r="4"/);
  assert.match(icon, /<circle cx="42" cy="27" r="4"/);
  assert.match(icon, /<path d="M21 42H43"/);
});
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("main process uses the sandbox-compatible CommonJS preload bridge", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /preload\.cjs/);
});

test("renderer volume bridge exposes only typed IPC methods", async () => {
  const preload = await readFile(new URL("../src/preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /getSpeakerVolume: \(\) => ipcRenderer\.invoke\("stackchan:get-speaker-volume"\)/);
  assert.match(preload, /setSpeakerVolume: \(volume\) => ipcRenderer\.invoke\("stackchan:set-speaker-volume", volume\)/);
  assert.match(preload, /getSubtitle: \(\) => ipcRenderer\.invoke\("stackchan:get-subtitle"\)/);
  assert.match(preload, /setSubtitleEnabled: \(enabled\) => ipcRenderer\.invoke\("stackchan:set-subtitle-enabled", enabled\)/);
  assert.match(preload, /onSubtitle: \(listener\) => \{/);
  assert.doesNotMatch(preload, /STACKCHAN_XIAOZHI_TOKEN|NamedPipe|createConnection/);
});

test("live subtitle display reads a dedicated Owner snapshot and never starts a second runtime", async () => {
  const [main, renderer, html] = await Promise.all([
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(main, /new SubtitlePublication\(\)/);
  assert.match(main, /presenter\.setEnabled\(subtitleEnabled\)/);
  assert.match(main, /const accepted = presenter\.setEnabled\(enabled\)/);
  assert.match(main, /ipcMain\.handle\("stackchan:get-subtitle", currentSubtitle\)/);
  assert.match(renderer, /api\.onSubtitle\(\(subtitle\) => renderSubtitle\(subtitle\)\)/);
  assert.match(html, /id="live-subtitle-text"/);
  assert.match(html, /id="subtitle-display-toggle"/);
});

test("Owner keeps a black-screen flight record received over the existing MCP session for local admin reads", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /notifications\/black_screen_flight_record/);
  assert.match(main, /black_screen_flight_record: blackScreenFlightRecord/);
});

test("volume slider previews locally and commits only on change", async () => {
  const renderer = await readFile(new URL("../src/renderer.mjs", import.meta.url), "utf8");
  assert.match(renderer, /speakerVolume\.addEventListener\("input", previewSpeakerVolume\)/);
  assert.match(renderer, /speakerVolume\.addEventListener\("change", \(\) => \{ void setSpeakerVolume\(\); \}\)/);
  assert.match(renderer, /预览：\$\{Number\(speakerVolume\.value\)\}%/);
});

test("audio control has a dedicated stable panel rather than living in status-dependent rows", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../src/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<section class="audio-control"/);
  assert.match(html, /max="150"/);
  assert.match(html, /101–150% 使用 Dock 安全增益/);
  assert.match(css, /\.hero \{[^}]*height: 480px/);
  assert.match(css, /\.hero-copy \{[^}]*grid-template-rows: 25px 124px 80px 32px/);
  assert.match(css, /\.audio-control \{[^}]*min-height: 138px/);
});
