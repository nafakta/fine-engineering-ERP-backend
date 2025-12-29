import { Request, Response } from "express";
import db from "../models";
import puppeteer, { Page } from "puppeteer";
import Handlebars from "handlebars";
import * as fs from "fs/promises";
import path from "node:path";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

async function resolveTemplate(rel: string): Promise<string> {
    const tryPaths = [
        path.resolve(__dirname, "../templates", rel),
        path.resolve(__dirname, "../../templates", rel),
    ];
    for (const p of tryPaths) {
        try {
            await fs.access(p);
            return p;
        } catch {
            continue;
        }
    }
    throw new Error(`Template not found: ${rel}`);
}

// Function to load company logo as base64
const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (best for prod / docker)
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.access(fromEnv);
            return path.resolve(fromEnv);
        } catch { }
    }

    // 2️⃣ Primary location (STANDARD)
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

    // 3️⃣ Fallbacks
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

function registerOnceHelpers() {
    if ((Handlebars as any).__ci_helpers_registered) return;
    (Handlebars as any).__ci_helpers_registered = true;

    Handlebars.registerHelper("formatDate", (d: any) => {
        if (!d) return "";
        const date = new Date(d);
        if (isNaN(date.getTime())) return "";
        // DD/MM/YYYY
        const dd = String(date.getDate()).padStart(2, "0");
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    });

    Handlebars.registerHelper("formatCurrency", (val: any) => {
        const n = Number(val || 0);
        return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
    });

    Handlebars.registerHelper("formatQty", (val: any) => {
        const n = Number(val || 0);
        // show up to 3 decimals if needed
        return Number.isInteger(n) ? String(n) : n.toFixed(3);
    });

    Handlebars.registerHelper("inc", (index: any) => Number(index) + 1);

    Handlebars.registerHelper("add", (a: any, b: any) => Number(a || 0) + Number(b || 0));
}

// Helper to convert a number to words in Indian format
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

