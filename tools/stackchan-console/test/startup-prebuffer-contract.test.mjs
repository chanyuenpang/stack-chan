import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Owner startup discovers the current Codex root instead of retaining a stale PID", async () => {
  const script = await readFile(new URL("../scripts/start-stackchan-console.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(script, /TargetProcessId\s*=\s*17572/);
  assert.match(script, /Name = 'ChatGPT\.exe'/);
  assert.match(script, /Start Codex, then start the Dock again\./);
});

test("Dock autostart remains a current-user Startup shortcut and does not place the token in its command", async () => {
  const script = await readFile(new URL("../scripts/install-stackchan-dock-autostart.ps1", import.meta.url), "utf8");
  assert.match(script, /SpecialFolder\]::Startup/);
  assert.match(script, /CreateShortcut/);
  assert.match(script, /-Owner/);
  assert.doesNotMatch(script, /STACKCHAN_XIAOZHI_TOKEN\s*=/);
});

test("Owner wires the Local-Dock startup prebuffer as an explicit default-off option", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /parseLocalDockStartupPrebufferFrames\(process\.env\.STACKCHAN_LOCAL_DOCK_STARTUP_PREBUFFER_FRAMES\)/);
  assert.match(main, /startupPrebufferFrames:\s*parseLocalDockStartupPrebufferFrames/);
  assert.doesNotMatch(main, /STACKCHAN_LOCAL_DOCK_STARTUP_PREBUFFER_FRAMES\s*\|\|\s*["']17["']/);
});

test("Owner resolves broker gain dynamically so a broker recovery also restores volume control", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(main, /await runtime\.ensureBroker\(\)/);
  assert.match(main, /return runtime\.broker\.setOutputGainPercent\(percent\)/);
  assert.doesNotMatch(main, /SpeakerVolumeController\(\{ token, gain: runtime\.broker/);
});

test("Owner records prebuffer telemetry only through the opt-in subtitle timing trace", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  const traceBlock = main.slice(main.indexOf("if (subtitleTraceEnabled)"), main.indexOf("const start = runtime.start.bind(runtime)"));
  assert.match(traceBlock, /runtime\.on\("prebufferTiming", \(details\) => recordTrace\(\{ source: "audio_prebuffer", \.\.\.details \}\)\)/);
  const [prebufferWire] = traceBlock.match(/runtime\.on\("prebufferTiming"[^\n]+/) ?? [];
  assert.ok(prebufferWire);
  assert.doesNotMatch(prebufferWire, /opus|pcm|transcript|text:/i);
});

test("Owner opt-in trace preserves fixed Dock session close evidence without audio or text", async () => {
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  const traceBlock = main.slice(main.indexOf("if (subtitleTraceEnabled)"), main.indexOf("const start = runtime.start.bind(runtime)"));
  assert.match(traceBlock, /runtime\.on\("authenticated", \(\{ deviceId, sessionId \}\) => recordTrace\(\{ source: "dock_session", event: "authenticated", at: Date\.now\(\), device_id: deviceId, session_id: sessionId, voice_phase: voiceStatus\.phase \}\)\)/);
  assert.match(traceBlock, /runtime\.on\("disconnected", \(\{ deviceId, code, reason \}\) => recordTrace\(\{ source: "dock_session", event: "disconnected", at: Date\.now\(\), device_id: deviceId, close_code: code, close_reason: reason, voice_phase: voiceStatus\.phase \}\)\)/);
  const sessionWires = traceBlock.split("\n").filter((line) => line.includes('source: "dock_session"')).join("\n");
  assert.doesNotMatch(sessionWires, /opus|pcm|transcript|text:/i);
});
