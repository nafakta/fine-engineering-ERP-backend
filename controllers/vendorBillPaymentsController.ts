// src/controllers/vendorBillPayments.controller.ts
import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import { sequelize } from "../models";
import path from "path";
import fs from "fs/promises";
import puppeteer, { Browser } from "puppeteer";
import Handlebars from "handlebars";
import fssync from "fs";
import { VendorBillPayment } from "../models/VendorBillPayment";
import { Account } from "../models/Banks";
import { VendorPaymentClearance } from "../models/VendorPaymentClearance";

// INR formatter helper for HB
Handlebars.registerHelper("formatINR", function (value: any) {
    const n = Number(value ?? 0);
    if (Number.isNaN(n)) return value;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

/* ---------------- Small MIME helper (no external lib) ---------------- */
function extToMime(ext: string): string {
    switch (ext.toLowerCase()) {
        case ".png": return "image/png";
        case ".jpg":
        case ".jpeg": return "image/jpeg";
        case ".gif": return "image/gif";
        case ".webp": return "image/webp";
        case ".svg": return "image/svg+xml";
        default: return "image/png";
    }
}

const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.access(fromEnv);
            return path.resolve(fromEnv);
        } catch { }
    }

    // 2️⃣ Primary logo location
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


const PUBLIC_ROOT = path.resolve(process.cwd(), "public");

const VENDOR_NAME_COL = "company";
type VBPListRow = {
    pay_no: string | null;
    company_name: string;
    transaction_date: string;
    price: string;
    pay_amount: string;
    bal_amount: string;
    bill_id: string;
    vendor_id: string;
};
const SORT_WHITELIST = new Set(["transaction_date", "price", "pay_amount", "bal_amount", "pay_no", "company_name"]);
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function absolutize(p: string) {
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith("/")) return `${BASE_URL}${p}`;
    return `${BASE_URL}/${p}`;
}

// ---------------- Amount in words (Indian system) ----------------
function inrToWords(n: number): string {
    if (!Number.isFinite(n)) return "";
    const a = [
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    ];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    function twoDigits(num: number) {
        if (num < 20) return a[num];
        const tens = Math.floor(num / 10), ones = num % 10;
        return [b[tens], a[ones]].filter(Boolean).join(" ");
    }
    function threeDigits(num: number) {
        const h = Math.floor(num / 100), rest = num % 100;
        return [
            h ? `${a[h]} Hundred` : "",
            rest ? twoDigits(rest) : ""
        ].filter(Boolean).join(" ");
    }

    const rupees = Math.floor(n);
    const paise = Math.round((n - rupees) * 100);

    if (rupees === 0 && paise === 0) return "Zero Rupees Only";

    const parts: string[] = [];
    let num = rupees;

    const crore = Math.floor(num / 10000000); num %= 10000000;
    const lakh = Math.floor(num / 100000); num %= 100000;
    const thousand = Math.floor(num / 1000); num %= 1000;
    const hundred = num;

    if (crore) parts.push(`${threeDigits(crore)} Crore`);
    if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
    if (hundred) parts.push(threeDigits(hundred));

    let words = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!words) words = "Zero";

    if (paise) {
        return `${words} Rupees and ${twoDigits(paise)} Paise Only`;
    }
    return `${words} Rupees Only`;
}

// ---------------- Template loader ----------------
let compiledVendorPaymentTpl: Handlebars.TemplateDelegate | null = null;
async function getVendorPaymentTemplate() {
    if (compiledVendorPaymentTpl) return compiledVendorPaymentTpl;
    const envPath = process.env.VENDOR_PAYMENT_TEMPLATE_PATH;
    const candidates = [
        envPath && path.resolve(envPath),
        path.resolve(process.cwd(), "src/views/vendor_payment_receipt.hbs"),
        path.resolve(process.cwd(), "src/templates/vendor_payment_receipt.hbs"),
        path.resolve(__dirname, "../views/vendor_payment_receipt.hbs"),
        path.resolve(__dirname, "../templates/vendor_payment_receipt.hbs"),
        path.resolve(__dirname, "../../src/views/vendor_payment_receipt.hbs"),
        path.resolve(__dirname, "../../src/templates/vendor_payment_receipt.hbs"),
        path.resolve(process.cwd(), "views/vendor_payment_receipt.hbs"),
        path.resolve(process.cwd(), "templates/vendor_payment_receipt.hbs"),
    ].filter(Boolean) as string[];

    const found = candidates.find(p => fssync.existsSync(p));
    if (!found) {
        throw new Error(
            `vendor_payment_receipt.hbs not found. Tried:\n${candidates.join("\n")}\n` +
            `Tip: set VENDOR_PAYMENT_TEMPLATE_PATH to the exact file path.`
        );
    }

    const tplStr = await fs.readFile(found, "utf8");
    compiledVendorPaymentTpl = Handlebars.compile(tplStr);
    return compiledVendorPaymentTpl!;
}

