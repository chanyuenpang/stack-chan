import { XiaoYiWebSocketManager } from "./websocket.js";
import type { XiaoYiChannelConfig } from "./types.js";
import type { RuntimeEnv } from "openclaw/dist/plugin-sdk/index.js";
/**
 * Set the runtime for logging in client module.
 */
export declare function setClientRuntime(rt: RuntimeEnv | undefined): void;
/**
 * Get or create a WebSocket manager for the given configuration.
 * Reuses existing managers if config matches.
 * Adapted for xiaoyi - uses aksk instead of apiKey/uid
 */
export declare function getXYWebSocketManager(config: XiaoYiChannelConfig): XiaoYiWebSocketManager;
/**
 * Remove a specific WebSocket manager from cache.
 * Disconnects the manager and removes it from the cache.
 */
export declare function removeXYWebSocketManager(config: XiaoYiChannelConfig): void;
/**
 * Clear all cached WebSocket managers.
 */
export declare function clearXYWebSocketManagers(): void;
/**
 * Get the number of cached managers.
 */
export declare function getCachedManagerCount(): number;
