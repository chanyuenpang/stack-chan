import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CodexVoiceTranscriptSource,
  parseCodexVoiceTranscriptEvent,
  parseCodexRealtimeWireTranscriptEvent,
} from "../src/codex-voice-transcript-source.mjs";

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

test("parses Codex realtime transcript delta and done events", () => {
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "你好\\nStack-chan" })'),
    { type: "delta", text: "你好\nStack-chan" },
  );
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "完成了" })'),
    { type: "done", text: "完成了" },
  );
  assert.equal(parseCodexVoiceTranscriptEvent("unrelated"), null);
  assert.deepEqual(
    parseCodexVoiceTranscriptEvent('received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })'),
    { type: "user_delta", text: "打断" },
  );
});

test("parses correlated Realtime wire turn delta and done events", () => {
  assert.deepEqual(
    parseCodexRealtimeWireTranscriptEvent('realtime websocket event: {"type":"turn.created","turn":{"id":"turn_1","role":"assistant","start_ms":100,"end_ms":120,"transcript":"好，"}}'),
    { type: "created", role: "assistant", text: "好，", turnId: "turn_1", startMs: 100, endMs: 120 },
  );
  assert.deepEqual(
    parseCodexRealtimeWireTranscriptEvent('realtime websocket event: {"type":"turn.delta","turn_id":"turn_1","start_ms":120,"end_ms":340,"delta":"你好"}'),
    { type: "delta", text: "你好", turnId: "turn_1", startMs: 120, endMs: 340 },
  );
  assert.deepEqual(
    parseCodexRealtimeWireTranscriptEvent('realtime websocket event: {"type":"turn.done","turn":{"id":"turn_1","role":"assistant","start_ms":120,"end_ms":340,"transcript":"你好"}}'),
    { type: "done", role: "assistant", text: "你好", turnId: "turn_1", startMs: 120, endMs: 340 },
  );
});

test("a user Realtime turn and its echo deltas never enter the assistant subtitle stream", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, feedback_log_body TEXT, process_uuid TEXT)");
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5, trace: true });
  const events = [];
  const trace = [];
  const userTurns = [];
  source.on("assistantResponseStarted", ({ turnId }) => events.push(["start", turnId]));
  source.on("assistantTextDelta", ({ turnId, text }) => events.push(["delta", turnId, text]));
  source.on("assistantTextDone", ({ turnId }) => events.push(["done", turnId]));
  source.on("lifecycleTrace", (entry) => trace.push(entry));
  source.on("userTurnStarted", ({ turnId }) => userTurns.push(["started", turnId]));
  source.on("userTurnDone", ({ turnId }) => userTurns.push(["done", turnId]));
  source.start();
  t.after(() => { source.stop(); writer.close(); rmSync(directory, { recursive: true, force: true }); });

  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.created","turn":{"id":"turn_user","role":"user","transcript":"用户开头"}}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.delta","turn_id":"turn_user","delta":"用户后续"}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.done","turn":{"id":"turn_user","role":"user","transcript":"用户完整"}}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.created","turn":{"id":"turn_assistant","role":"assistant","transcript":"助手开头"}}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.delta","turn_id":"turn_assistant","delta":"助手后续"}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.done","turn":{"id":"turn_assistant","role":"assistant","transcript":"助手完整"}}', "voice-process");

  await waitFor(() => events.some(([type]) => type === "done"));
  assert.deepEqual(events, [
    ["start", "turn_assistant"], ["delta", "turn_assistant", "助手开头"], ["delta", "turn_assistant", "助手后续"], ["done", "turn_assistant"],
  ]);
  assert.ok(trace.some(({ event, turnId, reason }) => event === "assistant_turn_ignored" && turnId === "turn_user" && reason === "non_assistant_role"));
  assert.ok(trace.some(({ event, turnId, reason }) => event === "assistant_delta_ignored" && turnId === "turn_user" && reason === "non_assistant_turn"));
  assert.deepEqual(userTurns, [["started", "turn_user"], ["done", "turn_user"]]);
  assert.ok(trace.some(({ event, turnId }) => event === "user_turn_done" && turnId === "turn_user"));
});

test("a delta before assistant turn.created fails closed instead of creating a subtitle", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, feedback_log_body TEXT, process_uuid TEXT)");
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5, trace: true });
  const events = [];
  const trace = [];
  source.on("assistantTextDelta", ({ text }) => events.push(text));
  source.on("lifecycleTrace", (entry) => trace.push(entry));
  source.start();
  t.after(() => { source.stop(); writer.close(); rmSync(directory, { recursive: true, force: true }); });
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.delta","turn_id":"turn_late_created","delta":"不得显示"}', "voice-process");
  await waitFor(() => trace.some(({ turnId, reason }) => turnId === "turn_late_created" && reason === "unconfirmed_turn"));
  assert.deepEqual(events, []);
});

test("parses the fallback audio-aligned Realtime wire transcript event", () => {
  assert.deepEqual(
    parseCodexRealtimeWireTranscriptEvent('realtime websocket event: {"type":"output_transcript.added","start_ms":120,"end_ms":340,"item":{"id":"item_1","type":"output_transcript","text":"你好"}}'),
    { type: "delta", text: "你好", itemId: "item_1", startMs: 120, endMs: 340 },
  );
});

