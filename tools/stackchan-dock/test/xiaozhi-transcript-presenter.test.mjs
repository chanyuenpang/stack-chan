import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { XiaozhiTranscriptPresenter } from "../src/xiaozhi-transcript-presenter.mjs";

class FakeServer extends EventEmitter {
  messages = [];
  sendTtsSentence(text, subtitleId) { this.messages.push({ state: "sentence_start", subtitleId, text }); }
  sendTtsSentenceAppend(subtitleId, text, options) { this.messages.push({ state: "sentence_append", subtitleId, text, ...options }); }
  sendTtsSubtitleTrim(subtitleId) { this.messages.push({ state: "subtitle_trim", subtitleId }); }
  sendTtsResponseEnd(subtitleId) { this.messages.push({ state: "response_end", subtitleId }); }
  sendTtsSubtitleCancel(subtitleId) { this.messages.push({ state: "subtitle_cancel", subtitleId }); }
}

test("a new assistant turn atomically cancels its old open subtitle before its new start", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("旧首段");
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("新首段");
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "旧首段" },
    { state: "subtitle_cancel", subtitleId: 1 },
    { state: "sentence_start", subtitleId: 2, text: "新首段" },
  ]);
  presenter.dispose();
});

test("a completed subtitle is not cancelled by the following assistant turn", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("已经结束");
  presenter.completeAssistantText();
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("下一轮");
  assert.equal(server.messages.some(({ state }) => state === "subtitle_cancel"), false);
  presenter.dispose();
});

test("subtitle delivery switch cancels the current robot subtitle and leaves later audio text unsent", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server);
  presenter.appendAssistantText("正在显示");
  assert.equal(presenter.setEnabled(false), false);
  presenter.appendAssistantText("不应发送");
  presenter.completeAssistantText("不应发送");
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "正在显示" },
    { state: "subtitle_cancel", subtitleId: 1 },
  ]);
  presenter.setEnabled(true);
  presenter.appendAssistantText("重新开启");
  assert.deepEqual(server.messages.at(-1), { state: "sentence_start", subtitleId: 2, text: "重新开启" });
});

test("first delta is immediate, then a readable Chinese soft boundary commits once", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("前");
  presenter.appendAssistantText("半句，");
  assert.deepEqual(server.messages, [{ state: "sentence_start", subtitleId: 1, text: "前" }]);

  presenter.appendAssistantText("继续展示。");
  presenter.completeAssistantText();
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "前" },
    { state: "sentence_append", subtitleId: 1, text: "半句，继续展示。", trimAfterAppend: true },
    { state: "response_end", subtitleId: 1 },
  ]);
  presenter.dispose();
});

test("one raw delta with multiple soft boundaries becomes one sparse visible commit at its last boundary", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("首");
  presenter.appendAssistantText("一，二！三。");
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "首" },
    { state: "sentence_append", subtitleId: 1, text: "一，二！三。", trimAfterAppend: true },
  ]);
  presenter.dispose();
});

test("a short Chinese dunhao fragment does not trigger a visible commit before six code points", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("首");
  presenter.appendAssistantText("二、三");
  assert.equal(server.messages.length, 1);
  presenter.appendAssistantText("四五六。");
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "首" },
    { state: "sentence_append", subtitleId: 1, text: "二、三四五六。", trimAfterAppend: true },
  ]);
  presenter.dispose();
});

test("an unpunctuated stream requires both a readable increment and the visible interval fallback", async () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, {
    maxUnpunctuatedWaitMs: 15,
    maxUnpunctuatedCodepoints: 4,
  });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("a");
  presenter.appendAssistantText("bcde");
  assert.equal(server.messages.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "a" },
    { state: "sentence_append", subtitleId: 1, text: "bcde", trimAfterAppend: true },
  ]);
  presenter.dispose();
});

test("elapsed time alone does not commit an unreadably short unpunctuated fragment", async () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, {
    maxUnpunctuatedWaitMs: 15,
    maxUnpunctuatedCodepoints: 8,
  });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("start");
  presenter.appendAssistantText(" xx");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(server.messages, [{ state: "sentence_start", subtitleId: 1, text: "start" }]);
  presenter.dispose();
});

test("English punctuation and emoji preserve one response ID and never send a standalone trim", () => {
  const server = new FakeServer();
  const presenter = new XiaozhiTranscriptPresenter(server, { maxUnpunctuatedWaitMs: 10_000 });
  presenter.beginAssistantResponse();
  presenter.appendAssistantText("Hello");
  presenter.appendAssistantText(" world 😊!");
  presenter.completeAssistantText();
  assert.deepEqual(server.messages, [
    { state: "sentence_start", subtitleId: 1, text: "Hello" },
    { state: "sentence_append", subtitleId: 1, text: " world 😊!", trimAfterAppend: true },
    { state: "response_end", subtitleId: 1 },
  ]);
  assert.equal(server.messages.some(({ state }) => state === "subtitle_trim"), false);
  presenter.dispose();
});
