import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { StackchanDock } from "./dock.mjs";
import { createStackchanMcpServer } from "./mcp.mjs";

const dock = new StackchanDock({
  preferredSerial: process.env.STACKCHAN_USB_SERIAL || undefined,
});
const server = createStackchanMcpServer(dock);

dock.on("dockError", (error) => console.error(`Stack-chan Dock: ${error.message}`));
dock.start().catch((error) => console.error(`Stack-chan Dock stopped: ${error.message}`));
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await server.close();
  await dock.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
