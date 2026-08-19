#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createXiaozhiVolumeMcpServer } from "../src/xiaozhi-volume-mcp.mjs";

const token = process.env.STACKCHAN_XIAOZHI_TOKEN;
if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) {
  throw new Error("STACKCHAN_XIAOZHI_TOKEN is required for the local StackChan volume MCP");
}
await createXiaozhiVolumeMcpServer({ token }).connect(new StdioServerTransport());
