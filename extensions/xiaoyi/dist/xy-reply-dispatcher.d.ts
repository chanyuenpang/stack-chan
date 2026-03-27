import type { OpenClawConfig, RuntimeEnv } from "openclaw/dist/plugin-sdk/index.js";
type ClawdbotConfig = OpenClawConfig;
export interface CreateXYReplyDispatcherParams {
    cfg: ClawdbotConfig;
    runtime: RuntimeEnv;
    sessionId: string;
    taskId: string;
    messageId: string;
    accountId: string;
}
/**
 * Create a reply dispatcher for XY channel messages.
 * Follows feishu pattern with status updates and streaming support.
 * Runtime is expected to be validated before calling this function.
 */
export declare function createXYReplyDispatcher(params: CreateXYReplyDispatcherParams): any;
export {};
