"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.xiaoyiPlugin = void 0;
const runtime_js_1 = require("./runtime.js");
const onboarding_js_1 = require("./onboarding.js");
const session_manager_js_1 = require("./xy-tools/session-manager.js");
// Special marker for default push delivery when no target is specified (cron/announce mode)
const DEFAULT_PUSH_MARKER = "default";
/**
 * Track if message handlers have been registered to prevent duplicate registrations
 * when startAccount() is called multiple times due to auto-restart attempts
 */
let handlersRegistered = false;
/**
 * XiaoYi Channel Plugin
 * Implements OpenClaw ChannelPlugin interface for XiaoYi A2A protocol
 * Single account mode only
 */
exports.xiaoyiPlugin = {
    id: "xiaoyi",
    meta: {
        id: "xiaoyi",
        label: "XiaoYi",
        selectionLabel: "XiaoYi (小艺)",
        docsPath: "/channels/xiaoyi",
        blurb: "小艺 A2A 协议支持，通过 WebSocket 连接。",
        aliases: ["xiaoyi"],
    },
    capabilities: {
        chatTypes: ["direct"],
        polls: false,
        reactions: false,
        threads: false,
        media: true,
        nativeCommands: false,
    },
    /**
     * Config schema for UI form rendering
     */
    configSchema: {
        schema: {
            type: "object",
            properties: {
                enabled: {
                    type: "boolean",
                    default: false,
                    description: "Enable XiaoYi channel",
                },
                wsUrl1: {
                    type: "string",
                    default: "wss://hag.cloud.huawei.com/openclaw/v1/ws/link",
                    description: "Primary WebSocket server URL",
                },
                wsUrl2: {
                    type: "string",
                    default: "wss://116.63.174.231/openclaw/v1/ws/link",
                    description: "Secondary WebSocket server URL",
                },
                ak: {
                    type: "string",
                    description: "Access Key",
                },
                sk: {
                    type: "string",
                    description: "Secret Key",
                },
                agentId: {
                    type: "string",
                    description: "Agent ID",
                },
                debug: {
                    type: "boolean",
                    default: false,
                    description: "Enable debug logging",
                },
                apiId: {
                    type: "string",
                    default: "",
                    description: "API ID for push notifications",
                },
                pushId: {
                    type: "string",
                    default: "",
                    description: "Push ID for push notifications",
                },
                taskTimeoutMs: {
                    type: "number",
                    default: 3600000,
                    description: "Task timeout in milliseconds (default: 1 hour)",
                },
            },
        },
    },
    onboarding: onboarding_js_1.xiaoyiOnboardingAdapter,
    /**
     * Config adapter - single account mode
     */
    config: {
        listAccountIds: (cfg) => {
            const channelConfig = cfg?.channels?.xiaoyi;
            if (!channelConfig || !channelConfig.enabled) {
                return [];
            }
            // Single account mode: always return "default"
            return ["default"];
        },
        resolveAccount: (cfg, accountId) => {
            // Single account mode: always use "default"
            const resolvedAccountId = "default";
            // Access channel config from cfg.channels.xiaoyi
            const channelConfig = cfg?.channels?.xiaoyi;
            // If channel is not configured yet, return empty config
            if (!channelConfig) {
                return {
                    accountId: resolvedAccountId,
                    config: {
                        enabled: false,
                        wsUrl: "",
                        wsUrl1: "",
                        wsUrl2: "",
                        ak: "",
                        sk: "",
                        agentId: "",
                    },
                    enabled: false,
                };
            }
            return {
                accountId: resolvedAccountId,
                config: channelConfig,
                enabled: channelConfig.enabled !== false,
            };
        },
        defaultAccountId: (cfg) => {
            const channelConfig = cfg?.channels?.xiaoyi;
            if (!channelConfig || !channelConfig.enabled) {
                return undefined;
            }
            // Single account mode: always return "default"
            return "default";
        },
        isConfigured: (account, cfg) => {
            // Safely check if all required fields are present and non-empty
            if (!account || !account.config) {
                return false;
            }
            const config = account.config;
            // Check each field is a string and has content after trimming
            // Note: wsUrl1/wsUrl2 are optional (defaults will be used if not provided)
            const hasAk = typeof config.ak === 'string' && config.ak.trim().length > 0;
            const hasSk = typeof config.sk === 'string' && config.sk.trim().length > 0;
            const hasAgentId = typeof config.agentId === 'string' && config.agentId.trim().length > 0;
            return hasAk && hasSk && hasAgentId;
        },
        isEnabled: (account, cfg) => {
            return account?.enabled !== false;
        },
        disabledReason: (account, cfg) => {
            return "Channel is disabled in configuration";
        },
        unconfiguredReason: (account, cfg) => {
            return "Missing required configuration: ak, sk, or agentId (wsUrl1/wsUrl2 are optional, defaults will be used)";
        },
        describeAccount: (account, cfg) => ({
            accountId: account.accountId,
            name: 'XiaoYi',
            enabled: account.enabled,
            configured: Boolean(account.config?.ak && account.config?.sk && account.config?.agentId),
        }),
    },
    /**
     * Gateway adapter - manage connections
     * Using xy-monitor for message handling (xy_channel architecture)
     */
    gateway: {
        startAccount: async (ctx) => {
            console.log("XiaoYi: startAccount() called - START");
            const { monitorXYProvider } = await Promise.resolve().then(() => __importStar(require("./xy-monitor.js")));
            const account = ctx.account;
            const config = ctx.cfg;
            console.log(`[xiaoyi] Starting xiaoyi channel with xy_monitor architecture`);
            console.log(`[xiaoyi] Account ID: ${account.accountId}`);
            console.log(`[xiaoyi] Agent ID: ${account.config.agentId}`);
            return monitorXYProvider({
                config: config,
                runtime: ctx.runtime,
                abortSignal: ctx.abortSignal,
                accountId: account.accountId,
                setStatus: ctx.setStatus,
            });
        },
        stopAccount: async (ctx) => {
            const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
            runtime.stop();
        },
    },
    /**
     * Outbound adapter - send messages via push
     */
    outbound: {
        deliveryMode: "direct",
        textChunkLimit: 4000,
        resolveTarget: ({ cfg, to, accountId, mode }) => {
            if (!to || to.trim() === "") {
                console.log(`[xiaoyi.resolveTarget] No target specified, using default push marker`);
                return { ok: true, to: DEFAULT_PUSH_MARKER };
            }
            const trimmedTo = to.trim();
            if (!trimmedTo.includes("::")) {
                console.log(`[xiaoyi.resolveTarget] Target "${trimmedTo}" missing taskId, looking up session context`);
                const sessionContext = (0, session_manager_js_1.getLatestSessionContext)();
                if (sessionContext && sessionContext.sessionId === trimmedTo) {
                    const enhancedTarget = `${trimmedTo}::${sessionContext.taskId}`;
                    console.log(`[xiaoyi.resolveTarget] Enhanced target: ${enhancedTarget}`);
                    return { ok: true, to: enhancedTarget };
                }
                console.log(`[xiaoyi.resolveTarget] Could not find matching session context for "${trimmedTo}"`);
            }
            return { ok: true, to: trimmedTo };
        },
        sendText: async (ctx) => {
            const { cfg, to, text, accountId } = ctx;
            console.log(`[xiaoyi.sendText] Called with: to=${to}, textLength=${text?.length || 0}`);
            const { resolveXYConfig } = await Promise.resolve().then(() => __importStar(require("./xy-config.js")));
            const { XiaoYiPushService } = await Promise.resolve().then(() => __importStar(require("./push.js")));
            const { configManager } = await Promise.resolve().then(() => __importStar(require("./xy-utils/config-manager.js")));
            const config = { ...resolveXYConfig(cfg) };
            // Resolve actual target (strip taskId portion if present)
            let actualTo = to;
            if (to === DEFAULT_PUSH_MARKER) {
                actualTo = config.defaultSessionId || "";
            }
            else if (to.includes("::")) {
                actualTo = to.split("::")[0];
            }
            // Override pushId with dynamic per-session pushId if available
            const dynamicPushId = configManager.getPushId(actualTo);
            if (dynamicPushId) {
                config.pushId = dynamicPushId;
            }
            const pushService = new XiaoYiPushService(config);
            // Extract title (first line, up to 57 chars)
            const title = text.split("\n")[0].slice(0, 57);
            // Truncate content to 1000 chars
            const pushText = text.length > 1000 ? text.slice(0, 1000) : text;
            await pushService.sendPush(pushText, title);
            console.log(`[xiaoyi.sendText] Push sent successfully`);
            return {
                channel: "xiaoyi",
                messageId: Date.now().toString(),
                chatId: actualTo,
            };
        },
        sendMedia: async (ctx) => {
            throw new Error("暂不支持文件回传");
        },
    },
    /**
     * Messaging adapter - normalize targets
     * In new openclaw version, normalizeTarget receives a string and returns a normalized string
     */
    messaging: {
        normalizeTarget: (raw) => {
            // For XiaoYi, we use sessionId as the target
            // The raw input is already the normalized target (sessionId)
            return raw;
        },
    },
    /**
     * Status adapter - health checks
     * Using buildAccountSnapshot for compatibility with new openclaw version
     */
    status: {
        buildAccountSnapshot: async (params) => {
            const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
            const connection = runtime.getConnection();
            if (!connection) {
                return {
                    accountId: params.account.accountId,
                    state: "offline",
                    lastEventAt: Date.now(),
                    issues: [{
                            severity: "error",
                            message: "Not connected",
                        }],
                };
            }
            const state = connection.getState();
            if (state.connected && state.authenticated) {
                return {
                    accountId: params.account.accountId,
                    state: "ready",
                    lastEventAt: Date.now(),
                    lastInboundAt: Date.now(),
                };
            }
            else if (state.connected) {
                return {
                    accountId: params.account.accountId,
                    state: "authenticating",
                    lastEventAt: Date.now(),
                    issues: [{
                            severity: "warning",
                            message: "Connected but not authenticated",
                        }],
                };
            }
            else {
                return {
                    accountId: params.account.accountId,
                    state: "offline",
                    lastEventAt: Date.now(),
                    issues: [{
                            severity: "error",
                            message: `Reconnect attempts: ${state.reconnectAttempts}/${state.maxReconnectAttempts}`,
                        }],
                };
            }
        },
    },
};
