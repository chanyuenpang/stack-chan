"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XiaoYiWebSocketManager = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const url_1 = require("url");
const auth_js_1 = require("./auth.js");
const heartbeat_js_1 = require("./heartbeat.js");
const types_js_1 = require("./types.js");
class XiaoYiWebSocketManager extends events_1.EventEmitter {
    constructor(config) {
        super();
        // ==================== Dual WebSocket Connections ====================
        this.ws1 = null;
        this.ws2 = null;
        // ==================== Dual Server States ====================
        this.state1 = {
            connected: false,
            ready: false,
            lastHeartbeat: 0,
            reconnectAttempts: 0
        };
        this.state2 = {
            connected: false,
            ready: false,
            lastHeartbeat: 0,
            reconnectAttempts: 0
        };
        // ==================== Session → Server Mapping ====================
        this.sessionServerMap = new Map();
        // ==================== Session Cleanup State ====================
        // Track sessions that are pending cleanup (user cleared context but task still running)
        this.sessionCleanupStateMap = new Map();
        // ==================== Active Tasks ====================
        this.activeTasks = new Map();
        // Resolve configuration with defaults and backward compatibility
        this.config = this.resolveConfig(config);
        this.auth = new auth_js_1.XiaoYiAuth(this.config.ak, this.config.sk, this.config.agentId);
        console.log(`[WS Manager] Initialized with dual server:`);
        console.log(`  Server 1: ${this.config.wsUrl1}`);
        console.log(`  Server 2: ${this.config.wsUrl2}`);
    }
    /**
     * Set health event callback to report activity to OpenClaw framework.
     * This callback is invoked on heartbeat success to update lastEventAt.
     */
    setHealthEventCallback(callback) {
        this.onHealthEvent = callback;
        console.log("[WS Manager] Health event callback registered");
    }
    /**
     * Check if URL is wss + IP format (skip certificate verification)
     */
    isWssWithIp(urlString) {
        try {
            const url = new url_1.URL(urlString);
            // Check if protocol is wss
            if (url.protocol !== 'wss:') {
                return false;
            }
            const hostname = url.hostname;
            // Check for IPv4 address (e.g., 192.168.1.1)
            const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
            if (ipv4Regex.test(hostname)) {
                // Validate each octet is 0-255
                const octets = hostname.split('.');
                return octets.every(octet => {
                    const num = parseInt(octet, 10);
                    return num >= 0 && num <= 255;
                });
            }
            // Check for IPv6 address (e.g., [::1] or 2001:db8::1)
            // IPv6 in URL might be wrapped in brackets
            const ipv6Regex = /^[\[::0-9a-fA-F]+$/;
            const ipv6WithoutBrackets = hostname.replace(/[\[\]]/g, '');
            // Simple check for IPv6: contains colons and valid hex characters
            if (hostname.includes('[') && hostname.includes(']')) {
                return ipv6Regex.test(hostname);
            }
            // Check for plain IPv6 format
            if (hostname.includes(':')) {
                const ipv6RegexPlain = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
                return ipv6RegexPlain.test(ipv6WithoutBrackets);
            }
            return false;
        }
        catch (error) {
            console.warn(`[WS Manager] Invalid URL format: ${urlString}`);
            return false;
        }
    }
    /**
     * Resolve configuration with defaults and backward compatibility
     */
    resolveConfig(userConfig) {
        // Backward compatibility: if wsUrl is provided but wsUrl1/wsUrl2 are not,
        // use wsUrl for server1 and default for server2
        let wsUrl1 = userConfig.wsUrl1;
        let wsUrl2 = userConfig.wsUrl2;
        if (!wsUrl1 && userConfig.wsUrl) {
            wsUrl1 = userConfig.wsUrl;
        }
        // Apply defaults if not provided
        if (!wsUrl1) {
            console.warn(`[WS Manager] wsUrl1 not provided, using default: ${types_js_1.DEFAULT_WS_URL_1}`);
            wsUrl1 = types_js_1.DEFAULT_WS_URL_1;
        }
        if (!wsUrl2) {
            console.warn(`[WS Manager] wsUrl2 not provided, using default: ${types_js_1.DEFAULT_WS_URL_2}`);
            wsUrl2 = types_js_1.DEFAULT_WS_URL_2;
        }
        return {
            wsUrl1,
            wsUrl2,
            agentId: userConfig.agentId,
            ak: userConfig.ak,
            sk: userConfig.sk,
            enableStreaming: userConfig.enableStreaming ?? true,
            sessionCleanupTimeoutMs: userConfig.sessionCleanupTimeoutMs ?? XiaoYiWebSocketManager.DEFAULT_CLEANUP_TIMEOUT_MS,
        };
    }
    /**
     * Connect to both WebSocket servers
     */
    async connect() {
        console.log("[WS Manager] Connecting to both servers...");
        const results = await Promise.allSettled([
            this.connectToServer1(),
            this.connectToServer2(),
        ]);
        // Check if at least one connection succeeded
        const server1Success = results[0].status === 'fulfilled';
        const server2Success = results[1].status === 'fulfilled';
        if (!server1Success && !server2Success) {
            console.error("[WS Manager] Failed to connect to both servers");
            throw new Error("Failed to connect to both servers");
        }
        console.log(`[WS Manager] Connection results: Server1=${server1Success}, Server2=${server2Success}`);
        // Start application-level heartbeat (only if at least one connection is ready)
        if (this.state1.connected || this.state2.connected) {
            this.startAppHeartbeat();
        }
    }
    /**
     * Connect to server 1
     */
    async connectToServer1() {
        console.log(`[Server1] Connecting to ${this.config.wsUrl1}...`);
        try {
            // ✅ Close existing connection and heartbeat before creating new one
            if (this.ws1) {
                console.log(`[Server1] Closing existing connection before reconnect`);
                if (this.heartbeat1) {
                    this.heartbeat1.stop();
                    this.heartbeat1 = undefined;
                }
                try {
                    this.ws1.removeAllListeners();
                    this.ws1.close();
                }
                catch (err) {
                    console.warn(`[Server1] Error closing old connection:`, err);
                }
                this.ws1 = null;
            }
            const authHeaders = this.auth.generateAuthHeaders();
            // Check if URL is wss + IP format, skip certificate verification
            const skipCertVerify = this.isWssWithIp(this.config.wsUrl1);
            if (skipCertVerify) {
                console.log(`[Server1] WSS + IP detected, skipping certificate verification`);
            }
            this.ws1 = new ws_1.default(this.config.wsUrl1, {
                headers: authHeaders,
                rejectUnauthorized: !skipCertVerify,
            });
            // ✅ Initialize HeartbeatManager for server1
            this.heartbeat1 = new heartbeat_js_1.HeartbeatManager(this.ws1, {
                interval: 30000, // 30 seconds
                timeout: 10000, // 10 seconds timeout
                message: JSON.stringify({
                    msgType: "heartbeat",
                    agentId: this.config.agentId,
                    timestamp: Date.now(),
                }),
            }, () => {
                console.log(`[Server1] Heartbeat timeout, reconnecting...`);
                if (this.ws1 && (this.ws1.readyState === ws_1.default.OPEN || this.ws1.readyState === ws_1.default.CONNECTING)) {
                    this.ws1.close();
                }
            }, "server1", console.log, console.error, () => {
                // ✅ Heartbeat success callback - report health to OpenClaw
                this.emit("heartbeat", "server1");
                // ✅ Report liveness to OpenClaw framework to prevent stale-socket detection
                this.onHealthEvent?.();
            });
            this.setupWebSocketHandlers(this.ws1, 'server1');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Connection timeout")), 30000);
                this.ws1.once("open", () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.ws1.once("error", (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
            this.state1.connected = true;
            this.state1.ready = true;
            console.log(`[Server1] Connected successfully`);
            this.emit("connected", "server1");
            // Schedule connection stability check before resetting reconnect counter
            this.scheduleStableConnectionCheck('server1');
            // Send init message
            this.sendInitMessage(this.ws1, 'server1');
            // ✅ Start heartbeat (replaces old startProtocolHeartbeat)
            this.heartbeat1.start();
            console.log(`[Server1] Heartbeat started (30s interval, 10s timeout)`);
        }
        catch (error) {
            console.error(`[Server1] Connection failed:`, error);
            this.state1.connected = false;
            this.state1.ready = false;
            this.emit("error", { serverId: 'server1', error });
            throw error;
        }
    }
    /**
     * Connect to server 2
     */
    async connectToServer2() {
        console.log(`[Server2] Connecting to ${this.config.wsUrl2}...`);
        try {
            // ✅ Close existing connection and heartbeat before creating new one
            if (this.ws2) {
                console.log(`[Server2] Closing existing connection before reconnect`);
                if (this.heartbeat2) {
                    this.heartbeat2.stop();
                    this.heartbeat2 = undefined;
                }
                try {
                    this.ws2.removeAllListeners();
                    this.ws2.close();
                }
                catch (err) {
                    console.warn(`[Server2] Error closing old connection:`, err);
                }
                this.ws2 = null;
            }
            const authHeaders = this.auth.generateAuthHeaders();
            // Check if URL is wss + IP format, skip certificate verification
            const skipCertVerify = this.isWssWithIp(this.config.wsUrl2);
            if (skipCertVerify) {
                console.log(`[Server2] WSS + IP detected, skipping certificate verification`);
            }
            this.ws2 = new ws_1.default(this.config.wsUrl2, {
                headers: authHeaders,
                rejectUnauthorized: !skipCertVerify,
            });
            // ✅ Initialize HeartbeatManager for server2
            this.heartbeat2 = new heartbeat_js_1.HeartbeatManager(this.ws2, {
                interval: 30000, // 30 seconds
                timeout: 10000, // 10 seconds timeout
                message: JSON.stringify({
                    msgType: "heartbeat",
                    agentId: this.config.agentId,
                    timestamp: Date.now(),
                }),
            }, () => {
                console.log(`[Server2] Heartbeat timeout, reconnecting...`);
                if (this.ws2 && (this.ws2.readyState === ws_1.default.OPEN || this.ws2.readyState === ws_1.default.CONNECTING)) {
                    this.ws2.close();
                }
            }, "server2", console.log, console.error, () => {
                // ✅ Heartbeat success callback - report health to OpenClaw
                this.emit("heartbeat", "server2");
                // ✅ Report liveness to OpenClaw framework to prevent stale-socket detection
                this.onHealthEvent?.();
            });
            this.setupWebSocketHandlers(this.ws2, 'server2');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Connection timeout")), 30000);
                this.ws2.once("open", () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.ws2.once("error", (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
            this.state2.connected = true;
            this.state2.ready = true;
            console.log(`[Server2] Connected successfully`);
            this.emit("connected", "server2");
            // Schedule connection stability check before resetting reconnect counter
            this.scheduleStableConnectionCheck('server2');
            // Send init message
            this.sendInitMessage(this.ws2, 'server2');
            // ✅ Start heartbeat (replaces old startProtocolHeartbeat)
            this.heartbeat2.start();
            console.log(`[Server2] Heartbeat started (30s interval, 10s timeout)`);
        }
        catch (error) {
            console.error(`[Server2] Connection failed:`, error);
            this.state2.connected = false;
            this.state2.ready = false;
            this.emit("error", { serverId: 'server2', error });
            throw error;
        }
    }
    /**
     * Disconnect from all servers
     */
    disconnect() {
        console.log("[WS Manager] Disconnecting from all servers...");
        this.clearTimers();
        // ✅ Stop heartbeat managers
        if (this.heartbeat1) {
            console.log("[Server1] Stopping heartbeat manager");
            this.heartbeat1.stop();
            this.heartbeat1 = undefined;
        }
        if (this.heartbeat2) {
            console.log("[Server2] Stopping heartbeat manager");
            this.heartbeat2.stop();
            this.heartbeat2 = undefined;
        }
        // ✅ Properly cleanup WebSocket connections to prevent ghost connections
        if (this.ws1) {
            try {
                console.log("[Server1] Removing all listeners and closing connection");
                this.ws1.removeAllListeners();
                if (this.ws1.readyState === ws_1.default.OPEN || this.ws1.readyState === ws_1.default.CONNECTING) {
                    this.ws1.close();
                }
            }
            catch (err) {
                console.warn("[Server1] Error during disconnect:", err);
            }
            this.ws1 = null;
        }
        if (this.ws2) {
            try {
                console.log("[Server2] Removing all listeners and closing connection");
                this.ws2.removeAllListeners();
                if (this.ws2.readyState === ws_1.default.OPEN || this.ws2.readyState === ws_1.default.CONNECTING) {
                    this.ws2.close();
                }
            }
            catch (err) {
                console.warn("[Server2] Error during disconnect:", err);
            }
            this.ws2 = null;
        }
        this.state1.connected = false;
        this.state1.ready = false;
        this.state2.connected = false;
        this.state2.ready = false;
        this.sessionServerMap.clear();
        this.activeTasks.clear();
        // Cleanup session cleanup state map
        for (const [sessionId, state] of this.sessionCleanupStateMap.entries()) {
            if (state.cleanupTimeoutId) {
                clearTimeout(state.cleanupTimeoutId);
            }
        }
        this.sessionCleanupStateMap.clear();
        this.emit("disconnected");
        console.log("[WS Manager] Disconnect complete");
    }
    /**
     * Send init message to specific server
     */
    sendInitMessage(ws, serverId) {
        const initMessage = {
            msgType: "clawd_bot_init",
            agentId: this.config.agentId,
        };
        try {
            ws.send(JSON.stringify(initMessage));
            console.log(`[${serverId}] Sent clawd_bot_init message`);
        }
        catch (error) {
            console.error(`[${serverId}] Failed to send init message:`, error);
        }
    }
    /**
     * Setup WebSocket event handlers for specific server
     */
    setupWebSocketHandlers(ws, serverId) {
        ws.on("open", () => {
            console.log(`[${serverId}] WebSocket opened`);
        });
        ws.on("message", (data) => {
            this.handleIncomingMessage(data, serverId);
        });
        ws.on("close", (code, reason) => {
            console.log(`[${serverId}] WebSocket closed: ${code} ${reason.toString()}`);
            // Clear stable connection timer - connection was not stable
            this.clearStableConnectionCheck(serverId);
            if (serverId === 'server1') {
                this.state1.connected = false;
                this.state1.ready = false;
                this.clearProtocolHeartbeat('server1');
            }
            else {
                this.state2.connected = false;
                this.state2.ready = false;
                this.clearProtocolHeartbeat('server2');
            }
            this.emit("disconnected", serverId);
            this.scheduleReconnect(serverId);
        });
        ws.on("error", (error) => {
            console.error(`[${serverId}] WebSocket error:`, error);
            this.emit("error", { serverId, error });
        });
        ws.on("pong", () => {
            if (serverId === 'server1') {
                this.state1.lastHeartbeat = Date.now();
            }
            else {
                this.state2.lastHeartbeat = Date.now();
            }
        });
    }
    /**
     * Extract sessionId from message based on method type
     * Different methods have sessionId in different locations:
     * - message/stream: sessionId in params, fallback to top-level sessionId
     * - tasks/cancel: sessionId at top level
     * - clearContext: sessionId at top level
     */
    extractSessionId(message) {
        // For message/stream, prioritize params.sessionId, fallback to top-level sessionId
        if (message.method === "message/stream") {
            return message.params?.sessionId || message.sessionId;
        }
        // For tasks/cancel and clearContext, sessionId is at top level
        if (message.method === "tasks/cancel" ||
            message.method === "clearContext" ||
            message.action === "clear") {
            return message.sessionId;
        }
        return undefined;
    }
    /**
     * Handle incoming message from specific server
     */
    handleIncomingMessage(data, sourceServer) {
        try {
            const message = JSON.parse(data.toString());
            // Log received message
            console.log("\n" + "=".repeat(80));
            console.log(`[${sourceServer}] Received message:`);
            console.log(JSON.stringify(message, null, 2));
            console.log("=".repeat(80) + "\n");
            // Validate agentId
            if (message.agentId && message.agentId !== this.config.agentId) {
                console.warn(`[${sourceServer}] Mismatched agentId: ${message.agentId}, expected: ${this.config.agentId}. Discarding.`);
                return;
            }
            // Extract sessionId based on method type
            const sessionId = this.extractSessionId(message);
            // Record session → server mapping
            if (sessionId) {
                this.sessionServerMap.set(sessionId, sourceServer);
                console.log(`[MAP] Session ${sessionId} -> ${sourceServer}`);
            }
            // Handle special messages (clearContext, tasks/cancel)
            if (message.method === "clearContext") {
                this.handleClearContext(message, sourceServer);
                return;
            }
            if (message.action === "clear") {
                this.handleClearMessage(message, sourceServer);
                return;
            }
            if (message.method === "tasks/cancel" || message.action === "tasks/cancel") {
                this.handleTasksCancelMessage(message, sourceServer);
                return;
            }
            // Handle regular A2A request
            if (this.isA2ARequestMessage(message)) {
                // Store task for potential cancellation (support params.sessionId or top-level sessionId)
                const sessionId = message.params?.sessionId || message.sessionId;
                this.activeTasks.set(message.id, {
                    sessionId: sessionId,
                    timestamp: Date.now(),
                });
                // Emit with server info
                this.emit("message", message);
            }
            else {
                console.warn(`[${sourceServer}] Unknown message format`);
            }
        }
        catch (error) {
            console.error(`[${sourceServer}] Failed to parse message:`, error);
            this.emit("error", { serverId: sourceServer, error });
        }
    }
    /**
     * Send A2A response message with automatic routing
     */
    async sendResponse(response, taskId, sessionId, isFinal = true, append = true) {
        // Check if session is pending cleanup
        const cleanupState = this.sessionCleanupStateMap.get(sessionId);
        if (cleanupState) {
            // Session is pending cleanup, silently discard response
            console.log(`[RESPONSE] Discarding response for pending cleanup session ${sessionId}`);
            return;
        }
        // Find which server this session belongs to
        const targetServer = this.sessionServerMap.get(sessionId);
        if (!targetServer) {
            console.error(`[ROUTE] Unknown server for session ${sessionId}`);
            throw new Error(`Cannot route response: unknown session ${sessionId}`);
        }
        // Get the corresponding WebSocket connection
        const ws = targetServer === 'server1' ? this.ws1 : this.ws2;
        const state = targetServer === 'server1' ? this.state1 : this.state2;
        if (!ws || ws.readyState !== ws_1.default.OPEN) {
            console.error(`[ROUTE] ${targetServer} not connected for session ${sessionId}`);
            throw new Error(`${targetServer} is not available`);
        }
        // Convert to JSON-RPC format
        const jsonRpcResponse = this.convertToJsonRpcFormat(response, taskId, isFinal, append);
        const message = {
            msgType: "agent_response",
            agentId: this.config.agentId,
            sessionId: sessionId,
            taskId: taskId,
            msgDetail: JSON.stringify(jsonRpcResponse),
        };
        try {
            ws.send(JSON.stringify(message));
            console.log(`[ROUTE] Response sent to ${targetServer} for session ${sessionId} (isFinal=${isFinal}, append=${append})`);
        }
        catch (error) {
            console.error(`[ROUTE] Failed to send to ${targetServer}:`, error);
            throw error;
        }
    }
    /**
     * Send clear context response to specific server
     */
    async sendClearContextResponse(requestId, sessionId, success = true, targetServer) {
        const serverId = targetServer || this.sessionServerMap.get(sessionId);
        if (!serverId) {
            console.error(`[CLEAR] Unknown server for session ${sessionId}`);
            throw new Error(`Cannot send clear response: unknown session ${sessionId}`);
        }
        const ws = serverId === 'server1' ? this.ws1 : this.ws2;
        if (!ws || ws.readyState !== ws_1.default.OPEN) {
            console.error(`[CLEAR] ${serverId} not connected`);
            throw new Error(`${serverId} is not available`);
        }
        const jsonRpcResponse = {
            jsonrpc: "2.0",
            id: requestId,
            result: {
                status: {
                    state: success ? "cleared" : "failed"
                }
            },
        };
        const message = {
            msgType: "agent_response",
            agentId: this.config.agentId,
            sessionId: sessionId,
            taskId: requestId,
            msgDetail: JSON.stringify(jsonRpcResponse),
        };
        console.log(`\n[CLEAR] Sending clearContext response to ${serverId}:`);
        console.log(`  sessionId: ${sessionId}`);
        console.log(`  requestId: ${requestId}`);
        console.log(`  success: ${success}\n`);
        try {
            ws.send(JSON.stringify(message));
        }
        catch (error) {
            console.error(`[CLEAR] Failed to send to ${serverId}:`, error);
            throw error;
        }
    }
    /**
     * Send status update (for intermediate status messages, e.g., timeout warnings)
     * This uses "status-update" event type which keeps the conversation active
     */
    async sendStatusUpdate(taskId, sessionId, message, targetServer) {
        // Check if session is pending cleanup
        const cleanupState = this.sessionCleanupStateMap.get(sessionId);
        if (cleanupState) {
            // Session is pending cleanup, silently discard status updates
            console.log(`[STATUS] Discarding status update for pending cleanup session ${sessionId}`);
            return;
        }
        const serverId = targetServer || this.sessionServerMap.get(sessionId);
        if (!serverId) {
            console.error(`[STATUS] Unknown server for session ${sessionId}`);
            throw new Error(`Cannot send status update: unknown session ${sessionId}`);
        }
        const ws = serverId === 'server1' ? this.ws1 : this.ws2;
        if (!ws || ws.readyState !== ws_1.default.OPEN) {
            console.error(`[STATUS] ${serverId} not connected`);
            throw new Error(`${serverId} is not available`);
        }
        // Create unique ID for this status update
        const messageId = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const jsonRpcResponse = {
            jsonrpc: "2.0",
            id: messageId,
            result: {
                taskId: taskId,
                kind: "status-update",
                final: false, // IMPORTANT: Not final, keeps conversation active
                status: {
                    message: {
                        role: "agent",
                        parts: [
                            {
                                kind: "text",
                                text: message,
                            },
                        ],
                    },
                    state: "working", // Indicates task is still being processed
                },
            },
        };
        const outboundMessage = {
            msgType: "agent_response",
            agentId: this.config.agentId,
            sessionId: sessionId,
            taskId: taskId,
            msgDetail: JSON.stringify(jsonRpcResponse),
        };
        console.log(`[STATUS] Sending status update to ${serverId}:`);
        console.log(`  sessionId: ${sessionId}`);
        console.log(`  taskId: ${taskId}`);
        console.log(`  message: ${message}`);
        console.log(`  final: false, state: working\n`);
        try {
            ws.send(JSON.stringify(outboundMessage));
        }
        catch (error) {
            console.error(`[STATUS] Failed to send to ${serverId}:`, error);
            throw error;
        }
    }
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
    async sendPushMessage(sessionId, message) {
        console.log(`[PUSH] Would send push message to session ${sessionId}, length: ${message.length} chars`);
        console.log(`[PUSH] Content: ${message.substring(0, 50)}${message.length > 50 ? "..." : ""}`);
        // TODO: Implement actual push message sending via HTTP API
        // Need to confirm correct push message format with XiaoYi API documentation
    }
    /**
     * Send an outbound WebSocket message directly.
     * This is a low-level method that sends a pre-formatted OutboundWebSocketMessage.
     *
     * @param sessionId - Session ID for routing
     * @param message - Pre-formatted outbound message
     */
    async sendMessage(sessionId, message) {
        // Check if session is pending cleanup
        const cleanupState = this.sessionCleanupStateMap.get(sessionId);
        if (cleanupState) {
            console.log(`[SEND_MESSAGE] Discarding message for pending cleanup session ${sessionId}`);
            return;
        }
        // Find which server this session belongs to
        const targetServer = this.sessionServerMap.get(sessionId);
        if (!targetServer) {
            console.error(`[SEND_MESSAGE] Unknown server for session ${sessionId}`);
            throw new Error(`Cannot route message: unknown session ${sessionId}`);
        }
        // Get the corresponding WebSocket connection
        const ws = targetServer === 'server1' ? this.ws1 : this.ws2;
        const state = targetServer === 'server1' ? this.state1 : this.state2;
        if (!ws || ws.readyState !== ws_1.default.OPEN) {
            console.error(`[SEND_MESSAGE] ${targetServer} not connected for session ${sessionId}`);
            throw new Error(`${targetServer} is not available`);
        }
        try {
            ws.send(JSON.stringify(message));
            console.log(`[SEND_MESSAGE] Message sent to ${targetServer} for session ${sessionId}, msgType=${message.msgType}`);
        }
        catch (error) {
            console.error(`[SEND_MESSAGE] Failed to send to ${targetServer}:`, error);
            throw error;
        }
    }
    /**
     * Send tasks cancel response to specific server
     */
    async sendTasksCancelResponse(requestId, sessionId, success = true, targetServer) {
        const serverId = targetServer || this.sessionServerMap.get(sessionId);
        if (!serverId) {
            console.error(`[CANCEL] Unknown server for session ${sessionId}`);
            throw new Error(`Cannot send cancel response: unknown session ${sessionId}`);
        }
        const ws = serverId === 'server1' ? this.ws1 : this.ws2;
        if (!ws || ws.readyState !== ws_1.default.OPEN) {
            console.error(`[CANCEL] ${serverId} not connected`);
            throw new Error(`${serverId} is not available`);
        }
        const jsonRpcResponse = {
            jsonrpc: "2.0",
            id: requestId,
            result: {
                id: requestId,
                status: {
                    state: success ? "canceled" : "failed"
                }
            },
        };
        const message = {
            msgType: "agent_response",
            agentId: this.config.agentId,
            sessionId: sessionId,
            taskId: requestId,
            msgDetail: JSON.stringify(jsonRpcResponse),
        };
        try {
            ws.send(JSON.stringify(message));
        }
        catch (error) {
            console.error(`[CANCEL] Failed to send to ${serverId}:`, error);
            throw error;
        }
    }
    /**
     * Handle clearContext method
     */
    handleClearContext(message, sourceServer) {
        const sessionId = this.extractSessionId(message);
        if (!sessionId) {
            console.error(`[${sourceServer}] Failed to extract sessionId from clearContext message`);
            return;
        }
        console.log(`[${sourceServer}] Received clearContext for session: ${sessionId}`);
        this.sendClearContextResponse(message.id, sessionId, true, sourceServer)
            .catch(error => console.error(`[${sourceServer}] Failed to send clearContext response:`, error));
        this.emit("clear", {
            sessionId: sessionId,
            id: message.id,
            serverId: sourceServer,
        });
        // Mark session for cleanup instead of immediate deletion
        this.markSessionForCleanup(sessionId, sourceServer, this.config.sessionCleanupTimeoutMs ?? XiaoYiWebSocketManager.DEFAULT_CLEANUP_TIMEOUT_MS);
    }
    /**
     * Handle clear message (legacy format)
     */
    handleClearMessage(message, sourceServer) {
        console.log(`[${sourceServer}] Received clear message for session: ${message.sessionId}`);
        this.sendClearContextResponse(message.id, message.sessionId, true, sourceServer)
            .catch(error => console.error(`[${sourceServer}] Failed to send clear response:`, error));
        this.emit("clear", {
            sessionId: message.sessionId,
            id: message.id,
            serverId: sourceServer,
        });
        // Mark session for cleanup instead of immediate deletion
        this.markSessionForCleanup(message.sessionId, sourceServer, this.config.sessionCleanupTimeoutMs ?? XiaoYiWebSocketManager.DEFAULT_CLEANUP_TIMEOUT_MS);
    }
    /**
     * Handle tasks/cancel message
     */
    handleTasksCancelMessage(message, sourceServer) {
        const sessionId = this.extractSessionId(message);
        if (!sessionId) {
            console.error(`[${sourceServer}] Failed to extract sessionId from tasks/cancel message`);
            return;
        }
        const effectiveTaskId = message.taskId || message.id;
        console.log("\n" + "=".repeat(60));
        console.log(`[${sourceServer}] Received cancel request`);
        console.log(`  Session: ${sessionId}`);
        console.log(`  Task ID: ${effectiveTaskId}`);
        console.log("=".repeat(60) + "\n");
        this.sendTasksCancelResponse(message.id, sessionId, true, sourceServer)
            .catch(error => console.error(`[${sourceServer}] Failed to send cancel response:`, error));
        this.emit("cancel", {
            sessionId: sessionId,
            taskId: effectiveTaskId,
            id: message.id,
            serverId: sourceServer,
        });
        this.activeTasks.delete(effectiveTaskId);
    }
    /**
     * Convert A2AResponseMessage to JSON-RPC 2.0 format
     */
    convertToJsonRpcFormat(response, taskId, isFinal = true, append = true) {
        const artifactId = `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        if (response.status === "error" && response.error) {
            return {
                jsonrpc: "2.0",
                id: response.messageId,
                error: {
                    code: response.error.code,
                    message: response.error.message,
                },
            };
        }
        const parts = [];
        if (response.content.type === "text" && response.content.text) {
            // When isFinal=true, use empty string for text (no content needed for final chunk)
            const textContent = isFinal ? "" : response.content.text;
            parts.push({
                kind: "text",
                text: textContent,
            });
        }
        else if (response.content.type === "file") {
            parts.push({
                kind: "file",
                file: {
                    name: response.content.fileName || "file",
                    mimeType: response.content.mimeType || "application/octet-stream",
                    uri: response.content.mediaUrl,
                },
            });
        }
        // When isFinal=true, append should be true and text should be empty
        const artifactEvent = {
            taskId: taskId,
            kind: "artifact-update",
            append: isFinal ? true : append,
            lastChunk: isFinal,
            final: isFinal,
            artifact: {
                artifactId: artifactId,
                parts: parts,
            },
        };
        return {
            jsonrpc: "2.0",
            id: response.messageId,
            result: artifactEvent,
        };
    }
    /**
     * Check if at least one server is ready
     */
    isReady() {
        return (this.state1.ready && this.ws1?.readyState === ws_1.default.OPEN) ||
            (this.state2.ready && this.ws2?.readyState === ws_1.default.OPEN);
    }
    /**
     * Get combined connection state
     */
    getState() {
        const connected = this.state1.connected || this.state2.connected;
        const authenticated = connected; // Auth via headers
        return {
            connected,
            authenticated,
            lastHeartbeat: Math.max(this.state1.lastHeartbeat, this.state2.lastHeartbeat),
            lastAppHeartbeat: 0,
            reconnectAttempts: Math.max(this.state1.reconnectAttempts, this.state2.reconnectAttempts),
            maxReconnectAttempts: 50,
        };
    }
    /**
     * Get individual server states
     */
    getServerStates() {
        return {
            server1: { ...this.state1 },
            server2: { ...this.state2 },
        };
    }
    /**
     * Start protocol-level heartbeat for specific server
     */
    startProtocolHeartbeat(serverId) {
        const interval = setInterval(() => {
            const ws = serverId === 'server1' ? this.ws1 : this.ws2;
            const state = serverId === 'server1' ? this.state1 : this.state2;
            if (ws && ws.readyState === ws_1.default.OPEN) {
                ws.ping();
                const now = Date.now();
                if (state.lastHeartbeat > 0 && now - state.lastHeartbeat > 90000) {
                    console.warn(`[${serverId}] Heartbeat timeout, reconnecting...`);
                    ws.close();
                }
            }
        }, 30000);
        if (serverId === 'server1') {
            this.heartbeatTimeout1 = interval;
        }
        else {
            this.heartbeatTimeout2 = interval;
        }
    }
    /**
     * Clear protocol heartbeat for specific server
     */
    clearProtocolHeartbeat(serverId) {
        const interval = serverId === 'server1' ? this.heartbeatTimeout1 : this.heartbeatTimeout2;
        if (interval) {
            clearInterval(interval);
            if (serverId === 'server1') {
                this.heartbeatTimeout1 = undefined;
            }
            else {
                this.heartbeatTimeout2 = undefined;
            }
        }
    }
    /**
     * Start application-level heartbeat (shared across both servers)
     */
    startAppHeartbeat() {
        this.appHeartbeatInterval = setInterval(() => {
            const heartbeatMessage = {
                msgType: "heartbeat",
                agentId: this.config.agentId,
            };
            // Send to all connected servers
            if (this.ws1?.readyState === ws_1.default.OPEN) {
                try {
                    this.ws1.send(JSON.stringify(heartbeatMessage));
                }
                catch (error) {
                    console.error('[Server1] Failed to send app heartbeat:', error);
                }
            }
            if (this.ws2?.readyState === ws_1.default.OPEN) {
                try {
                    this.ws2.send(JSON.stringify(heartbeatMessage));
                }
                catch (error) {
                    console.error('[Server2] Failed to send app heartbeat:', error);
                }
            }
        }, 20000);
    }
    /**
     * Schedule reconnection for specific server
     */
    scheduleReconnect(serverId) {
        const state = serverId === 'server1' ? this.state1 : this.state2;
        if (state.reconnectAttempts >= 50) {
            console.error(`[${serverId}] Max reconnection attempts reached`);
            this.emit("maxReconnectAttemptsReached", serverId);
            return;
        }
        const delay = Math.min(2000 * Math.pow(2, state.reconnectAttempts), 60000);
        state.reconnectAttempts++;
        console.log(`[${serverId}] Scheduling reconnect attempt ${state.reconnectAttempts}/50 in ${delay}ms`);
        const timeout = setTimeout(async () => {
            try {
                if (serverId === 'server1') {
                    await this.connectToServer1();
                }
                else {
                    await this.connectToServer2();
                }
                console.log(`[${serverId}] Reconnected successfully`);
            }
            catch (error) {
                console.error(`[${serverId}] Reconnection failed:`, error);
                this.scheduleReconnect(serverId);
            }
        }, delay);
        if (serverId === 'server1') {
            this.reconnectTimeout1 = timeout;
        }
        else {
            this.reconnectTimeout2 = timeout;
        }
    }
    /**
     * Clear all timers
     */
    clearTimers() {
        if (this.heartbeatTimeout1) {
            clearInterval(this.heartbeatTimeout1);
            this.heartbeatTimeout1 = undefined;
        }
        if (this.heartbeatTimeout2) {
            clearInterval(this.heartbeatTimeout2);
            this.heartbeatTimeout2 = undefined;
        }
        if (this.appHeartbeatInterval) {
            clearInterval(this.appHeartbeatInterval);
            this.appHeartbeatInterval = undefined;
        }
        if (this.reconnectTimeout1) {
            clearTimeout(this.reconnectTimeout1);
            this.reconnectTimeout1 = undefined;
        }
        if (this.reconnectTimeout2) {
            clearTimeout(this.reconnectTimeout2);
            this.reconnectTimeout2 = undefined;
        }
        // Clear stable connection timers
        this.clearStableConnectionCheck('server1');
        this.clearStableConnectionCheck('server2');
    }
    /**
     * Schedule a connection stability check
     * Only reset reconnect counter after connection has been stable for threshold time
     */
    scheduleStableConnectionCheck(serverId) {
        const timer = setTimeout(() => {
            const state = serverId === 'server1' ? this.state1 : this.state2;
            if (state.connected) {
                console.log(`[${serverId}] Connection stable for ${XiaoYiWebSocketManager.STABLE_CONNECTION_THRESHOLD}ms, resetting reconnect counter`);
                state.reconnectAttempts = 0;
            }
        }, XiaoYiWebSocketManager.STABLE_CONNECTION_THRESHOLD);
        if (serverId === 'server1') {
            this.stableConnectionTimer1 = timer;
        }
        else {
            this.stableConnectionTimer2 = timer;
        }
    }
    /**
     * Clear the connection stability check timer
     */
    clearStableConnectionCheck(serverId) {
        const timer = serverId === 'server1' ? this.stableConnectionTimer1 : this.stableConnectionTimer2;
        if (timer) {
            clearTimeout(timer);
            if (serverId === 'server1') {
                this.stableConnectionTimer1 = undefined;
            }
            else {
                this.stableConnectionTimer2 = undefined;
            }
        }
    }
    /**
     * Type guard for A2A request messages
     * sessionId can be in params OR at top level (fallback)
     */
    isA2ARequestMessage(data) {
        return data &&
            typeof data.agentId === "string" &&
            data.jsonrpc === "2.0" &&
            typeof data.id === "string" &&
            data.method === "message/stream" &&
            data.params &&
            typeof data.params.id === "string" &&
            // sessionId can be in params OR at top level
            (typeof data.params.sessionId === "string" || typeof data.sessionId === "string") &&
            data.params.message &&
            typeof data.params.message.role === "string" &&
            Array.isArray(data.params.message.parts);
    }
    /**
     * Get active tasks
     */
    getActiveTasks() {
        return new Map(this.activeTasks);
    }
    /**
     * Remove task from active tasks
     */
    removeActiveTask(taskId) {
        this.activeTasks.delete(taskId);
    }
    /**
     * Get server for a specific session
     */
    getServerForSession(sessionId) {
        return this.sessionServerMap.get(sessionId);
    }
    /**
     * Remove session mapping
     */
    removeSession(sessionId) {
        this.sessionServerMap.delete(sessionId);
    }
    /**
     * Mark a session for delayed cleanup
     * @param sessionId The session ID to mark for cleanup
     * @param serverId The server ID associated with this session
     * @param timeoutMs Timeout in milliseconds before forcing cleanup
     */
    markSessionForCleanup(sessionId, serverId, timeoutMs) {
        // Check if already marked
        const existingState = this.sessionCleanupStateMap.get(sessionId);
        if (existingState) {
            // Already pending cleanup, reset timeout
            if (existingState.cleanupTimeoutId) {
                clearTimeout(existingState.cleanupTimeoutId);
            }
            console.log(`[CLEANUP] Session ${sessionId} already pending cleanup, resetting timeout`);
        }
        // Create new cleanup state
        const newState = {
            sessionId,
            serverId,
            markedForCleanupAt: Date.now(),
            reason: 'user_cleared',
        };
        // Start cleanup timeout
        const timeoutId = setTimeout(() => {
            console.log(`[CLEANUP] Timeout reached for session ${sessionId}, forcing cleanup`);
            this.forceCleanupSession(sessionId);
        }, timeoutMs);
        newState.cleanupTimeoutId = timeoutId;
        this.sessionCleanupStateMap.set(sessionId, newState);
        console.log(`[CLEANUP] Session ${sessionId} marked for cleanup (timeout: ${timeoutMs}ms)`);
    }
    /**
     * Force cleanup a session immediately
     * @param sessionId The session ID to cleanup
     */
    forceCleanupSession(sessionId) {
        // Check if already cleaned
        const state = this.sessionCleanupStateMap.get(sessionId);
        if (!state) {
            console.log(`[CLEANUP] Session ${sessionId} already cleaned up, skipping`);
            return;
        }
        // Clear timeout
        if (state.cleanupTimeoutId) {
            clearTimeout(state.cleanupTimeoutId);
        }
        // Remove from both maps
        this.sessionServerMap.delete(sessionId);
        this.sessionCleanupStateMap.delete(sessionId);
        console.log(`[CLEANUP] Session ${sessionId} cleanup completed`);
    }
    /**
     * Check if a session is pending cleanup
     * @param sessionId The session ID to check
     * @returns True if session is pending cleanup
     */
    isSessionPendingCleanup(sessionId) {
        return this.sessionCleanupStateMap.has(sessionId);
    }
    /**
     * Get cleanup state for a session
     * @param sessionId The session ID to check
     * @returns Cleanup state if exists, undefined otherwise
     */
    getSessionCleanupState(sessionId) {
        return this.sessionCleanupStateMap.get(sessionId);
    }
    /**
     * Update accumulated text for a pending cleanup session
     * @param sessionId The session ID
     * @param text The accumulated text
     */
    updateAccumulatedTextForCleanup(sessionId, text) {
        const state = this.sessionCleanupStateMap.get(sessionId);
        if (state) {
            state.accumulatedText = text;
        }
    }
}
exports.XiaoYiWebSocketManager = XiaoYiWebSocketManager;
XiaoYiWebSocketManager.DEFAULT_CLEANUP_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
XiaoYiWebSocketManager.STABLE_CONNECTION_THRESHOLD = 10000; // 10 seconds
