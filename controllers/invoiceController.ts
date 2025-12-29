// src/controllers/invoiceController.ts
import { Request, Response } from "express";
import { Op, QueryTypes } from "sequelize";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Browser, Page } from "puppeteer";
import db from "../models";
import * as Yup from "yup";
import { Pool } from "pg";
import { Transaction } from "sequelize";

// ========== Handlebars helpers ==========
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim(); return s.length ? v : fb;
});
Handlebars.registerHelper("json", (v: any) => JSON.stringify(v, null, 2));
// Format ₹ amounts exactly as your template expects
Handlebars.registerHelper("formatINR", (v: any) => {
    const n = Number(v || 0);
    // Round to nearest whole rupee
    const rounded = Math.round(n);
    return rounded.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
});

Handlebars.registerHelper("formatINR", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("formatQty", (v: any) =>
    Number(v || 0).toFixed(3).replace(/\.?0+$/, "")
);
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("json", (ctx: any) => JSON.stringify(ctx, null, 2));
// Format quantities like 1 / 1.5 / 1.250 (trim trailing zeros)
Handlebars.registerHelper("formatQty", (v: any) => {
    const n = Number(v || 0);
    const s = n.toFixed(3);
    return s.replace(/\.?0+$/, "");
});
// Format date to en-IN
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
    const n = Number(v || 0);
    const rounded = Math.round(n);
    return rounded.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
});
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

// ✅ Add this helper (idempotent usage is fine)
Handlebars.registerHelper("or", (v: any, fallback: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fallback;
});
Handlebars.registerHelper("formatINR", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("formatQty", (v: any) => {
    const s = Number(v || 0).toFixed(3);
    return s.replace(/\.?0+$/, "");
});
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatINR", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});
Handlebars.registerHelper("formatQty", (v: any) => {
    const s = Number(v || 0).toFixed(3);
    return s.replace(/\.?0+$/, "");
});
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);

Handlebars.registerHelper("formatINR", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
});

Handlebars.registerHelper("formatQty", (v: any) => {
    const s = Number(v || 0).toFixed(3);
    return s.replace(/\.?0+$/, "");
});

Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});

Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});

Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatINR", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("formatQty", (v: any) =>
    Number(v || 0).toFixed(3).replace(/\.?0+$/, "")
);
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});

const toPaise = (n: any) => {
    const x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round(x * 100); // 2dp
};

// Add these to your existing Handlebars helpers

// Sum helper for arrays
Handlebars.registerHelper('sum', function (array: any[]) {
    return array.reduce((total, item) => total + (Number(item) || 0), 0);
});

// Pluck helper to extract values from array of objects
Handlebars.registerHelper('pluck', function (array: any[], property: string, start: number, end: number) {
    const slice = array.slice(start, end + 1);
    return slice.map(item => item[property]);
});

// Slice helper for arrays
Handlebars.registerHelper('slice', function (array: any[], start: number, end: number) {
    return array.slice(start, end);
});

// Subtract helper
Handlebars.registerHelper('subtract', function (a: any, b: any) {
    return Number(a) - Number(b);
});

// Add helper
Handlebars.registerHelper('add', function (a: any, b: any) {
    return Number(a) + Number(b);
});

// Lookup helper (already in newer Handlebars, but adding for safety)
Handlebars.registerHelper('lookup', function (obj: any, key: any) {
    return obj[key];
});
// Helper function for formatting Indian Rupees
Handlebars.registerHelper('formatINR', function (number) {
    if (isNaN(number)) return '0.00';
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(number);
});
const fromPaise = (p: number) => Number((p / 100).toFixed(2));
const calculateGST = (amount: number, gstPercentage: number): { gstAmount: number, totalAmount: number } => {
    const gstAmount = (amount * gstPercentage) / 100;
    const totalAmount = amount + gstAmount;
    return { gstAmount, totalAmount };
};

const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "your_db_name",
});
const getNextPayNumber = async (t: any): Promise<number> => {
    const lastPayment = await db.InvoicePayment.findOne({
        order: [["created_at", "DESC"]],
        attributes: ["pay_number"],
        transaction: t,         // ✅ now works
        lock: t.LOCK.UPDATE,
    });

    const lastNumber =
        lastPayment && lastPayment.pay_number
            ? parseInt(lastPayment.pay_number.split("_")[1], 10)
            : 0;

    return lastNumber + 1;
};


function requireValidDateISO(input: unknown, field: string): string | null {
    if (!input) return null;
    const d = new Date(String(input));
    return isNaN(d.getTime()) ? null : d.toISOString();
}

const toNumber = (n: any) => Number(n || 0);
const roundRupee = (n: any) => Math.round(toNumber(n));
// const toPaise = (n: any) => Math.round(toNumber(n) * 100);
// const fromPaise = (p: number) => p / 100;
const asRoundedMoney = (n: any) => roundRupee(n).toFixed(2); // "123.00"

// optional: handy for one-time debug in the template
Handlebars.registerHelper("json", (ctx: any) => JSON.stringify(ctx, null, 2));
// ========== utils ==========





type CustomerFull = {
    department?: string | null;
    company?: string | null;
    client?: string | null;                 // legacy “client” display name
    contact_person?: string | null;
    designation?: string | null;
    client_designation?: string | null;
    contact_person_number?: string | null;
    email_id?: string | null;
    mobile?: string | null;
    gstn?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pin_code?: string | null;
};


type ShippingFull = {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
};


type PaymentDTO = {
    id: string;
    invoice_id: string;
    payment_date: Date | string | null;
    payment_mode: string | null;
    payment_in: string | null;
    paid_by: string | null;
    notes: string | null;
    invoice_amount: number; // rounded whole rupees
    paid_amount: number;    // rounded whole rupees
    created_at: Date | string | null;
};

type PaymentSlipVM = {
    logo: string;
    company_display_name: string;
    company_legal_name: string;
    our_company: {
        name: string;
        legal_name: string;
        tax_id: string;
        address_line: string;
        city_state: string;
    };
    receipt_no: string;
    receipt_date: string;

    customer: {
        company: string;
        name?: string | null;
        address?: string | null;
        city_state?: string | null;
        gstin?: string | null;
        contact?: string | null;
    };

    invoice: {
        id: string;
        invoice_no: string;
        invoice_date: string;
    };

    payment: {
        id: string;
        payment_date: string;
        payment_mode: string;
        payment_in: string;
        paid_by: string;
        notes?: string | null;
    };

    place_of_supply?: string | null;
    subject?: string | null;

    bank: {
        account_name: string;
        account_no: string;
        bank_name: string;
        ifsc: string;
        branch: string;
    };

    amounts: {
        invoice_amount: number;        // whole rupees
        paid_amount: number;           // whole rupees
        paid_total_after: number;      // cumulative paid after this payment
        balance_after: number;         // remaining after this payment
    };

    amount_in_words: string;
    terms: string[];

    payment_history: Array<{
        invoice_number: string;
        invoice_date: string;
        invoice_amount: number;
        payment_amount: number;
        payment_date: string;
        pay_number?: string;
        is_current_invoice: boolean;
        remaining_amount: number; // Add this
        cumulative_paid?: number; // Optional: for reference
    }>;
};

type BankLookup = {
    bank_name?: string;
    account_name?: string;
    account_no?: string;
    ifsc?: string;
};

const PAYSLIP_TPL_PROMISE = (async () => {
    try { return await resolveTemplateFile("payslip.hbs"); }
    catch { throw new Error("payslip.hbs template not found"); }
})();

async function resolveAccountIdByBank(
    client: import("pg").PoolClient,
    { bank_name, account_name, account_no, ifsc }: BankLookup
): Promise<{ id: string | null; reason?: string }> {
    // Build a safe, discriminating lookup
    const clauses: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (bank_name) { clauses.push(`bankname ILIKE $${i++}`); params.push(bank_name); }
    if (account_name) { clauses.push(`accountname ILIKE $${i++}`); params.push(account_name); }
    if (account_no) { clauses.push(`accountnumber = $${i++}`); params.push(account_no); }
    if (ifsc) { clauses.push(`ifsc ILIKE $${i++}`); params.push(ifsc); }

    if (clauses.length === 0) {
        return { id: null, reason: "No bank fields provided to resolve account." };
    }

    // Prefer exact account_no/ifsc when present by ordering
    const sql = `
    SELECT id, bankname, accountname, accountnumber, ifsc
      FROM public.accounts
     WHERE ${clauses.join(" AND ")}
     ORDER BY
       (accountnumber IS NOT NULL AND accountnumber <> '') DESC,
       (ifsc IS NOT NULL AND ifsc <> '') DESC,
       updated_at DESC
     LIMIT 2
  `;
    const res = await client.query(sql, params);

    const count = res.rowCount ?? 0;

    if (count === 0)
        return { id: null, reason: "No matching bank account found." };

    if (count > 1)
        return { id: null, reason: "Multiple accounts matched the given bank details. Please specify account_id or add account_no/ifsc to disambiguate." };


    return { id: res.rows[0].id };
}

