// src/utils/fileUtils.ts
import fs from "fs";
import path from "path";
import { toRelativeUploadPath, getErrorMessage } from "./urlUtils";
/**
 * Ensures a directory exists, creating it recursively if needed
 */
export function ensureDirSync(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Get the public uploads base directory
 * This handles both development and production environments
 */
export function getUploadsBaseDir(): string {
    // For production, use the public directory
    // For development, use the standard uploads path
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
        return path.join(process.cwd(), 'public', 'uploads');
    }

    // Check common upload locations
    const possiblePaths = [
        path.join(process.cwd(), 'public', 'uploads'),
        path.join(process.cwd(), 'uploads'),
        process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
    ];

    // Use the first existing path, or create the first one
    for (const dirPath of possiblePaths) {
        if (fs.existsSync(dirPath)) {
            return dirPath;
        }
    }

    // Create and return the first path
    const firstPath = possiblePaths[0];
    ensureDirSync(firstPath);
    return firstPath;
}

/**
 * Get the public URL base for uploads
 */
export function getUploadsPublicBase(): string {
    return '/uploads'; // This is what your Express static middleware serves
}

/**
 * Convert absolute path to relative URL for public serving
 */
export function toPublicUrl(absolutePath: string): string {
    const uploadsBase = getUploadsBaseDir();

    // Ensure the path is within uploads directory
    if (!absolutePath.startsWith(uploadsBase)) {
        // If it's already a relative path starting with /uploads, return as is
        if (absolutePath.startsWith('/uploads')) {
            return absolutePath;
        }
        // If it's a relative path without leading slash, add it
        if (absolutePath.startsWith('uploads/')) {
            return `/${absolutePath}`;
        }
        // Otherwise, assume it's a filename and place in general uploads
        return `${getUploadsPublicBase()}/${path.basename(absolutePath)}`;
    }

    // Convert absolute path to relative URL
    const relativePath = path.relative(uploadsBase, absolutePath);
    return `${getUploadsPublicBase()}/${relativePath.replace(/\\/g, '/')}`;
}

/**
 * Convert relative URL to absolute file path
 */
export function toAbsolutePath(relativeUrl: string): string {
    const uploadsBase = getUploadsBaseDir();

    // Remove leading /uploads if present
    const cleanPath = relativeUrl.replace(/^\/?uploads\//, '');

    return path.join(uploadsBase, cleanPath);
}

/**
 * Writes a data URL (image/png;base64,...) to disk and returns a relative URL
 */
export function saveDataUrlPNG(dataUrl: string, destDir: string, fileBase: string): string {
    // Parse the data URL
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (!match) {
        throw new Error("Invalid image data URL. Expected image/png or image/jpeg");
    }

    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const base64 = match[2];
    const buf = Buffer.from(base64, "base64");

    // Ensure destination directory exists
    ensureDirSync(destDir);

    // Create filename with timestamp
    const timestamp = Date.now();
    const filename = `${fileBase}-${timestamp}.${ext}`;
    const absolutePath = path.join(destDir, filename);

    // Write the file
    fs.writeFileSync(absolutePath, buf);

    // Convert to public URL
    return toPublicUrl(absolutePath);
}

/**
 * Delete a file from disk
 */
export function deleteFile(relativeUrl: string): boolean {
    try {
        const absolutePath = toAbsolutePath(relativeUrl);
        if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error deleting file ${relativeUrl}:`, error);
        return false;
    }
}

/**
 * Check if a file exists
 */
export function fileExists(relativeUrl: string): boolean {
    try {
        const absolutePath = toAbsolutePath(relativeUrl);
        return fs.existsSync(absolutePath);
    } catch (error) {
        return false;
    }
}

/**
 * Get file info
 */
export function getFileInfo(relativeUrl: string) {
    try {
        const absolutePath = toAbsolutePath(relativeUrl);
        if (fs.existsSync(absolutePath)) {
            const stats = fs.statSync(absolutePath);
            return {
                exists: true,
                size: stats.size,
                modified: stats.mtime,
                absolutePath,
                relativeUrl
            };
        }
        return { exists: false };
    } catch (error) {
        // Handle unknown error type properly
        let errorMessage = 'Unknown error';

        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        } else if (error && typeof error === 'object' && 'message' in error) {
            errorMessage = String((error as any).message);
        }

        return {
            exists: false,
            error: errorMessage
        };
    }
}