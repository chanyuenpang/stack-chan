"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendA2AResponse = sendA2AResponse;
exports.sendReasoningTextUpdate = sendReasoningTextUpdate;
exports.sendStatusUpdate = sendStatusUpdate;
exports.sendCommand = sendCommand;
exports.sendClearContextResponse = sendClearContextResponse;
exports.sendTasksCancelResponse = sendTasksCancelResponse;
// OpenClaw → A2A format conversion
const uuid_1 = require("uuid");
const xy_client_js_1 = require("./xy-client.js");
const runtime_js_1 = require("./runtime.js");
/**
 * Send an A2A artifact update response.
 */
async function sendA2AResponse(params) {
    const { config, sessionId, taskId, messageId, text, append, final, files } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Build artifact update event
    const artifact = {
        taskId,
        kind: "artifact-update",
        append,
        lastChunk: true,
        final,
        artifact: {
            artifactId: (0, uuid_1.v4)(),
            parts: [],
        },
    };
    // Add text part (even if empty string, to maintain parts structure)
    if (text !== undefined) {
        artifact.artifact.parts.push({
            kind: "text",
            text,
        });
    }
    // Add file parts if provided
    if (files && files.length > 0) {
        artifact.artifact.parts.push({
            kind: "data",
            data: { fileInfo: files },
        });
    }
    // Build JSON-RPC response
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: artifact,
    };
    // Send via WebSocket
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId,
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    // 📋 Log complete response body
    log(`[A2A_RESPONSE] 📤 Sending A2A artifact-update response:`);
    log(`[A2A_RESPONSE]   - sessionId: ${sessionId}`);
    log(`[A2A_RESPONSE]   - taskId: ${taskId}`);
    log(`[A2A_RESPONSE]   - messageId: ${messageId}`);
    log(`[A2A_RESPONSE]   - append: ${append}`);
    log(`[A2A_RESPONSE]   - final: ${final}`);
    log(`[A2A_RESPONSE]   - text length: ${text?.length ?? 0}`);
    log(`[A2A_RESPONSE]   - files count: ${files?.length ?? 0}`);
    log(`[A2A_RESPONSE] 📦 Complete outbound message:`);
    log(JSON.stringify(outboundMessage, null, 2));
    log(`[A2A_RESPONSE] 📦 JSON-RPC response body:`);
    log(JSON.stringify(jsonRpcResponse, null, 2));
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`[A2A_RESPONSE] ✅ Message sent successfully`);
}
/**
 * Send an A2A artifact-update with reasoningText part.
 * Used for onToolStart, onToolResult, onReasoningStream, onReasoningEnd, onPartialReply.
 * append=true, final=false, lastChunk=true, text is suffixed with newline for markdown rendering.
 */
async function sendReasoningTextUpdate(params) {
    const { config, sessionId, taskId, messageId, text, append = true } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    const artifact = {
        taskId,
        kind: "artifact-update",
        append,
        lastChunk: true,
        final: false,
        artifact: {
            artifactId: (0, uuid_1.v4)(),
            parts: [
                {
                    kind: "reasoningText",
                    reasoningText: text,
                },
            ],
        },
    };
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: artifact,
    };
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId,
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    log(`[REASONING_TEXT] 📤 Sending reasoningText update: sessionId=${sessionId}, taskId=${taskId}, text.length=${text.length}`);
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`[REASONING_TEXT] ✅ Sent successfully`);
}
/**
 * Send an A2A task status update.
 * Follows A2A protocol standard format with nested status object.
 */