async function buildPaymentSlipVM(paymentId: string): Promise<PaymentSlipVM> {
    const pay = await db.InvoicePayment.findByPk(paymentId, {
        include: [{
            model: db.Invoice,
            as: "invoice",
            include: [
                { model: db.Client, as: "client" },
                {
                    model: db.InvoicePayment,
                    as: "payments",
                    attributes: ["id", "paid_amount", "payment_date", "payment_mode", "pay_number", "notes", "created_at"],
                    required: false,
                },
                { model: db.Estimate, as: "estimate", required: false },
            ],
        }],
    });

    if (!pay) throw new Error("Payment not found");

    const p: any = pay.toJSON();
    const inv: any = p.invoice || {};
    const cli: any = inv.client || {};

    // ---------- CUSTOMER / COMPANY ----------
    const our_company = {
        name: process.env.COMPANY_SHORT || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
        legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
        tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
        address_line: process.env.COMPANY_ADDR || "Off no. 103, Hi-Tech Commercial Complex, V.B. Nagar",
        city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
    };

    const customer_address = inv?.estimate?.shipping_address || cli.address || "";
    const customer_city_state = [cli.city, cli.state].filter(Boolean).join(", ");

    // ---------- AMOUNTS FOR *CURRENT* INVOICE ----------
    const invoice_amount = Math.round(Number(inv.price_inc_tax || p.invoice_amount || 0));
    const this_paid = Math.round(Number(p.paid_amount || 0));

    // Only payments of the current invoice, sorted ASC for proper cumulative math
    const currentInvoicePayments: any[] = Array.isArray(inv.payments) ? inv.payments : [];
    const sortedPaymentsForInvoice = [...currentInvoicePayments].sort((a: any, b: any) => {
        const da = new Date(a.payment_date || a.created_at).getTime();
        const db = new Date(b.payment_date || b.created_at).getTime();
        return da - db;
    });

    // Build current-invoice-only payment history
    let cumulativePaid = 0;
    const payment_history = sortedPaymentsForInvoice.map((payment: any) => {
        const paymentAmount = Math.round(Number(payment.paid_amount || 0));
        cumulativePaid += paymentAmount;
        const remainingAmount = Math.max(invoice_amount - cumulativePaid, 0);

        return {
            invoice_number: inv.invoice_no || "—",
            invoice_date: new Date(inv.tax_date || inv.creation_date || inv.created_at).toLocaleDateString("en-IN"),
            invoice_amount: invoice_amount,
            payment_amount: paymentAmount,
            payment_date: new Date(payment.payment_date || payment.created_at).toLocaleDateString("en-IN"),
            pay_number: payment.pay_number || null,
            is_current_invoice: true,
            remaining_amount: remainingAmount,
            cumulative_paid: cumulativePaid,
        };
    });

    const paid_total_after = sortedPaymentsForInvoice.reduce(
        (total: number, payment: any) => total + Math.round(Number(payment.paid_amount || 0)),
        0
    );
    const balance_after = Math.max(invoice_amount - paid_total_after, 0);

    // ---------- RECEIPT / BRANDING ----------
    const receipt_no = p.pay_number || (p.id || "").toString().split("-")[0].toUpperCase();
    const logo = await getLogoAsDataURL();

    const vm: PaymentSlipVM = {
        logo,
        company_display_name: our_company.name,
        company_legal_name: our_company.legal_name,
        our_company,
        receipt_no,
        receipt_date: new Date(p.payment_date).toLocaleDateString("en-IN"),

        customer: {
            company: cli.company_name ?? cli.company ?? cli.client ?? cli.name ?? "",
            name: cli.contact_person ?? cli.designation ?? null,
            address: customer_address || null,
            city_state: customer_city_state || null,
            gstin: cli.gstn || cli.gstin || null,
            contact: cli.mobile || null,
        },

        invoice: {
            id: inv.id,
            invoice_no: inv.invoice_no ?? inv.id,
            invoice_date: new Date(inv.tax_date || inv.creation_date || inv.created_at).toLocaleDateString("en-IN"),
        },

        payment: {
            id: p.id,
            payment_date: new Date(p.payment_date).toLocaleDateString("en-IN"),
            payment_mode: p.payment_mode || "-",
            payment_in: p.payment_in || "-",
            paid_by: p.paid_by || "-",
            notes: p.notes || null,
        },

        place_of_supply: p.place_of_supply || inv.place_of_supply || null,
        subject: inv.estimate?.subject || null,

        bank: {
            account_name: process.env.BANK_ACCOUNT_NAME || our_company.legal_name,
            account_no: process.env.BANK_ACCOUNT_NO || "—",
            bank_name: process.env.BANK_NAME || "—",
            ifsc: process.env.BANK_IFSC || "—",
            branch: process.env.BANK_BRANCH || "—",
        },

        amounts: {
            invoice_amount,
            paid_amount: this_paid,
            paid_total_after,
            balance_after,
        },

        // ✅ Only the current invoice’s payments appear here
        payment_history,

        amount_in_words: ` ${inWordsIndian(Number(this_paid || 0))}`,
        terms: [
            "This is a computer-generated receipt for the payment recorded against the above invoice.",
            "All disputes are subject to Mumbai jurisdiction.",
        ],
    };

    return vm;
}

// Helper function to extract sequence number from pay_number
function extractSequenceFromPayNumber(payNumber: string): number {
    if (!payNumber) return 0;

    // Handle formats like: pay_01, PAY_02, payment_03, etc.
    const match = payNumber.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
}

/** Recalculate invoice payment_status + payment_date */
async function recomputeInvoicePaymentRollup(invoiceId: string, t: any) {
    const InvoiceModel: any = db.Invoice as any;

    // detect optional columns safely
    const hasPaidTotalCol = !!InvoiceModel?.rawAttributes?.paid_total;
    const hasRemainingCol = !!InvoiceModel?.rawAttributes?.remaining_amount;

    // feature flag: overwrite the invoice total with remaining on partial payments
    const SHRINK_TOTAL = String(process.env.SHRINK_TOTAL_ON_PARTIAL || "").toLowerCase() === "true";

    const inv = await db.Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!inv) throw new Error("Invoice not found during rollup");

    const payments = await db.InvoicePayment.findAll({
        where: { invoice_id: invoiceId },
        transaction: t,
    });

    // sums as integer rupees
    const paidTotalRupee = payments.reduce((s: number, p: any) => s + Math.round(Number(p.paid_amount || 0)), 0);
    const originalTotalRupee = Math.round(Number((inv as any).price_inc_tax || 0));

    const balanceRupee = Math.max(originalTotalRupee - paidTotalRupee, 0);
    const nowPaid = originalTotalRupee > 0 && paidTotalRupee >= originalTotalRupee;

    // latest payment date (if any)
    const latest =
        payments
            .map((p: any) => new Date(p.payment_date))
            .filter((d: Date) => !isNaN(d.getTime()))
            .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] || null;

    const updatePayload: any = {
        payment_status: nowPaid,
        payment_date: nowPaid ? (latest ?? new Date()) : null,
        updated_at: new Date(),
    };

    // Store running totals if those columns exist
    if (hasPaidTotalCol) updatePayload.paid_total = paidTotalRupee;
    if (hasRemainingCol) updatePayload.remaining_amount = balanceRupee;

    // Optional: shrink invoice price_inc_tax to remaining when partially paid
    if (SHRINK_TOTAL) {
        const isPartial = !nowPaid && paidTotalRupee > 0;
        if (isPartial) {
            updatePayload.price_inc_tax = balanceRupee; // ← update total to remaining
        } else if (nowPaid) {
            updatePayload.price_inc_tax = 0; // fully paid → total becomes 0
        } else {
            // not paid at all → keep original
        }
    }

    await inv.update(updatePayload, { transaction: t });

    return {
        paid_total: paidTotalRupee,
        balance: balanceRupee,
        payment_status: nowPaid,
        payment_date: latest,
    };
}




function safeText(v: any, fallback = "") {
    const s = String(v ?? "").trim();
    return s.length ? s : fallback;
}

function pickHSN(it: any): string | null {
    return it?.hsn_sac ?? it?.hsn ?? it?.hsn_code ?? it?.hsncode ?? null;
}

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
const TEMPLATE_PATH_PROMISE = resolveTemplateFile("invoice_alt.hbs");

const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (best for Docker/prod)
    if (process.env.COMPANY_LOGO_PATH) {
        try {
            const p = path.resolve(process.env.COMPANY_LOGO_PATH);
            await fs.access(p);
            return p;
        } catch { }
    }

    // 2️⃣ Standard shared location
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

    // 3️⃣ Dev fallbacks
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

const createPaymentSchema = Yup.object({
    payment_date: Yup.string().required(),
    amount: Yup.number().min(0).required()
        .transform((v) => roundRupee(v)),           // <- round invoice amount
    paid_amount: Yup.number().moreThan(0).required()
        .transform((v) => roundRupee(v)),           // <- round paid amount
    paid_by: Yup.string().required(),
    place_of_supply: Yup.string().required(),
    payment_mode: Yup.string().oneOf(["UPI", "Bank Transfer", "Card", "Cash", "Cheque", "NEFT", "IMPS"]).required(),
    payment_in: Yup.string().required(),
    notes: Yup.string().nullable(),
});

// ========== GST CALCULATION LOGIC (Same as Estimate & PI) ==========
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

const computeTotalsWithStateBasedGST = (params: {
    items: Array<{ qty: number; rate: number }>;
    discount_type?: "none" | "percent" | "flat" | string | null;
    discount_value?: number | string | null;
    tax_percent: number;
    is_inter_state: boolean;
}) => {
    const items = Array.isArray(params.items) ? params.items : [];

    // Calculate sub_total
    const sub_total = items.reduce((sum, it) => {
        const q = Number(it.qty) || 0;
        const r = Number(it.rate) || 0;
        return sum + (q * r);
    }, 0);

    console.log('🧮 INVOICE GST CALCULATION DEBUG:');
    console.log('  - Items count:', items.length);
    console.log('  - Sub total:', sub_total);
    console.log('  - Tax percent:', params.tax_percent);
    console.log('  - Is inter-state:', params.is_inter_state);

    // Calculate discount
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

    console.log('📊 Before GST Calculation:');
    console.log('  - Taxable amount:', taxable);
    console.log('  - Tax percent:', taxPercent);
    console.log('  - Is inter-state:', isInterState);

    // GST Calculation - SAME LOGIC AS ESTIMATE & PI
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

    console.log('✅ FINAL INVOICE GST BREAKDOWN:');
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
};

