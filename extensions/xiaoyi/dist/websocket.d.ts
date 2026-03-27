import { EventEmitter } from "events";
import { A2AResponseMessage, OutboundWebSocketMessage, WebSocketConnectionState, XiaoYiChannelConfig, ServerId, ServerConnectionState, SessionCleanupState } from "./types.js";
export declare class XiaoYiWebSocketManager extends EventEmitter {
    private ws1;
    private ws2;
    private state1;
    private state2;
    private sessionServerMap;
    private sessionCleanupStateMap;
    private static readonly DEFAULT_CLEANUP_TIMEOUT_MS;
    private auth;
    private config;
    private heartbeatTimeout1?;
    private heartbeatTimeout2?;
    private appHeartbeatInterval?;
    private heartbeat1?;
    private heartbeat2?;
    private reconnectTimeout1?;
    private reconnectTimeout2?;
    private stableConnectionTimer1?;
    private stableConnectionTimer2?;
    private static readonly STABLE_CONNECTION_THRESHOLD;
    private activeTasks;
    private onHealthEvent?;
    constructor(config: XiaoYiChannelConfig);
    /**
     * Set health event callback to report activity to OpenClaw framework.
     * This callback is invoked on heartbeat success to update lastEventAt.
     */
    setHealthEventCallback(callback: () => void): void;
    /**
     * Check if URL is wss + IP format (skip certificate verification)
     */
    private isWssWithIp;
    /**
     * Resolve configuration with defaults and backward compatibility
     */
    private resolveConfig;
    /**
     * Connect to both WebSocket servers
     */
    connect(): Promise<void>;
    /**
     * Connect to server 1
     */
    private connectToServer1;
    /**
     * Connect to server 2
     */
    private connectToServer2;
    /**
     * Disconnect from all servers
     */
    disconnect(): void;
    /**
     * Send init message to specific server
     */
    private sendInitMessage;
    /**
     * Setup WebSocket event handlers for specific server
     */
    private setupWebSocketHandlers;
    /**
     * Extract sessionId from message based on method type
     * Different methods have sessionId in different locations:
     * - message/stream: sessionId in params, fallback to top-level sessionId
     * - tasks/cancel: sessionId at top level
     * - clearContext: sessionId at top level
     */
    private extractSessionId;
    /**
     * Handle incoming message from specific server
     */
    private handleIncomingMessage;
    /**
     * Send A2A response message with automatic routing
     */
    sendResponse(response: A2AResponseMessage, taskId: string, sessionId: string, isFinal?: boolean, append?: boolean): Promise<void>;
    /**
     * Send clear context response to specific server
     */
    sendClearContextResponse(requestId: string, sessionId: string, success?: boolean, targetServer?: ServerId): Promise<void>;
    /**
     * Send status update (for intermediate status messages, e.g., timeout warnings)
     * This uses "status-update" event type which keeps the conversation active
     */
    sendStatusUpdate(taskId: string, sessionId: string, message: string, targetServer?: ServerId): Promise<void>;
    /**
     * Send PUSH message (主动推送) via HTTP API
     *
     * This is used when SubAgent completes execution and needs to push results to user
     * independently of the original A2A request-response flow.
     *
     * Unlike sendResponse (which responds to a specific request via WebSocket), push messages are
     * sent through HTTP API asynchronously.
     *
     * @param sessionId - User's session ID
     * @param message - Message content to push
     *
     * Reference: 华为小艺推送消息 API
     * TODO: 实现实际的推送消息发送逻辑
     */
    sendPushMessage(sessionId: string, message: string): Promise<void>;
    /**
     * Send an outbound WebSocket message directly.
     * This is a low-level method that sends a pre-formatted OutboundWebSocketMessage.
     *
     * @param sessionId - Session ID for routing
     * @param message - Pre-formatted outbound message
     */
    sendMessage(sessionId: string, message: OutboundWebSocketMessage): Promise<void>;
    /**
     * Send tasks cancel response to specific server
     */
    sendTasksCancelResponse(requestId: string, sessionId: string, success?: boolean, targetServer?: ServerId): Promise<void>;
    /**
     * Handle clearContext method
     */
    private handleClearContext;
    /**
     * Handle clear message (legacy format)
     */
    private handleClearMessage;
    /**
     * Handle tasks/cancel message
     */
    private handleTasksCancelMessage;
    /**
     * Convert A2AResponseMessage to JSON-RPC 2.0 format
     */
    private convertToJsonRpcFormat;
    /**
     * Check if at least one server is ready
     */
    isReady(): boolean;
    /**
     * Get combined connection state
     */
    getState(): WebSocketConnectionState;
    /**
     * Get individual server states
     */
    getServerStates(): {
        server1: ServerConnectionState;
        server2: ServerConnectionState;
    };
    /**
     * Start protocol-level heartbeat for specific server
     */
    private startProtocolHeartbeat;
    /**
     * Clear protocol heartbeat for specific server
     */
    private clearProtocolHeartbeat;
    /**
     * Start application-level heartbeat (shared across both servers)
     */
    private startAppHeartbeat;
    /**
     * Schedule reconnection for specific server
     */
    private scheduleReconnect;
    /**
     * Clear all timers
     */
    private clearTimers;
    /**
     * Schedule a connection stability check
     * Only reset reconnect counter after connection has been stable for threshold time
     */
    private scheduleStableConnectionCheck;
    /**
     * Clear the connection stability check timer
     */
    private clearStableConnectionCheck;
    /**
     * Type guard for A2A request messages
     * sessionId can be in params OR at top level (fallback)
     */
    private isA2ARequestMessage;
    /**
     * Get active tasks
     */
    getActiveTasks(): Map<string, any>;
    /**
     * Remove task from active tasks
     */
    removeActiveTask(taskId: string): void;
    /**
     * Get server for a specific session
     */
    getServerForSession(sessionId: string): ServerId | undefined;
    /**
     * Remove session mapping
     */
    removeSession(sessionId: string): void;
    /**
     * Mark a session for delayed cleanup
     * @param sessionId The session ID to mark for cleanup
     * @param serverId The server ID associated with this session
     * @param timeoutMs Timeout in milliseconds before forcing cleanup
     */
    private markSessionForCleanup;
    /**
     * Force cleanup a session immediately
     * @param sessionId The session ID to cleanup
     */
    forceCleanupSession(sessionId: string): void;
    /**
     * Check if a session is pending cleanup
     * @param sessionId The session ID to check
     * @returns True if session is pending cleanup
     */
    isSessionPendingCleanup(sessionId: string): boolean;
    /**
     * Get cleanup state for a session
     * @param sessionId The session ID to check
     * @returns Cleanup state if exists, undefined otherwise
     */
    getSessionCleanupState(sessionId: string): SessionCleanupState | undefined;
    /**
     * Update accumulated text for a pending cleanup session
     * @param sessionId The session ID
     * @param text The accumulated text
     */
    updateAccumulatedTextForCleanup(sessionId: string, text: string): void;
}
