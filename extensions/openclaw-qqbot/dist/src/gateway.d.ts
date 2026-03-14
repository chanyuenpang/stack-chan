import type { ResolvedQQBotAccount } from "./types.js";
export interface GatewayContext {
    account: ResolvedQQBotAccount;
    abortSignal: AbortSignal;
    cfg: unknown;
    onReady?: (data: unknown) => void;
    onError?: (error: Error) => void;
    log?: {
        info: (msg: string) => void;
        error: (msg: string) => void;
        debug?: (msg: string) => void;
    };
}
/**
 * 启动 Gateway WebSocket 连接（带自动重连）
 * 支持流式消息发送
 */
export declare function startGateway(ctx: GatewayContext): Promise<void>;
