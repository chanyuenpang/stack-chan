import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { installBrokenPipeGuards } from "../src/broken-pipe-guard.mjs";

test("closed inherited output pipes are recorded without becoming an uncaught owner error", () => {
  const stderr = new EventEmitter();
  const closed = [];
  installBrokenPipeGuards({ streams: [stderr], onClosedPeer: (details) => closed.push(details) });

  assert.doesNotThrow(() => stderr.emit("error", Object.assign(new Error("broken pipe, write"), { code: "EPIPE" })));
  assert.deepEqual(closed, [{ stream: "stream_1", code: "EPIPE", message: "broken pipe, write" }]);
});

test("non-pipe stdio failures are reported separately and do not rewrite a real IPC error", () => {
  const stderr = new EventEmitter();
  const unexpected = [];
  installBrokenPipeGuards({ streams: [stderr], onUnexpectedError: (details) => unexpected.push(details) });

  stderr.emit("error", Object.assign(new Error("disk failure"), { code: "EIO" }));
  assert.deepEqual(unexpected, [{ stream: "stream_1", code: "EIO", message: "disk failure" }]);
});