// ========== ID picking ==========
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
function pickInvoiceId(req: Request): string | null {
    const p = req.params as any;
    const q = req.query as any;
    const b = req.body as any;
    const candidates = [
        p?.id, p?.invoice_id,
        q?.id, q?.invoice_id,
        b?.id, b?.invoice_id,
        (req.headers["x-invoice-id"] as string) ||
        (req.headers["invoice-id"] as string) ||
        (req.headers["x-invoiceid"] as string),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
        const v = sanitizeUuid(c);
        if (v && v !== ":id" && v !== ":invoice_id" && UUID_RX.test(v)) return v;
    }
    const fromUrl = extractUuidFromUrl(req.originalUrl || req.url);
    if (fromUrl && UUID_RX.test(fromUrl)) return fromUrl;
    return null;
}

// ========== VM types ==========

type ItemVM = {
    item_name: string;
    description: string;
    hsn_sac: string;
    make?: string | null;
    unit: string;
    qty: number;
    rate: number;
    gst_percent: number;
    total: number;
    line_total: number; // <-- add this
};

type InvoicePrintVM = {
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
    };
    customer_company: string;
    customer_name: string;
    customer_email: string;
    customer_address: string;
    customer_city_state?: string;
    customer_gstin?: string;
    customer_phone?: string;
    subject?: string;
    shipping_address?: string;
    shipping_city_state?: string;
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
    amount_in_words: string;
    terms: string[];
    payment_status: boolean;
    payment_date?: string | null;
    customer_full: CustomerFull;
    shipping_full: ShippingFull;
    isInterState: boolean; // ✅ ADD THIS TO THE TYPE
};

// ========== number-to-words (Indian) ==========
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

// ========== CORRECTED Item Mapping Functions ==========

function mapInvoiceItems(rows: any[] = []): ItemVM[] {
    return rows.map((it, index) => {
        const qty = Number(it.quantity ?? 0);
        const rate = Number(it.rate ?? 0);
        const line_total = Number(it.line_total ?? qty * rate);

        // ✅ USE ACTUAL DATABASE VALUES - No hardcoding
        const item_name = safeText(it.item_name, "");  // Empty string if not provided
        const description = safeText(it.description, ""); // Empty string if not provided

        console.log(`📦 Invoice Item ${index}:`, {
            item_name: `"${item_name}"`,
            description: `"${description}"`,
            areDifferent: item_name !== description,
            source: "invoice_items table"
        });

        return {
            item_name,
            description,
            hsn_sac: safeText(it.hsn_sac, "-"),
            make: safeText(it.make, ""),
            unit: safeText(it.unit, "NOS"),
            qty,
            rate,
            total: line_total,
            line_total,
            gst_percent: it.gst_percent != null ? Number(it.gst_percent) : 0,
        };
    });
}

function mapEstimateItems(rows: any[] = []): ItemVM[] {
    return rows.map((it, index) => {
        const qty = Number(it.qty ?? 0);
        const rate = Number(it.rate ?? 0);
        const line_total = Number(it.amount ?? qty * rate);

        // ✅ USE ACTUAL DATABASE VALUES - No hardcoding
        const item_name = safeText(it.item_name, "");  // Empty string if not provided
        const description = safeText(it.description, ""); // Empty string if not provided

        console.log(`📋 Estimate Item ${index}:`, {
            item_name: `"${item_name}"`,
            description: `"${description}"`,
            areDifferent: item_name !== description,
            source: "estimate_items table"
        });

        return {
            item_name,
            description,
            hsn_sac: safeText(pickHSN(it), "-"),
            make: safeText(it.make, ""),
            unit: safeText(it.unit, "NOS"),
            qty,
            rate,
            total: line_total,
            line_total,
            gst_percent: it.gst_percent != null ? Number(it.gst_percent) : 0,
        };
    });
}

