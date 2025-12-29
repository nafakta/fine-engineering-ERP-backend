import { Request, Response } from "express";
import db from "../models";
import { ValidationError, AnyObject } from "yup";
import { Op } from "sequelize";
import { CreatePOSchema, UpdatePOSchema } from "./Validations";
import puppeteer, { Page } from "puppeteer";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import { Transaction } from "sequelize";
import fsSync from "fs";
import multer from "multer";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}
const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || "");
const pickActorId = (req: AuthenticatedRequest) => {
    const hdr = (req.headers["x-user-id"] as string | undefined)?.trim() || "";
    const body = (req.body?.created_by as string | undefined)?.trim() || "";
    const user = (req.user?.userId || "").trim();

    const candidate = user || hdr || body;
    return isUuid(candidate) ? candidate : null;
};

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
});

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME!;
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com`;

Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("formatQty", (v: any) => {
    const n = Number(v || 0);
    const s = n.toFixed(3);
    return s.replace(/\.?0+$/, "");
});
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("json", (v: any) => JSON.stringify(v, null, 2));

Handlebars.registerHelper("nl2br", (text: any) => {
    if (text === null || text === undefined) return "";
    const s = String(text);
    const escaped = Handlebars.escapeExpression(s);
    const html = escaped.replace(/\r\n|\n\r|\r|\n/g, "<br/>");
    // @ts-ignore - Handlebars runtime has SafeString
    return new Handlebars.SafeString(html);
});

/* ---------------- Template resolution ---------------- */

// ================= SIGNED PO UPLOAD CONFIG =================

const PO_SIGNED_UPLOAD_DIR = path.join(
    process.cwd(),
    "uploads",
    "purchase_orders"
);
fsSync.mkdirSync(PO_SIGNED_UPLOAD_DIR, { recursive: true });

export const signedPoUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowed = [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error("Invalid file type"));
    },
});

function toRelativeUploadsPath(absPath: string): string {
    if (!absPath) return "";
    const norm = absPath.replace(/\\/g, "/");
    const marker = "/uploads/";
    const idx = norm.indexOf(marker);
    if (idx !== -1) {
        return norm.substring(idx);
    }
    return norm;
}

function inWordsIndian(num: number): string {
    const wholeNumber = Math.round(Number(num || 0));
    const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const thousands = ["", "Thousand", "Lakh", "Crore"];
    if (wholeNumber === 0) return "Zero Rupees Only";
    let words = '', n = wholeNumber, place = 0;
    do {
        let chunk = n % 1000;
        if (chunk) {
            let chunkWords = '';
            if (chunk >= 100) { chunkWords += units[Math.floor(chunk / 100)] + ' Hundred '; chunk %= 100; }
            if (chunk >= 20) { chunkWords += tens[Math.floor(chunk / 10)] + ' '; chunk %= 10; }
            if (chunk > 0) { chunkWords += units[chunk] + ' '; }
            words = chunkWords + (thousands[place] ? thousands[place] + ' ' : '') + words;
        }
        n = Math.floor(n / 1000); place++;
    } while (n > 0);
    return (words.trim() + ' Rupees Only').replace(/\s+/g, ' ');
}

async function resolveTemplate(rel: string) {
    const tryPaths = [
        path.resolve(__dirname, "../templates", rel),
        path.resolve(__dirname, "../../templates", rel),
    ];
    for (const p of tryPaths) {
        try { await fs.access(p); return p; } catch { /* keep trying */ }
    }
    throw new Error(`Template not found: ${rel}`);
}

async function uploadSignedPoToS3(
    poId: string,
    file: Express.Multer.File
): Promise<string> {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
    const key = `purchase_orders/${poId}/signed_${Date.now()}_${safeName}`;

    await new Upload({
        client: s3Client,
        params: {
            Bucket: S3_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: "private",
        },
    }).done();

    return key;
}

/* ---------------- Logo loader (base64) ---------------- */
const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.access(fromEnv);
            return path.resolve(fromEnv);
        } catch { }
    }

    const primary = path.resolve(
        process.cwd(),
        "public",
        "uploads",
        "images",
        "compress-india-logo-traced.png"
    );

    try {
        await fs.access(primary);
        return primary;
    } catch { }

    const fallbacks = [
        path.resolve(__dirname, "../images/compress-india-logo-traced.png"),
        path.resolve(__dirname, "../../images/compress-india-logo-traced.png"),
    ];

    for (const p of fallbacks) {
        try {
            await fs.access(p);
            return p;
        } catch { }
    }

    return "";
};

const getLogoAsDataURL = async (): Promise<string> => {
    try {
        const logoPath = await resolveLogoPath();
        if (!logoPath) return FALLBACK_PIXEL;

        const buf = await fs.readFile(logoPath);
        const ext = path.extname(logoPath).slice(1).toLowerCase() || "png";
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return FALLBACK_PIXEL;
    }
};

/* ---------------- VM builders ---------------- */
function mapPOItems(items: any[] = []) {
    return items.map(it => {
        const qty = Number(it.quantity || 0);
        const rate = Number(it.rate || 0);
        return {
            description: it.description || "-",
            item: it.item || "-",
            hsn_sac: it.hsn_sac || "-",
            unit: it.unit || "NOS",
            make: it.make || "",
            qty,
            rate,
            total: qty * rate,
        };
    });
}

function normalizeUrl(u = "") {
    const s = String(u || "").trim();
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function buildCompanyDetails() {
    const company_short = (process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.").trim();
    const company_legal = (process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED").trim();
    const gstin = (process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0").trim();

    const addr_line = (process.env.COMPANY_ADDR ||
        "Off no.103, 1st floor, Hi Tech Premises Co-Op.Soc.Ltd, Near SCLR Road, Kurla (W)").trim();

    const city_state = (process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra, India").trim();
    const phone = (process.env.COMPANY_PHONE || "+91 8655011465").trim();
    const email = (process.env.COMPANY_EMAIL || "sales@compressindia.in").trim();
    const website = normalizeUrl(process.env.COMPANY_WEBSITE || "www.compressindia.com");

    const our_company = {
        name: company_short,
        legal_name: company_legal,
        tax_id: gstin,
        address_line: addr_line,
        city_state,
        mobile_number: phone,
        email_id: email,
        website,
        company_name: company_legal,
        company: company_short,
        phone,
        email,
        gstin,
        address_full: `${addr_line}${city_state ? ", " + city_state : ""}`,
    };

    for (const k of Object.keys(our_company) as (keyof typeof our_company)[]) {
        our_company[k] = (our_company[k] || "").toString().trim();
    }

    return our_company;
}

async function buildPoVM(poId: string) {
    const po = await db.PurchaseOrder.findByPk(poId, {
        include: [
            { model: db.OrderItem, as: "items" },
            { model: db.Vendor, as: "vendorRef" },
            { model: db.SystemUser, as: "creator", attributes: ["id", "name"] },
        ],
    });
    if (!po) throw new Error("Purchase Order not found");

    const j: any = po.toJSON();
    const items = (j.items || []).map((it: any) => {
        const qty = Number(it.quantity || 0);
        const rate = Number(it.rate || 0);
        const total = qty * rate;

        const itemGstPercent = it.gst_pct !== undefined && it.gst_pct !== null
            ? Number(it.gst_pct)
            : 0;

        return {
            item: it.item || "-",
            description: it.description || "-",
            hsn_sac: it.hsn_sac || "-",
            unit: it.unit || "NOS",
            make: it.make || "",
            qty, rate, total,
            gst_percent: itemGstPercent,
            gst_amount: (total * itemGstPercent) / 100,
        };
    });

    const sub_total = items.reduce((s: number, it: any) => s + it.total, 0);
    const hasGST = items.some((item: any) => item.gst_percent > 0);
    const gst_amount = hasGST ? items.reduce((sum: number, it: any) => sum + it.gst_amount, 0) : 0;

    let gstPercent = 0;
    if (hasGST) {
        const itemWithGST = items.find((item: any) => item.gst_percent > 0);
        gstPercent = itemWithGST ? itemWithGST.gst_percent : 0;
    }

    const discount_value = 0;
    const total_amount = sub_total - discount_value;
    const grand_total = hasGST ? total_amount + gst_amount : sub_total;

    const our_company = buildCompanyDetails();
    const vendor = j.vendorRef || {};
    const site_issue = (j.site_issue || "").toString().trim();
    const logo = await getLogoAsDataURL();
    const po_notes = (j.notes || "").toString().trim();

    const formatPurchaseType = (type: string | null) => {
        if (type === "air_conditioning") return "Air Conditioning";
        if (type === "HVAC") return "HVAC";
        return "N/A";
    };

    const sellerStateRaw = (vendor.state || "").toString().trim();
    const sellerState = sellerStateRaw.toLowerCase();
    const shippingStateRaw = (j.shipping_state || "").toString().trim();
    const shippingState = shippingStateRaw.toLowerCase();
    const same_state = sellerState && shippingState && sellerState === shippingState;
    const place_of_supply = shippingStateRaw || sellerStateRaw || "";

    let cgst_amount = 0;
    let sgst_amount = 0;
    let igst_amount = 0;
    let cgst_percent = 0;
    let sgst_percent = 0;
    let igst_percent = 0;

    if (hasGST && gst_amount > 0) {
        if (same_state) {
            cgst_amount = Math.round(gst_amount / 2);
            sgst_amount = gst_amount - cgst_amount;
            cgst_percent = gstPercent / 2;
            sgst_percent = gstPercent / 2;
        } else {
            igst_amount = gst_amount;
            igst_percent = gstPercent;
        }
    }

    return {
        doc_title: "Purchase Order",
        logo,
        po_number: j.po_number,
        po_date: j.created_at,
        status: j.status,
        created_by: j.creator?.name || "N/A",
        purchase_type: formatPurchaseType(j.purchase_type),
        site_issue,
        our_company,
        vendor,
        delivery_address: j.delivery_address || "",
        delivery_phone: j.delivery_phone || "",
        shipping_address: j.shipping_address || "",
        shipping_state: j.shipping_state || "",
        place_of_supply,
        subject: j.notes || "",
        po_notes,
        items,
        sub_total,
        discount_value,
        total_amount: hasGST ? total_amount : sub_total,
        hasGST,
        gst_percent: gstPercent,
        gst_amount,
        grand_total,
        amount_in_words: inWordsIndian(grand_total),
        same_state: hasGST && same_state,
        cgst_amount,
        sgst_amount,
        igst_amount,
        cgst_percent,
        sgst_percent,
        igst_percent,
        contact_person: "",
        contact_person_designation: "",
    };
}

/* ---------------- PDF renderer ---------------- */
async function renderPoPdfBuffer(poId: string): Promise<Buffer> {
    const vm = await buildPoVM(poId);
    const tplPath = await resolveTemplate("purchaseOrder.hbs");
    const tplHtml = await fs.readFile(tplPath, "utf8");
    const html = Handlebars.compile(tplHtml)(vm);

    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page: Page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });
    await browser.close();

    return Buffer.from(pdfBuffer);
}

function buildS3Url(key?: string | null): string | null {
    if (!key) return null;
    return `${S3_BASE_URL}/${key.replace(/^\/+/, "")}`;
}

// FIXED: Added gst_pct to POItemInput type
type POItemInput = {
    item: string;
    description: string;
    unit: string;
    hsn_sac?: string | null;
    quantity: number;
    rate: number;
    make?: string | null;
    gst_pct?: number; // ADDED THIS LINE
};

type SearchScope = "all" | "vendors" | "purchase-orders";
class HttpError extends Error {
    status: number;
    data?: any;
    constructor(status: number, message: string, data?: any) {
        super(message);
        this.status = status;
        this.data = data;
    }
}
const pickIdOrPo = (req: Request) => {
    const id =
        (req.params?.id ?? "").toString().trim() ||
        (req.query?.id as string || "").trim() ||
        (req.body?.id || "").toString().trim();

    const po_number =
        (req.params as any)?.po_number?.toString().trim() ||
        (req.query?.po_number as string || "").trim() ||
        (req.body?.po_number || "").toString().trim();

    return { id, po_number };
};

export const createorder = async (req: AuthenticatedRequest, res: Response) => {
    let validatedData: {
        vendor_id: string;
        delivery_address?: string | null;
        delivery_phone?: string | null;
        notes?: string | null;
        purchase_type?: "air_conditioning" | "HVAC" | null;
        shipping_address?: string | null;
        shipping_state?: string | null;
        site_issue?: string | null;
        status?: "draft" | "approved" | "cancelled";
        items: Array<{
            item: string;
            description: string;
            unit: string;
            hsn_sac?: string | null;
            quantity: number;
            rate: number;
            make?: string | null;
        }>;
    };

    // Store the original body for gst_pct extraction
    const originalBody = req.body as AnyObject;

    try {
        validatedData = await CreatePOSchema.validate(originalBody, {
            abortEarly: false,
            stripUnknown: true,
        });
    } catch (err) {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                message: "Validation errors",
                errors: err.errors,
                fields: err.inner.map((e) => e.path),
            });
        }
        return res.status(500).json({ message: "Validation failed" });
    }

    const actorId = pickActorId(req);
    if (!actorId) {
        return res.status(401).json({ message: "Missing or invalid actor id for created_by" });
    }

    const t = await db.sequelize.transaction();
    try {
        const vendor = await db.Vendor.findByPk(validatedData.vendor_id, { transaction: t });
        if (!vendor) {
            await t.rollback();
            return res.status(400).json({ message: "Vendor not found" });
        }

        const { items: validatedItems, ...header } = validatedData;

        // CRITICAL FIX: Extract gst_pct from the original request body
        // because validation schema might not include it
        const itemsWithGst = validatedItems.map((item, index) => {
            const originalItem = originalBody.items?.[index] as AnyObject;
            return {
                ...item,
                gst_pct: originalItem?.gst_pct !== undefined && originalItem?.gst_pct !== null
                    ? Number(originalItem.gst_pct)
                    : 0
            };
        });

        // Debug log to check if gst_pct is present
        console.log("Creating PO with items (with GST):", itemsWithGst.map(item => ({
            item: item.item,
            gst_pct: item.gst_pct,
            quantity: item.quantity,
            rate: item.rate
        })));

        const po = await db.PurchaseOrder.create(
            {
                ...header,
                status: header.status ?? "draft",
                purchase_type: header.purchase_type ?? null,
                shipping_address: header.shipping_address ?? null,
                shipping_state: header.shipping_state ?? null,
                site_issue: header.site_issue ?? null,
                created_by: actorId,
                updated_by: actorId,
            } as any,
            { transaction: t }
        );

        // FIXED: Now using itemsWithGst which includes gst_pct
        await db.OrderItem.bulkCreate(
            itemsWithGst.map((item) => ({
                po_id: po.id,
                item: item.item,
                description: item.description || "",
                make: item.make ?? null,
                unit: item.unit,
                hsn_sac: item.hsn_sac ?? null,
                quantity: item.quantity,
                rate: item.rate,
                gst_pct: item.gst_pct, // ADDED THIS LINE - now it's included
            })),
            { transaction: t }
        );

        await t.commit();

        const freshPO = await db.PurchaseOrder.findByPk(po.id, {
            include: [
                { model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor"] },
                { model: db.OrderItem, as: "items" },
            ],
        });

        return res.status(200).json({ data: freshPO });
    } catch (error: any) {
        await t.rollback();
        console.error("Error creating PO:", error?.stack || error);
        return res.status(500).json({
            message: "Failed to create purchase order",
            error: error?.message || String(error),
        });
    }
};

export const updateorder = async (req: AuthenticatedRequest, res: Response) => {
    type UpdatePOData = {
        vendor_id?: string;
        delivery_address?: string | null;
        delivery_phone?: string | null;
        notes?: string | null;
        purchase_type?: "air_conditioning" | "HVAC" | null;
        shipping_address?: string | null;
        shipping_state?: string | null;
        site_issue?: string | null;
        status?: "draft" | "approved" | "cancelled";
        items: Array<{
            item: string;
            description: string;
            unit: string;
            hsn_sac?: string | null;
            quantity: number;
            rate: number;
            make?: string | null;
        }>;
    };

    const { id } = pickIdOrPo(req);
    if (!id) return res.status(400).json({ message: "Missing purchase order id" });
    if (!isUuid(id)) return res.status(400).json({ message: "Invalid purchase order id" });

    let validatedData: UpdatePOData;

    // Store the original body for gst_pct extraction
    const originalBody = req.body as AnyObject;

    try {
        validatedData = await UpdatePOSchema.validate(originalBody, {
            abortEarly: false,
            stripUnknown: true,
        });
    } catch (err: any) {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                message: "Validation errors",
                errors: err.errors,
                fields: err.inner.map((e) => e.path),
            });
        }
        return res.status(500).json({ message: "Validation failed" });
    }

    const actorId = pickActorId(req);
    if (!actorId) {
        return res.status(401).json({ message: "Missing or invalid actor id for updated_by" });
    }

    const t = await db.sequelize.transaction();
    try {
        const po = await db.PurchaseOrder.findByPk(id, { transaction: t });
        if (!po) {
            await t.rollback();
            return res.status(404).json({ message: "Purchase order not found" });
        }

        if (validatedData.vendor_id) {
            const vendor = await db.Vendor.findByPk(validatedData.vendor_id, { transaction: t });
            if (!vendor) {
                await t.rollback();
                return res.status(400).json({ message: "Vendor not found" });
            }
        }

        const { items: validatedItems, ...header } = validatedData;

        // CRITICAL FIX: Extract gst_pct from the original request body
        // because validation schema might not include it
        const itemsWithGst = validatedItems.map((item, index) => {
            const originalItem = originalBody.items?.[index] as AnyObject;
            return {
                ...item,
                gst_pct: originalItem?.gst_pct !== undefined && originalItem?.gst_pct !== null
                    ? Number(originalItem.gst_pct)
                    : 0
            };
        });

        // Debug log to check if gst_pct is present
        console.log("Updating PO with items (with GST):", itemsWithGst.map(item => ({
            item: item.item,
            gst_pct: item.gst_pct,
            quantity: item.quantity,
            rate: item.rate
        })));

        const siteIssueValue = header.site_issue && header.site_issue.trim() !== ""
            ? header.site_issue.trim()
            : null;

        await po.update(
            {
                ...header,
                updated_at: new Date(),
                updated_by: actorId,
                shipping_address: header.shipping_address ?? (po as any).shipping_address ?? null,
                shipping_state: header.shipping_state ?? (po as any).shipping_state ?? null,
                site_issue: siteIssueValue,
            } as any,
            { transaction: t }
        );

        await db.OrderItem.destroy({ where: { po_id: po.id }, transaction: t });

        // FIXED: Now using itemsWithGst which includes gst_pct
        await db.OrderItem.bulkCreate(
            itemsWithGst.map((item) => ({
                po_id: po.id,
                item: item.item,
                description: item.description || "",
                make: item.make ?? null,
                unit: item.unit,
                hsn_sac: item.hsn_sac ?? null,
                quantity: item.quantity,
                rate: item.rate,
                gst_pct: item.gst_pct, // ADDED THIS LINE - now it's included
            })),
            { transaction: t }
        );

        await t.commit();

        const freshPO = await db.PurchaseOrder.findByPk(po.id, {
            include: [
                { model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor"] },
                { model: db.OrderItem, as: "items" },
            ],
        });

        return res.json({ data: freshPO });
    } catch (error: any) {
        await t.rollback();
        console.error("Error updating PO:", error?.stack || error);
        return res.status(500).json({
            message: "Failed to update purchase order",
            error: error?.message || String(error),
        });
    }
};

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const poDetails = await db.PurchaseOrder.findAll({
            include: [
                {
                    model: db.OrderItem,
                    as: "items",
                    attributes: ["id", "item", "description", "make", "unit", "hsn_sac", "quantity", "rate", "gst_pct"], // ADDED gst_pct
                },
                {
                    model: db.Vendor,
                    as: "vendorRef",
                    attributes: ["id", "company", "vendor"],
                },
                {
                    model: db.SystemUser,
                    as: "creator",
                    attributes: ["id", "email", "name"],
                },
            ],
            order: [["created_at", "DESC"]],
        });

        if (poDetails.length === 0) {
            return res.status(404).json({ message: "No purchase orders found" });
        }

        const baseUrl = process.env.BACKEND_BASE_URL || "http://localhost:8003";

        const data = poDetails.map((po: { toJSON: () => any }) => {
            const j: any = po.toJSON();
            const key = j.signed_po_file;

            return {
                ...j,
                site_issue: j.site_issue || null,
                signed_po_url: buildS3Url(key),
                shipping_address: j.shipping_address ?? null,
                shipping_state: j.shipping_state ?? null,
            };
        });

        return res.status(200).json({ data });
    } catch (error: any) {
        console.error("Error fetching PO details:", error?.stack || error);
        return res.status(500).json({
            message: "Failed to fetch purchase order details",
            error: error?.message || String(error),
        });
    }
};

export const deleteorder = async (req: Request, res: Response) => {
    const id =
        (req.params?.id as string) ||
        (req.params?.po_id as string) ||
        (req.body?.id ? String(req.body.id) : "");

    const isUUIDv4 = (v: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || "");

    if (!id) {
        return res.status(400).json({ success: false, msg: "Missing purchase order id", data: null });
    }
    if (!isUUIDv4(id)) {
        return res.status(400).json({ success: false, msg: "Invalid purchase order id format", data: null });
    }

    const forceDelete = String(req.query.force).toLowerCase() === "true";

    const t = await db.sequelize.transaction();
    try {
        const po = await db.PurchaseOrder.findByPk(id, { transaction: t, paranoid: false });

        if (!po) {
            await t.rollback();
            return res.status(404).json({ success: false, msg: "Purchase order not found", data: null });
        }

        if ((po as any).deletedAt && !forceDelete) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                msg: "Purchase order already deleted",
                data: { id, alreadyDeleted: true },
            });
        }

        await db.PurchaseOrder.destroy({
            where: { id },
            transaction: t,
            individualHooks: true,
            force: forceDelete,
        });

        await t.commit();
        return res.json({
            success: true,
            msg: forceDelete ? "Purchase order permanently deleted" : "Purchase order deleted",
            data: { id, force: forceDelete },
        });
    } catch (error: any) {
        await t.rollback();
        console.error(`Error deleting purchase order ${id}:`, error?.stack || error);
        return res.status(500).json({
            success: false,
            msg: "Failed to delete purchase order",
            data: { error: error?.message || String(error) },
        });
    }
};

export const searchByVendorOrCompany = async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    const scope: SearchScope = ((req.query.scope as string) || "all") as SearchScope;

    if (!q) {
        return res.status(400).json({ success: false, message: "Query ?q= is required" });
    }
    if (!["all", "vendors", "purchase-orders"].includes(scope)) {
        return res.status(400).json({ success: false, message: "Invalid scope" });
    }

    const vPage = Math.max(parseInt(String(req.query.vendors_page ?? "1"), 10) || 1, 1);
    const vLimit = Math.min(Math.max(parseInt(String(req.query.vendors_limit ?? "20"), 10) || 20, 1), 100);
    const vOffset = (vPage - 1) * vLimit;

    const poPage = Math.max(parseInt(String(req.query.po_page ?? "1"), 10) || 1, 1);
    const poLimit = Math.min(Math.max(parseInt(String(req.query.po_limit ?? "20"), 10) || 20, 1), 100);
    const poOffset = (poPage - 1) * poLimit;

    const vendorMatch = {
        [Op.or]: [
            { company: { [Op.iLike]: `%${q}%` } },
            { vendor: { [Op.iLike]: `%${q}%` } },
        ],
    };

    try {
        const wantVendors = scope === "all" || scope === "vendors";
        const wantPOs = scope === "all" || scope === "purchase-orders";

        const vendorsPromise = wantVendors
            ? db.Vendor.findAndCountAll({
                where: vendorMatch,
                attributes: ["id", "company", "vendor", "email_id", "mobile"],
                order: [["company", "ASC"]],
                limit: vLimit,
                offset: vOffset,
            })
            : Promise.resolve(null);

        const poPromise = wantPOs
            ? db.PurchaseOrder.findAndCountAll({
                include: [
                    {
                        model: db.Vendor,
                        as: "vendorRef",
                        attributes: ["id", "company", "vendor", "email_id", "mobile"],
                        required: true,
                        where: vendorMatch,
                    },
                    {
                        model: db.OrderItem,
                        as: "items",
                        attributes: ["id", "item", "description", "make", "unit", "hsn_sac", "quantity", "rate", "gst_pct"], // ADDED gst_pct
                    },
                ],
                order: [["updated_at", "DESC"]],
                limit: poLimit,
                offset: poOffset,
                distinct: true,
            })
            : Promise.resolve(null);

        const [vendorsResult, poResult] = await Promise.all([vendorsPromise, poPromise]);

        const resp: any = { success: true, scope, query: q };

        if (wantVendors && vendorsResult) {
            const total = vendorsResult.count as number;
            resp.vendors = {
                data: vendorsResult.rows,
                pagination: {
                    total,
                    totalPages: Math.ceil(total / vLimit),
                    currentPage: vPage,
                    itemsPerPage: vLimit,
                    hasNextPage: vPage * vLimit < total,
                    hasPreviousPage: vPage > 1,
                },
            };
        }

        if (wantPOs && poResult) {
            const total = poResult.count as number;
            resp.purchaseOrders = {
                data: poResult.rows,
                pagination: {
                    total,
                    totalPages: Math.ceil(total / poLimit),
                    currentPage: poPage,
                    itemsPerPage: poLimit,
                    hasNextPage: poPage * poLimit < total,
                    hasPreviousPage: poPage > 1,
                },
            };
        }

        return res.json(resp);
    } catch (error: any) {
        console.error("Search error:", error?.stack || error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const vendors = async (req: Request, res: Response) => {
    try {
        const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const page = parseInt((req.query.page as string) || "1", 10) || 1;
        const limit = parseInt((req.query.limit as string) || "20", 10) || 20;
        const offset = (page - 1) * limit;

        const where = query
            ? {
                [Op.or]: [
                    { company: { [Op.iLike]: `%${query}%` } },
                    { vendor: { [Op.iLike]: `%${query}%` } },
                    { email_id: { [Op.iLike]: `%${query}%` } },
                    { mobile: { [Op.iLike]: `%${query}%` } },
                ],
            }
            : undefined;

        const { count, rows } = await db.Vendor.findAndCountAll({
            where,
            order: [["company", "ASC"]],
            limit,
            offset,
            attributes: ["id", "company", "vendor", "email_id", "mobile"],
        });

        const totalPages = Math.ceil(count / limit);
        return res.json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                totalPages,
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            },
            searchQuery: query || null,
        });
    } catch (error: any) {
        console.error("Error fetching vendors:", error?.stack || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch vendors",
            error: process.env.NODE_ENV === "development" ? error?.message : "Internal server error",
        });
    }
};

export const printPoPdf = async (req: Request, res: Response) => {
    try {
        const poId = String(req.params.id || "").trim();
        if (!poId) return res.status(400).send("PO id required");
        const buffer = await renderPoPdfBuffer(poId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="PO-${poId}.pdf"`);
        res.send(buffer);
    } catch (err: any) {
        console.error("Error generating PO PDF:", err);
        res.status(500).send(`Failed to generate PDF: ${err.message || err}`);
    }
};

