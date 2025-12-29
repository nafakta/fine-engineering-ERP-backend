// src/controllers/piController.ts
import { Request, Response } from "express";
import { literal } from "sequelize";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import puppeteer, { Page, Browser } from "puppeteer";

// Handlebars helpers (UNCHANGED)
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim(); return s.length ? v : fb;
});
Handlebars.registerHelper("json", (v: any) => JSON.stringify(v, null, 2));
Handlebars.registerHelper("formatINR", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});
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

// Add this helper along with your existing helpers
Handlebars.registerHelper("calculateTotal", function (sub_total, discount_amount) {
    const subtotal = Number(sub_total || 0);
    const discount = Number(discount_amount || 0);
    const total = Math.max(subtotal - discount, 0);
    return total;
});

// Or if you want formatted output directly:
Handlebars.registerHelper("formatTotal", function (sub_total, discount_amount) {
    const subtotal = Number(sub_total || 0);
    const discount = Number(discount_amount || 0);
    const total = Math.max(subtotal - discount, 0);

    // Reuse your existing formatINR helper or format directly
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    }).format(total);
});

// Template path resolution (UNCHANGED)
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

const TEMPLATE_PATH_PROMISE = resolveTemplateFile("pi_alt.hbs");

const resolveLogoPath = async (): Promise<string> => {
    if (process.env.COMPANY_LOGO_PATH) {
        try {
            const p = path.resolve(process.env.COMPANY_LOGO_PATH);
            await fs.access(p);
            return p;
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

const FALLBACK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// ID picking helpers
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sanitizeUuid = (raw: unknown) => {
    let s = String(raw ?? "");
    s = s.replace(/^:+/, "").replace(/^"+|"+$/g, "").trim();
    s = s.replace(/[\u0000-\u001F\u007F]/g, "");
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
    return s.replace(/\/+$/, "");
};

// GST CALCULATION LOGIC
const normalizeTaxToPercent = (raw: any): number => {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw).trim().toLowerCase();
    if (!s) return 0;
    if (/no\s*tax|none|^0(\.0+)?%?$/.test(s)) return 0;
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const isInterStateFromJson = (ejson: {
    client?: { state?: string | null } | any;
    shipping_state?: string | null;
    is_inter_state?: boolean | null;
}): boolean => {
    const norm = (s?: string | null) => (s ?? "").toString().trim().toLowerCase();
    const clientState = norm(ejson?.client?.state);
    const shippingState = norm(ejson.shipping_state);

    if (clientState && shippingState) {
        return clientState !== shippingState;
    }

    if (ejson?.is_inter_state !== undefined && ejson?.is_inter_state !== null) {
        return Boolean(ejson.is_inter_state);
    }

    return false;
};

const computeTotalsWithStateBasedGST = (params: {
    items: Array<{ qty: number; rate: number }>;
    discount_type?: "none" | "percent" | "flat" | string | null;
    discount_value?: number | string | null;
    tax_percent: number;
    is_inter_state: boolean;
}) => {
    const items = Array.isArray(params.items) ? params.items : [];
    const sub_total = items.reduce((sum, it) => {
        const q = Number(it.qty) || 0;
        const r = Number(it.rate) || 0;
        return sum + (q * r);
    }, 0);

    let discount_amount = 0;
    const dtype = String(params.discount_type ?? "none").toLowerCase().trim();
    const dval = Number(params.discount_value ?? 0) || 0;

    switch (dtype) {
        case "percent":
            if (dval > 0 && dval <= 100) {
                discount_amount = (sub_total * dval) / 100;
            } else if (dval > 100) {
                discount_amount = sub_total;
            }
            break;
        case "flat":
            if (dval > 0) {
                discount_amount = Math.min(dval, sub_total);
            }
            break;
    }

    const taxable = Math.max(0, sub_total - discount_amount);
    const taxPercent = Number(params.tax_percent) || 0;
    const isInterState = Boolean(params.is_inter_state);

    let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
    let cgst_percent = 0, sgst_percent = 0, igst_percent = 0;

    if (taxPercent > 0) {
        if (isInterState) {
            igst_percent = taxPercent;
            igst_amount = (taxable * taxPercent) / 100;
        } else {
            const halfPercent = taxPercent / 2;
            cgst_percent = halfPercent;
            sgst_percent = halfPercent;
            cgst_amount = (taxable * halfPercent) / 100;
            sgst_amount = (taxable * halfPercent) / 100;
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
};

function mapPiItems(rows: any[] = []) {
    return rows.map((it) => {
        const qty = Number(it.quantity ?? 0);
        const rate = Number(it.rate ?? 0);
        const line_total = Number(it.line_total ?? qty * rate);
        return {
            name: safeText(it.item_name, ""),
            item_name: safeText(it.item_name, ""),
            description: safeText(it.description, "-"),
            make: safeText(it.make, ""),
            hsn_sac: safeText(it.hsn_sac, "-"),
            unit: safeText(it.unit, "NOS"),
            qty,
            rate,
            total: line_total,
            line_total,
            gst_percent: it.gst_percent != null ? Number(it.gst_percent) : 0,
        };
    });
}

function safeText(v: any, fallback = "") {
    const s = String(v ?? "").trim();
    return s.length ? s : fallback;
}

function numberToWords(amount: number): string {
    if (amount == null || !isFinite(amount)) return "Zero Rupees";
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
    const hundredToOne = n;

    if (crore) parts.push(threeDigits(crore) + " Crore");
    if (lakh) parts.push(threeDigits(lakh) + " Lakh");
    if (thousand) parts.push(threeDigits(thousand) + " Thousand");
    if (hundredToOne) parts.push(threeDigits(hundredToOne));

    return (parts.join(" ") + " " + (rupees === 1 ? "Rupee" : "Rupees")).trim();
}

// ✅ CRITICAL FIX: Use RAW SQL queries to bypass association issues
async function buildPiVM(id: string) {
    console.log(`🔍 Building PI VM for ID: ${id}`);

    try {
        // 1. Fetch PI data with raw SQL to avoid association errors
        const piQuery = `
            SELECT 
                p.id,
                p.pi_no,
                p.tax_scheme,
                p.discount_type,
                p.discount_value,
                p.tax_date,
                p.created_at,
                p.price_inc_tax,
                p.tax_amount,
                p.is_inter_state,
                p.notes,
                p.client_id,
                p.estimate_id,
                p.creation_date,
                p.created_by,
                p.amount,
                p.amc_contract_id
            FROM pi p
            WHERE p.id = $1
        `;

        const [piData] = await db.sequelize.query(piQuery, {
            bind: [id],
            type: db.sequelize.QueryTypes.SELECT
        });

        if (!piData) {
            throw new Error(`PI with ID ${id} not found in database`);
        }

        const j: any = piData;
        console.log(`📊 PI found: ${j.pi_no}, Client ID: ${j.client_id}`);

        // 2. Fetch client data separately
        if (!j.client_id) {
            throw new Error(`PI ${id} has no client_id field`);
        }

        const clientQuery = `
            SELECT 
                c.id,
                c.department,
                c.company,
                c.client,
                c.mobile,
                c.email_id,
                c.city,
                c.state,
                c.pin_code,
                c.gstn,
                c.address,
                c.shipping_city,
                c.shipping_state,
                c.shipping_pincode,
                c.shipping_address,
                c.contact_person,
                c.designation,
                c.client_designation,
                c.contact_person_number
            FROM clients c
            WHERE c.id = $1
        `;

        const [clientData] = await db.sequelize.query(clientQuery, {
            bind: [j.client_id],
            type: db.sequelize.QueryTypes.SELECT
        });

        if (!clientData) {
            console.log(`❌ Client ${j.client_id} not found in database`);
            throw new Error(`Client ${j.client_id} not found for PI ${id}`);
        }

        j.client = clientData;
        console.log(`✅ Client fetched successfully: ${j.client.company}`);

        // 3. Fetch PI items
        const itemsQuery = `
            SELECT 
                id,
                item_name,
                description,
                make,
                quantity,
                rate,
                hsn_sac,
                gst_percent,
                line_total,
                unit
            FROM pi_items
            WHERE pi_id = $1
            ORDER BY created_at
        `;

        const items = await db.sequelize.query(itemsQuery, {
            bind: [id],
            type: db.sequelize.QueryTypes.SELECT
        });

        j.items = items || [];
        console.log(`✅ Fetched ${j.items.length} PI items`);

        // 4. Fetch estimate data if exists
        if (j.estimate_id) {
            const estimateQuery = `
                SELECT 
                    id,
                    shipping_state,
                    service_type,
                    notes
                FROM estimates
                WHERE id = $1
            `;

            const [estimateData] = await db.sequelize.query(estimateQuery, {
                bind: [j.estimate_id],
                type: db.sequelize.QueryTypes.SELECT
            });

            j.estimate = estimateData || null;
            if (estimateData) {
                console.log(`✅ Estimate fetched: ${estimateData.id}`);
            }
        } else {
            j.estimate = null;
        }

        console.log('📋 PI Data:', {
            pi_no: j.pi_no,
            client_state: j.client?.state,
            estimate_shipping_state: j.estimate?.shipping_state,
            items_count: j.items?.length || 0
        });

        // Determine inter-state status
        const clientState = String(j.client?.state || "").trim();
        const shippingState = String(j.estimate?.shipping_state || "").trim();
        let isInterState = Boolean(j.is_inter_state);

        if (clientState && shippingState) {
            isInterState = clientState.toLowerCase() !== shippingState.toLowerCase();
            console.log(`🌍 State comparison: ${clientState} vs ${shippingState} = ${isInterState ? 'Inter-state' : 'Intra-state'}`);
        } else {
            console.log(`⚠️ Using PI's is_inter_state flag: ${isInterState}`);
        }

        const service_type = j.estimate?.service_type || null;
        const notes = j.notes || j.estimate?.notes || null;
        const headerTaxPercent = normalizeTaxToPercent(j.tax_scheme ?? j.gst_percent ?? 0);

        // Calculate totals
        const totals = computeTotalsWithStateBasedGST({
            items: (j.items || []).map((it: any) => ({
                qty: Number(it.quantity ?? 0),
                rate: Number(it.rate ?? 0),
            })),
            discount_type: j.discount_type,
            discount_value: j.discount_value,
            tax_percent: headerTaxPercent,
            is_inter_state: isInterState,
        });

        console.log('💰 PI Totals:', {
            sub_total: totals.sub_total,
            discount: totals.discount_amount,
            taxable: totals.taxable,
            cgst: totals.cgst_amount,
            sgst: totals.sgst_amount,
            igst: totals.igst_amount,
            grand_total: totals.grand_total
        });

        const piItems = mapPiItems(j.items || []);
        const logoDataUrl = await getLogoAsDataURL();

        const r0 = (n: number) => Math.round(Number(n) || 0);

        // Company info
        const our_company = {
            name: process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.",
            legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PVT. LTD.",
            tax_id: process.env.COMPANY_GSTIN || "",
            address_line: process.env.COMPANY_ADDR || "",
            city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
            mobile_number: process.env.COMPANY_MOBILE_NUMBER || "7208219016 / 9920 5299 61",
            email_id: process.env.COMPANY_EMAIL || "info@compressindia.com / accounts@compressindia.in",
            website: process.env.COMPANY_WEBSITE || "www.compressindia.com",
        };

        // Customer info (with null checks)
        const c = j.client || {};
        const customer = {
            company: safeText(c.company, "Unknown Company"),
            name: safeText(c.client, "Unknown Client"),
            department: safeText(c.department),
            subject: safeText(c.subject),
            billing: {
                address: safeText(c.address),
                city: safeText(c.city),
                state: safeText(c.state),
                pin_code: safeText(c.pin_code),
                city_state_pin: [safeText(c.city), safeText(c.state), safeText(c.pin_code)]
                    .filter(Boolean)
                    .join(", "),
                gstin: safeText(c.gstn),
            },
            shipping: {
                address: safeText(c.shipping_address),
                city: safeText(c.shipping_city),
                state: safeText(c.shipping_state),
                pin_code: safeText(c.shipping_pincode),
                city_state_pin: [safeText(c.shipping_city), safeText(c.shipping_state), safeText(c.shipping_pincode)]
                    .filter(Boolean)
                    .join(", "),
            },
            contact: {
                person: safeText(c.contact_person),
                person_designation: safeText(c.designation || c.client_designation),
                phone: safeText(c.contact_person_number || c.mobile),
                email: safeText(c.email_id),
            },
        };

        // Build view model
        const vm = {
            doc_title: "Proforma Invoice",
            doc_label: "Invoice Number",
            logo: logoDataUrl,
            invoice_number: j.pi_no || j.id,
            invoice_date: new Date(j.tax_date || j.created_at).toLocaleDateString("en-IN"),
            due_date: "",
            our_company,
            customer,
            items: piItems,
            sub_total: r0(totals.sub_total),
            discount_value: j.discount_value != null ? Number(j.discount_value) : 0,
            discount_label: j.discount_type === "percent" ? `${j.discount_value}%` : (j.discount_type === "flat" ? "Flat" : ""),
            discount_amount: r0(totals.discount_amount),
            cgst_percent: totals.cgst_percent,
            sgst_percent: totals.sgst_percent,
            igst_percent: totals.igst_percent,
            cgst_amount: r0(totals.cgst_amount),
            sgst_amount: r0(totals.sgst_amount),
            igst_amount: r0(totals.igst_amount),
            grand_total: r0(totals.grand_total),
            total_amount: r0(totals.grand_total),
            total: r0(totals.grand_total),
            price_inc_tax: String(totals.grand_total),
            service_type: service_type,
            notes: notes,
            amount_in_words: `${numberToWords(totals.grand_total)} Only`,
            terms: [
                "75% Advance & 25% immediately after completion of the project.",
                "No additional works will be accepted after closing the deal.",
                "Additional works will be charged extra as per market actual cost.",
                "Natural damages are not considered.",
                "Client's work order / permission is mandatory to proceed further.",
            ],
            is_inter_state: totals.is_inter_state,
            reference: "",
            pi_no: j.pi_no,
            contact_person: customer.contact.person,
            customer_phone: customer.contact.phone,
            customer_email: customer.contact.email,
            customer_name: customer.name,
            customer_company: customer.company,
            customer_address: customer.billing.address,
            customer_gstin: customer.billing.gstin,
            shipping_address: customer.shipping.address,
            shipping_company: customer.company,
            terms_label: "DUE ON RECEIPT",
            bank: {
                account_name: "COMPRESS INDIA AIR CONDITIONING PVT. LTD",
                account_no: "50200081751743",
                bank_name: "HDFC BANK LIMITED",
                ifsc: "HDFC0007811",
                branch_addr: "NEELKANTH IT PARK, VIDYAVIHAR, MUMBAI - 400071"
            }
        };

        return vm;
    } catch (error) {
        console.error(`❌ Error building PI VM for ${id}:`, error);
        throw error;
    }
}

// HTML rendering
export const printPiHtml = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid(req.params.id);
        if (!id) {
            return res.status(400).type("text/plain").send("Invalid or missing PI id");
        }

        console.log(`🖨️ Rendering HTML for PI: ${id}`);
        const vm = await buildPiVM(id);
        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        console.error(`❌ HTML render error:`, err);
        const status = err.message.includes("not found") ? 404 : 500;
        return res.status(status).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
};

// PDF rendering
async function renderPiPdfBuffer(id: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
        const vm = await buildPiVM(id);
        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);

        const executablePath =
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            process.env.CHROME_EXECUTABLE_PATH ||
            (process.platform === "win32"
                ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                : process.platform === "darwin"
                    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                    : "/usr/bin/chromium-browser");

        const explicitPathProvided = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH);
        if (explicitPathProvided) {
            try {
                await fs.access(executablePath as string);
            } catch (ex) {
                throw new Error(
                    `Chrome/Chromium executable not found at path: ${executablePath}. ` +
                    `Set PUPPETEER_EXECUTABLE_PATH or CHROME_EXECUTABLE_PATH to a valid binary.`
                );
            }
        }

        const launchArgs = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--single-process",
            "--no-zygote",
            "--disable-gpu",
            "--font-render-hinting=none",
        ];

        browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath,
            args: launchArgs,
        });

        const page: Page = await browser.newPage();
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(60000);
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
        await page.emulateMediaType("screen");

        const pdfU8 = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
            preferCSSPageSize: true,
        });

        const pdfBuffer = Buffer.from(pdfU8);
        if (!pdfBuffer || pdfBuffer.length < 1000) {
            try {
                await fs.writeFile(path.resolve(process.cwd(), "pi-debug.html"), html);
                console.warn("PDF generation produced a very small buffer — debug HTML written to pi-debug.html");
            } catch { }
            throw new Error("Payment slip PDF generation failed (empty or too small buffer). Check pi-debug.html");
        }

        return pdfBuffer;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to render PI PDF: ${msg}`);
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore close errors
        }
    }
}

export const printPiPdf = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid(req.params.id);
        if (!id) {
            return res.status(400).type("text/plain").send("Invalid or missing PI id");
        }

        console.log(`📄 Rendering PDF for PI: ${id}`);
        const pdfBuffer = await renderPiPdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `PI-${id}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);

        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error(`❌ PDF render error:`, err);
        const status = err.message.includes("not found") ? 404 : 500;
        return res.status(status).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
    }
};