// ========== Build VM ==========
async function buildInvoiceVM(id: string): Promise<InvoicePrintVM> {
    // 1) Load invoice + related
    const inv = await db.Invoice.findByPk(id, {
        include: [
            {
                model: db.Client,
                as: "client",
            },
            {
                model: db.InvoiceItem,
                as: "items",
                attributes: [
                    "id",
                    "item_name",
                    "description",
                    "quantity",
                    "make",
                    "rate",
                    "unit",
                    "hsn_sac",
                    "gst_percent",
                    "line_total",
                    "created_at",
                    "updated_at",
                ],
            },
            {
                model: db.Estimate,
                as: "estimate",
                required: false,
                include: [{ model: db.EstimateItem, as: "items" }],
            },
        ],
        attributes: [
            "id", "invoice_no", "tax_scheme", "discount_type", "discount_value",
            "tax_date", "created_at", "price_inc_tax", "tax_amount",
            "is_inter_state", "payment_status", "payment_date", "notes",
        ],
    });

    const tdsPayments = await db.InvoicePayment.findAll({
        where: {
            invoice_id: id,
            tds_applicable: true,
            tds_amount: { [Op.gt]: 0 }
        },
        attributes: ['tds_percent', 'tds_amount', 'net_amount_credited', 'payment_date'],
        order: [['payment_date', 'DESC']],
        limit: 1
    });

    const latestTdsPayment = tdsPayments[0];

    if (!inv) throw new Error("Invoice not found");
    const j: any = inv.toJSON();

    console.log('=== INVOICE RAW DATA DEBUG ===');
    console.log('Client State:', j.client?.state);
    console.log('Estimate Shipping State:', j.estimate?.shipping_state);
    console.log('Invoice is_inter_state (raw):', j.is_inter_state);

    // STATE COMPARISON LOGIC - Same as PI
    const clientState = String(j.client?.state || "").trim();
    const shippingState = String(j.estimate?.shipping_state || "").trim();

    console.log('🔍 INVOICE STATE COMPARISON DEBUG:');
    console.log('  - Client State:', `"${clientState}"`);
    console.log('  - Shipping State (from Estimate):', `"${shippingState}"`);
    console.log('  - Client state length:', clientState.length);
    console.log('  - Shipping state length:', shippingState.length);
    const invoiceNotes = j.notes || null;
    const serviceType = j.estimate?.service_type || null;

    // DETERMINE INTER-STATE STATUS - Same logic as PI
    let isInterState = false;

    if (clientState && shippingState) {
        // Both states exist - compare them directly
        isInterState = clientState.toLowerCase() !== shippingState.toLowerCase();
        console.log('  - Both states exist - Comparison result:', isInterState);
    } else {
        // If either state is missing, use the explicit flag or default to intra-state
        isInterState = Boolean(j.is_inter_state);
        console.log('  - Missing state data, using explicit flag:', j.is_inter_state);
    }

    console.log('FINAL INVOICE isInterState:', isInterState);

    // Determine tax percent from invoice
    const headerTaxPercent = normalizeTaxToPercent(j.tax_scheme ?? 0);
    console.log('INVOICE Tax Percent:', headerTaxPercent);

    // Calculate totals with proper GST splitting - SAME AS ESTIMATE & PI
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

    console.log('=== FINAL INVOICE GST BREAKDOWN ===');
    console.log('Inter-State:', totals.is_inter_state);
    console.log('CGST:', totals.cgst_percent + '% =', totals.cgst_amount);
    console.log('SGST:', totals.sgst_percent + '% =', totals.sgst_amount);
    console.log('IGST:', totals.igst_percent + '% =', totals.igst_amount);
    console.log('Grand Total:', totals.grand_total);
    console.log('===========================');

    // ✅ CORRECTED: Use either invoice items OR estimate items, not both
    let items: ItemVM[] = [];

    if (j.items && j.items.length > 0) {
        // Use invoice items if available
        console.log('🔄 Using Invoice Items from database');
        items = mapInvoiceItems(j.items);
    } else if (j.estimate?.items && j.estimate.items.length > 0) {
        // Fall back to estimate items if no invoice items
        console.log('🔄 Using Estimate Items from database (fallback)');
        items = mapEstimateItems(j.estimate.items);
    } else {
        // No items found
        console.log('⚠️ No items found in database');
        items = [];
    }

    // ✅ ROUND ITEM VALUES TO WHOLE RUPEES
    items = items.map(item => ({
        ...item,
        rate: Math.round(item.rate),
        line_total: Math.round(item.line_total),
        total: Math.round(item.total)
    }));

    // ✅ DEBUG: Check final items
    console.log('🎯 FINAL ITEMS FOR PDF:');
    items.forEach((item, index) => {
        console.log(`  Item ${index}:`, {
            item_name: `"${item.item_name}"`,
            description: `"${item.description}"`,
            areDifferent: item.item_name !== item.description,
            item_name_length: item.item_name?.length || 0,
            description_length: item.description?.length || 0,
            rounded_rate: item.rate,
            rounded_line_total: item.line_total
        });
    });

    const our_company = {
        name: process.env.COMPANY_SHORT || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
        legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
        phone: process.env.COMPANY_PHONE || "9920 5299 61 / 8655 0114 65 / 9152 1571 14",
        customer_email: process.env.COMPANY_EMAIL || "info@compressindia.com  sales.compressindia@gmail.com",
        tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
        address_line: process.env.COMPANY_ADDR || "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Nagar, Near SCLR Road,Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
        city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
    };

    const c: any = j.client || {};
    const shippingFromEstimate: string = j.estimate?.shipping_address || "";

    // Prefer explicit shipping fields; fallback to estimate or billing
    const ship_addr = shippingFromEstimate || c.shipping_address || c.address || "";
    const ship_city = c.shipping_city || c.city || "";
    const ship_state = c.shipping_state || c.state || "";
    const ship_pin = c.shipping_pincode || c.pin_code || "";

    // Billing (customer) fields
    const customer_address = c.address || shippingFromEstimate || "";
    const customer_city = c.city || "";
    const customer_state = c.state || "";
    const customer_pin = c.pin_code || "";

    // Compose display strings
    const customer_city_state = [customer_city, customer_state].filter(Boolean).join(", ");
    const shipping_city_state = [ship_city, ship_state].filter(Boolean).join(", ");

    // Company name fallback order (based on your Client model)
    const customer_company = c.company ?? c.client ?? "";

    // Contact person/name fallback order
    const customer_name =
        c.contact_person ??
        c.designation ??
        c.client_designation ??
        c.client ??
        "";

    // Emails/phones from your model names
    const customer_email = c.email_id ?? c.email ?? "";
    const customer_phone = c.mobile ?? c.phone ?? "";

    // GST from your model
    const customer_gstin = c.gstn ?? c.gstin ?? "";

    // Existing compact objects (kept for backward-compatibility with template)
    const customer = {
        company: customer_company,
        name: customer_name,
        address: customer_address,
        gstin: customer_gstin,
        city_state: customer_city_state,
        contact: customer_phone,
        state: customer_state,
    };

    const shipping = {
        address: ship_addr,
        city_state: shipping_city_state,
        state: ship_state,
    };

    // Full objects for complete print
    const customer_full = {
        department: c.department ?? null,
        company: customer_company || null,
        client: c.client ?? null,
        contact_person: c.contact_person ?? null,
        designation: c.designation ?? null,
        client_designation: c.client_designation ?? null,
        contact_person_number: c.contact_person_number ?? null,
        email_id: customer_email || null,
        mobile: customer_phone || null,
        gstn: customer_gstin || null,
        address: c.address ?? null,
        city: customer_city || null,
        state: customer_state || null,
        pin_code: customer_pin || null,
    };

    const shipping_full = {
        address: ship_addr || null,
        city: ship_city || null,
        state: ship_state || null,
        pincode: ship_pin || null,
    };

    const bank = {
        account_name: process.env.BANK_ACCOUNT_NAME || our_company.legal_name,
        account_no: process.env.BANK_ACCOUNT_NO || "—",
        bank_name: process.env.BANK_NAME || "—",
        ifsc: process.env.BANK_IFSC || "—",
        branch: process.env.BANK_BRANCH || "—",
    };

    const company_display_name = our_company.name;
    const company_legal_name = our_company.legal_name;

    const logo = await getLogoAsDataURL();

    // ✅ ROUND ALL MONETARY VALUES TO WHOLE RUPEES
    const roundedSubTotal = Math.round(totals.sub_total);
    const roundedDiscountAmount = Math.round(totals.discount_amount);
    const roundedCgstAmount = Math.round(totals.cgst_amount);
    const roundedSgstAmount = Math.round(totals.sgst_amount);
    const roundedIgstAmount = Math.round(totals.igst_amount);
    const roundedGrandTotal = Math.round(totals.grand_total);
    const roundedTaxable = Math.round(totals.taxable);
    const roundedTdsAmount = latestTdsPayment?.tds_amount ? Math.round(latestTdsPayment.tds_amount) : 0;
    const roundedNetAmountCredited = latestTdsPayment?.net_amount_credited ? Math.round(latestTdsPayment.net_amount_credited) : 0;

    // ✅ UPDATE AMOUNT IN WORDS WITH ROUNDED VALUE
    const amountInWords = inWordsIndian(roundedGrandTotal);

    const vm: InvoicePrintVM & {
        invoice_no: string;
        tax_date: any;
        customer: typeof customer;
        shipping: typeof shipping;
        bank: typeof bank;
        company_display_name: string;
        company_legal_name: string;
        total_before_tax: number;
        customer_full: typeof customer_full;
        shipping_full: typeof shipping_full;
        customer_state?: string;
        shipping_state?: string;
        notes?: string | null;
        service_type?: string | null;
        isInterState: boolean;
        tds_applicable: boolean;
        tds_percent?: number;
        tds_amount?: number;
        net_amount_credited?: number;
    } = {
        doc_title: "TAX Invoice",
        doc_label: "Invoice Number",
        logo,
        invoice_number: j.invoice_no ?? j.id,
        invoice_date: new Date(j.tax_date || j.creation_date || j.created_at).toLocaleDateString("en-IN"),
        due_date: "",
        our_company,
        tds_applicable: !!latestTdsPayment,
        tds_percent: latestTdsPayment?.tds_percent,
        tds_amount: roundedTdsAmount,
        net_amount_credited: roundedNetAmountCredited,
        // legacy/compact customer fields
        customer_company,
        customer_name,
        customer_email,
        customer_address,
        customer_city_state,
        customer_gstin,
        customer_phone,

        subject: j.estimate?.subject || "",
        shipping_address: ship_addr,
        shipping_city_state,
        customer_state: customer_state,
        shipping_state: ship_state,
        items,
        notes: invoiceNotes,
        service_type: serviceType,

        // ✅ USE ROUNDED VALUES FOR ALL MONETARY AMOUNTS
        sub_total: roundedSubTotal,
        discount_value: j.discount_value != null ? Number(j.discount_value) : 0,
        discount_label: j.discount_type === "percent" ? `${j.discount_value}%` : (j.discount_type === "flat" ? "Flat" : ""),
        discount_amount: roundedDiscountAmount,

        // tax breakdown - USING ROUNDED GST VALUES
        cgst_percent: totals.cgst_percent,
        sgst_percent: totals.sgst_percent,
        igst_percent: totals.igst_percent,
        cgst_amount: roundedCgstAmount,
        sgst_amount: roundedSgstAmount,
        igst_amount: roundedIgstAmount,

        grand_total: roundedGrandTotal,
        amount_in_words: amountInWords,
        terms: [
            "Goods once sold will not be taken back.",
            "Interest @24% p.a. will be charged if payment is delayed.",
            "All disputes are subject to Mumbai jurisdiction.",
        ],
        payment_status: Boolean(j.payment_status),
        payment_date: j.payment_date ? new Date(j.payment_date).toLocaleDateString("en-IN") : null,

        // ✅ ADD THIS CRITICAL PROPERTY - This is what makes IGST show up
        isInterState: isInterState,

        invoice_no: j.invoice_no ?? j.id,
        tax_date: j.tax_date || j.creation_date || j.created_at,

        customer,
        shipping,
        bank,
        company_display_name,
        company_legal_name,
        total_before_tax: roundedTaxable,

        // Full objects for printing every detail
        customer_full,
        shipping_full,
    };

    console.log('✅ FINAL ROUNDED VALUES FOR PDF:');
    console.log('  - Sub Total:', roundedSubTotal);
    console.log('  - Discount:', roundedDiscountAmount);
    console.log('  - CGST:', roundedCgstAmount);
    console.log('  - SGST:', roundedSgstAmount);
    console.log('  - IGST:', roundedIgstAmount);
    console.log('  - Grand Total:', roundedGrandTotal);
    console.log('  - TDS Amount:', roundedTdsAmount);
    console.log('  - Net Amount Credited:', roundedNetAmountCredited);

    return vm;
}
// ========== HTML ==========
export const printInvoiceHtml = async (req: Request, res: Response) => {
    try {
        const id = pickInvoiceId(req);
        if (!id) return res.status(400).type("text/plain").send("Invalid or missing invoice id");
        const vm = await buildInvoiceVM(id);
        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const tpl: string = await fs.readFile(hbsPath, "utf-8");
        // const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
};

async function renderInvoicePdfBuffer(invoiceId: string): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
        const vm = await buildInvoiceVM(invoiceId);
        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);

        // one-time safety check so we know template shows data before launching Chromium
        if (!html.includes(vm.items?.[0]?.description || "")) {
            console.warn(
                "PDF HTML does not include first item description. First item:",
                vm.items?.[0]
            );
            // write a debug file you can open in browser
            await fs.writeFile(
                path.resolve(process.cwd(), "invoice-debug.html"),
                html
            );
        }

        // Unified executablePath resolution
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
            headless: true, // or "new" if you're on a recent puppeteer and want it
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page: Page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
        await page.emulateMediaType("screen");

        // page.pdf() -> Uint8Array
        const pdfU8 = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
            preferCSSPageSize: true,
        });

        // Convert Uint8Array -> Buffer (Node.js)
        const pdfBuffer = Buffer.from(pdfU8);

        if (!pdfBuffer || pdfBuffer.length < 1000) {
            throw new Error(
                "PDF generation failed (empty buffer). Likely missing Chromium or fonts in container."
            );
        }

        return pdfBuffer;
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore close errors
        }
    }
}

