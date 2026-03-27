import type { ChannelOutboundContext, ChannelGatewayContext, OpenClawConfig } from "openclaw/dist/plugin-sdk/index.js";
type OutboundDeliveryResult = {
    channel: string;
    messageId: string;
    chatId?: string;
    channelId?: string;
    roomId?: string;
    conversationId?: string;
    timestamp?: number;
    meta?: Record<string, unknown>;
};
import { XiaoYiChannelConfig } from "./types.js";
/**
 * Resolved XiaoYi account configuration (single account mode)
 */
export interface ResolvedXiaoYiAccount {
    accountId: string;
    config: XiaoYiChannelConfig;
}
/**
 * XiaoYi Channel Plugin
 * Implements OpenClaw ChannelPlugin interface for XiaoYi A2A protocol
 * Single account mode only
 */
export declare const xiaoyiPlugin: {
    id: string;
    meta: {
        id: string;
        label: string;
        selectionLabel: string;
        docsPath: string;
        blurb: string;
        aliases: string[];
    };
    capabilities: {
        chatTypes: string[];
        polls: boolean;
        reactions: boolean;
        threads: boolean;
        media: boolean;
        nativeCommands: boolean;
    };
    /**
     * Config schema for UI form rendering
     */
    configSchema: {
        schema: {
            type: string;
            properties: {
                enabled: {
                    type: string;
                    default: boolean;
                    description: string;
                };
                wsUrl1: {
                    type: string;
                    default: string;
                    description: string;
                };
                wsUrl2: {
                    type: string;
                    default: string;
                    description: string;
                };
                ak: {
                    type: string;
                    description: string;
                };
                sk: {
                    type: string;
                    description: string;
                };
                agentId: {
                    type: string;
                    description: string;
                };
                debug: {
                    type: string;
                    default: boolean;
                    description: string;
                };
                apiId: {
                    type: string;
                    default: string;
                    description: string;
                };
                pushId: {
                    type: string;
                    default: string;
                    description: string;
                };
                taskTimeoutMs: {
                    type: string;
                    default: number;
                    description: string;
                };
            };
        };
    };
    onboarding: any;
    /**
     * Config adapter - single account mode
     */
    config: {
        listAccountIds: (cfg: OpenClawConfig) => string[];
        resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
            accountId: string;
            config: XiaoYiChannelConfig;
            enabled: boolean;
        };
        defaultAccountId: (cfg: OpenClawConfig) => string;
        isConfigured: (account: any, cfg: OpenClawConfig) => boolean;
        isEnabled: (account: any, cfg: OpenClawConfig) => boolean;
        disabledReason: (account: any, cfg: OpenClawConfig) => string;
        unconfiguredReason: (account: any, cfg: OpenClawConfig) => string;
        describeAccount: (account: any, cfg: OpenClawConfig) => {
            accountId: any;
            name: string;
            enabled: any;
            configured: boolean;
        };
    };
    /**
     * Gateway adapter - manage connections
     * Using xy-monitor for message handling (xy_channel architecture)
     */
    gateway: {
        startAccount: (ctx: ChannelGatewayContext<ResolvedXiaoYiAccount>) => Promise<void>;
        stopAccount: (ctx: ChannelGatewayContext<ResolvedXiaoYiAccount>) => Promise<void>;
    };
    /**
     * Outbound adapter - send messages via push
     */
    outbound: {
        deliveryMode: string;
        textChunkLimit: number;
        resolveTarget: ({ cfg, to, accountId, mode }: any) => {
            ok: boolean;
            to: any;
        };
        sendText: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
        sendMedia: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
    };
    /**
     * Messaging adapter - normalize targets
     * In new openclaw version, normalizeTarget receives a string and returns a normalized string
     */
    messaging: {
        normalizeTarget: (raw: string) => string;
    };
    /**
     * Status adapter - health checks
     * Using buildAccountSnapshot for compatibility with new openclaw version
     */
    status: {
        buildAccountSnapshot: (params: {
            account: ResolvedXiaoYiAccount;
            cfg: OpenClawConfig;
            runtime?: any;
            probe?: unknown;
            audit?: unknown;
        }) => Promise<{
            accountId: string;
            state: "offline";
            lastEventAt: number;
            issues: {
                severity: "error";
                message: string;
            }[];
            lastInboundAt?: undefined;
        } | {
            accountId: string;
            state: "ready";
            lastEventAt: number;
            lastInboundAt: number;
            issues?: undefined;
        } | {
            accountId: string;
            state: "authenticating";
            lastEventAt: number;
            issues: {
                severity: "warning";
                message: string;
            }[];
            lastInboundAt?: undefined;
        }>;
    };
};
export {};
