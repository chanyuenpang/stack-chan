import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../launcher/StackChanDockLauncher.cs", import.meta.url), "utf8");
const build = await readFile(new URL("../launcher/build-stackchan-dock-launcher.ps1", import.meta.url), "utf8");

test("desktop launcher delegates to the official owner script without exposing a console", () => {
  assert.match(source, /start-stackchan-console\.ps1/);
  assert.match(source, /-Owner/);
  assert.match(source, /CreateNoWindow = true/);
  assert.match(source, /WindowStyle = ProcessWindowStyle\.Hidden/);
  assert.match(source, /UseShellExecute = true/);
  assert.doesNotMatch(source, /RedirectStandardOutput/);
  assert.doesNotMatch(source, /RedirectStandardError/);
});

test("desktop launcher prevents duplicate owners and preserves token secrecy", () => {
  assert.match(source, /LauncherMutexName/);
  assert.match(source, /IsListening\(8765\)/);
  assert.match(source, /IsListening\(8766\)/);
  assert.match(source, /\[redacted token\]/);
  assert.doesNotMatch(source, /wifi-audio-dock-key\.dpapi/);
  assert.doesNotMatch(source, /STACKCHAN_XIAOZHI_TOKEN/);
});

test("launcher build is a Windows GUI executable", () => {
  assert.match(build, /v4\.0\.30319\\csc\.exe/);
  assert.match(build, /\/target:winexe/);
  assert.match(build, /StackChan-Dock-Launcher\.exe/);
  assert.match(build, /System\.Security\.Cryptography\.SHA256/);
});
