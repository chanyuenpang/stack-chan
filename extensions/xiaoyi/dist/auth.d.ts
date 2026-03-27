import { AuthCredentials } from "./types.js";
/**
 * Generate authentication signature using AK/SK mechanism
 * Based on: https://developer.huawei.com/consumer/cn/doc/service/pushmessage-0000002505761436
 *
 * Signature format: Base64(HMAC-SHA256(secretKey, ts))
 */
export declare class XiaoYiAuth {
    private ak;
    private sk;
    private agentId;
    constructor(ak: string, sk: string, agentId: string);
    /**
     * Generate authentication credentials with signature
     */
    generateAuthCredentials(): AuthCredentials;
    /**
     * Generate HMAC-SHA256 signature
     * Format: Base64(HMAC-SHA256(secretKey, ts))
     * Reference: https://developer.huawei.com/consumer/cn/doc/service/pushmessage-0000002505761436
     * @param timestamp - Timestamp as string (e.g., "1514764800000")
     */
    private generateSignature;
    /**
     * Verify if credentials are valid
     */
    verifyCredentials(credentials: AuthCredentials): boolean;
    /**
     * Generate authentication headers for WebSocket connection
     */
    generateAuthHeaders(): Record<string, string>;
    /**
     * Generate authentication message for WebSocket (legacy, kept for compatibility)
     */
    generateAuthMessage(): any;
}
