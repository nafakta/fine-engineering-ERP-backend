// src/controllers/poInvoice.controller.ts
import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Page } from "puppeteer";
import db from "../models";

// ================= Handlebars helpers (minimal, deduped) =================
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatINR", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("formatQty", (v: any) =>
    Number(v || 0).toFixed(3).replace(/\.?0+$/, "")
);

Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});

Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";

    if (v instanceof Date) {
        return isNaN(v.getTime()) ? "" : v.toLocaleDateString("en-IN");
    }
    if (typeof v === "number") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
    }

    let s = String(v).trim();
    if (!s) return "";

    // Normalize Postgres-like "YYYY-MM-DD HH:mm:ss+05:30" → "YYYY-MM-DDTHH:mm:ss+05:30"
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");

    // Handle dd/mm/yyyy
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
        const [, dd, mm, yyyy] = m;
        const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});

Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";

    // Date object
    if (v instanceof Date) {
        return isNaN(v.getTime()) ? "" : v.toLocaleDateString("en-IN");
    }

    // Epoch
    if (typeof v === "number") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
    }

    let s = String(v).trim();
    if (!s) return "";

    // Postgres "YYYY-MM-DD HH:mm:ss.sss+05:30" → "YYYY-MM-DDTHH:mm:ss.sss+05:30"
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
        s = s.replace(" ", "T");
    }

    // dd/mm/yyyy
    const mDMY = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mDMY) {
        const [_, dd, mm, yyyy] = mDMY;
        const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});

// ================= utils =================
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sanitizeUuid = (raw: unknown) => {
    let s = String(raw ?? "");
    s = s.replace(/^:+/, "").replace(/^"+|"+$/g, "").trim();
    s = s.replace(/[\u0000-\u001F\u007F]/g, "");
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
    return s.replace(/\/+$/, "");
};
function extractUuidFromUrl(url?: string): string | null {
    if (!url) return null;
    const m = url.match(UUID_RX);
    return m ? m[0] : null;
}
function pickPoId(req: Request): string | null {
    const p = req.params as any;
    const q = req.query as any;
    const b = req.body as any;
    const candidates = [
        p?.id, p?.po_id,
        q?.id, q?.po_id,
        b?.id, b?.po_id,
        (req.headers["x-po-id"] as string) ||
        (req.headers["po-id"] as string) ||
        (req.headers["x-poid"] as string),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
        const v = sanitizeUuid(c);
        if (v && v !== ":id" && v !== ":po_id" && UUID_RX.test(v)) return v;
    }
    const fromUrl = extractUuidFromUrl(req.originalUrl || req.url);
    if (fromUrl && UUID_RX.test(fromUrl)) return fromUrl;
    return null;
}

