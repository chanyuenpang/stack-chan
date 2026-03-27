import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
/**
 * XiaoYi Channel Plugin for OpenClaw
 *
 * This plugin enables integration with XiaoYi's A2A protocol via WebSocket.
 * Supports dual server mode for high availability.
 *
 * Configuration example in openclaw.json:
 * {
 *   "channels": {
 *     "xiaoyi": {
 *       "enabled": true,
 *       "wsUrl1": "ws://localhost:8765/ws/link",
 *       "wsUrl2": "ws://localhost:8766/ws/link",
 *       "ak": "test_ak",
 *       "sk": "test_sk",
 *       "agentId": "your-agent-id"
 *     }
 *   }
 * }
 */
declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: any;
    register(api: OpenClawPluginApi): void;
};
export default plugin;