// Function to build the bill view model (updated to include state-aware GST split)
async function buildBillVM(billId: string) {
    const bill = await db.OrderBill.findByPk(billId, {
        include: [
            {
                model: db.Vendor,
                as: "vendor", // ✅ CORRECTED: Changed from "vendorRef" to "vendor"
                attributes: ['vendor', 'company', 'address', 'city', 'state', 'email_id', 'gstin', 'mobile'] // ✅ CHANGED: 'mobile_number' to 'mobile'
            },
            {
                model: db.PurchaseOrder,
                as: "purchaseOrder",
                include: [
                    { model: db.SystemUser, as: "creator" },
                    { model: db.OrderItem, as: "items" }
                ]
            },
        ],
    });

    if (!bill) throw new Error("Bill not found");

    // ✅ CORRECTED: Use correct alias "vendor" instead of "vendorRef"
    const vendor = (bill as any).vendor || {};
    const po = (bill as any).purchaseOrder || {};
    const creator =
        po?.creator
            ? (po.creator.name || po.creator.email || "")
            : "";

    const formatPurchaseType = (type: string | null) => {
        if (type === "air_conditioning") return "Air Conditioning";
        if (type === "HVAC") return "HVAC";
        return "N/A";
    };

    const rawItems = Array.isArray(po?.items) ? po.items : [];

    const DEFAULT_GST_PERCENT = Number(process.env.BILL_GST_PERCENT || process.env.DEFAULT_GST_PERCENT || 18);

    const items = rawItems.map((it: any) => {
        const qty = Number(it.quantity || 0);
        const rate = Number(it.rate || 0);
        const lineTotal = Math.round(qty * rate * 100) / 100;
        const gst_percent = (it.gst_percent != null && Number(it.gst_percent) > 0) ? Number(it.gst_percent) : DEFAULT_GST_PERCENT;
        return {
            item: it.item || "",
            description: it.description || "",
            hsn_sac: it.hsn_sac || "",
            make: it.make || "",
            qty,
            unit: it.unit || "",
            rate,
            total: lineTotal,
            gst_percent,
        };
    });

    const subtotal = Math.round(items.reduce((s: number, it: any) => s + Number(it.total || 0), 0) * 100) / 100;
    const discount_value = Number((bill as any).discount_value || 0);
    const taxableBase = Math.round(Math.max(0, subtotal - discount_value) * 100) / 100;

    // prefer DB values if present
    let totalBeforeTax = (bill as any).total_before_tax != null ? Number(bill.total_before_tax) : taxableBase;
    totalBeforeTax = Math.round(totalBeforeTax * 100) / 100;

    const totalTaxStoredRaw = (bill as any).total_tax;
    const totalTaxStored = totalTaxStoredRaw != null ? Number(totalTaxStoredRaw) : 0;

    // FIX: Only apply GST if tax is actually stored in DB (not 0)
    const applyGST = totalTaxStored > 0;

    const gst_percent = Number(process.env.BILL_GST_PERCENT || DEFAULT_GST_PERCENT);
    const computedTax = applyGST ? Math.round((totalBeforeTax * gst_percent / 100) * 100) / 100 : 0;

    // Use stored tax if > 0, otherwise use 0 (no GST)
    const totalTax = totalTaxStored > 0 ? Math.round(totalTaxStored * 100) / 100 : 0;

    const grandStored = (bill as any).total_amount != null ? Number(bill.total_amount) : null;
    const grand = (grandStored != null && grandStored > 0)
        ? Math.round(grandStored * 100) / 100
        : Math.round((totalBeforeTax + totalTax) * 100) / 100;

    const amount_in_words = inWordsIndian(grand);

    // --- STATE CHECK (simple trim + lower-case, NO normalization) ---
    const sellerStateRaw = (vendor.state || "").toString().trim();
    const shippingStateRaw = (po?.shipping_state || "").toString().trim();

    const sellerState = sellerStateRaw.toLowerCase();
    const shippingState = shippingStateRaw.toLowerCase();

    // same_state true only if both present and exactly equal
    const same_state = !!(sellerState && shippingState && sellerState === shippingState);

    // GST breakdown - only if tax > 0
    let cgst_amount = 0;
    let sgst_amount = 0;
    let igst_amount = 0;
    let cgst_percent = 0;
    let sgst_percent = 0;
    let igst_percent = 0;

    if (applyGST && totalTax > 0) {
        if (same_state) {
            const half = Math.round((totalTax / 2) * 100) / 100;
            cgst_amount = half;
            sgst_amount = Math.round((totalTax - cgst_amount) * 100) / 100;
            cgst_percent = gst_percent / 2;
            sgst_percent = gst_percent / 2;
        } else {
            igst_amount = Math.round(totalTax * 100) / 100;
            igst_percent = gst_percent;
        }
    }

    const place_of_supply = shippingStateRaw || sellerStateRaw || "";

    const our_company = {
        legal_name: process.env.COMPANY_LEGAL_NAME || "COMPRESS INDIA AIR CONDITIONING PVT. LTD",
        address_line: process.env.COMPANY_ADDRESS || "Off no.103, 1st Floor, Hi Tech Premises Co-Op.Soc.Ltd, Near SCLR Road, Kurla(W)",
        city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra, India",
        mobile_number: process.env.COMPANY_PHONE || "+91 8655011465",
        email_id: process.env.COMPANY_EMAIL || "sales@compressindia.in",
        website: process.env.COMPANY_WEBSITE || "www.compressindia.com",
        tax_id: process.env.COMPANY_GSTIN || "27AACCX0000Z1Z"
    };

    const logo = await getLogoAsDataURL();

    return {
        doc_title: "Order Bill",
        logo,

        bill_number: (bill as any).bill_number || "",
        bill_date: (bill as any).bill_date || (bill as any).created_at || new Date(),
        payment_status: (bill as any).payment_status || "pending",

        po: {
            po_number: po?.po_number ?? "—",
            creator_name: creator || "—",
            purchase_type: formatPurchaseType(po?.purchase_type || null),
            notes: po?.notes || "",
            site_issue: (po?.site_issue || "").toString().trim() || "",
        },

        vendor: {
            vendor: vendor.vendor || "",
            company: vendor.company || "",
            address: vendor.address || "",
            city: vendor.city || "",
            state: vendor.state || "",
            email_id: vendor.email_id || "",
            gstin: vendor.gstin || "",
            mobile_number: vendor.mobile || "", // ✅ CHANGED: vendor.mobile instead of vendor.mobile_number
        },

        delivery_address: po?.delivery_address || our_company.address_line,
        items,

        totals: {
            subtotal,
            discount: discount_value || 0,
            total_before_tax: totalBeforeTax,
            gst_percent: applyGST ? gst_percent : 0,
            tax: totalTax,
            grand,
            amount_in_words,
            same_state,
            cgst_amount,
            sgst_amount,
            igst_amount,
            cgst_percent,
            sgst_percent,
            igst_percent,
            place_of_supply,
            applyGST,
        },

        sub_total: subtotal,
        discount_value,
        gst_amount: totalTax,
        grand_total: grand,
        total_amount: grand,

        default_gst_percent: DEFAULT_GST_PERCENT,
        applyGST,

        our_company,
        place_of_supply,
    };
}

// PDF rendering function
async function renderBillPdfBuffer(billId: string): Promise<Buffer> {
    registerOnceHelpers();

    const vm = await buildBillVM(billId);
    const tplPath = await resolveTemplate("orderBill.hbs");
    const tplHtml = await fs.readFile(tplPath, "utf8");
    const html = Handlebars.compile(tplHtml)(vm);

    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page: Page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" } });
    await browser.close();

    return Buffer.from(pdfBuffer);
}