// ---------------- Build PDF context ----------------
async function buildReceiptContext(paymentId: string) {
    const richSQL = `
    SELECT
      vbp.*,
      v.company                                   AS vendor_company,
      COALESCE(v.vendor, v.contact, '')           AS vendor_contact_name,
      COALESCE(v.address, '')                     AS vendor_address,
      COALESCE(v.city, '')                        AS vendor_city,
      COALESCE(v.state, '')                       AS vendor_state,
      COALESCE(v.gstin, '')                       AS vendor_gstin,
      COALESCE(v.phone, v.mobile, v.contact, '')  AS vendor_phone,
      ob.bill_number                              AS ob_bill_number,
      ob.bill_date                                AS ob_bill_date,
      ob.total_amount                             AS ob_total_amount,
      po.po_number                                AS po_number,
      po.created_at                               AS po_date
    FROM public.vendor_bill_payments vbp
    JOIN public.vendors v ON v.id = vbp.vendor_id
    LEFT JOIN public.order_bills ob ON ob.id = vbp.bill_id
    LEFT JOIN public.purchase_orders po ON po.id = ob.po_id
    WHERE vbp.id = :id
    LIMIT 1
`;
    const safeSQL = `
    SELECT
      vbp.*,
      v.company                                   AS vendor_company,
      COALESCE(v.address, '')                     AS vendor_address,
      COALESCE(v.city, '')                        AS vendor_city,
      COALESCE(v.state, '')                       AS vendor_state,
      COALESCE(v.gstin, '')                       AS vendor_gstin,
      ''::text                                    AS vendor_contact_name,
      ''::text                                    AS vendor_phone,
      ob.bill_number                              AS ob_bill_number,
      ob.bill_date                                AS ob_bill_date,
      ob.total_amount                             AS ob_total_amount,
      po.po_number                                AS po_number,
      po.created_at                               AS po_date
    FROM public.vendor_bill_payments vbp
    JOIN public.vendors v ON v.id = vbp.vendor_id
    LEFT JOIN public.order_bills ob ON ob.id = vbp.bill_id
    LEFT JOIN public.purchase_orders po ON po.id = ob.po_id
    WHERE vbp.id = :id
    LIMIT 1
`;


    let row: any;
    try {
        row = await sequelize.query<any>(richSQL, {
            type: QueryTypes.SELECT,
            replacements: { id: paymentId },
            plain: true,
        });
    } catch (e: any) {
        if (e?.original?.code === '42703') {
            console.warn("🔁 Falling back to safeSQL due to undefined column:", e?.original?.message);
            row = await sequelize.query<any>(safeSQL, {
                type: QueryTypes.SELECT,
                replacements: { id: paymentId },
                plain: true,
            });
        } else {
            throw e;
        }
    }

    if (!row) throw new Error("Payment not found");

    const billAmount = Number(row.bill_amount ?? 0);
    const paidAmount = Number(row.paid_amount ?? 0);
    const balanceBefore = Number(row.remaining_amount ?? billAmount);
    const remainingAfter = (Number(row.remaining_amount ?? billAmount) || billAmount) - paidAmount;

    const histSQL = `
    SELECT
      po.po_number                             AS invoice_number,
      TO_CHAR(po.created_at, 'YYYY-MM-DD')     AS invoice_date,
      COALESCE(ob.total_amount, 0)            AS invoice_amount,
      COALESCE(vbp.paid_amount, 0)            AS payment_amount,
      TO_CHAR(vbp.payment_date, 'YYYY-MM-DD') AS payment_date,
      COALESCE(vbp.remaining_amount, 0)       AS balance_after_payment,
      (vbp.id = :pid) AS is_current_invoice
    FROM public.vendor_bill_payments vbp
    LEFT JOIN public.order_bills ob ON ob.id = vbp.bill_id
    LEFT JOIN public.purchase_orders po ON po.id = ob.po_id
    WHERE vbp.vendor_id = :vendor_id
    ORDER BY vbp.payment_date DESC, vbp.created_at DESC
    LIMIT 10
`;

    const history = await sequelize.query<any>(histSQL, {
        type: QueryTypes.SELECT,
        replacements: { pid: paymentId, vendor_id: row.vendor_id },
    });

    const companyDisplayName = process.env.COMPANY_DISPLAY_NAME || "COMPRESS INDIA PVT. LTD.";
    const logoDataUri = await getLogoAsDataURL();

    const ctx = {
        receipt_no: row.pay_number || row.id,
        receipt_date: new Date(row.payment_date).toISOString().slice(0, 10),

        // 👉 this is now PO No / PO Date
        invoice: row.po_number
            ? {
                invoice_no: row.po_number,
                invoice_date: row.po_date
                    ? new Date(row.po_date).toISOString().slice(0, 10)
                    : undefined,
            }
            : undefined,

        payment: {
            payment_mode: row.payment_mode,
            payment_date: new Date(row.payment_date).toISOString().slice(0, 10),
            payment_in: row.payment_in,
            paid_by: row.paid_by,
            ref_no: row.ref_no || null,
            notes: row.notes || null,
        },

        place_of_supply: row.place_of_supply || null,
        subject: row.subject || null,

        customer: {
            company: row.vendor_company,
            name: row.vendor_contact_name || null,
            address: row.vendor_address || null,
            city_state: [row.vendor_city, row.vendor_state].filter(Boolean).join(", "),
            gstin: row.vendor_gstin || null,
            contact: row.vendor_phone || null,
        },

        company_display_name: companyDisplayName,

        amounts: {
            bill_amount: billAmount,
            paid_amount: paidAmount,
            balance_before: balanceBefore,
            remaining_after: Math.max(0, remainingAfter),
        },

        payment_history: history.length ? history : null,

        amount_in_words: inrToWords(paidAmount),
        terms: [
            "This is a system generated slip.",
            "Subject to Mumbai jurisdiction.",
            "All disputes, if any, shall be settled mutually.",
        ],

        logo: logoDataUri,
    };

    if (!ctx.invoice?.invoice_no) (ctx as any).invoice = undefined;
    if (!ctx.place_of_supply) (ctx as any).place_of_supply = undefined;
    if (!ctx.subject) (ctx as any).subject = undefined;

    return ctx;
}

// ==================== PAYMENT SERVICE FUNCTIONS ====================
async function calculateAccountBalance(accountId: string, transaction: any = null): Promise<number> {
    const account = await Account.findByPk(accountId, { transaction });
    if (!account) {
        throw new Error("Bank account not found");
    }
    return Number(account.initialamount) || 0;
}

