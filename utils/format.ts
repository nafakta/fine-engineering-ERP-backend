// utils/fileUtils.ts
import fs from "fs";
import path from "path";

/** Ensure a directory exists (recursive). */
export function ensureDirSync(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Save a data URL (image/png) to disk and return the absolute file path. */
export function saveDataUrlPNG(dataUrl: string, folder: string, baseName: string): string {
    if (!dataUrl?.startsWith("data:image/png")) {
        throw new Error("Expected a PNG data URL");
    }
    ensureDirSync(folder);
    const [, b64] = dataUrl.split(",");
    const buf = Buffer.from(b64, "base64");
    const abs = path.join(folder, `${baseName}.png`);
    fs.writeFileSync(abs, buf);
    return abs;
}

/** Format date as 27 Sep 2025 (or "-" if falsy). */
export function fmtDate(d?: string | Date | null): string {
    if (!d) return "-";
    const dt = typeof d === "string" ? new Date(d) : d;
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(dt);
}

/** Format number as INR currency, e.g., ₹1,23,456.78 */
export function fmtINR(n?: number | null): string {
    if (n == null || Number.isNaN(n)) return "₹0.00";
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}

/** Build absolute URL for a public path like /uploads/... */
export function absolutizePath(p?: string | null): string | null {
    if (!p) return null;
    if (p.startsWith("http://") || p.startsWith("https://")) return p;
    const BASE_URL =
        process.env.BASE_URL ||
        `http://localhost:${process.env.COMPRESS_CRM_PORT || 3000}`;
    return `${BASE_URL}${p.startsWith("/") ? p : `/${p}`}`;
}
