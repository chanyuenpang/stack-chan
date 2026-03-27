"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XiaoYiRuntime = void 0;
exports.getXiaoYiRuntime = getXiaoYiRuntime;
exports.setXiaoYiRuntime = setXiaoYiRuntime;
const websocket_js_1 = require("./websocket.js");
/**
 * Default timeout configuration
 */
const DEFAULT_TIMEOUT_CONFIG = {
    enabled: true,
    duration: 60000, // 60 seconds
    message: "任务正在处理中，请稍后",
};
/**
 * Runtime state for XiaoYi channel
 * Manages single WebSocket connection (single account mode)
 */
class XiaoYiRuntime {
    constructor() {
        this.connection = null;
        this.pluginRuntime = null; // Store PluginRuntime from OpenClaw
        this.config = null;
        this.sessionToTaskIdMap = new Map(); // Map sessionId to taskId
        // Timeout management
        this.sessionTimeoutMap = new Map();
        this.sessionTimeoutSent = new Set();
        this.timeoutConfig = DEFAULT_TIMEOUT_CONFIG;
        // AbortController management for canceling agent runs
        this.sessionAbortControllerMap = new Map();
        // Track if a session has an active agent run (for concurrent request detection)
        this.sessionActiveRunMap = new Map();
        // Track session start time for timeout detection
        this.sessionStartTimeMap = new Map();
        // 1-hour task timeout mechanism
        this.sessionTaskTimeoutMap = new Map();
        this.sessionPushPendingMap = new Map();
        this.taskTimeoutMs = 3600000; // Default 1 hour
        this.instanceId = `runtime_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`XiaoYi: Created new runtime instance: ${this.instanceId}`);
    }
    getInstanceId() {
        return this.instanceId;
    }
    /**
     * Set OpenClaw PluginRuntime (from api.runtime in register())
     */
    setPluginRuntime(runtime) {
        console.log(`XiaoYi: [${this.instanceId}] Setting PluginRuntime`);
        this.pluginRuntime = runtime;
    }
    /**
     * Get OpenClaw PluginRuntime
     */
    getPluginRuntime() {
        return this.pluginRuntime;
    }
    /**
     * Start connection (single account mode)
     */
    async start(config) {
        if (this.connection) {
            console.log("XiaoYi channel already connected");
            return;
        }
        this.config = config;
        const manager = new websocket_js_1.XiaoYiWebSocketManager(config);
        // Setup basic event handlers (message handling is done in channel.ts)
        manager.on("error", (error) => {
            console.error("XiaoYi channel error:", error);
        });
        manager.on("disconnected", () => {
            console.log("XiaoYi channel disconnected");
        });
        manager.on("authenticated", () => {
            console.log("XiaoYi channel authenticated");
        });
        manager.on("maxReconnectAttemptsReached", (serverId) => {
            console.error(`XiaoYi channel ${serverId} max reconnect attempts reached`);
            // Check if the other server is still connected and ready
            const otherServerId = serverId === 'server1' ? 'server2' : 'server1';
            const serverStates = manager.getServerStates();
            const otherServerState = otherServerId === 'server1' ? serverStates.server1 : serverStates.server2;
            if (otherServerState?.connected && otherServerState?.ready) {
                console.warn(`[${otherServerId}] is still connected and ready, continuing in single-server mode`);
                console.warn(`System will continue running with ${otherServerId} only`);
                // Don't stop, continue with the other server
                return;
            }
            // Only stop when both servers have failed
            console.error("Both servers have reached max reconnect attempts, stopping connection");
            console.error(`Server1: ${serverStates.server1.connected ? 'connected' : 'disconnected'}, Server2: ${serverStates.server2.connected ? 'connected' : 'disconnected'}`);
            this.stop();
        });
        // Connect
        await manager.connect();
        this.connection = manager;
        console.log("XiaoYi channel started");
    }
    /**
     * Stop connection
     */
    stop() {
        if (this.connection) {
            this.connection.disconnect();
            this.connection = null;
            console.log("XiaoYi channel stopped");
        }
        // Clear session mappings
        this.sessionToTaskIdMap.clear();
        // Clear all timeouts
        this.clearAllTimeouts();
        // Clear all abort controllers
        this.clearAllAbortControllers();
        // Clear all task timeout state
        for (const sessionId of this.sessionTaskTimeoutMap.keys()) {
            this.clearTaskTimeoutState(sessionId);
        }
    }
    /**
     * Set timeout configuration
     */
    setTimeoutConfig(config) {
        this.timeoutConfig = { ...this.timeoutConfig, ...config };
        console.log(`XiaoYi: Timeout config updated:`, this.timeoutConfig);
    }
    /**
     * Get timeout configuration
     */
    getTimeoutConfig() {
        return { ...this.timeoutConfig };
    }
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
    setTimeoutForSession(sessionId, callback) {
        if (!this.timeoutConfig.enabled) {
            console.log(`[TIMEOUT] Timeout disabled, skipping for session ${sessionId}`);
            return undefined;
        }
        // Clear existing timeout AND timeout flag if any (reuse session scenario)
        const hadExistingTimeout = this.sessionTimeoutMap.has(sessionId);
        const hadSentTimeout = this.sessionTimeoutSent.has(sessionId);
        this.clearSessionTimeout(sessionId);
        // Clear the timeout sent flag to allow this session to timeout again
        if (hadSentTimeout) {
            this.sessionTimeoutSent.delete(sessionId);
            console.log(`[TIMEOUT] Previous timeout flag cleared for session ${sessionId} (session reuse)`);
        }
        // Use setInterval for periodic timeout triggers
        // First trigger after duration, then every duration after that
        const intervalId = setInterval(() => {
            console.log(`[TIMEOUT] Timeout triggered for session ${sessionId} (will trigger again in ${this.timeoutConfig.duration}ms if still active)`);
            this.sessionTimeoutSent.add(sessionId);
            callback();
        }, this.timeoutConfig.duration);
        this.sessionTimeoutMap.set(sessionId, intervalId);
        const logSuffix = hadExistingTimeout ? " (replacing existing interval)" : "";
        console.log(`[TIMEOUT] ${this.timeoutConfig.duration}ms periodic timeout started for session ${sessionId}${logSuffix}`);
        return intervalId;
    }
    /**
     * Clear timeout interval for a session
     * @param sessionId - Session ID
     */
    clearSessionTimeout(sessionId) {
        const intervalId = this.sessionTimeoutMap.get(sessionId);
        if (intervalId) {
            clearInterval(intervalId);
            this.sessionTimeoutMap.delete(sessionId);
            console.log(`[TIMEOUT] Timeout interval cleared for session ${sessionId}`);
        }
    }
    /**
     * Check if timeout has been sent for a session
     * @param sessionId - Session ID
     */
    isSessionTimeout(sessionId) {
        return this.sessionTimeoutSent.has(sessionId);
    }
    /**
     * Mark session as completed (clear timeout and timeout flag)
     * @param sessionId - Session ID
     */
    markSessionCompleted(sessionId) {
        this.clearSessionTimeout(sessionId);
        this.sessionTimeoutSent.delete(sessionId);
        console.log(`[TIMEOUT] Session ${sessionId} marked as completed`);
    }
    /**
     * Clear all timeout intervals
     */
    clearAllTimeouts() {
        for (const [sessionId, intervalId] of this.sessionTimeoutMap.entries()) {
            clearInterval(intervalId);
        }
        this.sessionTimeoutMap.clear();
        this.sessionTimeoutSent.clear();
        console.log("[TIMEOUT] All timeout intervals cleared");
    }
    /**
     * Get WebSocket manager
     */
    getConnection() {
        return this.connection;
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.connection ? this.connection.isReady() : false;
    }
    /**
     * Get configuration
     */
    getConfig() {
        return this.config;
    }
    /**
     * Set taskId for a session
     */
    setTaskIdForSession(sessionId, taskId) {
        this.sessionToTaskIdMap.set(sessionId, taskId);
    }
    /**
     * Get taskId for a session
     */
    getTaskIdForSession(sessionId) {
        return this.sessionToTaskIdMap.get(sessionId);
    }
    /**
     * Clear taskId for a session
     */
    clearTaskIdForSession(sessionId) {
        this.sessionToTaskIdMap.delete(sessionId);
    }
    /**
     * Create and register an AbortController for a session
     * @param sessionId - Session ID
     * @returns The AbortController and its signal, or null if session is busy
     */
    createAbortControllerForSession(sessionId) {
        // Check if there's an active agent run for this session
        if (this.sessionActiveRunMap.get(sessionId)) {
            console.log(`[CONCURRENT] Session ${sessionId} has an active agent run, cannot create new AbortController`);
            return null;
        }
        const controller = new AbortController();
        this.sessionAbortControllerMap.set(sessionId, controller);
        this.sessionActiveRunMap.set(sessionId, true);
        this.sessionStartTimeMap.set(sessionId, Date.now());
        console.log(`[ABORT] Created AbortController for session ${sessionId}`);
        return { controller, signal: controller.signal };
    }
    /**
     * Check if a session has an active agent run
     * If session is active but stale (超过 SESSION_STALE_TIMEOUT_MS), automatically clean up
     * @param sessionId - Session ID
     * @returns true if session is busy
     */
    isSessionActive(sessionId) {
        const isActive = this.sessionActiveRunMap.get(sessionId) || false;
        if (isActive) {
            // Check if the session has been active for too long
            const startTime = this.sessionStartTimeMap.get(sessionId);
            if (startTime) {
                const elapsed = Date.now() - startTime;
                if (elapsed > XiaoYiRuntime.SESSION_STALE_TIMEOUT_MS) {
                    // Session is stale, auto-cleanup and return false
                    console.log(`[CONCURRENT] Session ${sessionId} is stale (active for ${elapsed}ms), auto-cleaning`);
                    this.clearAbortControllerForSession(sessionId);
                    this.clearTaskIdForSession(sessionId);
                    this.clearSessionTimeout(sessionId);
                    this.sessionStartTimeMap.delete(sessionId);
                    return false;
                }
            }
        }
        return isActive;
    }
    /**
     * Abort a session's agent run
     * @param sessionId - Session ID
     * @returns true if a controller was found and aborted, false otherwise
     */
    abortSession(sessionId) {
        const controller = this.sessionAbortControllerMap.get(sessionId);
        if (controller) {
            console.log(`[ABORT] Aborting session ${sessionId}`);
            controller.abort();
            this.sessionAbortControllerMap.delete(sessionId);
            return true;
        }
        console.log(`[ABORT] No AbortController found for session ${sessionId}`);
        return false;
    }
    /**
     * Check if a session has been aborted
     * @param sessionId - Session ID
     * @returns true if the session's abort signal was triggered
     */
    isSessionAborted(sessionId) {
        const controller = this.sessionAbortControllerMap.get(sessionId);
        return controller ? controller.signal.aborted : false;
    }
    /**
     * Clear the AbortController for a session (call when agent completes successfully)
     * @param sessionId - Session ID
     */
    clearAbortControllerForSession(sessionId) {
        const controller = this.sessionAbortControllerMap.get(sessionId);
        if (controller) {
            this.sessionAbortControllerMap.delete(sessionId);
            console.log(`[ABORT] Cleared AbortController for session ${sessionId}`);
        }
        // Also clear the active run flag
        this.sessionActiveRunMap.delete(sessionId);
        // Clear the session start time
        this.sessionStartTimeMap.delete(sessionId);
        console.log(`[CONCURRENT] Session ${sessionId} marked as inactive`);
    }
    /**
     * Clear all AbortControllers
     */
    clearAllAbortControllers() {
        this.sessionAbortControllerMap.clear();
        console.log("[ABORT] All AbortControllers cleared");
    }
    // ==================== PUSH STATE MANAGEMENT HELPERS ====================
    /**
     * Generate a composite key for session+task combination
     * This ensures each task has its own push state, even within the same session
     */
    getPushStateKey(sessionId, taskId) {
        return `${sessionId}:${taskId}`;
    }
    // ==================== END PUSH STATE MANAGEMENT HELPERS ====================
    // ==================== 1-HOUR TASK TIMEOUT METHODS ====================
    /**
     * Set task timeout time (from configuration)
     */
    setTaskTimeout(timeoutMs) {
        this.taskTimeoutMs = timeoutMs;
        console.log(`[TASK TIMEOUT] Task timeout set to ${timeoutMs}ms`);
    }
    /**
     * Set a 1-hour task timeout timer for a session
     * @returns timeout ID
     */
    setTaskTimeoutForSession(sessionId, taskId, callback) {
        this.clearTaskTimeoutForSession(sessionId);
        const timeoutId = setTimeout(() => {
            console.log(`[TASK TIMEOUT] ${this.taskTimeoutMs}ms timeout triggered for session ${sessionId}, task ${taskId}`);
            callback(sessionId, taskId);
        }, this.taskTimeoutMs);
        this.sessionTaskTimeoutMap.set(sessionId, timeoutId);
        console.log(`[TASK TIMEOUT] ${this.taskTimeoutMs}ms task timeout started for session ${sessionId}`);
        return timeoutId;
    }
    /**
     * Clear the task timeout timer for a session
     */
    clearTaskTimeoutForSession(sessionId) {
        const timeoutId = this.sessionTaskTimeoutMap.get(sessionId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.sessionTaskTimeoutMap.delete(sessionId);
            console.log(`[TASK TIMEOUT] Timeout cleared for session ${sessionId}`);
        }
    }
    /**
     * Check if session+task is waiting for push notification
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    isSessionWaitingForPush(sessionId, taskId) {
        const key = taskId ? this.getPushStateKey(sessionId, taskId) : sessionId;
        return this.sessionPushPendingMap.get(key) === true;
    }
    /**
     * Mark session+task as waiting for push notification
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    markSessionWaitingForPush(sessionId, taskId) {
        const key = taskId ? this.getPushStateKey(sessionId, taskId) : sessionId;
        this.sessionPushPendingMap.set(key, true);
        const taskInfo = taskId ? `, task ${taskId}` : '';
        console.log(`[PUSH] Session ${sessionId}${taskInfo} marked as waiting for push`);
    }
    /**
     * Clear the waiting push state for a session+task
     * @param sessionId - Session ID
     * @param taskId - Task ID (optional, for per-task tracking)
     */
    clearSessionWaitingForPush(sessionId, taskId) {
        const key = taskId ? this.getPushStateKey(sessionId, taskId) : sessionId;
        this.sessionPushPendingMap.delete(key);
        const taskInfo = taskId ? `, task ${taskId}` : '';
        console.log(`[PUSH] Session ${sessionId}${taskInfo} cleared from waiting for push`);
    }
    /**
     * Clear all task timeout related state for a session
     */
    clearTaskTimeoutState(sessionId) {
        this.clearTaskTimeoutForSession(sessionId);
        this.clearSessionWaitingForPush(sessionId);
        console.log(`[TASK TIMEOUT] All timeout state cleared for session ${sessionId}`);
    }
}
exports.XiaoYiRuntime = XiaoYiRuntime;
// Maximum time a session can be active before we consider it stale (5 minutes)
XiaoYiRuntime.SESSION_STALE_TIMEOUT_MS = 5 * 60 * 1000;
// Global runtime instance - use global object to survive module reloads
// CRITICAL: Use string key instead of Symbol to ensure consistency across module reloads
const GLOBAL_KEY = '__xiaoyi_runtime_instance__';
function getXiaoYiRuntime() {
    const g = global;
    if (!g[GLOBAL_KEY]) {
        console.log("XiaoYi: Creating NEW runtime instance (global storage)");
        g[GLOBAL_KEY] = new XiaoYiRuntime();
    }
    else {
        console.log(`XiaoYi: Reusing EXISTING runtime instance: ${g[GLOBAL_KEY].getInstanceId()}`);
    }
    return g[GLOBAL_KEY];
}
function setXiaoYiRuntime(runtime) {
    getXiaoYiRuntime().setPluginRuntime(runtime);
}