async function updateAccountBalance(accountId: string, deductedAmount: number): Promise<void> {
    const account = await Account.findByPk(accountId);
    if (!account) {
        throw new Error("Bank account not found");
    }
    const newBalance = (Number(account.initialamount) || 0) - deductedAmount;
    await Account.update(
        { initialamount: newBalance },
        { where: { id: accountId } }
    );
}

async function createAccountTransaction(
    transactionData: {
        account_id: string;
        amount: number;
        type: string;
        reference_id: string;
        description: string;
        transaction_date: Date;
    },
    transaction?: any
) {
    await sequelize.query(`
      INSERT INTO account_transactions (
        id, account_id, amount, type, reference_id, description, transaction_date, created_at, updated_at
      ) VALUES (
        uuid_generate_v4(), :account_id, :amount, :type, :reference_id, :description, :transaction_date, NOW(), NOW()
      )
    `, {
        replacements: transactionData,
        type: QueryTypes.INSERT,
        transaction
    });
}

async function validatePayment(billId: string, paidAmount: number, accountId: string): Promise<{ valid: boolean; message?: string }> {
    try {
        const bill = await sequelize.query<{
            total_amount: number;
            paid_amount: number;
            remaining_amount: number;
        }>(`
            SELECT 
                total_amount,
                COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as paid_amount,
                total_amount - COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as remaining_amount
            FROM order_bills 
            WHERE id = :billId
        `, {
            replacements: { billId: billId },
            type: QueryTypes.SELECT,
            plain: true
        });

        if (!bill) {
            return { valid: false, message: "Bill not found" };
        }

        if (paidAmount > bill.remaining_amount) {
            return {
                valid: false,
                message: `Payment amount (${paidAmount.toLocaleString('en-IN')}) exceeds remaining amount (${bill.remaining_amount.toLocaleString('en-IN')})`
            };
        }

        if (paidAmount <= 0) {
            return { valid: false, message: "Payment amount must be greater than 0" };
        }

        const accountBalance = await calculateAccountBalance(accountId, null);
        if (accountBalance < paidAmount) {
            return {
                valid: false,
                message: `Insufficient balance in bank account. Available: ${accountBalance.toLocaleString('en-IN')}, Required: ${paidAmount.toLocaleString('en-IN')}`
            };
        }

        return { valid: true };
    } catch (error) {
        return { valid: false, message: "Error validating payment" };
    }
}

/* --------------- ORM helper --------------- */
async function getPaymentById(paymentId: string) {
    return await VendorBillPayment.findByPk(paymentId, {
        include: [
            {
                model: sequelize.models.Vendor,
                as: 'vendor',
                attributes: ['id', 'company', 'vendor', 'gstin', 'address']
            },
            {
                model: sequelize.models.Account,
                as: 'account',
                attributes: ['id', 'accountname', 'bankname', 'accountnumber', 'initialamount']
            }
        ]
    });
}

// ==================== CONTROLLER FUNCTIONS ====================
export async function listVendorBillPayments(req: Request, res: Response) {
    try {
        const {
            page = "1",
            limit = "10",
            q,
            vendor_id,
            bill_id,
            date_from,
            date_to,
            sort_by,
            sort_dir,
        } = req.query as Record<string, string | undefined>;

        const pageNum = Math.max(parseInt(page || "1", 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit || "10", 10) || 10, 1), 100);

        const where: string[] = [];
        const params: Record<string, any> = {};

        if (q && q.trim()) {
            where.push(`(v.${VENDOR_NAME_COL} ILIKE :q OR v.vendor ILIKE :q OR vbp.pay_number ILIKE :q)`);
            params.q = `%${q.trim()}%`;
        }
        if (vendor_id) {
            where.push(`vbp.vendor_id = :vendor_id`);
            params.vendor_id = vendor_id;
        }
        if (bill_id) {
            where.push(`vbp.bill_id = :bill_id`);
            params.bill_id = bill_id;
        }
        if (date_from) {
            where.push(`vbp.payment_date >= :date_from`);
            params.date_from = date_from;
        }
        if (date_to) {
            where.push(`vbp.payment_date <= :date_to`);
            params.date_to = date_to;
        }

        const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const by = sort_by && SORT_WHITELIST.has(sort_by) ? sort_by : "transaction_date";
        const dir = (sort_dir && sort_dir.toLowerCase() === "asc") ? "ASC" : "DESC";

        const paramsWithPage = {
            ...params,
            limit: pageSize,
            offset: (pageNum - 1) * pageSize,
        };

        const countSQL = `
      SELECT COUNT(*)::bigint AS total
      FROM public.vendor_bill_payments vbp
      JOIN public.vendors v ON v.id = vbp.vendor_id
      ${whereSQL}
    `;

        // UPDATED SQL to include status field
        const dataSQL = `
      SELECT
        vbp.id                              AS payment_id, 
        vbp.pay_number                        AS pay_no,
        COALESCE(v.${VENDOR_NAME_COL}, '')    AS company_name,
        vbp.payment_date                      AS transaction_date,
        vbp.bill_amount::text                 AS price,
        COALESCE(vbp.paid_amount, 0)::text    AS pay_amount,
        COALESCE(vbp.remaining_amount, 0)::text AS bal_amount,
        vbp.is_paid                            AS is_paid,
        vbp.status                            AS status, -- ADDED THIS FIELD
        vbp.bill_id                           AS bill_id,
        vbp.vendor_id                         AS vendor_id
      FROM public.vendor_bill_payments vbp
      JOIN public.vendors v ON v.id = vbp.vendor_id
      ${whereSQL}
      ORDER BY ${by} ${dir} NULLS LAST
      LIMIT :limit OFFSET :offset
    `;

        const [{ total }] = await sequelize.query<{ total: string }>(countSQL, {
            type: QueryTypes.SELECT,
            replacements: params,
        });

        const rows = await sequelize.query<VBPListRow>(dataSQL, {
            type: QueryTypes.SELECT,
            replacements: paramsWithPage,
        });

        res.json({
            success: true,
            pagination: {
                page: pageNum,
                limit: pageSize,
                total: Number(total || 0),
                pages: Math.ceil(Number(total || 0) / pageSize),
            },
            columns: ["pay_no", "company_name", "transaction_date", "price", "pay_amount", "bal_amount", "status"], // Added status
            data: rows,
        });
    } catch (err: any) {
        console.error("listVendorBillPayments error:", err);
        res.status(500).json({
            success: false,
            error: "Failed to load vendor bill payments.",
            detail: err?.message ?? String(err),
        });
    }
}

