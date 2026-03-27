import type { A2AJsonRpcRequest, A2AMessagePart, A2ADataEvent } from "./types.js";
/**
 * Parsed message information extracted from A2A request.
 * Note: agentId is not extracted from message - it should come from config.
 */
export interface ParsedA2AMessage {
    sessionId: string;
    taskId: string;
    messageId: string;
    parts: A2AMessagePart[];
    method: string;
}
/**
 * Parse an A2A JSON-RPC request into structured message data.
 */
export declare function parseA2AMessage(request: A2AJsonRpcRequest): ParsedA2AMessage;
/**
 * Extract text content from message parts.
 */
export declare function extractTextFromParts(parts: A2AMessagePart[]): string;
/**
 * Extract file parts from message parts.
 */
export declare function extractFileParts(parts: A2AMessagePart[]): Array<{
    name: string;
    mimeType: string;
    uri: string;
}>;
/**
 * Extract data events from message parts (for tool responses).
 */
export declare function extractDataEvents(parts: A2AMessagePart[]): A2ADataEvent[];
/**
 * Check if message is a clearContext request.
 */
export declare function isClearContextMessage(method: string): boolean;
/**
 * Check if message is a tasks/cancel request.
 */
export declare function isTasksCancelMessage(method: string): boolean;
/**
 * Extract push_id from message parts.
 * Looks for push_id in data parts under variables.systemVariables.push_id
 */
export declare function extractPushId(parts: A2AMessagePart[]): string | null;
/**
 * Validate A2A request structure.
 */
export declare function validateA2ARequest(request: any): request is A2AJsonRpcRequest;