// API endpoint to print the bill PDF
export const printBillPdf = async (req: Request, res: Response) => {
    try {
        const billId = String(req.params.id || "").trim();
        if (!billId) return res.status(400).send("Bill ID is required");
        const pdfBuffer = await renderBillPdfBuffer(billId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="Bill-${billId}.pdf"`);
        res.send(pdfBuffer);
    } catch (err: any) {
        console.error("Error generating bill PDF:", err);
        res.status(500).send(`Failed to generate PDF: ${err.message || err}`);
    }
};

// API to list all Bills
export const listBills = async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
        const pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize || "10"), 10)));

        const where: any = {};
        const vendor_id = (req.query.vendor_id as string | undefined)?.trim();
        if (vendor_id) where.vendor_id = vendor_id;

        const { rows, count } = await db.OrderBill.findAndCountAll({
            where,
            limit: pageSize,
            offset: (page - 1) * pageSize,
            order: [["created_at", "DESC"]],
            attributes: [
                "id", "bill_number", "bill_date", "total_before_tax", "total_tax", "total_amount", "payment_status",
                "notes", "created_at", "updated_at", "created_by", "vendor_id", "po_id", "is_payment"
            ],
            include: [
                {
                    model: db.Vendor,
                    as: "vendor",
                    attributes: ["id", "company", "vendor", "mobile", "email_id", "gstin"], // ✅ CHANGED: 'mobile_number' to 'mobile'
                },
                {
                    model: db.SystemUser,
                    as: "createdBy",
                    attributes: ["id", "name", "email"],
                },
                {
                    model: db.PurchaseOrder,
                    as: "purchaseOrder",
                    attributes: ["id", "po_number", "status", "notes", "created_at", "updated_at", "created_by", "vendor_id"],
                    include: [
                        {
                            model: db.SystemUser,
                            as: "creator",
                            attributes: ["id", "name", "email"],
                        },
                        {
                            model: db.OrderItem,
                            as: "items",
                            attributes: ["id", "item", "description", "make", "unit", "hsn_sac", "quantity", "rate"],
                            separate: true,
                        },
                    ],
                },
            ],
            distinct: true,
        });

        const formatted = rows.map((bill: any) => ({
            ...bill.toJSON(),
            payment_message:
                bill.is_payment === true
                    ? "✅ Payment Completed"
                    : "❌ Pending Payment",
        }));

        return res.json({
            data: {
                data: formatted,
                pagination: {
                    page,
                    pageSize,
                    totalDocs: count,
                    totalPages: Math.ceil(count / pageSize),
                },
            },
        });
    } catch (err: any) {
        console.error("listBills error:", err);
        return res.status(500).json({
            message: "Failed to fetch bills",
            error: err?.message || String(err),
        });
    }
};

// Create Vendor Payment
export const createVendorPayment = async (req: AuthenticatedRequest, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            bill_id,
            vendor_id,
            payment_date,
            bill_amount,
            paid_by,
            place_of_supply,
            payment_mode,
            payment_in,
            notes,
            account_id,
            created_by,
        } = req.body;

        if (!bill_id || !vendor_id || !paid_by || !place_of_supply || !payment_mode || !payment_in) {
            await t.rollback();
            return res.status(400).json({
                message: "bill_id, vendor_id, paid_by, place_of_supply, payment_mode, payment_in are required",
            });
        }

        /** Step 1: Fetch bill */
        const bill = await db.OrderBill.findByPk(bill_id, {
            attributes: ["id", "total_amount", "is_payment"],
            transaction: t,
        });

        if (!bill) {
            await t.rollback();
            return res.status(404).json({ message: "Order bill not found" });
        }

        /** Step 2: Prevent duplicate payment */
        if (bill.is_payment === true) {
            await t.rollback();
            return res.status(400).json({ message: "Payment already done for this bill" });
        }

        /** Step 3: Resolve bill amount if not provided */
        const finalBillAmount = bill_amount ?? bill.total_amount;

        /** Step 4: Insert vendor payment */
        const payment = await db.VendorBillPayment.create(
            {
                bill_id,
                vendor_id,
                payment_date: payment_date ? new Date(payment_date) : new Date(),
                bill_amount: finalBillAmount,
                remaining_amount: finalBillAmount,
                paid_amount: 0,
                paid_by,
                place_of_supply,
                payment_mode,
                payment_in,
                notes,
                created_by: created_by ?? null,
                account_id: account_id ?? null,
            },
            { transaction: t, returning: true }
        );

        /** Step 5: Mark bill as paid-init */
        await db.OrderBill.update(
            { is_payment: true },
            { where: { id: bill_id }, transaction: t }
        );

        await t.commit();

        return res.status(201).json({
            message: "Vendor payment recorded successfully",
            data: payment,
        });

    } catch (err: any) {
        await t.rollback();
        return res.status(500).json({
            message: "Failed to insert vendor payment",
            error: err?.message || String(err),
        });
    }
};