import { Request } from "express";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";

export function makeAbsoluteUrl(req: Request, relativePath?: string | null): string | null {
    if (!relativePath || relativePath.trim() === "") {
        return null;
    }

    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
        return relativePath;
    }

    const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

    if (process.env.BASE_URL) {
        const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
        return `${baseUrl}${cleanPath}`;
    }

    const protocol = req.protocol;
    const host = req.get('host');

    if (!host) {
        return null;
    }

    return `${protocol}://${host}${cleanPath}`;
}

export function getUploadsBaseDir(): string {
    if (process.env.UPLOAD_DIR) {
        return process.env.UPLOAD_DIR;
    }
    return path.join(process.cwd(), 'public', 'uploads');
}

export function toRelativeUploadPath(absolutePath: string): string {
    if (!path.isAbsolute(absolutePath)) {
        return absolutePath.startsWith('/') ? absolutePath : `/${absolutePath}`;
    }

    const uploadsDir = getUploadsBaseDir();
    let relativePath = path.relative(uploadsDir, absolutePath);

    if (relativePath.startsWith('..')) {
        return `/uploads/${path.basename(absolutePath)}`;
    }

    if (!relativePath.startsWith('uploads/')) {
        relativePath = `uploads/${relativePath}`;
    }

    return `/${relativePath.replace(/\\/g, '/')}`;
}

/**
 * Ensure the standard uploads directory structure exists.
 * Creates:
 *   <uploadsBase>/tickets
 *   <uploadsBase>/hvac_tickets
 *   <uploadsBase>/tickets/followups
 *   <uploadsBase>/hvac_tickets/followups
 *
 * Accepts an optional baseDir override (useful in tests or non-standard setups).
 */
export async function ensureUploadsStructure(baseDir?: string): Promise<void> {
    const uploadsDir = baseDir || getUploadsBaseDir();

    const dirs = [
        uploadsDir,
        path.join(uploadsDir, 'tickets'),
        path.join(uploadsDir, 'hvac_tickets'),
        path.join(uploadsDir, 'tickets', 'followups'),
        path.join(uploadsDir, 'hvac_tickets', 'followups'),
        path.join(uploadsDir, 'reports'),
    ];

    // Use fs/promises.mkdir with recursive true so this is idempotent
    for (const d of dirs) {
        try {
            await fsPromises.mkdir(d, { recursive: true });
        } catch (err) {
            // If something else goes wrong, rethrow so caller sees it
            throw err;
        }
    }

    // ensure proper permissions (best-effort; ignore errors)
    try {
        await Promise.all(dirs.map(d => fsPromises.chmod(d, 0o755).catch(() => { })));
    } catch {
        /* ignore */
    }
}

/**
 * Utility to return a readable error message from various error shapes.
 * Safe to call from controllers and utils.
 */
export function getErrorMessage(err: unknown): string {
    if (!err) return "Unknown error";

    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message || String(err);
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
