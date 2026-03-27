import type { XiaoYiChannelConfig } from "../types.js";
export interface SessionContext {
    config: XiaoYiChannelConfig;
    sessionId: string;
    taskId: string;
    messageId: string;
    agentId: string;
}
/**
 * Register a session context for tool access.
 * Should be called when starting to process a message.
 */
export declare function registerSession(sessionKey: string, context: SessionContext): void;
/**
 * Unregister a session context.
 * Should be called when message processing is complete.
 */
export declare function unregisterSession(sessionKey: string): void;
/**
 * Get session context by sessionKey.
 * Returns null if session not found.
 */
export declare function getSessionContext(sessionKey: string): SessionContext | null;
/**
 * Get the most recent session context.
 * This is a fallback for tools that don't have access to sessionKey.
 * Returns null if no sessions are active.
 */
export declare function getLatestSessionContext(): SessionContext | null;
