import assert from "node:assert/strict";
import test from "node:test";

import {
  XiaozhiBootstrapServer,
  createXiaozhiBootstrapResponse,
} from "../src/xiaozhi-bootstrap-server.mjs";

const token = "0123456789abcdef".repeat(4);
const websocketUrl = "ws://192.168.0.8:8765/xiaozhi/v1";

test("bootstrap response contains only the official websocket configuration", () => {
  assert.deepEqual(createXiaozhiBootstrapResponse({ websocketUrl, token }), {
    websocket: { url: websocketUrl, token, version: 1 },
  });
});

test("bootstrap authenticates the device and never exposes MQTT or firmware routes", async (t) => {
  const server = new XiaozhiBootstrapServer({ token, websocketUrl, expectedDeviceId: "aabbccddeeff" });
  const address = await server.listen({ host: "127.0.0.1" });
  t.after(() => server.close());
  const url = `http://127.0.0.1:${address.port}${address.path}`;

  const unauthorized = await fetch(url, { headers: { "Device-Id": "aabbccddeeff" } });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Device-Id": "aabbccddeeff",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ board: "stackchan" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload, { websocket: { url: websocketUrl, token, version: 1 } });
  assert.equal("mqtt" in payload, false);
  assert.equal("firmware" in payload, false);
  assert.deepEqual(server.stats, { requests: 2, authenticatedRequests: 1, rejectedRequests: 1 });
});
