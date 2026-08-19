import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { requestXiaozhiLocalAdmin } from "../src/xiaozhi-local-admin-client.mjs";

const token = "a".repeat(64);

class FakePipe extends EventEmitter {
  setEncoding() {}
  write(request) { this.request = request; }
  end() { this.closed = true; }
  destroy(error) { this.emit("error", error); }
}

function connectWith(chunks) {
  return () => {
    const socket = new FakePipe();
    queueMicrotask(() => {
      socket.emit("connect");
      for (const chunk of chunks) socket.emit("data", chunk);
      socket.emit("end");
    });
    return socket;
  };
}

test("local admin client returns an explicit error for an empty pipe response", async () => {
  await assert.rejects(requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", connect: connectWith([]) }),
    /StackChan Owner local admin returned an empty response/);
});

test("local admin client returns an explicit error for a truncated pipe response", async () => {
  await assert.rejects(requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", connect: connectWith(['{"ok":true,"result":']) }),
    /StackChan Owner local admin returned an invalid JSON response/);
});

test("local admin client retains an explicit server error", async () => {
  await assert.rejects(requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", connect: connectWith(['{"ok":false,"error":"XiaoZhi device is not authenticated"}']) }),
    /XiaoZhi device is not authenticated/);
});

test("local admin client coalesces concurrent reads for the same authenticated pipe", async () => {
  let connections = 0;
  const baseConnect = connectWith(['{"ok":true,"result":{"volume":50}}']);
  const connect = (...args) => { connections += 1; return baseConnect(...args); };
  const replies = await Promise.all(Array.from({ length: 20 }, () =>
    requestXiaozhiLocalAdmin({ token, operation: "get-speaker-volume", connect })));
  assert.equal(connections, 1);
  assert.deepEqual(replies, Array.from({ length: 20 }, () => ({ volume: 50 })));
});

test("local admin client writes a request frame and waits for a response frame before closing", async () => {
  let pipe;
  const connect = () => {
    pipe = new FakePipe();
    queueMicrotask(() => {
      pipe.emit("connect");
      assert.match(pipe.request, /\"operation\":\"get-speaker-volume\"/);
      assert.equal(pipe.closed, undefined);
      pipe.emit("data", '{"ok":true,"result":{"volume":50}}\n');
    });
    return pipe;
  };
  assert.deepEqual(await requestXiaozhiLocalAdmin({ token: "b".repeat(64), operation: "get-speaker-volume", connect }), { volume: 50 });
  assert.equal(pipe.closed, true);
});

test("local admin client frames an allowlisted RGB LED request and rejects out-of-range values", async () => {
  let pipe;
  const connect = () => {
    pipe = new FakePipe();
    queueMicrotask(() => {
      pipe.emit("connect");
      assert.match(pipe.request, /"operation":"set-robot-led-color"/);
      assert.match(pipe.request, /"red":120/);
      pipe.emit("data", '{"ok":true,"result":{"accepted":true,"color":{"red":120,"green":0,"blue":168}}}\n');
    });
    return pipe;
  };
  assert.equal((await requestXiaozhiLocalAdmin({ token: "c".repeat(64), operation: "set-robot-led-color", red: 120, green: 0, blue: 168, connect })).accepted, true);
  assert.throws(() => requestXiaozhiLocalAdmin({ token, operation: "set-robot-led-color", red: -1, green: 0, blue: 0, connect }), /0 to 168/);
});
