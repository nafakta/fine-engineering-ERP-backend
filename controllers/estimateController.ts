import { Request, Response } from "express";
import db from "../models";
import { ValidationError, AnyObject } from "yup";
import { Op, Transaction } from "sequelize";
import { CreateEstimateSchema, UpdateEstimateSchema } from "./Validations";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Browser, Page } from "puppeteer";

// Fallback pixel image (1x1 transparent PNG)
// ---------- Handlebars helpers ----------
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    });
});

const inferGstFromItems = (body: any): string | undefined => {
    if (!Array.isArray(body?.items)) return undefined;
    for (const it of body.items) {
        const g = it?.gst;
        if (g && String(g).trim() !== "") return g;
    }
    return undefined;
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const escapeILike = (s: string) => s.replace(/[%_]/g, m => `\\${m}`);
const uiToDbTaxScheme = (ui: string | undefined | null): string | undefined => {
    const s = String(ui ?? "").trim().toLowerCase();
    if (!s) return undefined;
    if (s.includes("no tax") || s === "0" || s === "0%") return "No Tax";
    if (s.includes("18")) return "18%";
    if (s.includes("28")) return "28%";
    return undefined; // unknown → don't set
};

function safeText(v: any, fallback = "") {
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    if (!s) return fallback;

    const lower = s.toLowerCase();
    if (lower === "null" || lower === "undefined") return fallback;
    return s;
}
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}
// ---------- Type Definitions ----------
type PaymentMethodVM = {
    type: string;
    number?: string;
    account?: string;
    holder?: string
};

type ItemVM = {
    name: string;
    description: string;
    hsn: string;
    unit: string;
    qty: number;
    price: number;
    gst_percent: number;
    line_total: number;
    make?: string | null;
};

type EstimatePrintVM = {
    doc_title: string;
    doc_label: string;
    logo: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    our_company: {
        name: string;
        legal_name: string;
        tax_id: string;
        address_line: string;
        city_state: string;
        mobile_number: string;
        email_id: string;
        website: string;
    };
    customer_company: string;
    customer_name: string;
    customer_email: string;
    customer_address: string;
    subject?: string;
    shipping_address?: string;
    shipping_city_state?: string;
    customer_gstin?: string;
    customer_phone?: string;
    customer_city_state?: string;
    // Contact Person Details
    contact_person?: string;
    contact_person_designation?: string;
    contact_person_number?: string;
    payment_methods: PaymentMethodVM[];
    items: ItemVM[];
    sub_total: number;
    discount_value?: number;
    discount_label: string;
    discount_amount: number;
    cgst_percent: number;
    sgst_percent: number;
    igst_percent: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
    grand_total: number;
    total_amount?: number;
    total?: number;
    price_inc_tax?: string;
    amount_in_words: string;
    terms: string[];
    // ADD THIS PROPERTY:
    is_inter_state: boolean;
    service_type?: string | null;
    notes?: string | null;
};

type ItemInput = {
    item_name?: string;        // New field
    description?: string | null; // New field
    unit?: string | null;
    hsn_sac?: string | null;
    make?: string | null;
    qty: number;
    rate: number;
};

// ---------- Utility Functions ----------
const isValidUUID = (v: string): boolean => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
};

const extractUuidFromUrl = (url?: string): string | null => {
    if (!url) return null;
    const m = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
};

const pickEstimateId = (req: Request): string | null => {
    const p = req.params as any;
    const q = req.query as any;
    const b = req.body as any;

    const candidates = [
        p?.id, p?.estimate_id,
        q?.id, q?.estimate_id,
        b?.id, b?.estimate_id,
        (req.headers["x-estimate-id"] as string) ||
        (req.headers["x-estimateid"] as string) ||
        (req.headers["estimate-id"] as string),
    ].filter(Boolean) as string[];

    for (const c of candidates) {
        if (c && c !== ":id" && c !== ":estimate_id" && isValidUUID(c)) return c;
    }

    const fromUrl = extractUuidFromUrl(req.originalUrl || req.url);
    if (fromUrl && isValidUUID(fromUrl)) return fromUrl;

    return null;
};

function normalizeTaxScheme(value: string | number | null | undefined): string {
    // Default: no tax
    if (value == null) return "0";

    const raw = String(value).trim();
    const lower = raw.toLowerCase();

    // Explicit no-tax forms
    if (!raw || lower === "no tax" || lower === "none" || lower === "0" || lower === "0%") {
        return "0";
    }

    // If the raw is exactly 18/28 or 18%/28%, keep it as-is
    if (/^(18|28)$/.test(raw)) return raw;              // "18" or "28"
    if (/^(18|28)%$/.test(raw)) return raw;             // "18%" or "28%"

    // Try to extract a number (handles "18% tax", "gst 28", etc.)
    const m = raw.match(/(\d+(?:\.\d+)?)/);
    if (!m) return "0";

    const n = Number(m[1]);
    if (n !== 18 && n !== 28) return "0";

    // Preserve whether a percent sign appears in the original string
    const hasPercent = /%/.test(raw);
    const intStr = String(n).replace(/\.0+$/, "");

    return hasPercent ? `${intStr}%` : intStr;
}

// Prefer DB amount (generated column) when present
const lineAmount = (row: any): number => {
    if (row?.amount != null) return Number(row.amount);
    const qty = Number(row?.qty ?? row?.quantity ?? 0);
    const rate = Number(row?.rate ?? 0);
    return qty * rate;
};


function computeTotalsFromEstimateJSON(json: any) {
    const items = (json.items || []);
    const sub_total = items.reduce((acc: number, it: any) => acc + lineAmount(it), 0);

    let discount_amount = 0;
    if (json.discount_type === "percent" && Number(json.discount_value)) {
        discount_amount = (sub_total * Number(json.discount_value)) / 100;
    } else if (json.discount_type === "flat" && Number(json.discount_value)) {
        discount_amount = Number(json.discount_value);
    }

    const taxable = Math.max(sub_total - discount_amount, 0);

    // parse percent from gst/tax_scheme/gst_percent
    const parsePct = (gst?: any) => {
        if (gst == null) return 0;
        const s = String(gst).trim();
        if (!s || /no\s*tax/i.test(s) || s === "0" || s === "0%") return 0;
        const m = s.match(/(\d+(?:\.\d+)?)\s*%?/);
        return m ? Number(m[1]) : 0;
    };

    const percent =
        parsePct(json.gst) ||
        parsePct(json.tax_scheme) ||
        parsePct(json.gst_percent);

    let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
    const isInterState = Boolean(json.is_inter_state);

    if (percent > 0) {
        if (isInterState) {
            igst_amount = (taxable * percent) / 100;
        } else {
            const half = percent / 2;
            cgst_amount = (taxable * half) / 100;
            sgst_amount = (taxable * half) / 100;
        }
    }

    const grand_total = taxable + cgst_amount + sgst_amount + igst_amount;

    return {
        sub_total,
        discount_amount,
        taxable,
        cgst_amount,
        sgst_amount,
        igst_amount,
        percent,
        grand_total,
    };
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

const resolveExistingPath = async (...segments: string[]): Promise<string | null> => {
    const p = path.resolve(...segments);
    try {
        await fs.access(p);
        return p;
    } catch {
        return null;
    }
};

const resolveTemplateFile = async (rel: string): Promise<string> => {
    let p = await resolveExistingPath(__dirname, "../templates", rel);
    if (p) return p;

    p = await resolveExistingPath(__dirname, "../../templates", rel);
    if (p) return p;

    throw new Error(`Template not found: ${rel}`);
};

const resolveLogoPath = async (): Promise<string> => {
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        const p = await resolveExistingPath(fromEnv);
        if (p) return p;
    }

    const candidates: string[][] = [
        [__dirname, "../images", "compress-india-logo-traced.png"],
        [__dirname, "../../images", "compress-india-logo-traced.png"],
        [__dirname, "../public", "uploads", "images", "compress-india-logo-traced.png"],
        [__dirname, "../../public", "uploads", "images", "compress-india-logo-traced.png"],
        [__dirname, "../templates", "logo.png"],
        [__dirname, "../../templates", "logo.png"],
    ];

    for (const parts of candidates) {
        const p = await resolveExistingPath(...parts);
        if (p) return p;
    }
    return "";
};

// ---------- Template and Logo Cache ----------
const TEMPLATE_PATH_PROMISE: Promise<string> = resolveTemplateFile("invoice.hbs");
const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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

// ---------- Response Formatter ----------


class EstimateController {
    constructor() {
        this.update = this.updateEstimate;
    }

