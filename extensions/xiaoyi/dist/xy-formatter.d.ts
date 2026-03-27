import type { XiaoYiChannelConfig, A2ACommand } from "./types.js";
/**
 * Parameters for sending an A2A response.
 */
export interface SendA2AResponseParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
    text?: string;
    append: boolean;
    final: boolean;
    files?: Array<{
        fileName: string;
        fileType: string;
        fileId: string;
    }>;
}
/**
 * Send an A2A artifact update response.
 */
export declare function sendA2AResponse(params: SendA2AResponseParams): Promise<void>;
/**
 * Parameters for sending a reasoning text update (intermediate, streamed).
 */
export interface SendReasoningTextUpdateParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
    text: string;
    append?: boolean;
}
/**
 * Send an A2A artifact-update with reasoningText part.
 * Used for onToolStart, onToolResult, onReasoningStream, onReasoningEnd, onPartialReply.
 * append=true, final=false, lastChunk=true, text is suffixed with newline for markdown rendering.
 */
export declare function sendReasoningTextUpdate(params: SendReasoningTextUpdateParams): Promise<void>;
/**
 * Parameters for sending a status update.
 */
export interface SendStatusUpdateParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
    text: string;
    state: "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed" | "unknown";
}
/**
 * Send an A2A task status update.
 * Follows A2A protocol standard format with nested status object.
 */
export declare function sendStatusUpdate(params: SendStatusUpdateParams): Promise<void>;
/**
 * Parameters for sending a command.
 */
export interface SendCommandParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
    command: A2ACommand;
}
/**
 * Send a command as an artifact update (final=false).
 */
export declare function sendCommand(params: SendCommandParams): Promise<void>;
/**
 * Parameters for sending a clearContext response.
 */
export interface SendClearContextResponseParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    messageId: string;
}
/**
 * Send a clearContext response.
 */
export declare function sendClearContextResponse(params: SendClearContextResponseParams): Promise<void>;
/**
 * Parameters for sending a tasks/cancel response.
 */
export interface SendTasksCancelResponseParams {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
}
/**
 * Send a tasks/cancel response.
 */
export declare function sendTasksCancelResponse(params: SendTasksCancelResponseParams): Promise<void>;
