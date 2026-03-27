import { XiaoYiWebSocketManager } from "./websocket.js";
import { XiaoYiChannelConfig } from "./types.js";
/**
 * Timeout configuration
 */
export interface TimeoutConfig {
    enabled: boolean;
    duration: number;
    message: string;
}
/**
 * Runtime state for XiaoYi channel
 * Manages single WebSocket connection (single account mode)
 */
export declare class XiaoYiRuntime {
    private connection;
    private pluginRuntime;
    private config;
    private sessionToTaskIdMap;
    private instanceId;
    private sessionTimeoutMap;
    private sessionTimeoutSent;
    private timeoutConfig;
    private sessionAbortControllerMap;
    private sessionActiveRunMap;
    private sessionStartTimeMap;
    private static readonly SESSION_STALE_TIMEOUT_MS;
    private sessionTaskTimeoutMap;
    private sessionPushPendingMap;
    private taskTimeoutMs;
    constructor();
    getInstanceId(): string;
    /**
     * Set OpenClaw PluginRuntime (from api.runtime in register())
     */
    setPluginRuntime(runtime: any): void;
    /**
     * Get OpenClaw PluginRuntime
     */
    getPluginRuntime(): any;
    /**
     * Start connection (single account mode)
     */
    start(config: XiaoYiChannelConfig): Promise<void>;
    /**
     * Stop connection
     */
    stop(): void;
    /**
     * Set timeout configuration
     */
    setTimeoutConfig(config: Partial<TimeoutConfig>): void;
    /**
     * Get timeout configuration
     */
    getTimeoutConfig(): TimeoutConfig;
    /**
     * Set timeout for a session
     * @param sessionId - Session ID
     * @param callback - Function to call when timeout occurs
     * @returns The interval ID (for cancellation)
     *
     * IMPORTANT: This now uses setInterval instead of setTimeout
     * - First trigger: after 60 seconds
     * - Subsequent triggers: every 60 seconds after that
     * - Cleared when: response received, session completed, or explicitly cleared
     */
    setTimeoutForSession(sessionId: string, callback: () => void): NodeJS.Timeout | undefined;
    /**
     * Clear timeout interval for a session
     * @param sessionId - Session ID
     */
    clearSessionTimeout(sessionId: string): void;
    /**
     * Check if timeout has been sent for a session
     * @param sessionId - Session ID
     */
    isSessionTimeout(sessionId: string): boolean;
    /**
     * Mark session as completed (clear timeout and timeout flag)
     * @param sessionId - Session ID
     */
    markSessionCompleted(sessionId: string): void;
    /**
     * Clear all timeout intervals
     */
    clearAllTimeouts(): void;
    /**
     * Get WebSocket manager
     */
    getConnection(): XiaoYiWebSocketManager | null;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Get configuration
     */
    getConfig(): XiaoYiChannelConfig | null;
    /**
     * Set taskId for a session
     */
    setTaskIdForSession(sessionId: string, taskId: string): void;
    /**
     * Get taskId for a session
     */
    getTaskIdForSession(sessionId: string): string | undefined;
    /**
     * Clear taskId for a session
     */
    clearTaskIdForSession(sessionId: string): void;
    /**
     * Create and register an AbortController for a session
     * @param sessionId - Session ID
     * @returns The AbortController and its signal, or null if session is busy
     */
    createAbortControllerForSession(sessionId: string): {
        controller: AbortController;
        signal: AbortSignal;
    } | null;
    /**
     * Check if a session has an active agent run
     * If session is active but stale (超过 SESSION_STALE_TIMEOUT_MS), automatically clean up
     * @param sessionId - Session ID
     * @returns true if session is busy
     */
    isSessionActive(sessionId: string): boolean;
    /**
     * Abort a session's agent run
     * @param sessionId - Session ID
     * @returns true if a controller was found and aborted, false otherwise
     */
    abortSession(sessionId: string): boolean;
    /**
     * Check if a session has been aborted
     * @param sessionId - Session ID
     * @returns true if the session's abort signal was triggered
     */
    isSessionAborted(sessionId: string): boolean;
    /**
     * Clear the AbortController for a session (call when agent completes successfully)
     * @param sessionId - Session ID
     */
    clearAbortControllerForSession(sessionId: string): void;
    /**
     * Clear all AbortControllers
     */
    clearAllAbortControllers(): void;
    /**
     * Generate a composite key for session+task combination
     * This ensures each task has its own push state, even within the same session
     */
    private getPushStateKey;
    /**
     * Set task timeout time (from configuration)
     */
    setTaskTimeout(timeoutMs: number): void;
    /**
     * Set a 1-hour task timeout timer for a session
     * @returns timeout ID
     */
    setTaskTimeoutForSession(sessionId: string, taskId: string, callback: (sessionId: string, taskId: string) => void): NodeJS.Timeout;
    /**
     * Clear the task timeout timer for a session
     */
    clearTaskTimeoutForSession(sessionId: string): void;
    /**
     * Check if session+task is waiting for push notification
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    isSessionWaitingForPush(sessionId: string, taskId?: string): boolean;
    /**
     * Mark session+task as waiting for push notification
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    markSessionWaitingForPush(sessionId: string, taskId?: string): void;
    /**
     * Clear the waiting push state for a session+task
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    clearSessionWaitingForPush(sessionId: string, taskId?: string): void;
    /**
     * Clear all task timeout related state for a session
     */
    clearTaskTimeoutState(sessionId: string): void;
}
export declare function getXiaoYiRuntime(): XiaoYiRuntime;
export declare function setXiaoYiRuntime(runtime: any): void;