// GET /invoices/:id/print.pdf
export const printInvoicePdf = async (req: Request, res: Response) => {
    let pdfBuffer: Buffer | null = null;
    try {
        const id = pickInvoiceId(req);
        if (!id) return res.status(400).type("text/plain").send("Invalid or missing invoice id");
        pdfBuffer = await renderInvoicePdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Invoice-${id}.pdf`;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Content-Encoding", "identity");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
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
                res.setHeader("Content-Length", String(chunk.length));
                return res.end(chunk);
            }
        }
        res.setHeader("Content-Length", String(total));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printInvoicePdf error:", err?.stack || err);
        return res.status(500).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
    }
};

// GET /invoicespdf?id=<uuid>
export const printInvoicePdfByQuery = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid((req.query as any).id);
        if (!id || !UUID_RX.test(id)) return res.status(400).json({ message: "Invalid invoice id format" });
        const pdfBuffer = await renderInvoicePdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Invoice-${id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printInvoicePdfByQuery error:", err);
        return res.status(500).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
    }
};
// POST /invoicespdf  { "id": "<uuid>" }
export const printInvoicePdfFromBody = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid((req.body as any)?.id || (req.body as any)?.invoice_id);
        if (!id || !UUID_RX.test(id)) return res.status(400).json({ message: "Invalid invoice id format" });
        const pdfBuffer = await renderInvoicePdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Invoice-${id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("printInvoicePdfFromBody error:", err);
        return res.status(500).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
    }
};

// ========== Existing endpoints (list/get) ==========
export const listInvoices = async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page || 1) || 1;
        const limit = Number(req.query.limit || 20) || 20;
        const offset = (page - 1) * limit;

        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const payment_status =
            req.query.payment_status !== undefined
                ? String(req.query.payment_status).toLowerCase() === "true"
                : undefined;

        const where: any = {};
        if (q) where[Op.or] = [{ invoice_no: { [Op.iLike]: `%${q}%` } }];
        if (payment_status !== undefined) where.payment_status = payment_status;

        // 👇 Only join creator if invoices.created_by exists in this environment
        const qi = db.sequelize.getQueryInterface();
        const invCols = await qi.describeTable("invoices").catch(() => ({} as any));
        const hasCreatedBy = !!(invCols as any)?.created_by;

        const include: any[] = [
            { model: db.Client, as: "client" }, // <-- Change from "client" to "client"
            {
                model: db.InvoicePayment,
                as: "payments",
                required: false,
                attributes: ["id", "paid_amount", "payment_date"],
                separate: true,
            },
        ];

        if (hasCreatedBy) {
            include.push({
                model: db.SystemUser,
                as: "createdBy", // ✅ matches models/index.ts
                attributes: ["id", "name", "email"],
                required: false,
            });
        }

        const { rows, count } = await db.Invoice.findAndCountAll({
            where,
            include,
            order: [["created_at", "DESC"]],
            limit,
            offset,
            distinct: true,
            subQuery: false,
        });

        const data = rows.map((inv: any) => {
            const c: any = inv.client || {};
            const companyName =
                c.company_name ?? c.company ?? c.client ?? c.name ?? null;

            const createdByName = hasCreatedBy ? inv.createdBy?.name ?? null : null;

            const priceOriginal = Number(inv.price_inc_tax) || 0;
            const taxAmount = inv.tax_amount != null ? Number(inv.tax_amount) : null;
            const paidAmount = Number(inv.paid_amount) || 0;
            const remainingAmount = Number(inv.remaining_amount) || 0;

            const isFullyPaid = remainingAmount <= 0;
            const hasPartialPayment = paidAmount > 0 && paidAmount < priceOriginal;
            const canAcceptPayment = remainingAmount > 0;

            return {
                id: inv.id,
                invoice_no: inv.invoice_no,
                company_name: companyName,

                price_inc_tax: priceOriginal,
                tax_amount: taxAmount,
                paid_amount: paidAmount,
                remaining_amount: remainingAmount,

                created_by: createdByName,
                created_by_id: hasCreatedBy ? inv.created_by ?? null : null,

                display_total: hasPartialPayment ? remainingAmount : priceOriginal,
                is_fully_paid: isFullyPaid,
                has_partial_payment: hasPartialPayment,
                can_accept_payment: canAcceptPayment,

                creation_date: inv.creation_date,
                tax_date: inv.tax_date,
                payment_status: isFullyPaid,
                payment_date: inv.payment_date,
                account_id: inv.account_id,
            };
        });

        return res.status(200).json({
            data,
            pagination: {
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page * limit < count,
                hasPreviousPage: page > 1,
            },
            searchQuery: q || null,
            payment_status: payment_status !== undefined ? payment_status : null,
        });
    } catch (err: any) {
        console.error("listInvoices error:", err);
        return res.status(500).json({
            message: "Failed to fetch invoices",
            error: err?.message || String(err),
        });
    }
};

export const getInvoiceById = async (req: Request, res: Response) => {
    try {
        const id = pickInvoiceId(req);
        if (!id) return res.status(400).json({ message: "Invalid invoice id format" });
        const inv = await db.Invoice.findByPk(id, {
            include: [
                { model: db.Client, as: "client", attributes: ["id", "company_name", "contact_name", "email", "phone"] },
                { model: db.InvoiceItem, as: "items" },
            ],
        });

        if (!inv) return res.status(404).json({ message: "Invoice not found" });
        const invoiceData = inv.toJSON();
        invoiceData.payment_status = !!invoiceData.payment_status;
        return res.json({ data: invoiceData });
    } catch (err: any) {
        console.error("getInvoiceById error:", err);
        return res.status(500).json({ message: "Failed to fetch invoice", error: err?.message || String(err) });
    }
};

// ========== Payment Status (PUT/POST) ==========
export const updatePaymentStatus = async (req: Request, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const raw = sanitizeUuid(req.params.id);
        if (!raw || !UUID_RX.test(raw)) { await t.rollback(); return res.status(400).json({ message: "Invalid invoice id format" }); }
        const { payment_status, payment_date } = req.body as { payment_status?: boolean; payment_date?: string };
        if (typeof payment_status !== "boolean") {
            await t.rollback();
            return res.status(400).json({ message: "Invalid payment_status. Must be a boolean value." });
        }
        const inv = await db.Invoice.findByPk(raw, { transaction: t, lock: t.LOCK.UPDATE });
        if (!inv) { await t.rollback(); return res.status(404).json({ message: "Invoice not found" }); }
        const updateData: any = { payment_status, updated_at: new Date() };
        if (payment_status) {
            updateData.payment_date = payment_date ? new Date(payment_date) : (inv as any).payment_date ?? new Date();
        } else {
            updateData.payment_date = null;
        }
        await inv.update(updateData, { transaction: t });
        await t.commit();
        const updated = await db.Invoice.findByPk(raw, {
            include: [{ model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor", "email_id", "mobile"] }],
        });
        return res.status(200).json({ message: "Payment status updated successfully", data: updated });
    } catch (err: any) {
        await t.rollback();
        console.error("updatePaymentStatus error:", err);
        return res.status(500).json({ message: "Failed to update payment status", error: err?.message || String(err) });
    }
};

// ========== Payment Status (bulk) ==========
export const bulkUpdatePaymentStatus = async (req: Request, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const { invoice_ids, payment_status, payment_date } = req.body as { invoice_ids: string[]; payment_status?: boolean; payment_date?: string };
        if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
            await t.rollback(); return res.status(400).json({ message: "invoice_ids must be a non-empty array" });
        }
        if (typeof payment_status !== "boolean") {
            await t.rollback(); return res.status(400).json({ message: "Invalid payment_status. Must be a boolean value." });
        }
        const updateData: any = { payment_status, updated_at: new Date() };
        if (payment_status) updateData.payment_date = payment_date ? new Date(payment_date) : new Date();
        else updateData.payment_date = null;
        const [affectedCount] = await db.Invoice.update(updateData, {
            where: { id: { [Op.in]: invoice_ids } },
            transaction: t,
        });
        await t.commit();
        return res.status(200).json({ message: `Payment status updated for ${affectedCount} invoice(s)`, data: { affected_count: affectedCount } });
    } catch (err: any) {
        await t.rollback();
        console.error("bulkUpdatePaymentStatus error:", err);
        return res.status(500).json({ message: "Failed to update payment status", error: err?.message || String(err) });
    }
};

export const setPaymentStatusByGet = async (req: Request, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const id = String((req.query as any).id || (req.params as any).id || "").trim();
        if (!UUID_RX.test(id)) { await t.rollback(); return res.status(400).json({ message: "Invalid invoice id format" }); }
        const inv = await db.Invoice.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!inv) { await t.rollback(); return res.status(404).json({ message: "Invoice not found" }); }
        const raw = String(req.query.status ?? "").trim().toLowerCase();
        const next = ["true", "1", "yes", "y"].includes(raw)
            ? true
            : ["false", "0", "no", "n"].includes(raw)
                ? false
                : !Boolean((inv as any).payment_status);

        let providedDate: Date | null = null;
        if (req.query.date) {
            const d = new Date(String(req.query.date));
            if (!isNaN(d.getTime())) providedDate = d;
        }
        await inv.update({
            payment_status: next,
            payment_date: next ? (providedDate ?? (inv as any).payment_date ?? new Date()) : null,
            updated_at: new Date(),
        } as any, { transaction: t });
        await t.commit();
        const updated = await db.Invoice.findByPk(id, {
            include: [{ model: db.Vendor, as: "vendorRef", attributes: ["id", "company", "vendor", "email_id", "mobile"] }],
        });
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ message: "Payment status updated successfully", data: updated });
    } catch (err: any) {
        await t.rollback();
        return res.status(500).json({ message: "Failed to update payment status", error: String(err?.message || err) });
    }
};

//= ========= List all payments with filters ==========
export const getAllPayments = async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page || 1) || 1;
        const limit = Number(req.query.limit || 20) || 20;
        const offset = (page - 1) * limit;

        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const invoice_id = (req.query.invoice_id as string) || undefined;
        const account_id = (req.query.account_id as string) || undefined;
        const payment_mode = (req.query.payment_mode as string) || undefined;
        const start_date = (req.query.start_date as string) || undefined;
        const end_date = (req.query.end_date as string) || undefined;

        // WHERE builder (parameterized)
        let whereConditions: string[] = ["1=1"];
        const queryParams: any[] = [];
        let paramCount = 0;

        if (q) {
            paramCount++;
            whereConditions.push(
                `(ip.pay_number ILIKE $${paramCount} OR ip.paid_by ILIKE $${paramCount} OR ip.payment_in ILIKE $${paramCount})`
            );
            queryParams.push(`%${q}%`);
        }

        if (invoice_id && UUID_RX.test(invoice_id)) {
            paramCount++;
            whereConditions.push(`ip.invoice_id = $${paramCount}`);
            queryParams.push(invoice_id);
        }

        if (account_id && UUID_RX.test(account_id)) {
            paramCount++;
            whereConditions.push(`ip.account_id = $${paramCount}`);
            queryParams.push(account_id);
        }

        if (payment_mode) {
            paramCount++;
            whereConditions.push(`ip.payment_mode = $${paramCount}`);
            queryParams.push(payment_mode);
        }

        if (start_date) {
            paramCount++;
            whereConditions.push(`ip.payment_date >= $${paramCount}`);
            queryParams.push(new Date(start_date));
        }

        if (end_date) {
            paramCount++;
            whereConditions.push(`ip.payment_date <= $${paramCount}`);
            queryParams.push(new Date(end_date));
        }

        const whereClause = whereConditions.join(" AND ");

        // Figure out best client display column
        const checkColumnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'clients' 
        AND column_name IN ('client', 'company', 'contact_person', 'email_id')
    `;
        const columnResult = await db.sequelize.query(checkColumnsQuery, {
            type: db.sequelize.QueryTypes.SELECT,
        });

        const has = (n: string) => (columnResult as any[]).some((c) => c.column_name === n);
        const clientDisplayCol =
            has("client") ? "client" :
                has("company") ? "company" :
                    has("contact_person") ? "contact_person" :
                        has("email_id") ? "email_id" :
                            "client";

        // MAIN QUERY:
        // Use a CTE (ipw) that computes cumulative paid per invoice using a window function.
        // We then apply filters/pagination on top of that, while still having the correct cumulative amounts.
        const orderKey = `
  COALESCE(ip.payment_date::timestamptz, ip.created_at),
  ip.created_at,
  ip.id
`;

        const mainQuery = `
  WITH ipw AS (
    SELECT
      ip.*,
      -- ✅ cumulative paid in **chronological (ASC)** order
      SUM(ip.paid_amount) OVER (
        PARTITION BY ip.invoice_id
        ORDER BY ${orderKey} ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cum_paid_asc
    FROM invoice_payments ip
  )
  SELECT
    ip.*,
    i.invoice_no,
    i.price_inc_tax AS invoice_amount,
    -- ✅ remaining AFTER this payment (uses ASC cumulative)
    GREATEST(i.price_inc_tax - ip.cum_paid_asc, 0) AS remaining_after_payment,
    i.client_id,
    c.${clientDisplayCol} AS client_display_name,
    c.client  AS client_name,
    c.company AS company_name,
    a.accountname,
    a.bankname,
    a.accountnumber,
    u.name AS created_by_name
  FROM ipw ip
  LEFT JOIN invoices i ON ip.invoice_id = i.id
  LEFT JOIN clients  c ON i.client_id = c.id
  LEFT JOIN accounts a ON ip.account_id = a.id
  LEFT JOIN system_users u ON ip.created_by = u.id
  WHERE ${whereClause}
  -- You can sort the final result any way you want (DESC here for UI):
  ORDER BY ip.payment_date DESC, ip.created_at DESC
  LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
`;

        const countQuery = `
  WITH ipw AS (
    SELECT
      ip.*,
      SUM(ip.paid_amount) OVER (
        PARTITION BY ip.invoice_id
        ORDER BY ${orderKey} ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cum_paid_asc
    FROM invoice_payments ip
  )
  SELECT COUNT(*)
  FROM ipw ip
  WHERE ${whereClause}
`;

        const mainParams = [...queryParams, limit, offset];
        const countParams = [...queryParams];

        const [payments, countResult] = await Promise.all([
            db.sequelize.query(mainQuery, {
                bind: mainParams,
                type: db.sequelize.QueryTypes.SELECT,
            }),
            db.sequelize.query(countQuery, {
                bind: countParams,
                type: db.sequelize.QueryTypes.SELECT,
            }),
        ]);

        const total = parseInt((countResult as any[])[0]?.count || "0", 10);

        const data = (payments as any[]).map((p) => ({
            id: p.id,
            pay_number: p.pay_number,
            payment_date: p.payment_date,

            // Invoice
            invoice_id: p.invoice_id,
            invoice_no: p.invoice_no,
            invoice_amount: Number(p.invoice_amount), // now correctly selected

            // Payment
            paid_amount: Number(p.paid_amount),
            paid_by: p.paid_by,
            place_of_supply: p.place_of_supply,
            payment_mode: p.payment_mode,
            payment_in: p.payment_in,
            notes: p.notes,

            // Remaining after THIS payment (what you wanted)
            remaining_after_payment: Number(p.remaining_after_payment),

            // Client + Company
            client_id: p.client_id,
            client_name: p.client_name ?? p.client_display_name ?? null,
            company_name: p.company_name ?? null,

            // Account
            account_id: p.account_id,
            account_name: p.accountname,
            bank_name: p.bankname,
            account_number: p.accountnumber,

            // Created by
            created_by: p.created_by_name || null,
            created_by_id: p.created_by,

            // Timestamps
            created_at: p.created_at,
            updated_at: p.updated_at,
        }));

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1,
            },
            filters: {
                searchQuery: q || null,
                invoice_id: invoice_id || null,
                account_id: account_id || null,
                payment_mode: payment_mode || null,
                start_date: start_date || null,
                end_date: end_date || null,
            },
        });
    } catch (err: any) {
        console.error("getAllPayments error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch payments",
            error: err?.message || String(err),
        });
    }
};