// ==================== CREATE NEW VENDOR BILL PAYMENT ====================
export async function createVendorBillPayment(req: Request, res: Response) {
    const t = await sequelize.transaction();

    try {
        const {
            bill_id,
            vendor_id,
            payment_date,
            bill_amount,
            paid_amount,
            paid_by = "System User",
            place_of_supply = "Maharashtra",
            payment_mode = "NEFT",
            payment_in = "INR",
            notes = null,
            account_id = null,
            created_by = null,
            // Additional fields for better error handling
            vendor_bill_payment_id,
        } = req.body;

        console.log("📦 [createVendorBillPayment] Request body:", JSON.stringify(req.body, null, 2));

        // If vendor_bill_payment_id is provided, this is likely a send-to-clearance request
        if (vendor_bill_payment_id) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "Use /send-to-clearance endpoint to send existing payments to clearance",
                suggestion: "POST /api/v1/compresscrmbackend/vendor-bill-payments/send-to-clearance"
            });
        }

        // Validate required fields with better error messages
        const missingFields: string[] = [];
        if (!bill_id) missingFields.push("bill_id");
        if (!vendor_id) missingFields.push("vendor_id");
        if (!payment_date) missingFields.push("payment_date");
        if (!bill_amount && bill_amount !== 0) missingFields.push("bill_amount");
        if (!paid_amount && paid_amount !== 0) missingFields.push("paid_amount");

        if (missingFields.length > 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(", ")}`,
                received_fields: Object.keys(req.body).filter(key => req.body[key] !== undefined && req.body[key] !== ""),
                details: {
                    bill_id: bill_id || "MISSING",
                    vendor_id: vendor_id || "MISSING",
                    payment_date: payment_date || "MISSING",
                    bill_amount: bill_amount || "MISSING",
                    paid_amount: paid_amount || "MISSING"
                }
            });
        }

        // Validate numeric values
        const parsedBillAmount = parseFloat(String(bill_amount));
        const parsedPaidAmount = parseFloat(String(paid_amount));

        if (isNaN(parsedBillAmount) || parsedBillAmount <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "bill_amount must be a positive number",
                value: bill_amount
            });
        }

        if (isNaN(parsedPaidAmount) || parsedPaidAmount <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "paid_amount must be a positive number",
                value: paid_amount
            });
        }

        // Validate bill exists
        const billExists = await sequelize.query<{ exists: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM public.order_bills WHERE id = :bill_id)`,
            {
                type: QueryTypes.SELECT,
                replacements: { bill_id },
                plain: true,
                transaction: t
            }
        );

        if (!billExists?.exists) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: "Bill not found",
                bill_id
            });
        }

        // Validate vendor exists
        const vendorExists = await sequelize.query<{ exists: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM public.vendors WHERE id = :vendor_id)`,
            {
                type: QueryTypes.SELECT,
                replacements: { vendor_id },
                plain: true,
                transaction: t
            }
        );

        if (!vendorExists?.exists) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: "Vendor not found",
                vendor_id
            });
        }

        // Validate payment amount against bill
        const billStatus = await sequelize.query<{
            total_amount: number;
            paid_amount: number;
            remaining_amount: number;
        }>(`
            SELECT 
                total_amount,
                COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as paid_amount,
                total_amount - COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as remaining_amount
            FROM order_bills 
            WHERE id = :billId
        `, {
            replacements: { billId: bill_id },
            type: QueryTypes.SELECT,
            plain: true,
            transaction: t
        });

        if (!billStatus) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: "Failed to get bill status"
            });
        }

        const remainingAmount = billStatus.remaining_amount;

        // Validate not exceeding remaining amount
        if (parsedPaidAmount > remainingAmount) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: `Payment amount (₹${parsedPaidAmount.toLocaleString('en-IN')}) exceeds remaining bill amount (₹${remainingAmount.toLocaleString('en-IN')})`,
                bill_total: billStatus.total_amount,
                already_paid: billStatus.paid_amount,
                remaining: remainingAmount,
                attempted: parsedPaidAmount
            });
        }

        // Validate account balance if account_id provided
        if (account_id) {
            const accountBalance = await calculateAccountBalance(account_id, t);
            if (accountBalance < parsedPaidAmount) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    error: `Insufficient balance in bank account. Available: ₹${accountBalance.toLocaleString('en-IN')}, Required: ₹${parsedPaidAmount.toLocaleString('en-IN')}`
                });
            }
        }

        // Get the latest pay_number
        const latestPayment = await VendorBillPayment.findOne({
            order: [['created_at', 'DESC']],
            transaction: t
        });

        let nextPayNumber = "PAY-0001";
        if (latestPayment && latestPayment.pay_number) {
            const match = latestPayment.pay_number.match(/PAY-(\d+)/);
            if (match) {
                const num = parseInt(match[1]) + 1;
                nextPayNumber = `PAY-${num.toString().padStart(4, '0')}`;
            }
        }

        // Calculate new remaining amount after this payment
        const newRemainingAmount = remainingAmount - parsedPaidAmount;

        // Create new vendor bill payment
        const newPayment = await VendorBillPayment.create({
            bill_id,
            vendor_id,
            payment_date: new Date(payment_date),
            bill_amount: parsedBillAmount,
            paid_amount: parsedPaidAmount,
            remaining_amount: Math.max(0, newRemainingAmount),
            paid_by,
            place_of_supply,
            payment_mode,
            payment_in,
            notes,
            account_id,
            pay_number: nextPayNumber,
            created_by,
            is_paid: false, // Initially not sent to clearance
            status: newRemainingAmount === 0 ? "Paid" : "Partial",
        } as any, { transaction: t });

        // Update account balance if account_id provided
        if (account_id) {
            await updateAccountBalance(account_id, parsedPaidAmount);

            // Create account transaction
            await createAccountTransaction({
                account_id,
                amount: parsedPaidAmount,
                type: 'DEBIT',
                reference_id: newPayment.id,
                description: `Vendor Payment ${nextPayNumber}`,
                transaction_date: new Date(payment_date),
            }, t);
        }

        await t.commit();

        console.log("✅ [createVendorBillPayment] Payment created:", {
            id: newPayment.id,
            pay_number: nextPayNumber,
            bill_id,
            vendor_id,
            paid_amount: parsedPaidAmount,
            remaining_amount: newRemainingAmount
        });

        return res.status(201).json({
            success: true,
            message: "Vendor bill payment created successfully",
            data: {
                id: newPayment.id,
                pay_number: nextPayNumber,
                bill_id,
                vendor_id,
                paid_amount: parsedPaidAmount,
                remaining_amount: newRemainingAmount,
                is_paid: false, // Not yet sent to clearance
                status: newRemainingAmount === 0 ? "Paid" : "Partial"
            },
        });

    } catch (error: any) {
        try {
            await t.rollback();
        } catch (rollbackError) {
            console.error("❌ Rollback error:", rollbackError);
        }

        console.error("❌ [createVendorBillPayment] error:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to create vendor bill payment",
            detail: error?.message ?? String(error),
            stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
        });
    }
}

// ==================== SEND TO PAYMENT CLEARANCE ====================
export async function sendToPaymentClearance(req: Request, res: Response) {
    const t = await sequelize.transaction();

    try {
        const {
            vendor_bill_payment_id, // ID of the vendor bill payment to send to clearance
            bill_amount,            // Optional: The total bill amount (can be fetched from bill)
            account_id,            // Optional: account ID for the payment
            payment_date,          // Optional: payment date (defaults to current date)
            // Other optional fields
            bank_name = null,      // Will be set to null as requested
            cheque_number = null,
            transaction_reference = null,
            notes = null,
            created_by = null,
        } = req.body;

        console.log("📦 [sendToPaymentClearance] Request body:", JSON.stringify(req.body, null, 2));

        if (!vendor_bill_payment_id) {
            return res.status(400).json({
                success: false,
                error: "vendor_bill_payment_id is required",
            });
        }

        // 1) Fetch the vendor bill payment
        const vbp = await VendorBillPayment.findByPk(vendor_bill_payment_id, { transaction: t });
        if (!vbp) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "Vendor bill payment not found",
                vendor_bill_payment_id
            });
        }

        // Check if already sent to clearance
        const existingClearance = await VendorPaymentClearance.findOne({
            where: { vendor_bill_payment_id },
            transaction: t,
        });

        if (existingClearance) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "This vendor bill payment is already sent to VendorPaymentClearance",
                clearance_id: existingClearance.id
            });
        }

        // Extract IDs from vendor bill payment
        const billId = String((vbp as any).bill_id || '');
        const vendorId = String((vbp as any).vendor_id || '');

        if (!billId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                error: "Invalid bill_id in vendor bill payment",
            });
        }

        // 2) Get purchase order ID and bill amount from the bill
        const billRow = await sequelize.query<{
            po_id: string | null;
            total_amount: number;
            bill_number: string;
        }>(
            `SELECT po_id, total_amount, bill_number 
             FROM public.order_bills 
             WHERE id = :bill_id LIMIT 1`,
            {
                type: QueryTypes.SELECT,
                replacements: { bill_id: billId },
                plain: true,
                transaction: t,
            }
        );

        if (!billRow) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                error: "Bill not found in order_bills",
            });
        }

        const purchaseOrderId = billRow.po_id;
        const billNumber = billRow.bill_number;

        // 3) Determine bill amount
        let parsedBillAmount: number | null = null;

        // Priority 1: Use bill_amount from request if provided
        if (bill_amount !== undefined && bill_amount !== null) {
            const parsed = parseFloat(String(bill_amount));
            if (!isNaN(parsed) && parsed >= 0) {
                parsedBillAmount = parsed;
            }
        }

        // Priority 2: Use bill amount from order_bills table
        if (parsedBillAmount === null && billRow.total_amount !== null) {
            parsedBillAmount = Number(billRow.total_amount);
        }

        // Priority 3: Use bill_amount from vendor bill payment
        if (parsedBillAmount === null && (vbp as any).bill_amount !== null) {
            parsedBillAmount = Number((vbp as any).bill_amount);
        }

        // If still null, set to 0
        if (parsedBillAmount === null) {
            parsedBillAmount = 0;
        }

        // 4) Calculate amounts - paid_amount will be NULL
        let previousPaidAmount = 0;

        // Get previous paid amount for this bill (if any)
        const prevPayment = await sequelize.query<{ previous_total: string }>(
            `SELECT COALESCE(SUM(COALESCE(paid_amount, 0)), 0)::text AS previous_total
             FROM public.vendor_payment_clearence
             WHERE bill_id = :bill_id AND clearance_status != 'BOUNCED'`,
            {
                type: QueryTypes.SELECT,
                replacements: { bill_id: billId },
                plain: true,
                transaction: t,
            }
        );

        if (prevPayment) {
            previousPaidAmount = Number(prevPayment.previous_total || 0);
        }

        // Calculate remaining amount (bill_amount - previous payments)
        const finalRemainingAmount = parsedBillAmount - previousPaidAmount;

        // Determine payment stage
        let paymentStage: "FIRST" | "INTERIM" | "FINAL" = "FIRST";
        const paymentCountResult = await sequelize.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM public.vendor_payment_clearence
             WHERE bill_id = :bill_id AND clearance_status != 'BOUNCED'`,
            {
                type: QueryTypes.SELECT,
                replacements: { bill_id: billId },
                plain: true,
                transaction: t,
            }
        );

        const paymentCount = paymentCountResult ? Number(paymentCountResult.count || 0) : 0;

        if (paymentCount === 0) {
            paymentStage = "FIRST";
        } else if (finalRemainingAmount <= 0) { // Use <= 0 to handle edge cases
            paymentStage = "FINAL";
        } else {
            paymentStage = "INTERIM";
        }

        // Payment status will be PENDING since paid_amount is NULL
        const paymentStatus: "PENDING" | "PARTIAL" | "FULL" | "CANCELLED" = "PENDING";

        // Check if bill is fully paid considering all payments
        const isFullyPaid = finalRemainingAmount <= 0;

        // 5) Create clearance record
        const now = new Date();
        const clearance = await VendorPaymentClearance.create({
            // Required fields (NOT NULL)
            vendor_id: vendorId,
            bill_id: billId,
            purchase_order_id: purchaseOrderId || vendor_bill_payment_id,

            // Bill amount fields
            total_amount: parsedBillAmount,
            remaining_amount: Math.max(0, finalRemainingAmount), // Ensure non-negative
            balance_amount: Math.max(0, finalRemainingAmount),

            // Optional fields that can be NULL
            vendor_bill_payment_id: vendor_bill_payment_id,
            account_id: account_id || null,
            paid_amount: null, // Always null as requested
            previous_paid_amount: previousPaidAmount,

            // Optional dates
            payment_date: payment_date || (vbp as any).payment_date || null,
            cleared_date: null,

            // Optional payment details - bank_name set to null as requested
            payment_mode: null,
            payment_in: null,
            cheque_number: cheque_number || null,
            transaction_reference: transaction_reference || null,
            bank_name: null, // Always null as requested

            // Optional amounts
            cleared_amount: null,

            // Status fields
            payment_status: paymentStatus,
            is_fully_paid: isFullyPaid,
            payment_stage: paymentStage,
            clearance_status: 'PENDING',

            // Optional notes and details
            clearance_notes: null,
            paid_by: null,
            place_of_supply: null,
            notes: notes || null,
            attachment: null,

            // Audit fields
            created_by: created_by || (vbp as any).created_by || null,
            updated_by: created_by || (vbp as any).created_by || null,
            created_at: now,
            updated_at: now,
        }, { transaction: t });

        // 6) Update vendor bill payment status
        let vbpStatus: "Pending" | "Partial" | "Paid" | "Cancelled" = "Pending";
        if (isFullyPaid) {
            vbpStatus = "Paid";
        } else if (previousPaidAmount > 0) {
            vbpStatus = "Partial";
        }

        await VendorBillPayment.update(
            {
                is_paid: true, // Mark as sent to clearance
                status: vbpStatus,
                bill_amount: parsedBillAmount, // Update bill amount in vendor_bill_payments
                remaining_amount: Math.max(0, finalRemainingAmount),
                updated_at: now,
            } as any,
            {
                where: { id: vendor_bill_payment_id },
                transaction: t,
            }
        );

        await t.commit();

        console.log("✅ [sendToPaymentClearance] Payment sent to clearance:", {
            vendor_bill_payment_id,
            clearance_id: clearance.id,
            vendor_id: vendorId,
            bill_id: billId,
            bill_number: billNumber,
            purchase_order_id: purchaseOrderId,
            bill_amount: parsedBillAmount,
            paid_amount: null,
            remaining_amount: Math.max(0, finalRemainingAmount),
            previous_paid_amount: previousPaidAmount,
            is_fully_paid: isFullyPaid
        });

        return res.status(201).json({
            success: true,
            message: "Payment sent to VendorPaymentClearance successfully",
            data: {
                clearance_id: clearance.id,
                vendor_bill_payment_id,
                vendor_id: vendorId,
                bill_id: billId,
                bill_number: billNumber,
                purchase_order_id: purchaseOrderId,
                bill_amount: parsedBillAmount,
                paid_amount: null,
                total_amount: parsedBillAmount,
                previous_paid_amount: previousPaidAmount,
                remaining_amount: Math.max(0, finalRemainingAmount),
                balance_amount: Math.max(0, finalRemainingAmount),
                payment_status: paymentStatus,
                is_fully_paid: isFullyPaid,
                payment_stage: paymentStage,
                status: "sent_to_clearance"
            },
        });

    } catch (error: any) {
        try {
            await t.rollback();
        } catch (rollbackError) {
            console.error("❌ Rollback error:", rollbackError);
        }

        console.error("❌ [sendToPaymentClearance] error:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to send payment to VendorPaymentClearance",
            detail: error?.message ?? String(error),
            stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
        });
    }
}

