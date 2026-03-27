/**
 * XiaoYi Media Handler - Downloads and saves media files locally
 * Similar to clawdbot-feishu's media.ts approach
 */
type PluginRuntime = any;
export interface DownloadedMedia {
    path: string;
    contentType: string;
    placeholder: string;
    fileName?: string;
}
export interface MediaDownloadOptions {
    maxBytes?: number;
    timeoutMs?: number;
}
/**
 * Check if a MIME type is an image
 */
export declare function isImageMimeType(mimeType: string | undefined): boolean;
/**
 * Check if a MIME type is a PDF
 */
export declare function isPdfMimeType(mimeType: string | undefined): boolean;
/**
 * Check if a MIME type is text-based
 */
export declare function isTextMimeType(mimeType: string | undefined): boolean;
/**
 * Download and save media file to local disk
 * This is the key function that follows clawdbot-feishu's approach
 */
export declare function downloadAndSaveMedia(runtime: PluginRuntime, uri: string, mimeType: string, fileName: string, options?: MediaDownloadOptions): Promise<DownloadedMedia>;
/**
 * Download and save multiple media files
 */
export declare function downloadAndSaveMediaList(runtime: PluginRuntime, files: Array<{
    uri: string;
    mimeType: string;
    name: string;
}>, options?: MediaDownloadOptions): Promise<DownloadedMedia[]>;
/**
 * Build media payload for inbound context
 * Similar to clawdbot-feishu's buildFeishuMediaPayload()
 */
export declare function buildXiaoYiMediaPayload(mediaList: DownloadedMedia[]): {
    MediaPath?: string;
    MediaType?: string;
    MediaUrl?: string;
    MediaPaths?: string[];
    MediaUrls?: string[];
    MediaTypes?: string[];
};
/**
 * Extract text from downloaded file for including in message body
 */
export declare function extractTextFromFile(path: string, mimeType: string): Promise<string | null>;
/**
 * Input image content type for AI processing
 */
export interface InputImageContent {
    type: "image";
    data: string;
    mimeType: string;
}
/**
 * Image download limits
 */
export interface ImageLimits {
    maxBytes?: number;
    timeoutMs?: number;
}
/**
 * Extract image from URL and return base64 encoded data
 */
export declare function extractImageFromUrl(url: string, limits?: Partial<ImageLimits>): Promise<InputImageContent>;
/**
 * Extract text content from URL
 * Supports text-based files (txt, md, json, xml, csv, etc.)
 */
export declare function extractTextFromUrl(url: string, maxBytes?: number, timeoutMs?: number): Promise<string>;
export {};