const fileToDataUri = async (absPath: string): Promise<string | null> => {
    try {
        const buf = await fs.readFile(absPath);
        const ext = (path.extname(absPath).slice(1) || "png").toLowerCase();
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
};

async function resolveExistingPath(...segments: string[]) {
    const p = path.resolve(...segments);
    try { await fs.access(p); return p; } catch { return null; }
}
async function resolveTemplateFile(rel: string): Promise<string> {
    let p = await resolveExistingPath(__dirname, "../templates", rel);
    if (p) return p;
    p = await resolveExistingPath(__dirname, "../../templates", rel);
    if (p) return p;
    throw new Error(`Template not found: ${rel}`);
}

// Reuse your invoice templating approach: put a dedicated PO template next to invoice one.
const TEMPLATE_PATH_PROMISE = resolveTemplateFile("po_invoice.hbs");
const LOGO_PATH_PROMISE = (async () => {
    const tryPaths = [
        [__dirname, "../images/compress-india-logo-traced.png"],
        [__dirname, "../../images/compress-india-logo-traced.png"],
        [__dirname, "../public/uploads/images/compress-india-logo-traced.png"],
        [__dirname, "../../public/uploads/images/compress-india-logo-traced.png"],
    ];
    for (const parts of tryPaths) {
        const p = path.resolve(...parts);
        try { await fs.access(p); return p; } catch { }
    }
    return ""; // 1x1 fallback
})();

type PoItemVM = {
    item_desc: string;
    unit: string;
    hsn_sac: string;
    quantity: number;
    rate: number;
    gst_pct: number;
    base: number;
    line_total: number;
};

// ================= Build VM =================
async function buildPoVM(id: string) {
    const po = await db.PurchaseOrder.findByPk(id, {
        include: [
            { model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor", "email_id", "mobile", "address"] },
            { model: db.OrderItem, as: "items", attributes: ["id", "item_desc", "unit", "hsn_sac", "quantity", "rate"] },
            { model: db.Client, as: "client", attributes: ["id", "name"] }  // Add Client model reference here
        ],
    });
    if (!po) throw new Error("Purchase order not found");

    const j: any = po.toJSON();

    // Client ID and name
    const clientId = j.client?.id || null;
    const clientName = j.client?.name || "";

    // Build items and totals
    const items = (j.items || []).map((r: any) => {
        const qty = Number(r.quantity ?? 0);
        const rate = Number(r.rate ?? 0);
        const gst_pct = 0;               // no GST column in DB yet
        const base = qty * rate;
        const gstAmt = base * (gst_pct / 100);
        return {
            item_desc: String(r.item_desc || "-"),
            unit: String(r.unit || "NOS"),
            hsn_sac: String(r.hsn_sac || "-"),
            quantity: qty,
            rate,
            gst_pct,
            base,
            line_total: base + gstAmt,
        };
    }) as PoItemVM[];

    const sub_total = items.reduce((s, it) => s + (it.base || 0), 0);
    const total_gst = items.reduce((s, it) => s + (it.base * (it.gst_pct / 100)), 0);
    const grand_total = sub_total + total_gst;

    // Build raw/ISO po_date (format in template with {{formatDate po_date}})
    const createdRaw = j.created_at ?? j.createdAt ?? j.created_on ?? null;
    let po_date: string | null = null;
    if (createdRaw) {
        const tryDate = new Date(createdRaw);
        po_date = !isNaN(tryDate.getTime()) ? tryDate.toISOString() : String(createdRaw);
    }

    const our_company = {
        name: process.env.ORG_NAME ?? "COMPRESS INDIA PRIVATE LIMITED",
        legal_name: process.env.ORG_LEGAL ?? "COMPRESS INDIA PRIVATE LIMITED",
        tax_id: process.env.ORG_GSTIN ?? "27AAKCC6103D1Z0",
        address_line: process.env.ORG_ADDRESS ?? "Off no.103, 1st floor, Hi Tech Premises Co-Op.Soc.Ltd, Near SCLR Road, Kurla(W)",
        city_state: process.env.ORG_CITY_STATE ?? "Mumbai (Maharashtra)",
        contact: process.env.ORG_CONTACT ?? "+91-7208219016",
        email: process.env.ORG_EMAIL ?? "info@compressindia.com",
    };

    const logoPath = await LOGO_PATH_PROMISE;
    const logo = (logoPath ? await fileToDataUri(logoPath) : null)
        || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    return {
        doc_title: "Purchase Order",
        po_number: j.po_number,
        po_date,                 // <- date provided; template: {{formatDate po_date}}
        status: j.status,
        clientId,                // Add clientId to return
        clientName,              // Add clientName to return

        logo,
        our_company,

        vendor: {
            company: j.vendorRef?.company ?? "",
            vendor: j.vendorRef?.vendor ?? "",
            address: j.vendorRef?.address ?? "",
            phone: j.vendorRef?.mobile ?? "",
            email: j.vendorRef?.email_id ?? "",
        },
        shipping: {
            company: our_company.name,
            address: j.delivery_address ?? our_company.address_line,
            city_state: our_company.city_state,
            contact: our_company.contact,
            email: our_company.email,
        },

        items,
        sub_total,
        total_gst,
        grand_total,
        amount_in_words: `INR ${inWordsIndian(Math.round(grand_total))} Only`,
        notes: j.notes ?? "",
    };
}


// ============== number-to-words (Indian) ==============
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
const three = (n: number) => { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + " Hundred" : "") + (h && r ? " and " : "") + (r ? two(r) : ""); };
function inWordsIndian(num: number) {
    if (!isFinite(num)) return "";
    if (num === 0) return "Zero";
    const parts = num.toFixed(2).split(".");
    const n = Number(parts[0]); const ps = Number(parts[1]);
    const cr = Math.floor(n / 1e7);
    const lk = Math.floor((n % 1e7) / 1e5);
    const th = Math.floor((n % 1e5) / 1e3);
    const hd = n % 1e3;
    let s = "";
    if (cr) s += three(cr) + " Crore ";
    if (lk) s += three(lk) + " Lakh ";
    if (th) s += three(th) + " Thousand ";
    if (hd) s += three(hd);
    s = s.trim();
    if (ps) s += ` and ${two(ps)} Paise`;
    return s;
}

// ================= HTML (Handlebars) =================
// Create a Handlebars template file at /src/templates/po_invoice.hbs
// You can reuse the HTML table you already built earlier; here is a compatible context:
// {
//   doc_title, po_number, po_date, status,
//   logo, our_company{...}, vendor{...}, shipping{...},
//   items[], sub_total, total_gst, grand_total, amount_in_words, notes
// }

// GET /purchase-orders/:id/invoice (html preview)
export const printPoHtml = async (req: Request, res: Response) => {
    try {
        const id = pickPoId(req);
        if (!id) return res.status(400).type("text/plain").send("Invalid or missing purchase order id");
        const vm = await buildPoVM(id);
        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const tpl: string = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        return res.status(500).type("text/plain").send(`Failed to render PO HTML: ${err?.message || err}`);
    }
};

// ============== PDF core ==============
async function renderPoPdfBuffer(poId: string): Promise<Buffer> {
    const vm = await buildPoVM(poId);
    const hbsPath = await TEMPLATE_PATH_PROMISE;
    const tpl = await fs.readFile(hbsPath, "utf-8");
    const html = Handlebars.compile(tpl)(vm);

    // Debug safety
    if (!html.includes(vm.items?.[0]?.item_desc || "") && (vm.items?.length ?? 0) > 0) {
        console.warn("PO PDF HTML does not include first item description. First item:", vm.items?.[0]);
        await fs.writeFile(path.resolve(process.cwd(), "po-invoice-debug.html"), html);
    }

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined;
    const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
    const page: Page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await page.emulateMediaType("screen");
    const pdfU8 = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
        preferCSSPageSize: true,
    });
    await browser.close();

    const pdfBuffer = Buffer.from(pdfU8);
    if (!pdfBuffer || pdfBuffer.length < 1000) {
        throw new Error("PO PDF generation failed (empty buffer). Likely missing Chromium or fonts in container.");
    }
    return pdfBuffer;
}