    private calculateDiscount(params: {
        sub_total: number;
        discount_type?: "none" | "percent" | "flat" | string | null;
        discount_value?: number | string | null;
    }): { discount_amount: number; taxable_amount: number } {
        const { sub_total, discount_type, discount_value } = params;

        // Normalize discount type
        const dtype = String(discount_type ?? "none").toLowerCase().trim();
        const dval = Number(discount_value ?? 0) || 0;

        let discount_amount = 0;
        let taxable_amount = sub_total;

        console.log('🧮 DISCOUNT CALCULATION DEBUG:');
        console.log('  - Sub Total:', sub_total);
        console.log('  - Discount Type:', dtype);
        console.log('  - Discount Value:', dval);

        switch (dtype) {
            case "percent":
                // Percentage discount: discount_value is the percentage (e.g., 10 for 10%)
                if (dval > 0 && dval <= 100) {
                    discount_amount = (sub_total * dval) / 100;
                    console.log('  - Percentage Discount Applied:', `${dval}% = ${discount_amount}`);
                } else if (dval > 100) {
                    // Cap at 100% if value exceeds
                    discount_amount = sub_total;
                    console.log('  - Discount capped at 100%');
                }
                break;

            case "flat":
                // Flat amount discount: discount_value is the fixed amount to subtract
                if (dval > 0) {
                    discount_amount = Math.min(dval, sub_total);
                    console.log('  - Flat Discount Applied:', discount_amount);
                }
                break;

            case "none":
            default:
                // No discount
                discount_amount = 0;
                console.log('  - No Discount Applied');
                break;
        }

        // Ensure discount doesn't make taxable amount negative
        taxable_amount = Math.max(0, sub_total - discount_amount);

        console.log('  - Final Discount Amount:', discount_amount);
        console.log('  - Taxable Amount after Discount:', taxable_amount);

        return { discount_amount, taxable_amount };
    }

    // ---------------- CREATE ESTIMATE ----------------
    public createEstimate = async (req: AuthenticatedRequest, res: Response) => {
        // 1) Auth
        const createdBy = req.user?.userId;
        if (!createdBy) {
            return res.status(401).json({ message: "User authentication required" });
        }

        // ---------- RAW SHIPPING FIELDS (direct from request) ----------
        const rawShippingAddress =
            (req.body?.shipping_address ??
                req.body?.delivery_address ??
                null) || null;

        const rawShippingState =
            (req.body?.shipping_state ?? null) || null;

        // 2) Normalize incoming GST
        const incomingGST =
            req.body?.tax_scheme ??
            req.body?.gst ??
            inferGstFromItems(req.body) ??
            "No Tax";

        const shapedBody = {
            ...req.body,
            // we don't trust the client to send a normalized scheme
            tax_scheme: normalizeTaxScheme(incomingGST),
            // DO NOT force shipping fields here – keep raw copies above
        };

        console.log("=== CREATE ESTIMATE DEBUG ===");
        console.log("Req shipping_address:", req.body?.shipping_address);
        console.log("Req delivery_address:", req.body?.delivery_address);
        console.log("Req shipping_state:", req.body?.shipping_state);
        console.log("Raw shipping_address:", rawShippingAddress);
        console.log("Raw shipping_state:", rawShippingState);
        console.log("============================");

        // 3) Validate
        let data: {
            client_id: string;
            subject?: string | null;
            tax_scheme?: string;
            //  tds?: number;
            discount_value?: number;
            discount_type?: "none" | "percent" | "flat";
            notes?: string | null;
            items: ItemInput[];
            // optional: if you HAVE these in the schema, typings won't hurt:
            shipping_address?: string | null;
            shipping_state?: string | null;
            service_type?: string | null;
        };

        try {
            data = await CreateEstimateSchema.validate(shapedBody as AnyObject, {
                abortEarly: false,
                stripUnknown: true,
            });
        } catch (err) {
            if (err instanceof ValidationError) {
                return res.status(400).json({
                    message: "Validation errors",
                    errors: err.errors,
                    fields: err.inner.map(e => e.path),
                });
            }
            return res.status(500).json({ message: "Validation failed" });
        }

        // 4) Validate client_id format
        if (!isValidUUID(data.client_id)) {
            return res.status(400).json({
                message: "Invalid client_id format",
                client_id: data.client_id,
            });
        }

        // 5) TX: verify client, create estimate + items
        const t = await db.sequelize.transaction();
        try {
            const client = await db.Client.findByPk(data.client_id, {
                transaction: t,
                attributes: ["id", "company", "client", "email_id", "mobile", "state", "city", "address"],
            });
            if (!client) {
                await t.rollback();
                return res.status(400).json({ message: "Client not found" });
            }

            const { items, ...header } = data;

            // ---------- FORCE PERSIST SHIPPING FIELDS ----------
            // Prefer validated values if schema includes them, otherwise fall back to raw
            const finalHeader = {
                ...header,
                client_id: data.client_id,
                created_by: createdBy,
                shipping_address:
                    data.shipping_address ?? rawShippingAddress ?? null,
                shipping_state:
                    data.shipping_state ?? rawShippingState ?? null,
                service_type: data.service_type ?? null,
            };

            console.log("=== FINAL HEADER DEBUG (CREATE) ===");
            console.log("finalHeader.shipping_address:", finalHeader.shipping_address);
            console.log("finalHeader.shipping_state:", finalHeader.shipping_state);
            console.log("===================================");

            const est = await db.Estimate.create(finalHeader, { transaction: t });

            if (Array.isArray(items) && items.length) {
                await db.EstimateItem.bulkCreate(
                    items.map(it => ({
                        estimate_id: est.id,
                        item_name: it.item_name, // Support both for backward compatibility
                        description: it.description ?? null,      // New field
                        make: it.make ?? null,
                        unit: it.unit ?? null,
                        hsn_sac: it.hsn_sac ?? null,
                        qty: Number(it.qty),
                        rate: Number(it.rate),
                    })),
                    { transaction: t }
                );
            }

            await t.commit();

            // In updateEstimate method - fix the refetch query
            const fresh = await db.Estimate.findByPk(est.id, {
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: ["id", "company", "client", "email_id", "mobile", "state", "city", "address"],
                    },
                    {
                        model: db.EstimateItem,
                        as: "items",
                        attributes: ["id", "item_name", "description", "unit", "hsn_sac", "make", "qty", "rate", "amount"], // ✅ UPDATED
                    },
                    {
                        model: db.SystemUser,
                        as: "createdBy",
                        attributes: ["id", "name", "email"],
                    },
                ],
                attributes: [
                    "id",
                    "est_no",
                    "subject",
                    "created_at",
                    "tax_scheme",
                    "discount_type",
                    "discount_value",
                    "shipping_address",
                    "shipping_state",
                    "created_by",
                    "is_invoiced",
                    "invoice_id",
                    "invoiced_at",
                    "client_id",
                    "service_type",
                ],
            });
            const json: any = fresh?.toJSON?.() ?? fresh ?? {};

            if (Array.isArray(json.items)) {
                json.items = json.items.map((it: any) => ({
                    ...it,
                    amount: lineAmount(it),
                    // Ensure proper field mapping for frontend compatibility
                    item_desc: it.item_name || it.description || "", // Map to old field for compatibility
                }));
            }

            // 💡 Pass client + shipping_state so GST uses correct state
            const totals = this.computeTotalsUnified({
                items: json.items || [],
                discount_type: json.discount_type,
                discount_value: json.discount_value,
                tax_scheme: json.tax_scheme,
                gst: json.gst,
                gst_percent: json.gst_percent,
                is_inter_state: json.is_inter_state,
                client: json.client,
                shipping_state: json.shipping_state,
            });

            json.sub_total = totals.sub_total;
            json.discount_amount = totals.discount_amount;
            json.taxable = totals.taxable;
            json.cgst_amount = totals.cgst_amount;
            json.sgst_amount = totals.sgst_amount;
            json.igst_amount = totals.igst_amount;
            json.gst_amount = totals.cgst_amount + totals.sgst_amount + totals.igst_amount;
            json.grand_total = totals.grand_total;
            json.is_inter_state = totals.is_inter_state;

