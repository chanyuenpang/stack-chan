/**
 * Simple file and image handler for XiaoYi Channel
 * Handles downloading and extracting content from URIs
 */
export interface InputImageContent {
    type: "image";
    data: string;
    mimeType: string;
}
export interface ImageLimits {
    allowUrl: boolean;
    allowedMimes: Set<string>;
    maxBytes: number;
    maxRedirects: number;
    timeoutMs: number;
}
/**
 * Extract image content from URL
 */
export declare function extractImageFromUrl(url: string, limits?: Partial<ImageLimits>): Promise<InputImageContent>;
/**
 * Extract text content from URL (for text-based files)
 */
export declare function extractTextFromUrl(url: string, maxBytes?: number, timeoutMs?: number): Promise<string>;
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