export async function getBankAccounts(req: Request, res: Response) {
    try {
        const accounts = await Account.findAll({
            attributes: [
                'id',
                'accountname',
                'bankname',
                'accountnumber',
                'branch',
                'ifsc',
                'initialamount'
            ],
            order: [['accountname', 'ASC']]
        });

        res.json({
            success: true,
            data: accounts.map(account => ({
                ...account.toJSON(),
                current_balance: Number(account.initialamount) || 0
            }))
        });
    } catch (error: any) {
        console.error("getBankAccounts error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch bank accounts",
            detail: error?.message ?? String(error)
        });
    }
}

export async function validatePaymentAmount(req: Request, res: Response) {
    try {
        const { bill_id, paid_amount, account_id } = req.body;

        if (!bill_id || !paid_amount || !account_id) {
            return res.status(400).json({
                success: false,
                error: "bill_id, paid_amount and account_id are required"
            });
        }

        const validation = await validatePayment(bill_id, parseFloat(paid_amount), account_id);

        res.json({
            success: validation.valid,
            valid: validation.valid,
            message: validation.message
        });

    } catch (error: any) {
        console.error("validatePaymentAmount error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to validate payment amount",
            detail: error?.message ?? String(error)
        });
    }
}

export async function getBillPaymentStatus(req: Request, res: Response) {
    try {
        const { bill_id } = req.params;

        if (!bill_id) {
            return res.status(400).json({
                success: false,
                error: "bill_id is required"
            });
        }

        const billStatus = await sequelize.query<{
            total_amount: number;
            paid_amount: number;
            remaining_amount: number;
            is_fully_paid: boolean;
        }>(`
            SELECT 
                total_amount,
                COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as paid_amount,
                total_amount - COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0) as remaining_amount,
                (total_amount - COALESCE((
                    SELECT SUM(paid_amount) 
                    FROM vendor_bill_payments 
                    WHERE bill_id = :billId AND is_paid = true
                ), 0)) <= 0 as is_fully_paid
            FROM order_bills 
            WHERE id = :billId
        `, {
            replacements: { billId: bill_id },
            type: QueryTypes.SELECT,
            plain: true
        });

        if (!billStatus) {
            return res.status(404).json({
                success: false,
                error: "Bill not found"
            });
        }

        res.json({
            success: true,
            data: billStatus
        });

    } catch (error: any) {
        console.error("getBillPaymentStatus error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to get bill payment status",
            detail: error?.message ?? String(error)
        });
    }
}

