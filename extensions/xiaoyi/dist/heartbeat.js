"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeartbeatManager = void 0;
// Heartbeat management for WebSocket connections
const ws_1 = __importDefault(require("ws"));
/**
 * Manages heartbeat for a WebSocket connection.
 * Supports both application-level and protocol-level heartbeats.
 */
class HeartbeatManager {
    constructor(ws, config, onTimeout, serverName = "unknown", logFn, errorFn, onHeartbeatSuccess // ✅ 心跳成功回调，向 OpenClaw 报告健康状态
    ) {
        this.ws = ws;
        this.config = config;
        this.onTimeout = onTimeout;
        this.serverName = serverName;
        this.onHeartbeatSuccess = onHeartbeatSuccess;
        this.intervalTimer = null;
        this.timeoutTimer = null;
        this.lastPongTime = 0;
        this.log = logFn ?? console.log;
        this.error = errorFn ?? console.error;
    }
    /**
     * Start heartbeat monitoring.
     */
    start() {
        this.stop(); // Clear any existing timers
        this.lastPongTime = Date.now();
        // Setup ping/pong for protocol-level heartbeat
        this.ws.on("pong", () => {
            this.lastPongTime = Date.now();
            if (this.timeoutTimer) {
                clearTimeout(this.timeoutTimer);
                this.timeoutTimer = null;
            }
            // ✅ Report health: heartbeat successful - notify OpenClaw framework
            this.onHeartbeatSuccess?.();
            this.log(`[${this.serverName}] Heartbeat pong received, health reported to OpenClaw`);
        });
        // Start interval timer
        this.intervalTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.config.interval);
        this.log(`[${this.serverName}] Heartbeat started: interval=${this.config.interval}ms, timeout=${this.config.timeout}ms`);
    }
    /**
     * Stop heartbeat monitoring.
     */
    stop() {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        // Remove pong listener
        this.ws.off("pong", () => { });
        this.log(`[${this.serverName}] Heartbeat stopped`);
    }
    /**
     * Send a heartbeat ping.
     */
    sendHeartbeat() {
        if (this.ws.readyState !== ws_1.default.OPEN) {
            console.warn(`[${this.serverName}] Cannot send heartbeat: WebSocket not open`);
            return;
        }
        try {
            // Send application-level heartbeat message
            this.log(`[${this.serverName}] Sending heartbeat frame:`, this.config.message.substring(0, 100));
            this.ws.send(this.config.message);
            // Send protocol-level ping
            this.ws.ping();
            this.log(`[${this.serverName}] Protocol-level ping sent`);
            // Setup timeout timer
            this.timeoutTimer = setTimeout(() => {
                this.error(`[${this.serverName}] Heartbeat timeout - no pong received`);
                this.onTimeout();
            }, this.config.timeout);
        }
        catch (error) {
            this.error(`[${this.serverName}] Failed to send heartbeat:`, error);
        }
    }
    /**
     * Check if connection is healthy based on last pong time.
     */
    isHealthy() {
        if (this.lastPongTime === 0) {
            return true; // Not started yet
        }
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        return timeSinceLastPong < this.config.interval + this.config.timeout;
    }
}
exports.HeartbeatManager = HeartbeatManager;