            return res.status(201).json({
                message: "Estimate created successfully",
                data: json,
            });
        } catch (error: any) {
            if (t.finished !== "commit") await t.rollback();
            console.error("Error creating estimate:", error?.stack || error);
            return res.status(500).json({
                message: "Failed to create estimate",
                error: error?.message || String(error),
            });
        }
    };

    // ---------------- UPDATE ESTIMATE ----------------
    public updateEstimate = async (req: Request, res: Response) => {
        const user = (req as any).user;

        // ---------- RAW SHIPPING FIELDS FROM REQUEST ----------
        const rawShippingAddress =
            (req.body?.shipping_address ??
                req.body?.delivery_address ??
                null) || null;

        const rawShippingState =
            (req.body?.shipping_state ?? null) || null;

        // Flags to know whether user actually sent these fields
        const hasShippingAddress =
            "shipping_address" in req.body || "delivery_address" in req.body;
        const hasShippingState = "shipping_state" in req.body;

        // ---------- TAX NORMALIZATION ----------
        const rawTaxTop = req.body?.tax_scheme ?? req.body?.gst;
        const rawTax = rawTaxTop ?? inferGstFromItems(req.body);
        const normalizedTax = normalizeTaxScheme(rawTax);

        const shaped: any = { ...req.body };

        // Map delivery_address → shipping_address if present
        if (shaped.shipping_address === undefined && shaped.delivery_address !== undefined) {
            shaped.shipping_address = shaped.delivery_address;
        }

        // Only set tax_scheme if tax was provided
        if (rawTax !== undefined) {
            shaped.tax_scheme = normalizedTax;
        } else {
            delete shaped.tax_scheme;
        }

        // IMPORTANT:
        // - If user did NOT send these fields, remove them from shaped,
        //   so they don't get nulled out by the update.
        if (!hasShippingState) {
            delete shaped.shipping_state;
        }
        if (!hasShippingAddress) {
            delete shaped.shipping_address;
        }

        console.log("=== UPDATE ESTIMATE DEBUG ===");
        console.log("Req.shipping_address:", req.body?.shipping_address);
        console.log("Req.delivery_address :", req.body?.delivery_address);
        console.log("Req.shipping_state   :", req.body?.shipping_state);
        console.log("rawShippingAddress   :", rawShippingAddress);
        console.log("rawShippingState     :", rawShippingState);
        console.log("shaped.shipping_addr :", shaped.shipping_address);
        console.log("shaped.shipping_state:", shaped.shipping_state);

        // DEBUG: Check items and make field
        console.log("Items in request:", req.body?.items?.length);
        if (req.body?.items) {
            req.body.items.forEach((item: any, index: number) => {
                console.log(`Item ${index}:`, {
                    item_desc: item.item_desc,
                    make: item.make,
                    make_type: typeof item.make,
                    make_exists: 'make' in item
                });
            });
        }
        console.log("===================================");

        // ---------- VALIDATION ----------
        let data: any;
        try {
            data = await UpdateEstimateSchema.validate(shaped as AnyObject, {
                abortEarly: false,
                stripUnknown: true,
            });
        } catch (err: any) {
            if (err instanceof ValidationError) {
                return res.status(400).json({
                    message: "Validation errors",
                    errors: err.errors,
                    fields: err.inner.map((e: any) => e.path),
                });
            }
            return res.status(500).json({ message: "Validation failed" });
        }

        const estId = req.params.id || req.body?.id;
        if (!estId) {
            return res.status(400).json({ message: "Missing estimate id" });
        }

        if (data.client_id && !isValidUUID(data.client_id)) {
            return res.status(400).json({ message: "Invalid client_id format" });
        }

        const t = await db.sequelize.transaction();
        try {
            const est = await db.Estimate.findByPk(estId, { transaction: t });
            if (!est) {
                await t.rollback();
                return res.status(404).json({ message: "Estimate not found" });
            }

            if (data.client_id) {
                const client = await db.Client.findByPk(data.client_id, { transaction: t });
                if (!client) {
                    await t.rollback();
                    return res.status(400).json({ message: "Client not found" });
                }
            }

            const { items, ...header } = data;

            // Remove only undefined (keep null if you want to explicitly clear a field)
            Object.keys(header).forEach(k => {
                if ((header as any)[k] === undefined) {
                    delete (header as any)[k];
                }
            });

            // 🔹 FORCE PATCH SHIPPING FIELDS ONLY IF USER SENT THEM
            if (hasShippingAddress) {
                (header as any).shipping_address = rawShippingAddress;
            }
            if (hasShippingState) {
                (header as any).shipping_state = rawShippingState;
            }

            console.log("=== FINAL UPDATE HEADER ===");
            console.log("header:", header);
            console.log("header.shipping_address:", header.shipping_address);
            console.log("header.shipping_state  :", header.shipping_state);
            console.log("===================================");

            await est.update(
                {
                    ...header,
                    updated_at: new Date(),
                },
                { transaction: t }
            );

            // In the items processing section of updateEstimate:
            if (Array.isArray(items)) {
                // Remove old items
                await db.EstimateItem.destroy({
                    where: { estimate_id: est.id },
                    transaction: t,
                });

                if (items.length) {
                    console.log("=== ITEMS PROCESSING DEBUG ===");
                    console.log("Raw items from request:", JSON.stringify(items, null, 2));

                    const itemData = items.map((it: any, index: number) => {
                        console.log(`Processing item ${index}:`, {
                            raw_item_name: it.item_name,
                            raw_description: it.description,
                            raw_make: it.make,
                            raw_make_type: typeof it.make,
                            has_make: 'make' in it
                        });

                        // Process make field with detailed logging
                        let makeValue: string | null = null;
                        if (it.make !== undefined && it.make !== null && it.make !== '') {
                            const trimmedMake = String(it.make).trim();
                            if (trimmedMake !== '') {
                                makeValue = trimmedMake;
                            }
                        }

                        const item = {
                            estimate_id: est.id,
                            item_name: it.item_name || it.item_desc, // Support both
                            description: it.description ?? null,      // New field
                            unit: it.unit ?? null,
                            hsn_sac: it.hsn_sac ?? null,
                            qty: Number(it.qty),
                            rate: Number(it.rate),
                            make: makeValue,
                        };

                        console.log(`  - Item ${index} final data:`, JSON.stringify(item, null, 2));
                        return item;
                    });

                    console.log("All processed items:", JSON.stringify(itemData, null, 2));
                    const createdItems = await db.EstimateItem.bulkCreate(itemData, { transaction: t });
                    console.log("BulkCreate completed, created items:", createdItems.length);
                }
            }
            await t.commit();

            // ---------- REFETCH + TOTALS ----------
            // In updateEstimate method - fix the refetch query
            const fresh = await db.Estimate.findByPk(est.id, {
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: ["id", "company", "client", "email_id", "mobile", "state", "city", "address"],
                    },
                    {
                        model: db.EstimateItem,
                        as: "items",
                        attributes: ["id", "item_name", "description", "unit", "hsn_sac", "make", "qty", "rate", "amount"], // ✅ UPDATED - remove item_desc
                    },
                    {
                        model: db.SystemUser,
                        as: "createdBy",
                        attributes: ["id", "name", "email"],
                    },
                ],
                attributes: [
                    "id",
                    "est_no",
                    "subject",
                    "created_at",
                    "tax_scheme",
                    "discount_type",
                    "discount_value",
                    "shipping_address",
                    "shipping_state",
                    "created_by",
                    "is_invoiced",
                    "invoice_id",
                    "invoiced_at",
                    "client_id",
                    "service_type",
                ],
            });

            const json: any = fresh?.toJSON?.() ?? fresh ?? {};

            if (Array.isArray(json.items)) {
                json.items = json.items.map((it: any) => ({
                    ...it,
                    amount: lineAmount(it),
                }));
            }

            const totals = computeTotalsFromEstimateJSON({
                items: json.items || [],
                discount_type: json.discount_type,
                discount_value: json.discount_value,
                tax_scheme: json.tax_scheme,
                is_inter_state: json.is_inter_state,
            });

            Object.assign(json, totals);
            json.gst_amount = totals.cgst_amount + totals.sgst_amount + totals.igst_amount;

            // Debug: Check if make was saved
            console.log("=== AFTER UPDATE DEBUG ===");
            console.log("Updated items with make fields:");
            json.items?.forEach((item: any, index: number) => {
                console.log(`Item ${index}:`, {
                    item_desc: item.item_desc,
                    make: item.make,
                    make_type: typeof item.make
                });
            });
            console.log("===================================");

            return res.json({
                message: "Estimate updated successfully",
                data: json,
            });
        } catch (error: any) {
            if (t.finished !== "commit") await t.rollback();
            console.error("Error updating estimate:", error);
            return res.status(500).json({
                message: "Failed to update estimate",
                error: error?.message || String(error),
            });
        }
    };

    public getAllEstimates = async (req: Request, res: Response) => {
        try {
            const page = parseInt((req.query.page as string) || "1", 10) || 1;
            const limit = parseInt((req.query.limit as string) || "20", 10) || 20;
            const offset = (page - 1) * limit;

            const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
            const status = typeof req.query.status === "string" ? req.query.status.trim() : undefined;

            // ✅ Describe the *live* table to avoid 42703 on lagging envs
            const estCols = await db.sequelize.getQueryInterface().describeTable("estimates");

            const where: any = {};
            if (q) {
                where[Op.or] = [
                    { est_no: estCols.est_no ? { [Op.iLike]: `%${q}%` } : undefined },
                    { subject: estCols.subject ? { [Op.iLike]: `%${q}%` } : undefined },
                ].filter(Boolean);
                if (!where[Op.or].length) delete where[Op.or];
            }

            if (status && estCols.is_invoiced) {
                if (status === "open") where.is_invoiced = false;
                if (status === "invoiced") where.is_invoiced = true;
            }
            if (status && estCols.status && status !== "open" && status !== "invoiced") {
                where.status = status;
            }
            // Only request attributes that are known to exist - ADD "status" HERE
            const safeAttrs = [
                "id", "est_no", "subject", "created_at", "tax_scheme", "discount_type", "discount_value",
                "shipping_address", "shipping_state", "created_by", "is_invoiced", "invoice_id", "invoiced_at", "service_type",
                "status", // ✅ ADD THIS LINE - CRITICAL FIX
            ].filter(a => a in estCols);

            const { rows, count } = await db.Estimate.findAndCountAll({
                where,
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: ["id", "company", "client", "email_id", "mobile"],
                    },
                    {
                        model: db.EstimateItem,
                        as: "items",
                        attributes: ["id", "item_name", "description", "qty", "make", "rate", "hsn_sac"],
                    },
                    {
                        model: db.SystemUser,
                        as: "createdBy",
                        attributes: ["id", "name", "email"],
                    },
                ],
                attributes: safeAttrs,
                order: [["created_at", "DESC"]],
                limit,
                offset,
                distinct: true,
            });

            // Transform rows to include calculated totals and basic amount
            const transformedRows = rows.map((est: { toJSON: () => any; }) => {
                const json: any = est.toJSON();

                // Calculate sub_total from items
                let sub_total = 0;
                if (Array.isArray(json.items)) {
                    sub_total = json.items.reduce((sum: number, it: any) => {
                        const qty = Number(it.qty) || 0;
                        const rate = Number(it.rate) || 0;
                        return sum + (qty * rate);
                    }, 0);
                }

                // Calculate discount amount using the helper method
                const { discount_amount } = this.calculateDiscount({
                    sub_total,
                    discount_type: json.discount_type,
                    discount_value: json.discount_value,
                });

                // Calculate basic amount (subtotal - discount)
                const basic_amount = Math.max(0, sub_total - discount_amount);

                // Calculate tax amount
                const taxPercent = this.normalizeTaxToPercent(json.tax_scheme);
                let tax_amount = 0;
                if (taxPercent > 0) {
                    tax_amount = (basic_amount * taxPercent) / 100;
                }

                // Calculate grand total
                const grand_total = basic_amount + tax_amount;

                return {
                    ...json,
                    sub_total,
                    discount_amount,
                    basic_amount, // This is what you want: subtotal - discount
                    tax_amount,
                    grand_total,
                    // For backward compatibility, also include total_amount
                    total_amount: grand_total,
                };
            });

            return res.status(200).json({
                data: transformedRows,
                totalCount: count,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                hasNext: page < Math.ceil(count / limit),
                hasPrev: page > 1,
                searchQuery: q || null,
                status: status || null,
            });
        } catch (error: any) {
            console.error("Error fetching estimates:", error?.stack || error);
            return res.status(500).json({
                message: "Failed to fetch estimates",
                error: error?.message || String(error),
            });
        }
    };
    public getEstimateById = async (req: Request, res: Response) => {
        try {
            const id = String(req.query.id || "").trim();
            if (!id) {
                return res.status(400).json({ message: "Estimate ID is required" });
            }

            const estimate = await db.Estimate.findOne({
                where: { id },
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: ["id", "company", "client", "email_id", "mobile", "address", "state", "city", "pin_code"],
                    },
                    {
                        model: db.EstimateItem,
                        as: "items",
                        attributes: ["id", "item_name", "description", "unit", "hsn_sac", "make", "qty", "rate", "amount"], // Updated
                    },
                    {
                        model: db.SystemUser,
                        as: "createdBy",
                        attributes: ["id", "name", "email"],
                    },
                ],
            });
            if (!estimate) {
                return res.status(404).json({ message: "Estimate not found" });
            }

            // Transform the data to match frontend expectations
            const json: any = estimate.toJSON();

            console.log('Estimate data from DB:', {
                id: json.id,
                client_id: json.client_id,
                shipping_state: json.shipping_state,
                shipping_address: json.shipping_address,
                subject: json.subject,
                notes: json.notes,
                //tds: json.tds,
                discount_type: json.discount_type,
                discount_value: json.discount_value,
                tax_scheme: json.tax_scheme,
                itemCount: json.items?.length || 0
            });

            // Ensure each item has proper fields
            if (Array.isArray(json.items)) {
                json.items = json.items.map((it: any) => ({
                    ...it,
                    amount: it.amount != null ? Number(it.amount) : (Number(it.qty) || 0) * (Number(it.rate) || 0),
                    item_name: it.item_name || "", // Updated
                    description: it.description || "", // New
                    unit: it.unit || "",
                    hsn_sac: it.hsn_sac || "",
                    make: it.make || "",
                    qty: it.qty || 0,
                    rate: it.rate || 0,
                }));
            }


            // Add vendorRef for backward compatibility
            if (json.client) {
                json.vendorRef = {
                    id: json.client.id,
                    company: json.client.company,
                    client: json.client.client,
                    email_id: json.client.email_id,
                    mobile: json.client.mobile,
                    address: json.client.address,
                    state: json.client.state, // Client's state (different from shipping_state)
                    city: json.client.city,
                    pin_code: json.client.pin_code,
                };
            }

            // Map tax_scheme to gst for frontend compatibility
            const gstMapping: { [key: string]: string } = {
                "No Tax": "No Tax",
                "18%": "18% Tax",
                "28%": "28% Tax",
                "0": "No Tax",
                "0%": "No Tax"
            };

            const responseData = {
                ...json,
                // Ensure all required fields for frontend
                shipping_state: json.shipping_state || "", // ✅ From Estimate model
                shipping_address: json.shipping_address || "",
                delivery_address: json.shipping_address || "", // Use shipping_address as delivery_address
                notes: json.notes || "",
                //tds: json.tds != null ? json.tds : null,
                discount_type: json.discount_type || "none",
                discount_value: json.discount_value != null ? json.discount_value : null,
                tax_scheme: json.tax_scheme || "No Tax",
                client_id: json.client_id || (json.client?.id || ""),
                gst: gstMapping[json.tax_scheme] || json.tax_scheme || "No Tax", // Map to frontend gst field
                subject: json.subject || "",
                est_number: json.est_no || "",
                created_by: json.created_by || ""
            };

            return res.status(200).json({ data: responseData });
        } catch (err: unknown) {
            if (err instanceof Error) {
                console.error("Error fetching estimate:", err);
                return res.status(500).json({
                    message: "Failed to fetch estimate",
                    error: err.message,
                });
            }
            console.error("Unknown error:", err);
            return res.status(500).json({ message: "An unknown error occurred" });
        }
    };

    // ---------------- GET ONE ESTIMATE ----------------
    public getOne = async (req: Request, res: Response) => {
        try {
            const est = await db.Estimate.findByPk(req.params.id, {
                include: [
                    {
                        model: db.Client,
                        as: "clientRef",
                        attributes: ["id", "company", "client", "email_id", "mobile"]
                    },
                    {
                        model: db.EstimateItem,
                        as: "items"
                    },
                ],
                attributes: {
                    include: [
                        "is_invoiced",
                        "invoiced_at",
                        "invoice_id",
                        "created_by",
                        // "updated_by"
                        "service_type",
                    ],
                },
            });

            if (!est) return res.status(404).json({ message: "Estimate not found" });
            return res.json({ data: formatEstimateResponse(est) });
        } catch (error: any) {
            console.error(`Error fetching estimate ${req.params.id}:`, error?.stack || error);
            return res.status(500).json({
                message: "Failed to fetch estimate",
                error: error?.message || String(error)
            });
        }
    };

    // ---------------- DELETE ESTIMATE ----------------
    public deleteEstimate = async (req: Request, res: Response) => {
        const id = req.params.id || req.params.estimate_id || req.body?.id;
        const isUUIDv4 = (v: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

        if (!id) return res.status(400).json({
            success: false,
            msg: "Missing estimate id",
            data: null
        });

        if (!isUUIDv4(id)) return res.status(400).json({
            success: false,
            msg: "Invalid estimate id format",
            data: null
        });

        const forceDelete = String(req.query.force).toLowerCase() === "true";

        const t = await db.sequelize.transaction();
        try {
            const est = await db.Estimate.findByPk(id, {
                transaction: t,
                paranoid: false
            });

            if (!est) {
                await t.rollback();
                return res.status(404).json({
                    success: false,
                    msg: "Estimate not found",
                    data: null
                });
            }

            if ((est as any).deletedAt && !forceDelete) {
                await t.rollback();
                return res.status(409).json({
                    success: false,
                    msg: "Estimate already deleted",
                    data: { id, alreadyDeleted: true }
                });
            }

            await db.Estimate.destroy({
                where: { id },
                transaction: t,
                individualHooks: true,
                force: forceDelete
            });

            await t.commit();

            return res.json({
                success: true,
                msg: forceDelete ? "Estimate permanently deleted" : "Estimate deleted",
                data: { id, force: forceDelete }
            });
        } catch (error: any) {
            await t.rollback();
            console.error(`Error deleting estimate ${id}:`, error?.stack || error);
            return res.status(500).json({
                success: false,
                msg: "Failed to delete estimate",
                data: { error: error?.message || String(error) }
            });
        }
    };

    // ---------------- ESTIMATE STATUS ----------------
    public status = async (req: Request, res: Response) => {
        try {
            const est = await db.Estimate.findByPk(req.params.id, {
                attributes: [
                    "id",
                    "is_invoiced",
                    "invoice_id",
                    "invoiced_at",
                    "created_by"
                ],
            });

            if (!est) return res.status(404).json({ message: "Estimate not found" });

            const json = est.toJSON() as any;
            return res.json({
                id: json.id,
                converted: Boolean(json.is_invoiced || json.invoice_id),
                ...json,
            });
        } catch (err: any) {
            console.error("status error:", err);
            return res.status(500).json({
                message: "Failed to read status",
                error: err?.message || String(err)
            });
        }
    };

    // ---------------- VENDORS SEARCH ----------------

    public vendors = async (req: Request, res: Response) => {
        try {
            const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
            const q = qRaw ? escapeILike(qRaw) : "";

            // ✅ correct param names + safe ranges
            const pageParam = typeof req.query.page === "string" ? parseInt(req.query.page, 10) : NaN;
            const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;

            const page = clamp(Number.isFinite(pageParam) ? pageParam : 1, 1, 10_000);
            const limit = clamp(Number.isFinite(limitParam) ? limitParam : 20, 1, 200);
            const offset = (page - 1) * limit;

            const where = q
                ? {
                    [Op.or]: [
                        { company: { [Op.iLike]: `%${q}%` } },
                        { vendor: { [Op.iLike]: `%${q}%` } },
                        { email_id: { [Op.iLike]: `%${q}%` } },
                        { mobile: { [Op.iLike]: `%${q}%` } },
                    ],
                }
                : undefined;

            const { count, rows } = await db.Vendor.findAndCountAll({
                where,
                attributes: ["id", "company", "vendor", "email_id", "mobile"],
                order: [["company", "ASC"]],
                limit,
                offset,
                // distinct: true, // uncomment if you add JOINs later
            });

            const totalPages = Math.max(1, Math.ceil(count / limit));
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
                searchQuery: qRaw || null,
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

    // ---------------- PRINT ESTIMATE HTML ----------------
    public printEstimateHtml = async (req: Request, res: Response) => {
        try {
            const id = pickEstimateId(req);
            if (!id) return res.status(400).type("text/plain").send("Invalid or missing estimate id");

            const vm = await this.buildEstimateViewModel(id);
            vm.logo = await getLogoAsDataURL();
            const hbsPath = await TEMPLATE_PATH_PROMISE;
            const tpl = await fs.readFile(hbsPath, "utf-8");
            const html = Handlebars.compile(tpl)(vm);

            return res.status(200).type("html").send(html);
        } catch (err: any) {
            console.error("printEstimateHtml error:", err?.stack || err);
            return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
        }
    };

    // ---------------- PRINT ESTIMATE PDF ----------------
    public printEstimatePdf = async (req: Request, res: Response) => {
        let browser: Browser | null = null;

        try {
            const id = pickEstimateId(req);
            if (!id) {
                return res.status(400).type("text/plain").send("Invalid or missing estimate id");
            }

            const vm = await this.buildEstimateViewModel(id);
            vm.logo = await getLogoAsDataURL();


            const hbsPath = await TEMPLATE_PATH_PROMISE;
            const tpl = await fs.readFile(hbsPath, "utf-8");
            const html = Handlebars.compile(tpl)(vm);

            // ---------------- PUPPETEER EXECUTABLE PATH FIX ----------------
            // 1) Prefer Docker / env variable (we set this in Dockerfile)
            // 2) Fallbacks for local dev (Windows/macOS/Linux)
            const executablePath =
                process.env.PUPPETEER_EXECUTABLE_PATH ||
                process.env.CHROME_EXECUTABLE_PATH ||
                (process.platform === "win32"
                    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                    : process.platform === "darwin"
                        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                        : "/usr/bin/chromium");

            browser = await puppeteer.launch({
                executablePath,                // 👈 use the resolved path
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });
            // ---------------------------------------------------------------

            const page: Page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
            await page.emulateMediaType("screen");

            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
                preferCSSPageSize: true,
            });

            if (!pdfBuffer || pdfBuffer.length < 1000) {
                console.error("PDF DEBUG: empty/short buffer");
                return res
                    .status(500)
                    .type("text/plain")
                    .send(
                        "PDF generation failed (empty buffer). Likely missing Chromium or fonts in container."
                    );
            }

            const download = String(req.query.dl || req.query.download) === "1";
            const filename = `Quotation-${vm.invoice_number || id}.pdf`;

            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            res.setHeader("Content-Encoding", "identity");
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                `${download ? "attachment" : "inline"}; filename="${filename}"`
            );
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Accept-Ranges", "bytes");

            const range = req.headers.range;
            const total = pdfBuffer.length;

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
                    res.setHeader("Content-Length", String(chunk.length));
                    return res.end(chunk);
                }
            }

            res.setHeader("Content-Length", String(total));
            return res.end(pdfBuffer);
        } catch (err: any) {
            console.error("printEstimatePdf error:", err?.stack || err);
            return res
                .status(500)
                .type("text/plain")
                .send(
                    `Failed to render PDF: ${err?.message || err}
Hint: If this happens only in Docker, ensure Chromium + fonts are installed or use Debian-slim base image.`
                );
        } finally {
            try {
                await browser?.close();
            } catch {
                // ignore browser close errors
            }
        }
    };

    // ---------------- CONVERT TO PI ----------------
    public convertToPI = async (req: AuthenticatedRequest, res: Response) => {
        const estimateId = req.params.id;
        const cloneItems = String(req.query.cloneItems || "").toLowerCase() === "true";
        const force = String(req.query.force || "").toLowerCase() === "true";

        const isUuid = (v: any) =>
            typeof v === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

        if (!isUuid(req.user?.userId)) {
            return res.status(401).json({ message: "User authentication required" });
        }
        const createdBy = req.user!.userId;

        const t = await db.sequelize.transaction();
        try {
            // 1) Fetch estimate with items
            const est = await db.Estimate.findByPk(estimateId, {
                transaction: t,
                include: [{
                    model: db.EstimateItem,
                    as: "items",
                    attributes: ["id", "item_name", "description", "make", "qty", "rate", "unit", "hsn_sac"]
                }]
            });
            if (!est) {
                await t.rollback();
                return res.status(404).json({ message: "Estimate not found" });
            }

            // 2) Check if PI already exists
            const existingPI = await db.Pi.findOne({
                where: { estimate_id: est.id },
                transaction: t,
            });
            if (existingPI && !force) {
                await t.rollback();
                return res.status(409).json({
                    message: "Estimate already converted to PI",
                    data: { pi_id: existingPI.id, estimate_id: est.id, created_at: existingPI.created_at },
                });
            }

            const estJson: any = est.toJSON();
            const estItems = estJson.items || [];

            // 3) Calculate all amounts properly
            // Subtotal from items
            const sub_total = estItems.reduce((sum: number, it: any) => {
                const qty = Number(it.qty ?? 0);
                const rate = Number(it.rate ?? 0);
                return sum + (qty * rate);
            }, 0);

            // Calculate discount amount
            const { discount_amount } = this.calculateDiscount({
                sub_total,
                discount_type: estJson.discount_type,
                discount_value: estJson.discount_value,
            });

            // Amount AFTER discount but BEFORE GST (this goes in 'amount' column)
            const amountAfterDiscount = Math.max(sub_total - discount_amount, 0);

            // Get tax percentage
            const headerTaxPercent = this.normalizeTaxToPercent(estJson.tax_scheme ?? estJson.tax_scheam ?? 0);

            // Calculate GST amount on the discounted amount
            let taxAmount = 0;
            if (headerTaxPercent > 0) {
                taxAmount = (amountAfterDiscount * headerTaxPercent) / 100;
            }

            // Calculate final price including tax (this goes in 'price_inc_tax' column)
            const priceIncTax = amountAfterDiscount + taxAmount;

            console.log('=== CONVERT TO PI AMOUNT CALCULATION (CORRECTED) ===');
            console.log('Subtotal (items total):', sub_total);
            console.log('Discount applied:', discount_amount);
            console.log('Amount after discount (goes in "amount" column):', amountAfterDiscount);
            console.log('Tax percent:', headerTaxPercent + '%');
            console.log('Tax amount (GST):', taxAmount);
            console.log('Price including tax (goes in "price_inc_tax" column):', priceIncTax);
            console.log('====================================================');

            // 4) Prepare PI header with CORRECT amounts
            const upsertHeader: any = {
                estimate_id: est.id,
                client_id: est.client_id,
                creation_date: new Date(),
                tax_date: new Date(),
                created_by: createdBy,

                // CORRECTED AMOUNTS:
                amount: amountAfterDiscount,          // ONLY discounted amount, NO GST
                price_inc_tax: priceIncTax,           // Discounted amount + GST
                tax_amount: taxAmount,                // Just the GST portion

                notes: est.notes || null,
                tax_scheme: estJson.tax_scheme || estJson.tax_scheam || null,
                discount_type: estJson.discount_type ?? null,
                discount_value: estJson.discount_value ?? null,
                is_inter_state: Boolean(estJson.is_inter_state),
                payment_status: false,
                payment_date: null,
            };

            let pi = existingPI;
            if (pi) {
                // Update existing PI with new amounts
                await pi.update(upsertHeader, { transaction: t });
                if (cloneItems) {
                    await db.PiItem.destroy({ where: { pi_id: pi.id }, transaction: t });
                }
            } else {
                // Create new PI with correct amounts
                pi = await db.Pi.create(upsertHeader, { transaction: t });
            }

            // 5) Clone items if requested
            if (cloneItems && estItems.length) {
                await db.PiItem.bulkCreate(
                    estItems.map((it: any) => {
                        const quantity = Number(it.qty) || 0;
                        const rate = Number(it.rate) || 0;
                        const lineTotal = quantity * rate;

                        return {
                            pi_id: pi.id,
                            item_name: it.item_name,
                            description: it.description,
                            make: it.make,
                            quantity: quantity,
                            rate: rate,
                            unit: it.unit ?? "NOS",
                            hsn_sac: it.hsn_sac,
                            gst_percent: headerTaxPercent || null,
                            line_total: lineTotal, // Item line total without GST
                        };
                    }),
                    { transaction: t }
                );
            }

            // 6) Mark estimate as invoiced
            await est.update(
                {
                    is_invoiced: true,
                    invoiced_at: new Date(),
                    updated_at: new Date(),
                    total_amount: String(priceIncTax) // Store the final price including tax
                },
                { transaction: t }
            );

            await t.commit();

            // 7) Return fresh PI with items
            const fresh = await db.Pi.findByPk(pi.id, {
                include: [{ model: db.PiItem, as: "items" }],
            });

            // Verify amounts were saved correctly
            console.log('=== AFTER PI CREATION (VERIFICATION) ===');
            console.log('PI amount (should be discounted only):', fresh?.amount);
            console.log('PI price_inc_tax (should include GST):', fresh?.price_inc_tax);
            console.log('PI tax_amount (GST only):', fresh?.tax_amount);

            // Verify the math
            if (fresh) {
                const calculatedTotal = Number(fresh.amount) + Number(fresh.tax_amount);
                console.log('Verification: amount + tax_amount =', calculatedTotal);
                console.log('Matches price_inc_tax?', calculatedTotal === Number(fresh.price_inc_tax));
            }
            console.log('=========================================');

            return res.status(201).json({
                message: existingPI ? "PI updated from estimate" : "PI created from estimate",
                data: {
                    pi: fresh,
                    estimate: {
                        id: est.id,
                        is_invoiced: true,
                        invoiced_at: est.invoiced_at,
                        total_amount: priceIncTax
                    },
                    calculated_amounts: {
                        subtotal: sub_total,
                        discount: discount_amount,
                        amount_after_discount: amountAfterDiscount,
                        tax_percent: headerTaxPercent,
                        tax_amount: taxAmount,
                        price_including_tax: priceIncTax
                    }
                },
            });
        } catch (err: any) {
            if (t.finished !== "commit") await t.rollback();
            console.error("convertToPI error:", err);
            return res.status(500).json({
                message: "Failed to create/update PI",
                error: err?.message || String(err)
            });
        }
    };

    public updateEstimateStatus = async (req: AuthenticatedRequest, res: Response) => {
        const t = await db.sequelize.transaction();

        try {
            const { id } = req.params;
            const { status } = req.body;
            const userId = req.user?.userId;

            // Validate inputs
            if (!userId) {
                await t.rollback();
                return res.status(401).json({ message: "User authentication required" });
            }

            if (!id) {
                await t.rollback();
                return res.status(400).json({ message: "Estimate ID is required" });
            }

            if (!status || typeof status !== 'string') {
                await t.rollback();
                return res.status(400).json({ message: "Valid status is required" });
            }

            // Normalize status
            const normalizedStatus = status.trim().toLowerCase();
            const validStatuses = ["pending", "selected", "rejected", "cancelled"];

            if (!validStatuses.includes(normalizedStatus)) {
                await t.rollback();
                return res.status(400).json({
                    message: "Invalid status",
                    validStatuses
                });
            }

            // Check if estimate exists
            const estimate = await db.Estimate.findByPk(id, { transaction: t });
            if (!estimate) {
                await t.rollback();
                return res.status(404).json({ message: "Estimate not found" });
            }

            // Update using direct query to avoid model issues
            const [updateCount] = await db.sequelize.query(
                `UPDATE estimates 
             SET status = $1, 
                 updated_at = $2, 
                 updated_by = $3 
             WHERE id = $4`,
                {
                    bind: [normalizedStatus, new Date(), userId, id],
                    transaction: t,
                    type: db.sequelize.QueryTypes.UPDATE
                }
            );

            if (updateCount === 0) {
                await t.rollback();
                return res.status(500).json({ message: "Failed to update estimate" });
            }

            await t.commit();

            // Fetch updated estimate
            const updatedEstimate = await db.Estimate.findByPk(id, {
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: ["id", "company", "client", "email_id", "mobile"],
                    },
                ],
            });

            return res.status(200).json({
                success: true,
                message: `Estimate status updated to ${normalizedStatus}`,
                data: updatedEstimate,
            });

        } catch (error: any) {
            if (t.finished !== "commit") {
                await t.rollback();
            }
            console.error("Error updating estimate status:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to update estimate status",
                error: error?.message || String(error),
            });
        }
    };

    // ---------------- SEARCH ESTIMATES (by client/company) ----------------
    public searchEstimates = async (req: Request, res: Response) => {
        try {
            // pagination
            const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
            const offset = (page - 1) * limit;

            // query
            const rawQ = typeof req.query.q === "string" ? req.query.q.trim() : "";
            const q = rawQ ? escapeILike(rawQ) : "";

            // describe tables to avoid selecting non-existent columns across envs
            const estCols = await db.sequelize.getQueryInterface().describeTable("estimates");
            const cliCols = await db.sequelize.getQueryInterface().describeTable("clients");

            // Build client "name" OR company criteria (only if columns exist)
            const clientWhere: any = q
                ? {
                    [Op.or]: [
                        cliCols.company ? { company: { [Op.iLike]: `%${q}%` } } : undefined,
                        cliCols.client ? { client: { [Op.iLike]: `%${q}%` } } : undefined,
                        cliCols.contact_person ? { contact_person: { [Op.iLike]: `%${q}%` } } : undefined,
                    ].filter(Boolean),
                }
                : undefined;

            // Minimal, safe estimate attributes (only if present)
            const estimateAttrs = [
                "id",
                "est_no",
                "subject",
                "created_at",
                "tax_scheme",
                "discount_type",
                "discount_value",
                "shipping_address",
                "shipping_state",
                "is_invoiced",
                "invoice_id",
                "invoiced_at",
                "service_type",
            ].filter((c) => c in estCols);

            // Minimal, safe client attributes (only if present)
            const clientAttrs = ["id", "company", "client", "email_id", "mobile"]
                .filter((c) => c in cliCols);

            const { rows, count } = await db.Estimate.findAndCountAll({
                where: {},
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: clientAttrs,
                        required: Boolean(q),
                        where: clientWhere || undefined,
                    },
                    {
                        model: db.EstimateItem,
                        as: "items",
                        attributes: ["id", "item_name", "description", "qty", "make", "rate", "hsn_sac"], // Updated
                        required: false,
                    },
                ],
                attributes: estimateAttrs,
                order: [["created_at", "DESC"]],
                limit,
                offset,
                distinct: true,
            });

            return res.status(200).json({
                data: rows,
                pagination: {
                    total: count,
                    totalPages: Math.ceil(count / limit),
                    currentPage: page,
                    itemsPerPage: limit,
                    hasNextPage: page * limit < count,
                    hasPreviousPage: page > 1,
                },
                searchQuery: rawQ || null,
            });
        } catch (error: any) {
            console.error("searchEstimates error:", error?.stack || error);
            return res.status(500).json({
                message: "Failed to search estimates",
                error: error?.message || String(error),
            });
        }
    };

    // ------- PRIVATE HELPER METHODS ----------------
    private parseGstPercent = (gst?: any): number => {
        if (gst === null || gst === undefined) return 0;
        if (typeof gst === "number" && Number.isFinite(gst)) return gst;
        const s = String(gst).trim();
        if (!s) return 0;
        if (/no\s*tax/i.test(s)) return 0;
        const m = s.match(/(\d+(?:\.\d+)?)\s*%?/);
        return m ? Number(m[1]) : 0;
    };
    private parseTaxRate(raw: any): number {
        const s = String(raw ?? "").trim().toLowerCase();
        if (!s || s === "no tax" || s === "0" || s === "0%") return 0;
        const m = s.match(/(\d+(\.\d+)?)\s*%?/); // 18 from "18% Tax"
        const num = m ? Number(m[1]) : Number(s);
        return Number.isFinite(num) ? num / 100 : 0;
    }

    private normalizeTaxToPercent(raw: any): number {
        if (raw === null || raw === undefined) return 0;
        if (typeof raw === "number" && Number.isFinite(raw)) return raw;
        const s = String(raw).trim().toLowerCase();
        if (!s) return 0;
        if (/no\s*tax|none|^0(\.0+)?%?$/.test(s)) return 0;
        const m = s.match(/(\d+(?:\.\d+)?)/);
        if (!m) return 0;
        const n = Number(m[1]);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    }
    private percentToDecimal(percent: number): number {
        return Number.isFinite(percent) ? percent / 100 : 0;
    }

    // Better inter-state detection: prefer estimate.shipping_state, then client.shipping_state, then client.state
    private isInterStateFromJson(ejson: {
        client?: { state?: string | null; shipping_state?: string | null } | any;
        shipping_state?: string | null;
        is_inter_state?: boolean | null;
    }): boolean {
        const norm = (s?: string | null) => (s ?? "").toString().trim().toLowerCase();

        // Seller's state (company state) - from environment or fixed
        const sellerState = norm(process.env.COMPANY_STATE || "maharashtra");

        // Buyer's shipping state - from estimate.shipping_state
        const shippingState = norm(ejson.shipping_state);

        // If shipping state is not provided in estimate, fallback to client's state
        const buyerState = shippingState || norm(ejson?.client?.state) || "";

        // If we have both states, compare them
        if (sellerState && buyerState) {
            return sellerState !== buyerState;
        }

        // If explicit flag provided, respect it
        if (ejson?.is_inter_state !== undefined && ejson?.is_inter_state !== null) {
            return Boolean(ejson.is_inter_state);
        }

        // Default: assume intra-state (same state)
        return false;
    }

    private computeTotalsWithStateBasedGST(params: {
        items: Array<{ qty: number; rate: number }>;
        discount_type?: "none" | "percent" | "flat" | string | null;
        discount_value?: number | string | null;
        tax_percent: number;
        is_inter_state: boolean;
    }) {
        const items = Array.isArray(params.items) ? params.items : [];

        // Calculate sub_total
        const sub_total = items.reduce((sum, it) => {
            const q = Number(it.qty) || 0;
            const r = Number(it.rate) || 0;
            return sum + (q * r);
        }, 0);

        console.log('🧮 computeTotalsWithStateBasedGST INPUT:');
        console.log('  - Items count:', items.length);
        console.log('  - Sub total:', sub_total);
        console.log('  - Tax percent:', params.tax_percent);
        console.log('  - Is inter-state:', params.is_inter_state);
        console.log('  - Discount type:', params.discount_type);
        console.log('  - Discount value:', params.discount_value);

        // Use improved discount calculation
        const { discount_amount, taxable_amount: taxable } = this.calculateDiscount({
            sub_total,
            discount_type: params.discount_type,
            discount_value: params.discount_value,
        });

        const taxPercent = Number(params.tax_percent) || 0;
        const isInterState = Boolean(params.is_inter_state);

        console.log('📊 Before GST Calculation:');
        console.log('  - Taxable amount:', taxable);
        console.log('  - Tax percent:', taxPercent);
        console.log('  - Is inter-state:', isInterState);

        // GST Calculation - FIXED LOGIC
        let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
        let cgst_percent = 0, sgst_percent = 0, igst_percent = 0;

        if (taxPercent > 0) {
            if (isInterState) {
                // Interstate -> IGST full (18% or whatever the tax percent is)
                igst_percent = taxPercent;
                igst_amount = (taxable * taxPercent) / 100;
                console.log('🌍 IGST APPLIED (Inter-State):', {
                    percent: igst_percent,
                    amount: igst_amount
                });
            } else {
                // Intrastate -> split half/half (9% CGST + 9% SGST for 18% GST)
                const halfPercent = taxPercent / 2;
                cgst_percent = halfPercent;
                sgst_percent = halfPercent;
                cgst_amount = (taxable * halfPercent) / 100;
                sgst_amount = (taxable * halfPercent) / 100;
                console.log('🏠 CGST+SGST APPLIED (Intra-State):', {
                    cgst_percent, cgst_amount,
                    sgst_percent, sgst_amount
                });
            }
        } else {
            console.log('❌ No GST Applied - taxPercent is 0');
        }

        const grand_total = taxable + cgst_amount + sgst_amount + igst_amount;

        console.log('✅ FINAL GST BREAKDOWN:');
        console.log('  - CGST:', cgst_percent + '% =', cgst_amount);
        console.log('  - SGST:', sgst_percent + '% =', sgst_amount);
        console.log('  - IGST:', igst_percent + '% =', igst_amount);
        console.log('  - Grand Total:', grand_total);

        return {
            sub_total,
            discount_amount,
            taxable,
            cgst_amount,
            sgst_amount,
            igst_amount,
            cgst_percent,
            sgst_percent,
            igst_percent,
            tax_percent: taxPercent,
            is_inter_state: isInterState,
            grand_total,
        };
    }
    // Put this INSIDE the EstimateController class, replacing the stubbed version.
    private numberToWords = (amount: number): string => {
        if (amount == null || !isFinite(amount)) return "Zero Rupees";
        // round to nearest rupee
        let rupees = Math.round(amount);

        const ones = [
            "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
            "Sixteen", "Seventeen", "Eighteen", "Nineteen"
        ];
        const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

        const twoDigits = (n: number): string => {
            if (n < 20) return ones[n];
            const t = Math.floor(n / 10), o = n % 10;
            return tens[t] + (o ? " " + ones[o] : "");
        };

        const threeDigits = (n: number): string => {
            const h = Math.floor(n / 100);
            const r = n % 100;
            const hPart = h ? ones[h] + " Hundred" : "";
            const rPart = r ? (h ? " " : "") + twoDigits(r) : "";
            return (hPart + rPart).trim();
        };

        if (rupees === 0) return "Zero Rupees";

        const parts: string[] = [];
        let n = rupees;

        const crore = Math.floor(n / 10000000); n %= 10000000;
        const lakh = Math.floor(n / 100000); n %= 100000;
        const thousand = Math.floor(n / 1000); n %= 1000;
        const hundredToOne = n; // 0..999

        if (crore) parts.push(threeDigits(crore) + " Crore");
        if (lakh) parts.push(threeDigits(lakh) + " Lakh");
        if (thousand) parts.push(threeDigits(thousand) + " Thousand");
        if (hundredToOne) parts.push(threeDigits(hundredToOne));

        return (parts.join(" ") + " " + (rupees === 1 ? "Rupee" : "Rupees")).trim();
    };

    private buildEstimateViewModel = async (estimateId: string): Promise<EstimatePrintVM> => {
        const est = await db.Estimate.findByPk(estimateId, {
            include: [
                {
                    model: db.Client,
                    as: "client",
                    attributes: [
                        "id", "company", "client", "email_id", "mobile", "gstn", "city", "state", "address",
                        "contact_person", "designation", "contact_person_number"
                    ],
                },
                {
                    model: db.EstimateItem,
                    as: "items",
                    attributes: ["id", "item_name", "description", "unit", "hsn_sac", "make", "qty", "rate", "amount"]
                },
            ],
        });

        if (!est) throw new Error("Estimate not found");
        const json = est.toJSON() as any;

        // DEBUG: Get raw data first
        console.log('=== RAW DATA DEBUG ===');
        console.log('Client State (raw):', json.client?.state);
        console.log('Shipping State (raw):', json.shipping_state);
        console.log('Client State (type):', typeof json.client?.state);
        console.log('Shipping State (type):', typeof json.shipping_state);

        // Get states - handle null/undefined properly
        const clientState = String(json.client?.state || "").trim();
        const shippingState = String(json.shipping_state || "").trim();

        console.log('Client State (processed):', `"${clientState}"`);
        console.log('Shipping State (processed):', `"${shippingState}"`);
        console.log('States equal?', clientState === shippingState);
        console.log('Client state length:', clientState.length);
        console.log('Shipping state length:', shippingState.length);

        // Determine if inter-state transaction
        // FIXED LOGIC: Only consider it inter-state if both states exist AND are different
        // If shipping state is empty, assume same state (intra-state)
        let isInterState = false;

        if (clientState && shippingState) {
            // Both states exist, compare them
            isInterState = clientState !== shippingState;
            console.log('Both states exist - Comparison result:', isInterState);
        } else if (shippingState) {
            // Only shipping state exists (unlikely but handle it)
            console.log('Only shipping state exists');
            isInterState = true; // If we have shipping state but no client state, assume inter-state
        } else {
            // No shipping state or both missing - assume intra-state
            console.log('No shipping state or both missing - assuming intra-state');
            isInterState = false;
        }

        console.log('FINAL isInterState:', isInterState);
        console.log('==========================');

        // Determine tax percent from estimate
        const headerTaxPercent = this.normalizeTaxToPercent(json.gst ?? json.tax_scheme ?? 0);
        console.log('Tax Percent:', headerTaxPercent);

        // Calculate totals with proper GST splitting
        const totals = this.computeTotalsWithStateBasedGST({
            items: (json.items || []).map((it: any) => ({
                qty: Number(it.qty ?? it.quantity ?? 0),
                rate: Number(it.rate ?? 0),
            })),
            discount_type: json.discount_type,
            discount_value: json.discount_value,
            tax_percent: headerTaxPercent,
            is_inter_state: isInterState,
        });

        console.log('=== FINAL GST BREAKDOWN ===');
        console.log('Inter-State:', totals.is_inter_state);
        console.log('CGST:', totals.cgst_percent + '% =', totals.cgst_amount);
        console.log('SGST:', totals.sgst_percent + '% =', totals.sgst_amount);
        console.log('IGST:', totals.igst_percent + '% =', totals.igst_amount);
        console.log('Grand Total:', totals.grand_total);
        console.log('===========================');

        // Rest of your method continues...
        const invoiceDate = json.created_at ? new Date(json.created_at) : null;
        const dueDate = json.due_date ? new Date(json.due_date) : null;
        const invoice_date = invoiceDate ? invoiceDate.toLocaleDateString("en-IN") : "";
        const vm_due_date = dueDate ? dueDate.toLocaleDateString("en-IN") : "";

        const logoData = await getLogoAsDataURL();

        const our_company = {
            name: process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.",
            legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
            tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
            address_line: process.env.COMPANY_ADDR ||
                "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Naga Near SCLR Road, Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
            city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
            mobile_number: process.env.COMPANY_MOBILE_NUMBER || "8655 0114 65 / 9920 5299 61",
            email_id: process.env.COMPANY_EMAIL || "sales@compressindia.in / info@compressindia.com",
            // website: process.env.COMPANY_WEBSITE ||
            //     "www.compressindia.in / www.compressindia.com / www.compressindia.co.in",
            website: process.env.COMPANY_WEBSITE ||
                "www.compressindia.com",
        };

        // Customer details
        const customer_company = json.client?.company ?? "";
        const customer_name = json.client?.client ?? "";
        const customer_email = json.client?.email_id ?? "";
        const customer_phone = json.client?.mobile ?? "";
        const customer_gstin = json.client?.gstn ?? "";
        const customer_city_state = `${json.client?.city ?? ""}, ${json.client?.state ?? ""}`
            .trim().replace(/^,\s*|,\s*$/g, "");
        const customer_address = json.client?.address ?? "";

        // Contact person
        const contact_person = json.client?.contact_person ?? "";
        const contact_person_designation = json.client?.designation ?? "";
        const contact_person_number = json.client?.contact_person_number ?? "";

        // Document fields
        const subject = json.subject ?? "";
        const shipping_address = json.shipping_address ?? json.delivery_address ?? "";
        const shipping_city_state = json.client?.city
            ? `${json.client.city}, ${json.shipping_state || json.client?.state || ""}`.trim().replace(/^,\s*|,\s*$/g, "")
            : (json.shipping_state || json.client?.state || "");

        // Items
        const items: ItemVM[] = (json.items || []).map((it: any) => {
            const qty = Number(it.qty ?? it.quantity ?? 0);
            const price = Number(it.rate ?? 0);
            const line_total = qty * price;

            const itemGstPercent = this.normalizeTaxToPercent(
                it.gst ?? it.gst_percent ?? headerTaxPercent
            );

            return {
                name: it.item_name || "",
                description: it.description || "",
                hsn: it.hsn_sac || "",
                unit: it.unit || "",
                qty,
                price,
                gst_percent: itemGstPercent,
                line_total,
                make: it.make ?? null,
            };
        });

        const r0 = (n: number) => Math.round(Number(n) || 0);

        return {
            doc_title: "Quotation",
            doc_label: "QUOTE Number",
            logo: logoData,
            invoice_number: json.est_no ?? json.est_number ?? "",
            invoice_date: invoice_date,
            due_date: vm_due_date,

            our_company,

            customer_company,
            customer_name,
            customer_email,
            customer_address,
            subject,
            shipping_address,
            shipping_city_state,
            customer_gstin,
            customer_city_state,
            customer_phone,

            contact_person,
            contact_person_designation,
            contact_person_number,

            payment_methods: [] as PaymentMethodVM[],

            items,

            // line totals
            sub_total: r0(totals.sub_total),
            discount_value: Number(json.discount_value ?? 0),
            discount_label: json.discount_type === "percent" ? `${json.discount_value}%` : (json.discount_type === "flat" ? "Flat" : ""),
            discount_amount: r0(totals.discount_amount),

            // tax breakdown
            cgst_percent: totals.cgst_percent,
            sgst_percent: totals.sgst_percent,
            igst_percent: totals.igst_percent,
            cgst_amount: r0(totals.cgst_amount),
            sgst_amount: r0(totals.sgst_amount),
            igst_amount: r0(totals.igst_amount),

            // grand totals
            grand_total: r0(totals.grand_total),
            total_amount: r0(totals.grand_total),
            total: r0(totals.grand_total),
            price_inc_tax: String(totals.grand_total),

            amount_in_words: `${this.numberToWords(totals.grand_total)} Only`,

            terms: [
                "75% Advance & 25% immediately after completion of the project.",
                "No additional works will be accepted after closing the deal.",
                "Additional works will be charged extra as per market actual cost.",
                "Natural damages are not considered.",
                "Client's work order / permission is mandatory to proceed further.",
            ],

            is_inter_state: totals.is_inter_state,
            service_type: json.service_type ?? null,
            notes: json.notes ?? null,
        };
    };

    // Simple state normalization method
    private normalizeState(state: string): string {
        if (!state) return "";
        // Just basic normalization - lowercase and trim
        return state.toString().trim().toLowerCase();
    }

    private computeTotalsUnified(ejson: {
        items: Array<{ qty: number; rate: number }>;
        discount_type?: "none" | "percent" | "flat" | string | null;
        discount_value?: number | string | null;
        tax_scheme?: string | number | null;
        gst?: any;
        gst_percent?: any;
        is_inter_state?: boolean | null;
        client?: { state?: string | null } | any;
        shipping_state?: string | null;
    }) {
        const items = Array.isArray(ejson.items) ? ejson.items : [];
        const sub_total = items.reduce((sum, it) => {
            const q = Number(it.qty) || 0;
            const r = Number(it.rate) || 0;
            return sum + q * r;
        }, 0);

        // Use improved discount calculation
        const { discount_amount, taxable_amount: taxable } = this.calculateDiscount({
            sub_total,
            discount_type: ejson.discount_type,
            discount_value: ejson.discount_value,
        });

        // Determine tax percent
        const taxPercent = this.normalizeTaxToPercent(ejson.tax_scheme ?? ejson.gst ?? ejson.gst_percent ?? 0);

        // Determine inter-state using seller state vs shipping state
        const isInterState = this.isInterStateFromJson({
            client: ejson.client,
            shipping_state: ejson.shipping_state,
            is_inter_state: ejson.is_inter_state,
        });

        let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
        let cgst_percent = 0, sgst_percent = 0, igst_percent = 0;

        if (taxPercent > 0) {
            if (isInterState) {
                // Interstate -> IGST full (18%)
                igst_amount = (taxable * taxPercent) / 100;
                igst_percent = taxPercent;
            } else {
                // Intrastate -> split half/half (9% CGST + 9% SGST)
                const halfPercent = taxPercent / 2;
                cgst_amount = (taxable * halfPercent) / 100;
                sgst_amount = (taxable * halfPercent) / 100;
                cgst_percent = halfPercent;
                sgst_percent = halfPercent;
            }
        }

        const grand_total = taxable + cgst_amount + sgst_amount + igst_amount;

        return {
            sub_total,
            discount_amount,
            taxable,
            cgst_amount,
            sgst_amount,
            igst_amount,
            cgst_percent,
            sgst_percent,
            igst_percent,
            tax_percent: taxPercent,
            is_inter_state: isInterState,
            grand_total,
        };
    }

    private async generatePiNumber(): Promise<string> {
        const today = new Date();
        const prefix = 'PI';
        const datePart = today.toISOString().slice(2, 10).replace(/-/g, '');
        const seq = await this.getNextPiSeq();

        return `${prefix}_${datePart}_${String(seq).padStart(4, '0')}`;
    }

    private async getNextPiSeq(): Promise<number> {
        const result = await db.sequelize.query(
            'SELECT nextval(\'pi_no_seq\')',
            { type: db.sequelize.QueryTypes.SELECT }
        );
        return result[0].nextval;
    }

    public update!: (req: Request, res: Response) => Promise<any>;
}


export default new EstimateController();

function formatEstimateResponse(fresh: any) {
    throw new Error("Function not implemented.");
}