export const listPartialPayment = async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page || 1) || 1;
        const limit = Number(req.query.limit || 20) || 20;
        const offset = (page - 1) * limit;
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const client_id = (req.query.client_id as string) || undefined;

        const InvoiceModel: any = db.Invoice as any;
        const hasPaidTotalCol = !!InvoiceModel?.rawAttributes?.paid_total;
        const hasRemainingCol = !!InvoiceModel?.rawAttributes?.remaining_amount;

        const where: any = {};
        if (q) where[Op.or] = [{ invoice_no: { [Op.iLike]: `%${q}%` } }];

        // base: not fully paid
        where.payment_status = false;

        const include: any[] = [
            { model: db.Client, as: "client", required: !!client_id },
            { model: db.InvoicePayment, as: "payments", required: false },
            // include the invoice creator (same alias used elsewhere)
            {
                model: db.SystemUser,
                as: "createdBy",
                attributes: ["id", "name", "email"],
                required: false,
            },
        ];

        if (client_id && UUID_RX.test(client_id)) {
            include[0].where = { id: client_id };
        }

        if (hasPaidTotalCol || hasRemainingCol) {
            if (hasPaidTotalCol) where.paid_total = { [Op.gt]: 0 };
            if (hasRemainingCol) where.remaining_amount = { [Op.gt]: 0 };
        }

        const { rows, count } = await db.Invoice.findAndCountAll({
            where,
            include,
            order: [["created_at", "DESC"]],
            limit,
            offset,
        });

        let items = rows as any[];

        if (!hasPaidTotalCol || !hasRemainingCol) {
            items = items.filter((inv: any) => {
                const price = Math.round(Number(inv.price_inc_tax || 0));
                const paid = (inv.payments || []).reduce((s: number, p: any) => s + Math.round(Number(p.paid_amount || 0)), 0);
                return paid > 0 && paid < price; // partial
            });
        }

        const data = items.map((inv: any) => {
            const c: any = inv.client || {};

            // FIX: use the actual included alias
            const createdByName = inv.createdBy?.name || null;

            const price = Math.round(Number(inv.price_inc_tax || 0));
            const paid_from_col = inv.paid_total != null ? Math.round(Number(inv.paid_total)) : null;
            const remaining_from_col = inv.remaining_amount != null ? Math.round(Number(inv.remaining_amount)) : null;

            const paid = paid_from_col != null
                ? paid_from_col
                : (inv.payments || []).reduce((s: number, p: any) => s + Math.round(Number(p.paid_amount || 0)), 0);
            const remaining = remaining_from_col != null ? remaining_from_col : Math.max(price - paid, 0);

            // PICK the latest payment (if any) to expose pay_number + created_by
            const lastPayment = (inv.payments || []).slice().sort((a: any, b: any) => {
                const da = new Date(a.payment_date || a.created_at || 0).getTime();
                const db = new Date(b.payment_date || b.created_at || 0).getTime();
                return db - da;
            })[0] || null;

            const lastPayNumber = lastPayment?.pay_number ?? null;
            const lastPaymentCreatedBy = lastPayment?.created_by ?? null; // likely a user id

            return {
                id: inv.id,
                invoice_no: inv.invoice_no,
                client: c.company_name ?? c.company ?? c.client ?? c.name ?? null,
                created_by: createdByName,
                created_by_id: inv.created_by, // keep ID if needed
                price_inc_tax: price,
                paid_total: paid,
                remaining_amount: remaining,
                payment_status: !!inv.payment_status,
                payment_date: inv.payment_date,
                created_at: inv.created_at,

                // NEW: expose last payment info for UI
                last_pay_number: lastPayNumber,
                last_payment_created_by: lastPaymentCreatedBy,
            };
        });

        return res.status(200).json({
            data,
            pagination: {
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page * limit < count,
                hasPreviousPage: page > 1,
            },
            searchQuery: q || null,
            client_id: client_id || null,
        });
    } catch (err: any) {
        console.error("listPartialInvoices error:", err);
        return res.status(500).json({ message: "Failed to fetch partial invoices", error: err?.message || String(err) });
    }
};


