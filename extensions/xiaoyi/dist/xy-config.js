"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveXYConfig = resolveXYConfig;
exports.listXYAccountIds = listXYAccountIds;
exports.getDefaultXYAccountId = getDefaultXYAccountId;
/**
 * Resolve XiaoYi channel configuration from OpenClaw config.
 */
function resolveXYConfig(cfg) {
    const channelConfig = cfg?.channels?.xiaoyi;
    if (!channelConfig) {
        throw new Error("XiaoYi channel configuration not found");
    }
    return channelConfig;
}
/**
 * List XiaoYi channel account IDs.
 * Single account mode - always returns ["default"].
 */
function listXYAccountIds(cfg) {
    const channelConfig = cfg?.channels?.xiaoyi;
    if (!channelConfig || !channelConfig.enabled) {
        return [];
    }
    return ["default"];
}
/**
 * Get default XiaoYi channel account ID.
 * Single account mode - always returns "default".
 */
function getDefaultXYAccountId(cfg) {
    const channelConfig = cfg?.channels?.xiaoyi;
    if (!channelConfig || !channelConfig.enabled) {
        return undefined;
    }
    return "default";
}