export async function printVendorPaymentReceipt(req: Request, res: Response) {
    let browser: Browser | null = null;

    try {
        const paymentId = String(req.params.payment_id || req.params.id || "").trim();
        if (!paymentId) {
            return res.status(400).json({ success: false, error: "payment_id is required" });
        }

        const tpl = await getVendorPaymentTemplate();
        const ctx = await buildReceiptContext(paymentId);
        const html = tpl(ctx);

        // Unified executablePath resolution (Docker + local)
        const executablePath =
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            process.env.CHROME_EXECUTABLE_PATH ||
            (process.platform === "win32"
                ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                : process.platform === "darwin"
                    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                    : "/usr/bin/chromium");

        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--single-process",
            ],
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
        await page.emulateMediaType("screen");

        const pdfData = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "6mm", right: "6mm", bottom: "6mm", left: "6mm" },
            preferCSSPageSize: true,
        });

        const buf = Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);
        if (!buf || buf.length < 1000) {
            throw new Error("Vendor Payment Slip PDF generation failed (empty buffer).");
        }

        const filename = `VendorPaymentSlip-${ctx.receipt_no}.pdf`;

        res.status(200);
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${filename}"`,
            "Content-Length": String(buf.length),
            "Cache-Control": "no-store",
            "Accept-Ranges": "bytes",
        });
        return res.end(buf);
    } catch (err: any) {
        console.error("printVendorPaymentReceipt error (message):", err?.message);
        console.error("printVendorPaymentReceipt error (original):", err?.original?.message);
        console.error("printVendorPaymentReceipt error (code):", err?.original?.code);
        console.error("printVendorPaymentReceipt stack:", err?.stack);

        return res.status(500).json({
            success: false,
            error: "Failed to generate Vendor Payment Slip PDF",
            detail: err?.original?.message || err?.message || String(err),
            code: err?.original?.code,
        });
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore browser close errors
        }
    }
}

