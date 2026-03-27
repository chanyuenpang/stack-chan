"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.XiaoYiAuth = void 0;
const crypto = __importStar(require("crypto"));
/**
 * Generate authentication signature using AK/SK mechanism
 * Based on: https://developer.huawei.com/consumer/cn/doc/service/pushmessage-0000002505761436
 *
 * Signature format: Base64(HMAC-SHA256(secretKey, ts))
 */
class XiaoYiAuth {
    constructor(ak, sk, agentId) {
        this.ak = ak;
        this.sk = sk;
        this.agentId = agentId;
    }
    /**
     * Generate authentication credentials with signature
     */
    generateAuthCredentials() {
        const timestamp = Date.now();
        const signature = this.generateSignature(timestamp.toString());
        return {
            ak: this.ak,
            sk: this.sk,
            timestamp,
            signature,
        };
    }
    /**
     * Generate HMAC-SHA256 signature
     * Format: Base64(HMAC-SHA256(secretKey, ts))
     * Reference: https://developer.huawei.com/consumer/cn/doc/service/pushmessage-0000002505761436
     * @param timestamp - Timestamp as string (e.g., "1514764800000")
     */
    generateSignature(timestamp) {
        // HMAC-SHA256(secretKey, ts)
        const hmac = crypto.createHmac("sha256", this.sk);
        hmac.update(timestamp);
        const digest = hmac.digest();
        // Base64 encode
        return digest.toString("base64");
    }
    /**
     * Verify if credentials are valid
     */
    verifyCredentials(credentials) {
        const expectedSignature = this.generateSignature(credentials.timestamp.toString());
        return credentials.signature === expectedSignature;
    }
    /**
     * Generate authentication headers for WebSocket connection
     */
    generateAuthHeaders() {
        const timestamp = Date.now();
        const signature = this.generateSignature(timestamp.toString());
        return {
            "x-access-key": this.ak,
            "x-sign": signature,
            "x-ts": timestamp.toString(),
            "x-agent-id": this.agentId,
        };
    }
    /**
     * Generate authentication message for WebSocket (legacy, kept for compatibility)
     */
    generateAuthMessage() {
        const credentials = this.generateAuthCredentials();
        return {
            type: "auth",
            ak: credentials.ak,
            agentId: this.agentId,
            timestamp: credentials.timestamp,
            signature: credentials.signature,
        };
    }
}
exports.XiaoYiAuth = XiaoYiAuth;
