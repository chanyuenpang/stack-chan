"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setClientRuntime = setClientRuntime;
exports.getXYWebSocketManager = getXYWebSocketManager;
exports.removeXYWebSocketManager = removeXYWebSocketManager;
exports.clearXYWebSocketManagers = clearXYWebSocketManagers;
exports.getCachedManagerCount = getCachedManagerCount;
// WebSocket client cache management
// Adapted for xiaoyi - uses xiaoyi's WebSocket manager with aksk auth
const websocket_js_1 = require("./websocket.js");
// Runtime reference for logging
let runtime;
/**
 * Set the runtime for logging in client module.
 */
function setClientRuntime(rt) {
    runtime = rt;
}
/**
 * Global cache for WebSocket managers.
 * Key format: `${ak}-${agentId}` (using xiaoyi's aksk auth)
 */
const wsManagerCache = new Map();
/**
 * Get or create a WebSocket manager for the given configuration.
 * Reuses existing managers if config matches.
 * Adapted for xiaoyi - uses aksk instead of apiKey/uid
 */
function getXYWebSocketManager(config) {
    const cacheKey = `${config.ak}-${config.agentId}`;
    let cached = wsManagerCache.get(cacheKey);
    if (cached) {
        const log = runtime?.log ?? console.log;
        log(`[WS-MANAGER-CACHE] ✅ Reusing cached WebSocket manager: ${cacheKey}, total managers: ${wsManagerCache.size}`);
        return cached;
    }
    // Create new manager with xiaoyi's config (aksk auth)
    const log = runtime?.log ?? console.log;
    log(`[WS-MANAGER-CACHE] 🆕 Creating new WebSocket manager: ${cacheKey}, total managers before: ${wsManagerCache.size}`);
    cached = new websocket_js_1.XiaoYiWebSocketManager(config);
    wsManagerCache.set(cacheKey, cached);
    log(`[WS-MANAGER-CACHE] 📊 Total managers after creation: ${wsManagerCache.size}`);
    return cached;
}
/**
 * Remove a specific WebSocket manager from cache.
 * Disconnects the manager and removes it from the cache.
 */
function removeXYWebSocketManager(config) {
    const cacheKey = `${config.ak}-${config.agentId}`;
    const manager = wsManagerCache.get(cacheKey);
    if (manager) {
        console.log(`🗑️  [WS-MANAGER-CACHE] Removing manager from cache: ${cacheKey}`);
        manager.disconnect();
        wsManagerCache.delete(cacheKey);
        console.log(`🗑️  [WS-MANAGER-CACHE] Manager removed, remaining managers: ${wsManagerCache.size}`);
    }
    else {
        console.log(`⚠️  [WS-MANAGER-CACHE] Manager not found in cache: ${cacheKey}`);
    }
}
/**
 * Clear all cached WebSocket managers.
 */
function clearXYWebSocketManagers() {
    const log = runtime?.log ?? console.log;
    log("Clearing all WebSocket manager caches");
    for (const manager of wsManagerCache.values()) {
        manager.disconnect();
    }
    wsManagerCache.clear();
}
/**
 * Get the number of cached managers.
 */
function getCachedManagerCount() {
    return wsManagerCache.size;
}