// In your controller, update the uploadVendorPaymentAttachment function:
export async function uploadVendorPaymentAttachment(req: Request, res: Response) {
    try {
        const paymentId = String(req.params.payment_id || "").trim();
        if (!paymentId) {
            return res.status(400).json({ success: false, error: "payment_id is required" });
        }

        // multer puts file in req.file
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({
                success: false,
                error: "No file uploaded. Use field name 'attachment'.",
            });
        }

        // Validate file type
        const allowedTypes = [
            'application/pdf',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/svg+xml'
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            // Delete the uploaded file
            try {
                await fs.unlink(file.path);
            } catch { /* ignore */ }

            return res.status(400).json({
                success: false,
                error: "Invalid file type. Only PDF and image files are allowed.",
            });
        }

        // Validate file size (10MB limit)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            try {
                await fs.unlink(file.path);
            } catch { /* ignore */ }

            return res.status(400).json({
                success: false,
                error: "File size exceeds 10MB limit. Please compress the file and try again.",
            });
        }

        // 🔍 Get the absolute path where Multer actually saved the file
        const absPath = path.resolve(file.path);

        // 🔥 Compute the path relative to /public
        // If file is at:  /app/public/uploads/vendor_payments/xyz.png
        // this becomes:   "uploads/vendor_payments/xyz.png"
        let relFromPublic = path.relative(PUBLIC_ROOT, absPath).replace(/\\/g, "/");

        // Ensure it starts with a single leading slash → "/uploads/vendor_payments/xyz.png"
        if (!relFromPublic.startsWith("/")) {
            relFromPublic = "/" + relFromPublic;
        }

        const relativePath = relFromPublic;

        const payment = await VendorBillPayment.findByPk(paymentId);
        if (!payment) {
            // delete the uploaded file if payment not found
            try {
                await fs.unlink(absPath);
            } catch {
                /* ignore */
            }
            return res.status(404).json({ success: false, error: "Vendor bill payment not found" });
        }

        // Update DB record with attachment path
        payment.setDataValue("attachment", relativePath);
        await payment.save();

        return res.status(200).json({
            success: true,
            message: "Attachment uploaded and saved",
            data: {
                attachment: relativePath,
                download_url: absolutize(relativePath),
                file_type: file.mimetype,
                file_size: file.size,
                original_name: file.originalname,
            },
        });
    } catch (err: any) {
        console.error("uploadVendorPaymentAttachment error:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to upload attachment",
            detail: err?.message ?? String(err),
        });
    }
}

