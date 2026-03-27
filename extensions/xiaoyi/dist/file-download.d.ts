/**
 * Download a file from URL to local path.
 */
export declare function downloadFile(url: string, destPath: string): Promise<void>;
/**
 * Download files from A2A file parts.
 * Returns array of local file paths.
 */
export declare function downloadFilesFromParts(fileParts: Array<{
    name: string;
    mimeType: string;
    uri: string;
}>, tempDir?: string): Promise<Array<{
    path: string;
    name: string;
    mimeType: string;
}>>;
