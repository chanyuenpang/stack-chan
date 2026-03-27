"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configManager = void 0;
// Dynamic configuration manager for runtime updates
const logger_js_1 = require("./logger.js");
/**
 * Manages dynamic configuration updates that can change at runtime.
 * Specifically handles pushId which can be updated per-session.
 */
class ConfigManager {
    constructor() {
        this.sessionPushIds = new Map();
        this.globalPushId = null;
    }
    /**
     * Update push ID for a specific session.
     */
    updatePushId(sessionId, pushId) {
        if (!pushId) {
            logger_js_1.logger.warn(`[ConfigManager] Attempted to set empty pushId for session ${sessionId}`);
            return;
        }
        const previous = this.sessionPushIds.get(sessionId);
        if (previous !== pushId) {
            logger_js_1.logger.log(`[ConfigManager] ✨ Updated pushId for session ${sessionId}`);
            logger_js_1.logger.log(`[ConfigManager]   - Previous: ${previous ? previous.substring(0, 20) + '...' : 'none'}`);
            logger_js_1.logger.log(`[ConfigManager]   - New:      ${pushId.substring(0, 20)}...`);
            logger_js_1.logger.log(`[ConfigManager]   - Full new pushId: ${pushId}`);
            this.sessionPushIds.set(sessionId, pushId);
            this.globalPushId = pushId; // Also update global for backward compatibility
        }
    }
    /**
     * Get push ID for a session (falls back to global if not found).
     */
    getPushId(sessionId) {
        if (sessionId) {
            const sessionPushId = this.sessionPushIds.get(sessionId);
            if (sessionPushId) {
                return sessionPushId;
            }
        }
        return this.globalPushId;
    }
    /**
     * Clear push ID for a session.
     */
    clearSession(sessionId) {
        this.sessionPushIds.delete(sessionId);
        logger_js_1.logger.debug(`[ConfigManager] Cleared pushId for session ${sessionId}`);
    }
    /**
     * Clear all cached push IDs.
     */
    clear() {
        this.sessionPushIds.clear();
        this.globalPushId = null;
        logger_js_1.logger.debug(`[ConfigManager] Cleared all cached pushIds`);
    }
}
exports.configManager = new ConfigManager();