async function renderPaymentSlipPdfBuffer(paymentId: string): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
        const vm = await buildPaymentSlipVM(paymentId); // Your custom function to build the data
        const hbsPath = await PAYSLIP_TPL_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);

        // Unified executablePath resolution
        const executablePath =
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            process.env.CHROME_EXECUTABLE_PATH ||
            (process.platform === "win32"
                ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                : process.platform === "darwin"
                    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                    : "/usr/bin/chromium");

        browser = await puppeteer.launch({
            headless: true, // more stable across puppeteer versions
            executablePath,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--font-render-hinting=none",
            ],
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

        const pdfBuffer = Buffer.from(pdfU8);
        if (!pdfBuffer || pdfBuffer.length < 1000) {
            throw new Error("Payment slip PDF generation failed (empty buffer).");
        }

        return pdfBuffer;
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore close errors
        }
    }
}


// ---------- HTML preview (optional) ----------
export const printPaymentSlipHtml = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid((req.params as any).payment_id || (req.query as any).payment_id);
        if (!id || !UUID_RX.test(id)) return res.status(400).send("Invalid payment id");
        const vm = await buildPaymentSlipVM(id);
        const tpl = await fs.readFile(await PAYSLIP_TPL_PROMISE, "utf-8");
        const html = Handlebars.compile(tpl)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
};

// ---------- PDF endpoints ----------
export const printPaymentSlipPdf = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid(req.params.payment_id);
        if (!id || !UUID_RX.test(id)) return res.status(400).send("Invalid payment id");

        const pdfBuffer = await renderPaymentSlipPdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Payment-Receipt-${id}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("Error generating payment slip PDF:", err);
        return res.status(500).send("Failed to generate payment slip PDF.");
    }
};

// POST /paymentslip  { "payment_id": "<uuid>" } (body)
export const printPaymentSlipPdfFromBody = async (req: Request, res: Response) => {
    try {
        const id = sanitizeUuid((req.body as any)?.payment_id);
        if (!id || !UUID_RX.test(id)) return res.status(400).json({ message: "Invalid payment id" });

        // Fetch payment slip data
        const pdfBuffer = await renderPaymentSlipPdfBuffer(id);
        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Payment-Receipt-${id}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        return res.end(pdfBuffer);
    } catch (err: any) {
        console.error("Error rendering payment slip PDF:", err);
        return res.status(500).type("text/plain").send(`Failed to render payment slip PDF: ${err?.message || err}`);
    }
};

// ✅ REWRITE: updatePaymentDetails (fixes “current transaction is aborted” by using a SAVEPOINT for TDS insert)
// NOTE: This is a drop-in replacement for ONLY this API function.