async function sendStatusUpdate(params) {
    const { config, sessionId, taskId, messageId, text, state } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Build status update event following A2A protocol standard
    const statusUpdate = {
        taskId,
        kind: "status-update",
        final: false, // Status updates should not end the stream
        status: {
            message: {
                role: "agent",
                parts: [
                    {
                        kind: "text",
                        text,
                    },
                ],
            },
            state,
        },
    };
    // Build JSON-RPC response
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: statusUpdate,
    };
    // Send via WebSocket
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId,
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    // 📋 Log complete response body
    log(`[A2A_STATUS] 📤 Sending A2A status-update:`);
    log(`[A2A_STATUS]   - sessionId: ${sessionId}`);
    log(`[A2A_STATUS]   - taskId: ${taskId}`);
    log(`[A2A_STATUS]   - messageId: ${messageId}`);
    log(`[A2A_STATUS]   - state: ${state}`);
    log(`[A2A_STATUS]   - text: "${text}"`);
    log(`[A2A_STATUS] 📦 Complete outbound message:`);
    log(JSON.stringify(outboundMessage, null, 2));
    log(`[A2A_STATUS] 📦 JSON-RPC response body:`);
    log(JSON.stringify(jsonRpcResponse, null, 2));
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`[A2A_STATUS] ✅ Status update sent successfully`);
}
/**
 * Send a command as an artifact update (final=false).
 */
async function sendCommand(params) {
    const { config, sessionId, taskId, messageId, command } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Build artifact update with command as data
    // Wrap command in commands array as per protocol requirement
    const artifact = {
        taskId,
        kind: "artifact-update",
        append: false,
        lastChunk: true,
        final: false, // Commands are not final
        artifact: {
            artifactId: (0, uuid_1.v4)(),
            parts: [
                {
                    kind: "data",
                    data: {
                        commands: [command],
                    },
                },
            ],
        },
    };
    // Build JSON-RPC response
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: artifact,
    };
    // Send via WebSocket
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId,
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    // 📋 Log complete response body
    log(`[A2A_COMMAND] 📤 Sending A2A command:`);
    log(`[A2A_COMMAND]   - sessionId: ${sessionId}`);
    log(`[A2A_COMMAND]   - taskId: ${taskId}`);
    log(`[A2A_COMMAND]   - messageId: ${messageId}`);
    log(`[A2A_COMMAND]   - command: ${command.header.namespace}::${command.header.name}`);
    log(`[A2A_COMMAND] 📦 Complete outbound message:`);
    log(JSON.stringify(outboundMessage, null, 2));
    log(`[A2A_COMMAND] 📦 JSON-RPC response body:`);
    log(JSON.stringify(jsonRpcResponse, null, 2));
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`[A2A_COMMAND] ✅ Command sent successfully`);
}
/**
 * Send a clearContext response.
 */
async function sendClearContextResponse(params) {
    const { config, sessionId, messageId } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Build JSON-RPC response for clearContext
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: {
            status: {
                state: "cleared",
            },
        },
        error: {
            code: 0,
            // Note: Using any to bypass type check as the response format differs from standard A2A types
            message: "",
        },
    };
    // Send via WebSocket
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId: sessionId, // Use sessionId as taskId for clearContext
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`Sent clearContext response: sessionId=${sessionId}`);
}
/**
 * Send a tasks/cancel response.
 */
async function sendTasksCancelResponse(params) {
    const { config, sessionId, taskId, messageId } = params;
    const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
    const log = runtime?.log ?? console.log;
    const error = runtime?.error ?? console.error;
    // Build JSON-RPC response for tasks/cancel
    // Note: Using any to bypass type check as the response format differs from standard A2A types
    const jsonRpcResponse = {
        jsonrpc: "2.0",
        id: messageId,
        result: {
            id: taskId,
            status: {
                state: "canceled",
            },
        },
        error: {
            code: 0,
            message: "",
        },
    };
    // Send via WebSocket
    const wsManager = (0, xy_client_js_1.getXYWebSocketManager)(config);
    const outboundMessage = {
        msgType: "agent_response",
        agentId: config.agentId,
        sessionId,
        taskId,
        msgDetail: JSON.stringify(jsonRpcResponse),
    };
    await wsManager.sendMessage(sessionId, outboundMessage);
    log(`Sent tasks/cancel response: sessionId=${sessionId}, taskId=${taskId}`);
}
