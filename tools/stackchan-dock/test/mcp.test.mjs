import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createStackchanMcpServer, MCP_TOOL } from "../src/mcp.mjs";

class FakeDock {
  calls = [];
  async getStatus() { this.calls.push(["getStatus"]); return { connected: true, audio: {} }; }
  async setAudioEndpoints(args) { this.calls.push(["setAudioEndpoints", args]); return args; }
  async setExpression(value) { this.calls.push(["setExpression", value]); return { expression: value }; }
  async setLed(red, green, blue) { this.calls.push(["setLed", red, green, blue]); return { red, green, blue }; }
  async getHead() { this.calls.push(["getHead"]); return { yaw: 0, pitch: 20 }; }
  async setHead(yaw, pitch, speed) { this.calls.push(["setHead", yaw, pitch, speed]); return { yaw, pitch, speed }; }
}

async function createHarness() {
  const dock = new FakeDock();
  const server = createStackchanMcpServer(dock);
  const client = new Client({ name: "stackchan-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { dock, server, client };
}

test("MCP publishes only the six typed Stack-chan tools", async (t) => {
  const { server, client } = await createHarness();
  t.after(() => server.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), Object.values(MCP_TOOL).sort());
  assert.equal(tools.some(({ name }) => /raw|exec|command|shell|passthrough/i.test(name)), false);
  assert.equal(tools.every(({ inputSchema }) => inputSchema.additionalProperties === false), true);
});

test("official XiaoZhi route does not publish unsupported legacy audio toggles", async (t) => {
  const dock = new FakeDock();
  dock.capabilities = Object.freeze({ audioControl: false });
  const server = createStackchanMcpServer(dock);
  const client = new Client({ name: "stackchan-xiaozhi-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => server.close());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    MCP_TOOL.GET_HEAD,
    MCP_TOOL.GET_STATUS,
    MCP_TOOL.SET_EXPRESSION,
    MCP_TOOL.SET_HEAD,
    MCP_TOOL.SET_LED,
  ].sort());
});

test("MCP dispatches every allowed tool only through typed Dock methods", async (t) => {
  const { dock, server, client } = await createHarness();
  t.after(() => server.close());
  const calls = [
    [MCP_TOOL.GET_STATUS, {}],
    [MCP_TOOL.SET_AUDIO, { microphone_enabled: false, speaker_enabled: true }],
    [MCP_TOOL.SET_EXPRESSION, { expression: "happy" }],
    [MCP_TOOL.SET_LED, { red: 1, green: 2, blue: 3 }],
    [MCP_TOOL.GET_HEAD, {}],
    [MCP_TOOL.SET_HEAD, { yaw: 10, pitch: 30, speed: 180 }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, name);
  }
  assert.deepEqual(dock.calls.map(([name]) => name), [
    "getStatus", "setAudioEndpoints", "setExpression", "setLed", "getHead", "setHead",
  ]);
});

test("MCP rejects unknown tools, unknown fields, arbitrary commands, and unsafe ranges", async (t) => {
  const { dock, server, client } = await createHarness();
  t.after(() => server.close());
  const rejected = [
    ["stackchan_exec", { command: "erase-flash" }],
    [MCP_TOOL.GET_STATUS, { command: "raw" }],
    [MCP_TOOL.SET_AUDIO, {}],
    [MCP_TOOL.SET_EXPRESSION, { expression: "custom_script" }],
    [MCP_TOOL.SET_LED, { red: 169, green: 0, blue: 0 }],
    [MCP_TOOL.SET_HEAD, { yaw: 0, pitch: 20, speed: 999 }],
  ];
  for (const [name, args] of rejected) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, name);
  }
  assert.deepEqual(dock.calls, []);
});

test("MCP reports Dock disconnection as a tool error without exposing a transport API", async (t) => {
  const dock = new FakeDock();
  dock.getStatus = async () => { throw new Error("Stack-chan is not connected"); };
  const server = createStackchanMcpServer(dock);
  const client = new Client({ name: "stackchan-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => server.close());
  const result = await client.callTool({ name: MCP_TOOL.GET_STATUS, arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not connected/);
});