export const updatePaymentDetails = async (req: Request, res: Response) => {
    const invoiceId = String(req.params.invoiceId || "").trim();
    const UUID_RX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!UUID_RX.test(invoiceId)) {
        return res
            .status(400)
            .json({ success: false, message: "Invalid invoice ID format" });
    }

    const {
        paid_amount,
        payment_date,
        paid_by,
        place_of_supply,
        payment_mode,
        payment_in,
        account_id,
        notes,
        created_by,
        pay_number,
        tds_applicable,
        tds_percent,
        tds_amount,
        tds_type,
        net_amount_after_tds, // (kept; not used)
    } = req.body || {};

    const missing: string[] = [];
    if (paid_amount == null) missing.push("paid_amount");
    if (!payment_date) missing.push("payment_date");
    if (!paid_by) missing.push("paid_by");
    if (!payment_mode) missing.push("payment_mode");
    if (!account_id) missing.push("account_id");

    if (missing.length) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missing.join(", ")}`,
        });
    }

    try {
        const result = await db.sequelize.transaction(
            { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
            async (t: Transaction) => {
                // Lock & validate invoice
                const invoice = await db.Invoice.findByPk(invoiceId, {
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });
                if (!invoice)
                    throw Object.assign(new Error("Invoice not found"), { status: 404 });

                // ✅ Check if TDS has already been applied to this invoice
                const existingTdsPayment = await db.InvoicePayment.findOne({
                    where: {
                        invoice_id: invoiceId,
                        tds_applicable: true,
                        tds_amount: { [Op.gt]: 0 },
                    },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });

                // If TDS is already applied, prevent applying it again
                if (
                    (tds_applicable === true || tds_applicable === "true") &&
                    existingTdsPayment
                ) {
                    throw Object.assign(
                        new Error(
                            "TDS has already been applied to this invoice. Cannot apply TDS again."
                        ),
                        { status: 400 }
                    );
                }

                // Lock & validate bank account
                const bankAccount = await db.Account.findOne({
                    where: { id: account_id },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });
                if (!bankAccount)
                    throw Object.assign(new Error("Bank account not found"), {
                        status: 400,
                    });

                let paidAmountRupees = Number(paid_amount);

                if (paidAmountRupees <= 0) {
                    throw Object.assign(new Error("Payment amount must be > 0"), {
                        status: 400,
                    });
                }

                // Get current values as numbers
                const currentPaidAmount = Number(invoice.paid_amount);
                const currentRemaining = Number(invoice.remaining_amount);
                const priceIncTax = Number(invoice.price_inc_tax);

                console.log("🔍 DEBUG - Current Invoice State:", {
                    invoice_id: invoiceId,
                    current_paid_amount: currentPaidAmount,
                    current_remaining_amount: currentRemaining,
                    price_inc_tax: priceIncTax,
                    payment_amount: paidAmountRupees,
                    tds_already_applied: !!existingTdsPayment,
                });

                // ✅ Check if payment exceeds remaining amount
                if (paidAmountRupees > currentRemaining) {
                    console.log("❌ Overpayment detected, adjusting...");
                    paidAmountRupees = currentRemaining;
                }

                // Calculate TDS amounts - FIXED: Handle string "true" and boolean true
                const tdsApplicableBool =
                    tds_applicable === true || tds_applicable === "true";
                const tdsApplied = tdsApplicableBool && !existingTdsPayment; // Only apply if not already applied
                const tdsPercentage = tdsApplied ? Number(tds_percent || 2) : 0;
                const tdsDeducted = tdsApplied ? Number(tds_amount || 0) : 0;

                console.log("🔍 DEBUG - TDS Input Analysis:", {
                    tds_applicable_from_req: tds_applicable,
                    tds_applicable_type: typeof tds_applicable,
                    tds_percent_from_req: tds_percent,
                    tds_amount_from_req: tds_amount,
                    tdsApplicableBool,
                    tdsApplied,
                    tdsPercentage,
                    tdsDeducted,
                });

                // Calculate net amount that will be credited to bank (after TDS)
                const netAmountCredited = tdsApplied
                    ? Math.max(0, paidAmountRupees - tdsDeducted)
                    : paidAmountRupees;

                console.log("🔍 DEBUG - TDS Calculation:", {
                    tds_applicable: tdsApplied,
                    tds_percent: tdsPercentage,
                    tds_amount: tdsDeducted,
                    gross_paid: paidAmountRupees,
                    net_amount_credited: netAmountCredited,
                });

                // Generate pay_number if not provided
                let finalPayNumber = pay_number;
                if (!finalPayNumber) {
                    finalPayNumber = `PAY-${Date.now()}`;
                }

                // Calculate new values for invoice
                const newPaidAmount = currentPaidAmount + paidAmountRupees;
                let newRemainingAmount = currentRemaining - paidAmountRupees;

                // ✅ FORCE non-negative remaining amount
                if (newRemainingAmount < 0) newRemainingAmount = 0;

                // Check if invoice is fully paid
                const isTrulyFullyPaid = newRemainingAmount === 0;

                console.log("✅ Final Values for Update:", {
                    new_paid_amount: newPaidAmount,
                    new_remaining_amount: newRemainingAmount,
                    is_truly_fully_paid: isTrulyFullyPaid,
                });

                // ✅ UPDATE INVOICE FIRST
                await db.Invoice.update(
                    {
                        paid_amount: newPaidAmount,
                        remaining_amount: newRemainingAmount,
                        payment_status: isTrulyFullyPaid,
                        payment_date: isTrulyFullyPaid ? new Date(payment_date) : null,
                        updated_at: new Date(),
                    },
                    {
                        where: { id: invoiceId },
                        transaction: t,
                    }
                );

                // ✅ TDS Record Handling - IMPORTANT FIX:
                // If TDS insertion fails, we MUST NOT poison the parent transaction.
                // Use a SAVEPOINT (nested transaction) so errors rollback ONLY that block.
                if (tdsApplied) {
                    try {
                        await db.sequelize.transaction(
                            { transaction: t },
                            async (tSavepoint: Transaction) => {
                                const client = await db.Client.findByPk(invoice.client_id, {
                                    transaction: tSavepoint,
                                    lock: tSavepoint.LOCK.UPDATE,
                                });

                                if (client) {
                                    const companyName =
                                        client.company || client.client || "Unknown Company";

                                    const baseAmount =
                                        tdsDeducted > 0 && tdsPercentage > 0
                                            ? (tdsDeducted * 100) / tdsPercentage
                                            : 0;

                                    console.log(
                                        "📝 Creating TDS Record for partial/full payment:",
                                        {
                                            invoice_id: (invoice as any).id,
                                            invoice_no: (invoice as any).invoice_no,
                                            company_name: companyName,
                                            base_amount: baseAmount,
                                            tds_percent: tdsPercentage,
                                            tds_amount: tdsDeducted,
                                            payment_amount: paidAmountRupees,
                                        }
                                    );

                                    await db.TdsRecord.create(
                                        {
                                            invoice_id: (invoice as any).id,
                                            client_id: client.id,
                                            company_name: companyName,
                                            base_amount: baseAmount,
                                            tds_percent: tdsPercentage,
                                            tds_amount: tdsDeducted,
                                            total_amount: priceIncTax,
                                            paid_amount: tdsDeducted,
                                            remaining_amount: tdsDeducted,
                                            account_id: account_id,
                                            gst_no: (client as any).gstn || null,
                                            created_by:
                                                created_by ||
                                                (req as any).user?.userId ||
                                                (req as any).user?.id,
                                            notes: `TDS deducted from payment of ₹${paidAmountRupees}. ${tds_type === "percent"
                                                ? `Percentage: ${tdsPercentage}%`
                                                : "Fixed amount"
                                                }. Payment status: ${isTrulyFullyPaid ? "Fully Paid" : "Partially Paid"
                                                }`,
                                        },
                                        { transaction: tSavepoint }
                                    );

                                    console.log(
                                        "✅ TDS record created immediately for invoice:",
                                        (invoice as any).invoice_no
                                    );
                                } else {
                                    console.warn("⚠️ Client not found for TDS record creation");
                                }
                            }
                        );
                    } catch (tdsErr: any) {
                        // ✅ safe: nested tx rolled back, parent tx still valid
                        console.error("❌ TDS insertion failed but continuing with payment:", {
                            error: tdsErr?.message,
                            name: tdsErr?.name,
                        });
                    }
                }

                // ✅ CREATE PAYMENT RECORD
                const paymentData: any = {
                    invoice_id: invoiceId,
                    account_id: bankAccount.id,
                    payment_date: new Date(payment_date),
                    invoice_amount: priceIncTax,
                    paid_amount: paidAmountRupees,
                    paid_by: String(paid_by).trim(),
                    place_of_supply: (place_of_supply || "").trim() || null,
                    payment_mode,
                    payment_in: (payment_in || "").trim() || null,
                    notes: (notes || "").trim() || null,
                    pay_number: finalPayNumber,
                    // ✅ FIX: Use ONLY created_by
                    created_by:
                        created_by || (req as any).user?.userId || (req as any).user?.id,
                    // ✅ Add TDS info to payment record
                    tds_applicable: tdsApplied,
                    tds_percent: tdsPercentage,
                    tds_amount: tdsDeducted,
                    net_amount_credited: netAmountCredited,
                    tds_type: tds_type || (tdsApplied ? "percent" : null),
                };

                const payment = await db.InvoicePayment.create(paymentData, {
                    transaction: t,
                });

                // ✅ UPDATE BANK ACCOUNT BALANCE with NET amount (after TDS)
                const newAccountBalance =
                    Number(bankAccount.initialamount) + netAmountCredited;

                await db.Account.update(
                    { initialamount: newAccountBalance, updated_at: new Date() },
                    { where: { id: account_id }, transaction: t }
                );

                // Reload updated invoice and account
                const updatedInvoice = await db.Invoice.findByPk(invoiceId, {
                    transaction: t,
                });
                const updatedAccount = await db.Account.findByPk(account_id, {
                    transaction: t,
                });

                if (!updatedInvoice)
                    throw Object.assign(new Error("Failed to load updated invoice"), {
                        status: 500,
                    });
                if (!updatedAccount)
                    throw Object.assign(new Error("Failed to load updated account"), {
                        status: 500,
                    });

                // Response data
                const isFullyPaid = Boolean(updatedInvoice.payment_status);
                const paidAmountNumResp = Number(payment.paid_amount ?? 0);
                const finalRemaining = Number(updatedInvoice.remaining_amount ?? 0);

                // Prepare response message
                let message = "";
                if (tdsApplied) {
                    message = isFullyPaid
                        ? `🎉 FULLY PAID! ₹${paidAmountNumResp} paid (₹${tdsDeducted} TDS deducted, Net: ₹${netAmountCredited}). Invoice completed!`
                        : `✅ Payment processed! ₹${paidAmountNumResp} paid (₹${tdsDeducted} TDS deducted, Net: ₹${netAmountCredited}). Remaining: ₹${finalRemaining}`;
                } else {
                    message = isFullyPaid
                        ? `🎉 FULLY PAID! ₹${paidAmountNumResp} paid. Invoice completed!`
                        : `✅ Payment processed! ₹${paidAmountNumResp} paid. Remaining: ₹${finalRemaining}`;
                }

                return {
                    response: {
                        success: true,
                        data: {
                            payment: {
                                id: payment.id,
                                paid_amount: paidAmountNumResp,
                                paid_by: payment.paid_by,
                                payment_mode: payment.payment_mode,
                                pay_number: payment.pay_number,
                                created_at: payment.created_at,
                                tds_applicable: tdsApplied,
                                tds_amount: tdsDeducted,
                                tds_percent: tdsPercentage,
                                net_amount_credited: netAmountCredited,
                                created_by: payment.created_by,
                            },
                            invoice: {
                                id: updatedInvoice.id,
                                invoice_no: updatedInvoice.invoice_no,
                                price_inc_tax: priceIncTax,
                                paid_amount: Number(updatedInvoice.paid_amount),
                                remaining_amount: finalRemaining,
                                payment_status: isFullyPaid,
                                payment_date: updatedInvoice.payment_date,
                                is_fully_paid: isFullyPaid,
                                has_tds_applied: tdsApplied || !!existingTdsPayment,
                            },
                            account: {
                                id: updatedAccount.id,
                                accountname: updatedAccount.accountname,
                                bankname: updatedAccount.bankname,
                                accountnumber: updatedAccount.accountnumber,
                                previous_balance: Number(bankAccount.initialamount),
                                new_balance: newAccountBalance,
                                credit_amount: netAmountCredited,
                            },
                        },
                        message,
                    },
                    http: 200 as const,
                };
            }
        );

        return res.status(result.http).json(result.response);
    } catch (err: any) {
        console.error("❌ updatePaymentDetails error:", err);

        if (err?.message?.includes("TDS has already been applied")) {
            return res.status(400).json({ success: false, message: err.message });
        }
        if (err?.name === "SequelizeUniqueConstraintError") {
            return res
                .status(409)
                .json({ success: false, message: "Duplicate payment detected" });
        }
        if (err?.name === "SequelizeForeignKeyConstraintError") {
            return res.status(400).json({
                success: false,
                message: "Invalid reference - invoice or account not found",
            });
        }
        if (err?.name === "SequelizeDatabaseError") {
            if (String(err.message || "").includes("updated_by")) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Database error: The 'updated_by' field does not exist in the invoice_payments table. Please use 'created_by' instead.",
                });
            }
            if (String(err.message || "").includes("chk_remaining_amount_non_negative")) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Database trigger conflict. There might be a trigger on the invoices table interfering with payment processing.",
                });
            }
            return res
                .status(400)
                .json({ success: false, message: "Database error: " + err.message });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to process payment: " + (err.message || "Unknown error"),
        });
    }
};

export const searchInvoicesByClientName = async (req: Request, res: Response) => {
    try {
        const { clientName, page = 1, limit = 20 } = req.query;

        if (!clientName || typeof clientName !== "string" || clientName.trim() === "") {
            return res.status(400).json({ message: "Client name is required" });
        }

        const offset = (Number(page) - 1) * Number(limit);

        const { rows, count } = await db.Invoice.findAndCountAll({
            where: {
                "$client.company_name$": {
                    [Op.iLike]: `%${clientName.trim()}%`, // Partial match with case insensitivity
                },
            },
            include: [
                {
                    model: db.Client,
                    as: "client",
                    attributes: ["company_name", "client", "gstin"], // Include client info in the result
                    required: true, // Ensures that we only get invoices that have a related client
                },
            ],
            limit,
            offset,
            order: [["created_at", "DESC"]],
        });

        return res.status(200).json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                totalPages: Math.ceil(count / Number(limit)),
                currentPage: Number(page),
                itemsPerPage: Number(limit),
                hasNextPage: offset + rows.length < count,
                hasPreviousPage: offset > 0,
            },
        });
    } catch (err: any) {
        console.error("Error searching invoices by client name:", err);
        return res.status(500).json({ message: "Failed to search invoices", error: err?.message || err });
    }
};

// Add this to your invoiceController.ts
export const checkTdsStatus = async (req: Request, res: Response) => {
    try {
        const invoiceId = sanitizeUuid(req.params.invoice_id);
        if (!invoiceId || !UUID_RX.test(invoiceId)) {
            return res.status(400).json({ success: false, message: "Invalid invoice id" });
        }

        // Check if any payment with TDS exists for this invoice
        const tdsPayment = await db.InvoicePayment.findOne({
            where: {
                invoice_id: invoiceId,
                tds_applicable: true,
                tds_amount: { [Op.gt]: 0 }
            },
            attributes: ['id']
        });

        return res.status(200).json({
            success: true,
            has_tds_applied: !!tdsPayment,
            invoice_id: invoiceId
        });
    } catch (err: any) {
        console.error("checkTdsStatus error:", err);
        return res.status(500).json({
            success: false,
            message: "Failed to check TDS status",
            error: err?.message || String(err)
        });
    }
};