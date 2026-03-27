"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSHA256 = calculateSHA256;
exports.calculateSHA256String = calculateSHA256String;
// Cryptographic utilities
const crypto_1 = __importDefault(require("crypto"));
/**
 * Calculate SHA256 hash of a buffer.
 */
function calculateSHA256(buffer) {
    return crypto_1.default.createHash("sha256").update(buffer).digest("hex");
}
/**
 * Calculate SHA256 hash of a string.
 */
function calculateSHA256String(text) {
    return crypto_1.default.createHash("sha256").update(text, "utf8").digest("hex");
}