// ✅ FIXED: List PIs function with proper parameter binding
export const listPi = async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 20);
        const offset = (page - 1) * limit;
        const q = req.query.q ? String(req.query.q).trim() : "";

        console.log("📋 List PI Request:", { page, limit, offset, q });

        // Build WHERE clause with proper parameter indexing
        let whereClause = "";
        let whereParams: any[] = [];
        let paramIndex = 1;

        if (q) {
            whereClause = `WHERE p.pi_no ILIKE $${paramIndex}`;
            whereParams.push(`%${q}%`);
            paramIndex++;
        }

        // Main query with proper parameter binding
        const query = `
            SELECT 
                p.id,
                p.pi_no,
                p.creation_date,
                p.tax_date,
                p.price_inc_tax,
                p.tax_amount,
                p.notes,
                p.payment_status,
                p.payment_date,
                p.tax_scheme,
                p.discount_type,
                p.discount_value,
                p.is_inter_state,
                p.created_at,
                p.updated_at,
                p.client_id,
                p.iscreated,
                p.created_by,
                p.amount,
                p.amc_contract_id,
                p.estimate_id,
                c.id as client_id_full,
                c.company as client_company,
                c.client as client_name,
                u.name as created_by_name,
                u.email as created_by_email
            FROM pi p
            LEFT JOIN clients c ON p.client_id = c.id
            LEFT JOIN system_users u ON p.created_by = u.id
            ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        // Add limit and offset to parameters
        whereParams.push(limit, offset);

        // Count query
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM pi p
            ${whereClause}
        `;

        console.log("📝 Query:", query);
        console.log("📝 Params:", whereParams);

        // Execute queries with proper parameter binding
        const rows = await db.sequelize.query(query, {
            bind: whereParams,
            type: db.sequelize.QueryTypes.SELECT
        });

        const countResult = await db.sequelize.query(countQuery, {
            bind: whereParams.slice(0, whereParams.length - 2), // Remove limit and offset for count
            type: db.sequelize.QueryTypes.SELECT
        });

        console.log("📊 Rows found:", rows?.length || 0);
        const total = countResult[0]?.total || 0;

        // Format response
        const formattedRows = Array.isArray(rows) ? rows.map((row: any) => ({
            id: row.id,
            pi_no: row.pi_no,
            creation_date: row.creation_date,
            tax_date: row.tax_date,
            price_inc_tax: row.price_inc_tax,
            tax_amount: row.tax_amount,
            notes: row.notes,
            payment_status: row.payment_status,
            payment_date: row.payment_date,
            tax_scheme: row.tax_scheme,
            discount_type: row.discount_type,
            discount_value: row.discount_value,
            is_inter_state: row.is_inter_state,
            created_at: row.created_at,
            updated_at: row.updated_at,
            client_id: row.client_id,
            iscreated: row.iscreated,
            created_by: row.created_by_name || row.created_by,
            amount: row.amount,
            amc_contract_id: row.amc_contract_id,
            estimate_id: row.estimate_id,
            client: row.client_id_full ? {
                id: row.client_id_full,
                company: row.client_company,
                client: row.client_name
            } : null,
            created_by_email: row.created_by_email
        })) : [];

        return res.status(200).json({
            success: true,
            data: formattedRows,
            pagination: {
                total: parseInt(total),
                totalPages: Math.ceil(parseInt(total) / limit),
                currentPage: page,
                itemsPerPage: limit,
            },
        });
    } catch (err: any) {
        console.error("❌ PI list error:", {
            message: err.message,
            stack: err.stack,
            code: err.parent?.code,
            detail: err.parent?.detail,
            sql: err.parent?.sql,
            parameters: err.parent?.parameters
        });
        return res.status(500).json({
            success: false,
            message: "Failed to fetch PIs",
            error: err?.message || String(err)
        });
    }
};