export const printPoHtml = async (req: Request, res: Response) => {
    try {
        const poId = String(req.params.id || "").trim();
        if (!poId) return res.status(400).type("text/plain").send("PO id required");
        const vm = await buildPoVM(poId);
        const tplPath = await resolveTemplate("purchaseOrder.hbs");
        const tplHtml = await fs.readFile(tplPath, "utf8");
        const html = Handlebars.compile(tplHtml)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
};

export const printPoPdfByQuery = async (req: Request, res: Response) => {
    try {
        const id = String(req.query.id || "").trim();
        if (!id) return res.status(400).send("PO id required in query ?id=");
        const buffer = await renderPoPdfBuffer(id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="PO-${id}.pdf"`);
        res.send(buffer);
    } catch (err: any) {
        console.error("Error generating PO PDF (query):", err);
        res.status(500).send(`Failed to generate PDF: ${err.message || err}`);
    }
};

export const printPoPdfFromBody = async (req: Request, res: Response) => {
    try {
        const id = String(req.body?.id || "").trim();
        if (!id) return res.status(400).json({ message: "PO id required in body { id }" });
        const buffer = await renderPoPdfBuffer(id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="PO-${id}.pdf"`);
        res.send(buffer);
    } catch (err: any) {
        console.error("Error generating PO PDF (body):", err);
        res.status(500).json({ message: "Failed to generate PDF", error: err.message || String(err) });
    }
};

export const convertToBill = async (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id || req.body?.po_id || "").trim();
    if (!id) return res.status(400).json({ message: "PO id is required" });
    if (!isUuid(id)) return res.status(400).json({ message: "Invalid PO id" });

    const actorId = pickActorId(req);
    if (!actorId) {
        return res.status(401).json({ message: "Missing or invalid actor id for created_by" });
    }

    try {
        const result = await db.sequelize.transaction(
            { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
            async (t: { LOCK: { UPDATE: any; KEY_SHARE: any; }; }) => {
                const po = await db.PurchaseOrder.findByPk(id, {
                    transaction: t,
                    lock: { level: t.LOCK.UPDATE, of: db.PurchaseOrder },
                });

                if (!po) {
                    return { status: 404 as const, body: { message: "Purchase order not found" } };
                }

                const existing = await db.OrderBill.findOne({
                    where: { po_id: id },
                    transaction: t,
                    lock: t.LOCK.KEY_SHARE,
                });
                if (existing) {
                    return {
                        status: 409 as const,
                        body: { message: "Bill already exists for this purchase order", data: existing },
                    };
                }

                const items = await db.OrderItem.findAll({
                    where: { po_id: id },
                    transaction: t,
                });

                let totalBeforeTax = 0;
                let totalTax = 0;
                for (const it of items) {
                    const qty = Number((it as any).quantity || 0);
                    const rate = Number((it as any).rate || 0);
                    const line = qty * rate;
                    totalBeforeTax += line;

                    const gstPct = Number((it as any).gst_pct ?? 0); // Now gst_pct will be available
                    totalTax += (line * gstPct) / 100;
                }
                const totalAmount = totalBeforeTax + totalTax;

                const bill = await db.OrderBill.create(
                    {
                        po_id: po.id,
                        vendor_id: (po as any).vendor_id,
                        bill_date: new Date(),
                        total_before_tax: totalBeforeTax,
                        total_tax: totalTax,
                        total_amount: totalAmount,
                        payment_status: "pending",
                        notes: (po as any).notes || null,
                        created_by: actorId,
                        updated_by: actorId,
                    },
                    { transaction: t }
                );

                await po.update(
                    { status: "billed", updated_by: actorId },
                    { transaction: t }
                );

                const freshBill = await db.OrderBill.findByPk(bill.id, { transaction: t });

                const freshPO = await db.PurchaseOrder.findByPk(id, {
                    transaction: t,
                    include: [
                        { model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor"] },
                    ],
                });

                return {
                    status: 201 as const,
                    body: { message: "Bill created", data: freshBill, po: freshPO },
                };
            }
        );

        return res.status(result.status).json(result.body);
    } catch (err: any) {
        if (
            typeof err?.message === "string" &&
            err.message.includes("FOR UPDATE cannot be applied to the nullable side of an outer join")
        ) {
            return res.status(500).json({
                message: "Failed to create bill",
                error:
                    "Locking with JOIN detected. Ensure the locked query does not include LEFT JOINs, or use lock { of: PurchaseOrder } only.",
            });
        }

        return res
            .status(500)
            .json({ message: "Failed to create bill", error: err?.message || String(err) });
    }
};

export const uploadSignedPoFile = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = pickIdOrPo(req);
        if (!id || !isUuid(id)) {
            return res.status(400).json({ success: false, message: "Invalid PO id" });
        }

        const file = (req as any).file as Express.Multer.File;
        if (!file) {
            return res.status(400).json({
                success: false,
                message: "Upload file under field name 'signed_po'",
            });
        }

        const po = await db.PurchaseOrder.findByPk(id);
        if (!po) {
            return res.status(404).json({ success: false, message: "Purchase order not found" });
        }

        const actorId = pickActorId(req);

        const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
        const s3Key = `purchase_orders/${id}/signed_${Date.now()}_${safeName}`;

        await new Upload({
            client: s3Client,
            params: {
                Bucket: process.env.AWS_S3_BUCKET_NAME!,
                Key: s3Key,
                Body: file.buffer,
                ContentType: file.mimetype,
                ACL: "private",
            },
        }).done();

        (po as any).signed_po_file = s3Key;
        (po as any).signed_po_uploaded_at = new Date();
        (po as any).signed_po_uploaded_by = actorId || null;

        await po.save();

        return res.json({
            success: true,
            message: "Signed PO uploaded successfully",
            data: {
                id: po.id,
                signed_po_key: s3Key,
                signed_po_url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
            },
        });

    } catch (error: any) {
        console.error("Signed PO upload error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload signed PO",
            error: error.message || String(error),
        });
    }
};