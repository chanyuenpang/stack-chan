"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSession = registerSession;
exports.unregisterSession = unregisterSession;
exports.getSessionContext = getSessionContext;
exports.getLatestSessionContext = getLatestSessionContext;
const logger_js_1 = require("../xy-utils/logger.js");
const config_manager_js_1 = require("../xy-utils/config-manager.js");
// Map of sessionKey -> SessionContext
const activeSessions = new Map();
/**
 * Register a session context for tool access.
 * Should be called when starting to process a message.
 */
function registerSession(sessionKey, context) {
    logger_js_1.logger.log(`[SESSION_MANAGER] 📝 Registering session: ${sessionKey}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - sessionId: ${context.sessionId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - taskId: ${context.taskId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - messageId: ${context.messageId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - agentId: ${context.agentId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions before: ${activeSessions.size}`);
    activeSessions.set(sessionKey, context);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions after: ${activeSessions.size}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - All session keys: [${Array.from(activeSessions.keys()).join(", ")}]`);
}
/**
 * Unregister a session context.
 * Should be called when message processing is complete.
 */
function unregisterSession(sessionKey) {
    logger_js_1.logger.log(`[SESSION_MANAGER] 🗑️  Unregistering session: ${sessionKey}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions before: ${activeSessions.size}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Session existed: ${activeSessions.has(sessionKey)}`);
    // Get session context before deleting to clear associated pushId
    const context = activeSessions.get(sessionKey);
    const existed = activeSessions.delete(sessionKey);
    // Clear cached pushId for this session
    if (context) {
        config_manager_js_1.configManager.clearSession(context.sessionId);
    }
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Deleted: ${existed}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions after: ${activeSessions.size}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Remaining session keys: [${Array.from(activeSessions.keys()).join(", ")}]`);
}
/**
 * Get session context by sessionKey.
 * Returns null if session not found.
 */
function getSessionContext(sessionKey) {
    logger_js_1.logger.log(`[SESSION_MANAGER] 🔍 Getting session by key: ${sessionKey}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions: ${activeSessions.size}`);
    const context = activeSessions.get(sessionKey) ?? null;
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Found: ${context !== null}`);
    if (context) {
        logger_js_1.logger.log(`[SESSION_MANAGER]   - sessionId: ${context.sessionId}`);
    }
    return context;
}
/**
 * Get the most recent session context.
 * This is a fallback for tools that don't have access to sessionKey.
 * Returns null if no sessions are active.
 */
function getLatestSessionContext() {
    logger_js_1.logger.log(`[SESSION_MANAGER] 🔍 Getting latest session context`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active sessions count: ${activeSessions.size}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]   - Active session keys: [${Array.from(activeSessions.keys()).join(", ")}]`);
    if (activeSessions.size === 0) {
        logger_js_1.logger.error(`[SESSION_MANAGER]   - ❌ No active sessions found!`);
        return null;
    }
    // Return the last added session
    const sessions = Array.from(activeSessions.values());
    const latestSession = sessions[sessions.length - 1];
    logger_js_1.logger.log(`[SESSION_MANAGER]   - ✅ Found latest session:`);
    logger_js_1.logger.log(`[SESSION_MANAGER]     - sessionId: ${latestSession.sessionId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]     - taskId: ${latestSession.taskId}`);
    logger_js_1.logger.log(`[SESSION_MANAGER]     - messageId: ${latestSession.messageId}`);
    return latestSession;
}