// ✅ FIXED: Create Invoice from PI function with proper error handling
export const createInvoiceFromPi = async (req: AuthenticatedRequest, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const { pi_id } = req.body as { pi_id?: string };

        if (!pi_id) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "pi_id is required"
            });
        }

        console.log(`🔄 Creating invoice from PI: ${pi_id}`);

        // Use raw SQL to fetch PI data to avoid association issues
        const piQuery = `
            SELECT 
                p.*,
                c.*,
                e.shipping_state as estimate_shipping_state,
                e.service_type,
                e.notes as estimate_notes,
                u.name as created_by_name,
                u.email as created_by_email
            FROM pi p
            LEFT JOIN clients c ON p.client_id = c.id
            LEFT JOIN estimates e ON p.estimate_id = e.id
            LEFT JOIN system_users u ON p.created_by = u.id
            WHERE p.id = $1
        `;

        const [piData] = await db.sequelize.query(piQuery, {
            bind: [pi_id],
            type: db.sequelize.QueryTypes.SELECT,
            transaction: t
        });

        if (!piData) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                message: "PI not found"
            });
        }

        console.log(`📋 PI Data:`, {
            pi_no: piData.pi_no,
            client_id: piData.client_id,
            client_company: piData.company,
            items_count: 0 // We'll fetch items separately
        });

        // Check if client exists
        if (!piData.client_id) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `PI ${pi_id} is not associated with any client`
            });
        }

        // Fetch PI items
        const itemsQuery = `
            SELECT 
                id,
                item_name,
                description,
                make,
                quantity,
                rate,
                hsn_sac,
                gst_percent,
                line_total,
                unit
            FROM pi_items
            WHERE pi_id = $1
        `;

        const items = await db.sequelize.query(itemsQuery, {
            bind: [pi_id],
            type: db.sequelize.QueryTypes.SELECT,
            transaction: t
        });

        console.log(`🛒 Found ${items.length} PI items`);

        // Check if invoice already exists
        const existingInvoice = await db.Invoice.findOne({
            where: { pi_id },
            transaction: t
        });

        if (existingInvoice) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: "Invoice already exists for this PI",
                invoice_id: existingInvoice.id
            });
        }

        const now = new Date();
        const authUserId: string | null = req.user?.userId ?? null;
        let invoiceCreatedBy: string | null = piData.created_by ?? authUserId ?? null;
        let invoiceCreatedByName: string | null = piData.created_by_name ?? null;

        // Calculate amounts (round to whole numbers)
        const roundToWhole = (value: any): number => {
            const num = Number(value ?? 0);
            return Math.round(num);
        };

        const priceIncTaxRounded = roundToWhole(piData.price_inc_tax);
        const taxAmountRounded = roundToWhole(piData.tax_amount);
        const amountRounded = priceIncTaxRounded - taxAmountRounded;

        console.log('💰 Amount Calculation:', {
            price_inc_tax: piData.price_inc_tax,
            rounded_price_inc_tax: priceIncTaxRounded,
            tax_amount: piData.tax_amount,
            rounded_tax_amount: taxAmountRounded,
            calculated_amount: amountRounded
        });

        // Generate invoice ID
        const invoiceId = uuidv4();

        // Build invoice payload
        const invoicePayload = {
            id: invoiceId,
            estimate_id: piData.estimate_id ?? null,
            client_id: piData.client_id,
            pi_id,
            creation_date: piData.creation_date ? new Date(piData.creation_date) : now,
            tax_date: piData.tax_date ? new Date(piData.tax_date) : now,
            created_by: invoiceCreatedBy,
            created_by_name: invoiceCreatedByName,
            amount: amountRounded,
            price_inc_tax: priceIncTaxRounded,
            tax_amount: taxAmountRounded,
            remaining_amount: priceIncTaxRounded,
            paid_amount: 0,
            notes: piData.notes || piData.estimate_notes || null,
            payment_status: false,
            payment_date: null,
            tax_scheme: piData.tax_scheme || null,
            discount_type: piData.discount_type || null,
            discount_value: piData.discount_value != null ? roundToWhole(piData.discount_value) : null,
            is_inter_state: Boolean(piData.is_inter_state),
            created_at: now,
            updated_at: now,
        };

        console.log('📄 Invoice Payload:', invoicePayload);

        // Create invoice
        const createdInv = await db.Invoice.create(invoicePayload, {
            transaction: t
        });

        // Create invoice items
        const invoiceItems = Array.isArray(items) ? items.map((it: any, index: number) => {
            const roundedQuantity = Number(it.quantity ?? 0);
            const roundedRate = roundToWhole(it.rate);
            const roundedGstPercent = it.gst_percent != null ? roundToWhole(it.gst_percent) : 0;

            // Handle item name and description
            const itemName = String(it.item_name || "Unnamed Item");
            const itemDescription = String(it.description || "No description");

            console.log(`  Item ${index}:`, {
                name: itemName,
                description: itemDescription,
                quantity: roundedQuantity,
                rate: roundedRate,
                gst: roundedGstPercent
            });

            return {
                id: uuidv4(),
                invoice_id: createdInv.id,
                item_name: itemName,
                description: itemDescription,
                make: it.make != null ? String(it.make) : null,
                quantity: roundedQuantity,
                rate: roundedRate,
                unit: String(it.unit || "NOS"),
                hsn_sac: it.hsn_sac ?? null,
                gst_percent: roundedGstPercent,
                created_at: now,
                updated_at: now,
            };
        }) : [];

        if (invoiceItems.length > 0) {
            console.log(`📦 Creating ${invoiceItems.length} invoice items`);
            await db.InvoiceItem.bulkCreate(invoiceItems, {
                transaction: t
            });
        } else {
            console.warn('⚠️ No items found in PI to convert to invoice');
        }

        // Update PI status
        const [updatedRows] = await db.Pi.update(
            {
                iscreated: true,
                updated_at: now
            },
            {
                where: { id: pi_id },
                transaction: t
            }
        );

        if (updatedRows === 0) {
            console.warn(`⚠️ PI ${pi_id} update might have failed`);
        }

        await t.commit();

        console.log(`✅ Invoice created successfully: ${invoiceId}`);

        // Fetch the complete invoice with items using raw SQL
        const invoiceQuery = `
            SELECT 
                i.*,
                json_agg(
                    json_build_object(
                        'id', ii.id,
                        'item_name', ii.item_name,
                        'description', ii.description,
                        'quantity', ii.quantity,
                        'rate', ii.rate,
                        'unit', ii.unit,
                        'hsn_sac', ii.hsn_sac
                    )
                ) as items
            FROM invoices i
            LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
            WHERE i.id = $1
            GROUP BY i.id
        `;

        const [freshInvoice] = await db.sequelize.query(invoiceQuery, {
            bind: [createdInv.id],
            type: db.sequelize.QueryTypes.SELECT
        });

        return res.status(201).json({
            success: true,
            message: "Invoice created successfully from PI",
            data: {
                invoice_id: createdInv.id,
                pi_id: pi_id,
                invoice_no: createdInv.invoice_no,
                created_by: createdInv.created_by,
                created_by_name: createdInv.created_by_name,
                amount: createdInv.amount,
                price_inc_tax: createdInv.price_inc_tax,
                tax_amount: createdInv.tax_amount,
                remaining_amount: createdInv.remaining_amount,
                item_count: invoiceItems.length,
                invoice: freshInvoice || createdInv
            },
        });

    } catch (err: unknown) {
        if (t && t.finished !== "commit") {
            await t.rollback();
        }

        console.error("❌ Error creating invoice from PI:", err);
        const msg = err instanceof Error ? err.message : "Unknown error";

        return res.status(500).json({
            success: false,
            message: "Error creating invoice from PI",
            error: msg,
            pi_id: req.body.pi_id
        });
    }
};

