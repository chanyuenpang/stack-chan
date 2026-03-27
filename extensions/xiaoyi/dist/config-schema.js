"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XiaoYiConfigSchema = void 0;
const zod_1 = require("zod");
/**
 * XiaoYi configuration schema using Zod
 * Defines the structure for XiaoYi A2A protocol configuration
 */
exports.XiaoYiConfigSchema = zod_1.z.object({
    /** Account name (optional display name) */
    name: zod_1.z.string().optional(),
    /** Whether this channel is enabled */
    enabled: zod_1.z.boolean().optional().default(false),
    /** First WebSocket server URL */
    wsUrl1: zod_1.z.string().optional().default("wss://hag.cloud.huawei.com/openclaw/v1/ws/link"),
    /** Second WebSocket server URL */
    wsUrl2: zod_1.z.string().optional().default("wss://116.63.174.231/openclaw/v1/ws/link"),
    /** Access Key for authentication */
    ak: zod_1.z.string().optional(),
    /** Secret Key for authentication */
    sk: zod_1.z.string().optional(),
    /** Agent ID for this XiaoYi agent */
    agentId: zod_1.z.string().optional(),
    /** Enable debug logging */
    debug: zod_1.z.boolean().optional().default(false),
    /** Multi-account configuration */
    accounts: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
