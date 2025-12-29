import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "tickets"); // adjust for your env
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${ts}_${safe}`);
  },
});

const ALLOWED = new Set([
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

export const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB per file (videos)
    files: 20,                   // up to 20 files
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype) || file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});