// Search PI
const normalizeSearch = (s: string) => s.trim().replace(/\s+/g, " ");

export const searchPiByCompanyExact = async (req: Request, res: Response) => {
    try {
        const raw = String(req.query.q || "").trim();
        if (!raw) {
            return res.status(400).json({
                success: false,
                message: "Query 'q' is required"
            });
        }

        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        const offset = (page - 1) * limit;

        const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        let q = normalizeSearch(raw);
        const isUuid = UUID_RX.test(q);
        const piPrefix = /^pi:\s*/i;
        const forcePiExact = piPrefix.test(q);
        if (forcePiExact) q = q.replace(piPrefix, "");

        // Build WHERE clause with proper parameter indexing
        let whereClause = "";
        let whereParams: any[] = [];
        let paramIndex = 1;

        if (isUuid) {
            whereClause = `WHERE p.id = $${paramIndex}`;
            whereParams.push(q);
            paramIndex++;
        } else if (forcePiExact) {
            whereClause = `WHERE p.pi_no ILIKE $${paramIndex}`;
            whereParams.push(q);
            paramIndex++;
        } else {
            whereClause = `WHERE p.pi_no ILIKE $${paramIndex} OR c.company ILIKE $${paramIndex} OR c.client ILIKE $${paramIndex}`;
            whereParams.push(`%${q}%`);
            paramIndex++;
        }

        // Main query
        const query = `
            SELECT 
                p.id,
                p.pi_no,
                p.creation_date,
                p.tax_date,
                p.price_inc_tax,
                p.tax_amount,
                p.client_id,
                p.created_by,
                c.company as client_company,
                c.client as client_name,
                u.name as created_by_name,
                u.email as created_by_email
            FROM pi p
            LEFT JOIN clients c ON p.client_id = c.id
            LEFT JOIN system_users u ON p.created_by = u.id
            ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        // Add limit and offset to parameters
        whereParams.push(limit, offset);

        // Count query
        const countQuery = `
            SELECT COUNT(*) as total
            FROM pi p
            LEFT JOIN clients c ON p.client_id = c.id
            ${whereClause}
        `;

        const rows = await db.sequelize.query(query, {
            bind: whereParams,
            type: db.sequelize.QueryTypes.SELECT
        });

        const countResult = await db.sequelize.query(countQuery, {
            bind: whereParams.slice(0, whereParams.length - 2), // Remove limit and offset for count
            type: db.sequelize.QueryTypes.SELECT
        });

        const total = countResult[0]?.total || 0;

        return res.status(200).json({
            success: true,
            total: parseInt(total),
            totalPages: Math.ceil(parseInt(total) / limit),
            currentPage: page,
            data: Array.isArray(rows) ? rows.map((r: any) => ({
                id: r.id,
                pi_no: r.pi_no,
                creation_date: r.creation_date,
                tax_date: r.tax_date,
                price_inc_tax: r.price_inc_tax,
                tax_amount: r.tax_amount,
                client: r.client_id ? {
                    company: r.client_company,
                    client: r.client_name
                } : null,
                created_by: r.created_by_name || null,
                created_by_email: r.created_by_email || null,
            })) : [],
        });
    } catch (err: any) {
        console.error("PI search error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to search PIs",
            error: err?.message || String(err)
        });
    }
};

// Number to words in Indian format
function inWordsIndian(num: number): string {
    const wholeNumber = Math.round(num);

    const units: string[] = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    ];
    const tens: string[] = [
        "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Sixty", "Seventy", "Eighty", "Ninety"
    ];
    const thousands: string[] = [
        "", "Thousand", "Lakh", "Crore"
    ];

    if (wholeNumber === 0) return "Zero";

    let words = '';
    let n = wholeNumber;
    let place = 0;

    do {
        let chunk = n % 1000;
        if (chunk !== 0) {
            let chunkWords = '';

            if (chunk >= 100) {
                chunkWords += units[Math.floor(chunk / 100)] + ' Hundred ';
                chunk %= 100;
            }

            if (chunk >= 20) {
                chunkWords += tens[Math.floor(chunk / 10)] + ' ';
                chunk %= 10;
            }

            if (chunk > 0) {
                chunkWords += units[chunk] + ' ';
            }

            words = chunkWords + thousands[place] + ' ' + words;
        }
        n = Math.floor(n / 1000);
        place++;
    } while (n > 0);

    return words.trim() + ' Rupees Only';
}

export default {
    printPiHtml,
    printPiPdf,
    listPi,
    createInvoiceFromPi,
    searchPiByCompanyExact
};