test("wire turn IDs close only their active response and ignore a late done after interruption", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, feedback_log_body TEXT, process_uuid TEXT)");
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantResponseStarted", ({ turnId }) => events.push(["start", turnId]));
  source.on("assistantTextDelta", ({ text, turnId }) => events.push(["delta", turnId, text]));
  source.on("assistantTextDone", ({ turnId, text }) => events.push(["done", turnId, text]));
  source.start();
  t.after(() => { source.stop(); writer.close(); rmSync(directory, { recursive: true, force: true }); });

  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.created","turn":{"id":"turn_old","role":"assistant","transcript":"首段"}}', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.done","turn":{"id":"turn_old","role":"assistant","transcript":"首段"}}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.created","turn":{"id":"turn_new","role":"assistant","transcript":"新首段"}}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.delta","turn_id":"turn_new","delta":"延迟追加"}', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"turn.done","turn":{"id":"turn_new","role":"assistant","transcript":"新首段延迟追加"}}', "voice-process");

  await waitFor(() => events.some(([type]) => type === "done"));
  assert.deepEqual(events, [
    ["start", "turn_old"], ["delta", "turn_old", "首段"],
    ["start", "turn_new"], ["delta", "turn_new", "新首段"], ["delta", "turn_new", "延迟追加"],
    ["done", "turn_new", "新首段延迟追加"],
  ]);
});

test("prefers Realtime wire transcripts over delayed conversation transcript notifications", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec(`CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, feedback_log_body TEXT, process_uuid TEXT)`);
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"output_transcript.added","start_ms":0,"end_ms":100,"item":{"id":"item_1","text":"同源"}}', "voice-process");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantTextDelta", ({ text, source: origin }) => events.push([text, origin]));
  source.start();
  t.after(() => { source.stop(); writer.close(); rmSync(directory, { recursive: true, force: true }); });
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "延迟副本" })', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"output_transcript.added","start_ms":100,"end_ms":200,"item":{"id":"item_2","text":"事件"}}', "voice-process");
  await waitFor(() => events.length === 1);
  assert.deepEqual(events, [["事件", "realtime-wire"]]);
});

test("tails only new assistant transcript rows and emits incremental text", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    feedback_log_body TEXT,
    process_uuid TEXT
  )`);
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "historic" })', "old");

  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantResponseStarted", () => events.push(["start"]));
  source.on("assistantTextDelta", ({ text }) => events.push(["delta", text]));
  source.on("assistantTextDone", ({ text }) => events.push(["done", text]));
  source.start();
  t.after(() => {
    source.stop();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });

  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "你" })', "voice-process");
  insert.run("unrelated", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "ignored" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "好" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "你好" })', "voice-process");

  await waitFor(() => events.some(([type]) => type === "done"));
  assert.deepEqual(events, [["start"], ["delta", "你"], ["delta", "好"], ["done", "你好"]]);
});

test("user interruption stops the active response without restarting on its late done event", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    feedback_log_body TEXT,
    process_uuid TEXT
  )`);
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5 });
  const events = [];
  source.on("assistantResponseStarted", () => events.push("start"));
  source.on("assistantTextDelta", () => events.push("delta"));
  source.on("assistantTextDone", () => events.push("done"));
  source.on("userSpeechStarted", () => events.push("user"));
  source.start();
  t.after(() => {
    source.stop();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });

  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "旧回复" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "继续说" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDone(RealtimeTranscriptDone { text: "旧回复" })', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=OutputTranscriptDelta(RealtimeTranscriptDelta { delta: "新回复" })', "voice-process");

  await waitFor(() => events.filter((event) => event === "start").length === 2);
  assert.deepEqual(events, ["start", "delta", "user", "done", "start", "delta"]);
});

test("optional lifecycle trace records the exact wire-to-response boundary reason", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "stackchan-codex-log-"));
  const databasePath = join(directory, "logs.sqlite");
  const writer = new DatabaseSync(databasePath);
  writer.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT, feedback_log_body TEXT, process_uuid TEXT)");
  const insert = writer.prepare("INSERT INTO logs(target, feedback_log_body, process_uuid) VALUES (?, ?, ?)");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"output_transcript.added","item":{"id":"historic","text":"历史"}}', "historic-process");

  const source = new CodexVoiceTranscriptSource({ databasePath, pollIntervalMs: 5, trace: true });
  const trace = [];
  source.on("lifecycleTrace", (entry) => trace.push(entry));
  source.start();
  t.after(() => { source.stop(); writer.close(); rmSync(directory, { recursive: true, force: true }); });

  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"output_transcript.added","item":{"id":"item_a","text":"先"}}', "voice-process");
  insert.run("codex_core::realtime_conversation", 'received realtime conversation event event=InputTranscriptDelta(RealtimeTranscriptDelta { delta: "打断" })', "voice-process");
  insert.run("codex_api::realtime_websocket::wire", 'realtime websocket event: {"type":"output_transcript.added","item":{"id":"item_b","text":"后"}}', "voice-process");

  await waitFor(() => trace.filter((entry) => entry.event === "assistant_response_started").length === 2);
  const starts = trace.filter((entry) => entry.event === "assistant_response_started");
  assert.deepEqual(starts.map(({ event, processUuid, reason, source, itemId }) => ({ event, processUuid, reason, source, itemId })), [
    { event: "assistant_response_started", processUuid: "voice-process", reason: "initial", source: "realtime-wire", itemId: "item_a" },
    { event: "assistant_response_started", processUuid: "voice-process", reason: "input_interrupt", source: "realtime-wire", itemId: "item_b" },
  ]);
  assert.deepEqual(trace.find((entry) => entry.event === "user_delta" && entry.rowId), {
    source: "transcript", event: "user_delta", at: trace.find((entry) => entry.event === "user_delta" && entry.rowId).at,
    rowId: 3, processUuid: "voice-process", activeProcessUuid: "voice-process", wireAvailable: true, marksInterrupted: true, textLength: 2,
  });
});
