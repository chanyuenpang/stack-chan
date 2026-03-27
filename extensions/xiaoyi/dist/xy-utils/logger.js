"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
// Logging utilities for XY channel
const runtime_js_1 = require("../runtime.js");
/**
 * Log a message using the OpenClaw runtime logger.
 */
function logMessage(level, message, ...args) {
    try {
        const runtime = (0, runtime_js_1.getXiaoYiRuntime)();
        const logFn = runtime[level];
        if (logFn) {
            const formattedMessage = `[XY] ${message}`;
            logFn(formattedMessage, ...args);
        }
    }
    catch (error) {
        // Fallback to console if runtime not available
        console[level](`[XY] ${message}`, ...args);
    }
}
exports.logger = {
    log(message, ...args) {
        logMessage("log", message, ...args);
    },
    warn(message, ...args) {
        logMessage("warn", message, ...args);
    },
    error(message, ...args) {
        logMessage("error", message, ...args);
    },
    debug(message, ...args) {
        // Debug messages go to log level
        logMessage("log", `[DEBUG] ${message}`, ...args);
    },
};