const UPLOAD_ROOTS = [
    path.resolve(process.cwd(), "public", "uploads"),
    path.resolve(process.cwd(), "uploads"),
];

export async function serveVendorPaymentAttachment(req: Request, res: Response) {
    try {
        const paymentId = String(req.params.payment_id || "").trim();
        if (!paymentId) {
            return res.status(400).json({ success: false, error: "payment_id is required" });
        }

        const payment = await VendorBillPayment.findByPk(paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, error: "Vendor bill payment not found" });
        }

        const attachment: string | null = (payment as any).attachment || null;
        if (!attachment) {
            return res.status(404).json({ success: false, error: "No attachment found for this payment" });
        }

        // e.g. "/uploads/vendor_payments/xyz.png" OR "../../../uploads/vendor_payments/xyz.png"
        const cleaned = attachment.trim().replace(/^\/+/, ""); // remove leading slashes
        let normalized = path.normalize(cleaned).replace(/\\/g, "/").toLowerCase();

        // Extract the part UNDER "uploads/"
        const marker = "uploads/";
        let underUploads: string;
        const idx = normalized.lastIndexOf(marker);
        if (idx >= 0) {
            underUploads = normalized.slice(idx + marker.length); // "vendor_payments/xyz.png"
        } else {
            // if no "uploads/" string, just use normalized as is
            underUploads = normalized;
        }

        let diskPath: string | null = null;
        let tried: string[] = [];

        for (const root of UPLOAD_ROOTS) {
            const candidate = path.resolve(root, underUploads);
            tried.push(candidate);
            try {
                await fs.access(candidate);
                diskPath = candidate;
                break;
            } catch {
                // try next root
            }
        }

        console.log("🔍 [serveVendorPaymentAttachment] attachment =", attachment);
        console.log("🔍 [serveVendorPaymentAttachment] underUploads =", underUploads);
        console.log("🔍 [serveVendorPaymentAttachment] tried =", tried);
        console.log("🔍 [serveVendorPaymentAttachment] diskPath =", diskPath);

        if (!diskPath) {
            return res.status(404).json({
                success: false,
                error: "Attachment file not found on server",
            });
        }

        // Get file stats to check size
        const stats = await fs.stat(diskPath);
        const fileSize = stats.size;

        // Get file extension and MIME type
        const ext = path.extname(diskPath).toLowerCase();
        let contentType = 'application/octet-stream'; // default

        // Set proper MIME type
        if (ext === '.pdf') {
            contentType = 'application/pdf';
        } else if (ext === '.png') {
            contentType = 'image/png';
        } else if (ext === '.jpg' || ext === '.jpeg') {
            contentType = 'image/jpeg';
        } else if (ext === '.gif') {
            contentType = 'image/gif';
        } else if (ext === '.webp') {
            contentType = 'image/webp';
        } else if (ext === '.svg') {
            contentType = 'image/svg+xml';
        }

        const filename = path.basename(diskPath);

        // Set proper headers for file download/viewing
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Accept-Ranges', 'bytes');

        // CORS headers if needed
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        console.log(`📄 Serving file: ${filename}, Size: ${fileSize}, Type: ${contentType}`);

        const stream = fssync.createReadStream(diskPath);
        stream.on("error", (sErr) => {
            console.error("serveVendorPaymentAttachment stream error:", sErr);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: "Error reading file" });
            }
        });

        stream.pipe(res);

    } catch (err: any) {
        console.error("serveVendorPaymentAttachment error:", err);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: "Failed to serve attachment",
                detail: err?.message ?? String(err),
            });
        }
    }
}


export async function checkAttachmentExists(req: Request, res: Response) {
    try {
        const paymentId = String(req.params.payment_id || "").trim();
        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: "payment_id is required"
            });
        }

        const payment = await VendorBillPayment.findByPk(paymentId, {
            attributes: ["id", "attachment"],
        });

        if (!payment) {
            return res.status(404).json({
                success: false,
                error: "Vendor bill payment not found",
            });
        }

        const attachment: string | null = (payment as any).attachment || null;
        const hasAttachment = !!attachment;

        return res.status(200).json({
            success: true,
            data: {
                has_attachment: hasAttachment,
                // Return the API endpoint URL, not the static file path
                attachment_url: hasAttachment ?
                    `/vendor-bill-payments/${paymentId}/attachment` : null,
                attachment_path: attachment,
            },
        });
    } catch (err: any) {
        console.error("checkAttachmentExists error:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to check attachment status",
            detail: err?.message ?? String(err),
        });
    }
}