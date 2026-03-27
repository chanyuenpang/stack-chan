import type { OpenClawConfig } from "openclaw/dist/plugin-sdk/index.js";
import type { XiaoYiChannelConfig } from "./types.js";
type ClawdbotConfig = OpenClawConfig;
/**
 * Resolve XiaoYi channel configuration from OpenClaw config.
 */
export declare function resolveXYConfig(cfg: ClawdbotConfig): XiaoYiChannelConfig;
/**
 * List XiaoYi channel account IDs.
 * Single account mode - always returns ["default"].
 */
export declare function listXYAccountIds(cfg: ClawdbotConfig): string[];
/**
 * Get default XiaoYi channel account ID.
 * Single account mode - always returns "default".
 */
export declare function getDefaultXYAccountId(cfg: ClawdbotConfig): string | undefined;
export {};
