import type { SessionBinding, ServerIdentifier } from "../types.js";
/**
 * Session-to-server binding cache.
 * Tracks which WebSocket server each session is bound to.
 */
declare class SessionManager {
    private bindings;
    /**
     * Bind a session to a specific server.
     */
    bind(sessionId: string, server: ServerIdentifier): void;
    /**
     * Get the server binding for a session.
     */
    getBinding(sessionId: string): ServerIdentifier | null;
    /**
     * Check if a session is bound to a server.
     */
    isBound(sessionId: string): boolean;
    /**
     * Unbind a session.
     */
    unbind(sessionId: string): void;
    /**
     * Clear all bindings.
     */
    clear(): void;
    /**
     * Get all bindings.
     */
    getAll(): SessionBinding[];
}
export declare const sessionManager: SessionManager;
export {};
