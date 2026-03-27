"use strict";
/**
 * XiaoYi Media Handler - Downloads and saves media files locally
 * Similar to clawdbot-feishu's media.ts approach
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isImageMimeType = isImageMimeType;
exports.isPdfMimeType = isPdfMimeType;
exports.isTextMimeType = isTextMimeType;
exports.downloadAndSaveMedia = downloadAndSaveMedia;
exports.downloadAndSaveMediaList = downloadAndSaveMediaList;
exports.buildXiaoYiMediaPayload = buildXiaoYiMediaPayload;
exports.extractTextFromFile = extractTextFromFile;
exports.extractImageFromUrl = extractImageFromUrl;
exports.extractTextFromUrl = extractTextFromUrl;
/**
 * Download content from URL with validation
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
 * Infer placeholder text based on MIME type
 */
function inferPlaceholder(mimeType) {
    if (mimeType.startsWith("image/")) {
        return "<media:image>";
    }
    else if (mimeType.startsWith("video/")) {
        return "<media:video>";
    }
    else if (mimeType.startsWith("audio/")) {
        return "<media:audio>";
    }
    else if (mimeType === "application/pdf") {
        return "<media:document>";
    }
    else if (mimeType.startsWith("text/")) {
        return "<media:text>";
    }
    else {
        return "<media:document>";
    }
}
/**
 * Check if a MIME type is an image
 */
function isImageMimeType(mimeType) {
    if (!mimeType)
        return false;
    const lower = mimeType.toLowerCase();
    // Standard formats: image/jpeg, image/png, etc.
    if (lower.startsWith("image/")) {
        return true;
    }
    // Handle non-standard formats like "jpeg" instead of "image/jpeg"
    // Extract subtype if format is "type/subtype", otherwise use whole string
    const subtype = lower.includes("/") ? lower.split("/")[1] : lower;
    const imageSubtypes = [
        "jpeg", "jpg", "png", "gif", "webp", "bmp", "svg+xml", "svg"
    ];
    return imageSubtypes.includes(subtype);
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
/**
 * Download and save media file to local disk
 * This is the key function that follows clawdbot-feishu's approach
 */
async function downloadAndSaveMedia(runtime, uri, mimeType, fileName, options) {
    const maxBytes = options?.maxBytes ?? 30000000; // 30MB default
    const timeoutMs = options?.timeoutMs ?? 60000; // 60 seconds default
    console.log(`[XiaoYi Media] Downloading: ${fileName} (${mimeType}) from ${uri}`);
    // Download the file
    const { buffer, mimeType: detectedMimeType } = await fetchFromUrl(uri, maxBytes, timeoutMs);
    // Use detected MIME type if provided type is generic
    const finalMimeType = mimeType === "application/octet-stream" ? detectedMimeType : mimeType;
    // Save to local disk using OpenClaw's core.media API
    // This is the critical step - saves file locally and returns path
    const saved = await runtime.channel.media.saveMediaBuffer(buffer, finalMimeType, "inbound", maxBytes, fileName);
    console.log(`[XiaoYi Media] Saved to: ${saved.path}`);
    return {
        path: saved.path,
        contentType: saved.contentType,
        placeholder: inferPlaceholder(saved.contentType),
        fileName,
    };
}
/**
 * Download and save multiple media files
 */
async function downloadAndSaveMediaList(runtime, files, options) {
    const results = [];
    for (const file of files) {
        try {
            const downloaded = await downloadAndSaveMedia(runtime, file.uri, file.mimeType, file.name, options);
            results.push(downloaded);
        }
        catch (error) {
            console.error(`[XiaoYi Media] Failed to download ${file.name}:`, error);
            // Continue with other files
        }
    }
    return results;
}
/**
 * Build media payload for inbound context
 * Similar to clawdbot-feishu's buildFeishuMediaPayload()
 */
function buildXiaoYiMediaPayload(mediaList) {
    if (mediaList.length === 0) {
        return {};
    }
    const first = mediaList[0];
    const mediaPaths = mediaList.map((media) => media.path);
    const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean);
    return {
        MediaPath: first?.path,
        MediaType: first?.contentType,
        MediaUrl: first?.path,
        MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
        MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
        MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
    };
}
/**
 * Extract text from downloaded file for including in message body
 */
async function extractTextFromFile(path, mimeType) {
    // For now, just return null - Agent can read file directly from path
    // This could be enhanced to extract text from specific file types
    return null;
}
/**
 * Extract image from URL and return base64 encoded data
 */
async function extractImageFromUrl(url, limits) {
    const maxBytes = limits?.maxBytes ?? 10000000; // 10MB default
    const timeoutMs = limits?.timeoutMs ?? 30000; // 30 seconds default
    const { buffer, mimeType } = await fetchFromUrl(url, maxBytes, timeoutMs);
    // Validate it's an image MIME type
    if (!isImageMimeType(mimeType)) {
        throw new Error(`Unsupported image type: ${mimeType}`);
    }
    return {
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
    };
}
/**
 * Extract text content from URL
 * Supports text-based files (txt, md, json, xml, csv, etc.)
 */
async function extractTextFromUrl(url, maxBytes = 5000000, timeoutMs = 30000) {
    const { buffer, mimeType } = await fetchFromUrl(url, maxBytes, timeoutMs);
    // Check if it's a text-based MIME type
    const textMimes = [
        "text/plain",
        "text/markdown",
        "text/html",
        "text/csv",
        "application/json",
        "application/xml",
        "text/xml",
    ];
    const isTextFile = textMimes.some(tm => mimeType.startsWith(tm) || mimeType === tm);
    if (!isTextFile) {
        throw new Error(`Unsupported text type: ${mimeType}`);
    }
    return buffer.toString("utf-8");
}
