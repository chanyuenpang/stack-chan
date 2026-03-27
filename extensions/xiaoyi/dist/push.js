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
exports.XiaoYiPushService = void 0;
const crypto = __importStar(require("crypto"));
/**
 * Push message sending service
 * Sends notifications to XiaoYi clients via webhook API
 */
class XiaoYiPushService {
    constructor(config) {
        this.pushUrl = "https://hag.cloud.huawei.com/open-ability-agent/v1/agent-webhook";
        this.config = config;
    }
    /**
     * Check if push functionality is configured
     */
    isConfigured() {
        return Boolean(this.config.apiId?.trim() &&
            this.config.pushId?.trim() &&
            this.config.ak?.trim() &&
            this.config.sk?.trim());
    }
    /**
     * Generate HMAC-SHA256 signature
     */
    generateSignature(timestamp) {
        const hmac = crypto.createHmac("sha256", this.config.sk);
        hmac.update(timestamp);
        return hmac.digest().toString("base64");
    }
    /**
     * Generate UUID
     */
    generateUUID() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
    /**
     * Send push notification (with summary text)
     * @param text - Summary text to send (e.g., first 30 characters)
     * @param pushText - Push notification message (e.g., "任务已完成：xxx...")
     */
    async sendPush(text, pushText) {
        if (!this.isConfigured()) {
            console.log("[PUSH] Push not configured, skipping");
            return false;
        }
        try {
            const timestamp = Date.now().toString();
            const signature = this.generateSignature(timestamp);
            const messageId = this.generateUUID();
            const payload = {
                jsonrpc: "2.0",
                id: messageId,
                result: {
                    id: this.generateUUID(),
                    apiId: this.config.apiId,
                    pushId: this.config.pushId,
                    pushText: pushText,
                    kind: "task",
                    artifacts: [{
                            artifactId: this.generateUUID(),
                            parts: [{
                                    kind: "text",
                                    text: text, // Summary text
                                }]
                        }],
                    status: { state: "completed" }
                }
            };
            console.log(`[PUSH] Sending push notification: ${pushText}`);
            const response = await fetch(this.pushUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-hag-trace-id": this.generateUUID(),
                    "X-Access-Key": this.config.ak,
                    "X-Sign": signature,
                    "X-Ts": timestamp,
                },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                console.log("[PUSH] Push notification sent successfully");
                return true;
            }
            else {
                console.error(`[PUSH] Failed: HTTP ${response.status}`);
                return false;
            }
        }
        catch (error) {
            console.error("[PUSH] Error:", error);
            return false;
        }
    }
}
exports.XiaoYiPushService = XiaoYiPushService;
