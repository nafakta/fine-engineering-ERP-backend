// src/middleware/upload.ts
import multer from "multer";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { Request, Response, NextFunction } from "express";
import { getUploadsBaseDir, toRelativeUploadPath, ensureUploadsStructure } from "../utils/urlUtils";

/**
 * Multer upload middleware tailored for HVAC ticket uploads.
 *
 * Behavior:
 * - Stores files under <UPLOADS_BASE>/hvac_tickets/<ticketId>/
 * - Filenames: <timestamp>_<sanitized_original>
 * - Enforces per-file size + per-request file count
 * - Validates mimetypes
 *
 * Usage:
 *   route.post("/hvac/upload/:hvac_ticket_id", resolveHVACTicketId, fileUploadMiddleware, handler)
 */

// Ensure uploads structure exists at module-init (idempotent)
ensureUploadsStructure().catch((err) => {
    console.warn("ensureUploadsStructure failed:", err?.message || err);
});

const UPLOADS_BASE = getUploadsBaseDir(); // e.g. <cwd>/public/uploads
const HVAC_TICKETS_DIR = path.join(UPLOADS_BASE, "hvac_tickets");

// Allowed mimetypes (base set). We also permit image/* and video/* families.
const ALLOWED = new Set<string>([
    // images
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
    // video
    "video/mp4", "video/quicktime", "video/webm", "video/x-matroska",
    // docs
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
]);

// sanitize a filename: remove path chars and undesirable characters
function sanitizeFilename(name: string) {
    // Keep dot, dash, underscore and alphanum — replace others with _
    return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 200);
}

// Multer storage that places files under the correct ticket directory
const storage = multer.diskStorage({
    destination: async (req: Request, _file, cb) => {
        try {
            // resolvedHVACTicketId should be set by your resolver middleware
            const ticketId = (req as any).resolvedHVACTicketId as string | undefined;
            const target = ticketId
                ? path.join(HVAC_TICKETS_DIR, ticketId)
                : path.join(HVAC_TICKETS_DIR, "unspecified");

            // ensure directory exists (async)
            await fsp.mkdir(target, { recursive: true });
            cb(null, target);
        } catch (err: any) {
            cb(err, "");
        }
    },

    filename: (_req, file, cb) => {
        const ts = Date.now();
        const safe = sanitizeFilename(file.originalname || `file_${ts}`);
        cb(null, `${ts}_${safe}`);
    },
});

// File size and count limits
const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB per file
const MAX_FILES = 25;

// Common fileFilter using ALLOWED set + fallback to image/video families
function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
    const m = file.mimetype || "";
    if (ALLOWED.has(m) || m.startsWith("image/") || m.startsWith("video/")) {
        return cb(null, true);
    }
    return cb(new Error("Unsupported file type"));
}

export const uploader = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
    },
    fileFilter,
});

// Convenience middleware configured to accept the same fields you used:
// files (many), file (single), attachments (many), attachments[] (many)
export const fileUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const handler = uploader.fields([
        { name: "files", maxCount: MAX_FILES },
        { name: "file", maxCount: 1 },
        { name: "attachments", maxCount: MAX_FILES },
        { name: "attachments[]", maxCount: MAX_FILES },
    ]);

    handler(req, res, (err: any) => {
        if (err) {
            // multer errors have code like LIMIT_FILE_SIZE, etc.
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({ success: false, error: `File too large (max ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)` });
            }
            if (err.code === "LIMIT_UNEXPECTED_FILE") {
                return res.status(400).json({ success: false, error: "Too many files uploaded" });
            }
            return res.status(400).json({ success: false, error: err.message || "Upload failed" });
        }
        next();
    });
};

/**
 * Helper: convert multer saved file path -> standardized relative path for DB
 * Example: "/.../project/public/uploads/hvac_tickets/<ticketId>/123_file.png"
 * becomes "/uploads/hvac_tickets/<ticketId>/123_file.png"
 */
export function toRelativeForDb(absolutePath: string): string {
    return toRelativeUploadPath(absolutePath);
}

export default {
    fileUploadMiddleware,
    toRelativeForDb,
    uploader,
};
