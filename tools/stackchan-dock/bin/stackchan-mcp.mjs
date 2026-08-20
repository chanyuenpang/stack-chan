#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStackchanUnifiedMcpServer } from "../src/xiaozhi-unified-mcp.mjs";

const token = process.env.STACKCHAN_XIAOZHI_TOKEN;
if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) {
  throw new Error("STACKCHAN_XIAOZHI_TOKEN is required for the StackChan unified MCP proxy");
}
await createStackchanUnifiedMcpServer({ token }).connect(new StdioServerTransport());
