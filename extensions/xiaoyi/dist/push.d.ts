import { XiaoYiChannelConfig } from "./types.js";
/**
 * Push message sending service
 * Sends notifications to XiaoYi clients via webhook API
 */
export declare class XiaoYiPushService {
    private config;
    private readonly pushUrl;
    constructor(config: XiaoYiChannelConfig);
    /**
     * Check if push functionality is configured
     */
    isConfigured(): boolean;
    /**
     * Generate HMAC-SHA256 signature
     */
    private generateSignature;
    /**
     * Generate UUID
     */
    private generateUUID;
    /**
     * Send push notification (with summary text)
     * @param text - Summary text to send (e.g., first 30 characters)
     * @param pushText - Push notification message (e.g., "任务已完成：xxx...")
     */
    sendPush(text: string, pushText: string): Promise<boolean>;
}
