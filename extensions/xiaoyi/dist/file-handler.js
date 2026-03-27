"use strict";
/**
 * Simple file and image handler for XiaoYi Channel
 * Handles downloading and extracting content from URIs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractImageFromUrl = extractImageFromUrl;
exports.extractTextFromUrl = extractTextFromUrl;
exports.isImageMimeType = isImageMimeType;
exports.isPdfMimeType = isPdfMimeType;
exports.isTextMimeType = isTextMimeType;
// Default limits
const DEFAULT_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const DEFAULT_MAX_BYTES = 10000000; // 10MB
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_REDIRECTS = 3;
/**
 * Fetch content from URL with basic validation
 */
async function fetchFromUrl(url, maxBytes, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": "XiaoYi-Channel/1.0" },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        // Check content-length header if available
        const contentLength = response.headers.get("content-length");
        if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (size > maxBytes) {
                throw new Error(`File too large: ${size} bytes (limit: ${maxBytes})`);
            }
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
            throw new Error(`File too large: ${buffer.byteLength} bytes (limit: ${maxBytes})`);
        }
        // Detect MIME type
        const contentType = response.headers.get("content-type");
        const mimeType = contentType?.split(";")[0]?.trim() || "application/octet-stream";
        return { buffer, mimeType };
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Extract image content from URL
 */
async function extractImageFromUrl(url, limits) {
    const finalLimits = {
        allowUrl: limits?.allowUrl ?? true,
        allowedMimes: limits?.allowedMimes ?? DEFAULT_IMAGE_MIMES,
        maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
        maxRedirects: limits?.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
        timeoutMs: limits?.timeoutMs ?? DEFAULT_TIMEOUT,
    };
    if (!finalLimits.allowUrl) {
        throw new Error("URL sources are disabled");
    }
    const { buffer, mimeType } = await fetchFromUrl(url, finalLimits.maxBytes, finalLimits.timeoutMs);
    if (!finalLimits.allowedMimes.has(mimeType)) {
        throw new Error(`Unsupported image type: ${mimeType}`);
    }
    return {
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
    };
}
/**
 * Extract text content from URL (for text-based files)
 */
async function extractTextFromUrl(url, maxBytes = 5000000, timeoutMs = 30000) {
    const { buffer, mimeType } = await fetchFromUrl(url, maxBytes, timeoutMs);
    // Only process text-based MIME types
    const textMimes = ["text/plain", "text/markdown", "text/html", "text/csv", "application/json", "application/xml"];
    if (!textMimes.some((tm) => mimeType.startsWith(tm) || mimeType === tm)) {
        throw new Error(`Unsupported text type: ${mimeType}`);
    }
    // Try to decode as UTF-8
    return buffer.toString("utf-8");
}
/**
 * Check if a MIME type is an image
 */
function isImageMimeType(mimeType) {
    if (!mimeType)
        return false;
    return DEFAULT_IMAGE_MIMES.has(mimeType.toLowerCase());
}
/**
 * Check if a MIME type is a PDF
 */
function isPdfMimeType(mimeType) {
    return mimeType?.toLowerCase() === "application/pdf" || false;
}
/**
 * Check if a MIME type is text-based
 */
function isTextMimeType(mimeType) {
    if (!mimeType)
        return false;
    const lower = mimeType.toLowerCase();
    return (lower.startsWith("text/") ||
        lower === "application/json" ||
        lower === "application/xml");
}