// GET /purchase-orders/:id/invoice.pdf
export const printPoPdf = async (req: Request, res: Response) => {
    let pdfBuffer: Buffer | null = null;
    try {
        const id = pickPoId(req);
        if (!id) return res.status(400).type("text/plain").send("Invalid or missing purchase order id");
        pdfBuffer = await renderPoPdfBuffer(id);

        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `PO-${id}.pdf`;

        // Friendly headers + range support
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Content-Encoding", "identity");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Accept-Ranges", "bytes");

        const total = pdfBuffer.length;
        const range = req.headers.range;
        if (range) {
            const m = range.match(/bytes=(\d*)-(\d*)/);
            if (m) {
                let start = m[1] ? parseInt(m[1], 10) : 0;
                let end = m[2] ? parseInt(m[2], 10) : total - 1;
                if (isNaN(start) || start < 0) start = 0;
                if (isNaN(end) || end >= total) end = total - 1;
                if (end < start) end = start;
                const chunk = pdfBuffer.subarray(start, end + 1);
                res.status(206);
                res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
                res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
                res.setHeader("Content-Length", String(chunk.length));
                return res.end(chunk);
            }
        }

        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Content-Length", String(total));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printPoPdf error:", err?.stack || err);
        return res.status(500).type("text/plain").send(`Failed to render PO PDF: ${err?.message || err}`);
    }
};

// Convenience variants if you like your invoice controller style:

// GET /purchase-orderspdf?id=<uuid>
export const printPoPdfByQuery = async (req: Request, res: Response) => {
    try {
        const raw = (req.query as any).id;
        const id = sanitizeUuid(raw);
        if (!id || !UUID_RX.test(id)) return res.status(400).json({ message: "Invalid purchase order id format" });
        const pdfBuffer = await renderPoPdfBuffer(id);
        const filename = `PO-${id}.pdf`;
        const download = String(req.query.dl || req.query.download) === "1";
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printPoPdfByQuery error:", err);
        return res.status(500).type("text/plain").send(`Failed to render PO PDF: ${err?.message || err}`);
    }
};

// POST /purchase-orderspdf  { "id": "<uuid>" }
export const printPoPdfFromBody = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid((req.body as any)?.id || (req.body as any)?.po_id);
        if (!id || !UUID_RX.test(id)) return res.status(400).json({ message: "Invalid purchase order id format" });
        const pdfBuffer = await renderPoPdfBuffer(id);
        const filename = `PO-${id}.pdf`;
        const download = String(req.query.dl || req.query.download) === "1";
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printPoPdfFromBody error:", err);
        return res.status(500).type("text/plain").send(`Failed to render PO PDF: ${err?.message || err}`);
    }
};
