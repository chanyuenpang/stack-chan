"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = void 0;
/**
 * Session-to-server binding cache.
 * Tracks which WebSocket server each session is bound to.
 */
class SessionManager {
    constructor() {
        this.bindings = new Map();
    }
    /**
     * Bind a session to a specific server.
     */
    bind(sessionId, server) {
        this.bindings.set(sessionId, {
            sessionId,
            server,
            boundAt: Date.now(),
        });
    }
    /**
     * Get the server binding for a session.
     */
    getBinding(sessionId) {
        const binding = this.bindings.get(sessionId);
        return binding ? binding.server : null;
    }
    /**
     * Check if a session is bound to a server.
     */
    isBound(sessionId) {
        return this.bindings.has(sessionId);
    }
    /**
     * Unbind a session.
     */
    unbind(sessionId) {
        this.bindings.delete(sessionId);
    }
    /**
     * Clear all bindings.
     */
    clear() {
        this.bindings.clear();
    }
    /**
     * Get all bindings.
     */
    getAll() {
        return Array.from(this.bindings.values());
    }
}
// Singleton instance
exports.sessionManager = new SessionManager();
