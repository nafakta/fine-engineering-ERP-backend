import { Request, Response } from "express";
import * as Yup from "yup";
import db from "../models";
import puppeteer, { Page } from "puppeteer";
import fs from "fs/promises";
import Handlebars from "handlebars";
import path from "path";

// Handlebars helpers
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("formatINR", (v: any) =>
    Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
);
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("json", (v: any) => JSON.stringify(v, null, 2));
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});

Handlebars.registerHelper("now", () => new Date());

// Types
interface LedgerFilters {
    client_id?: string | null;
    client_name?: string | null;
    start_date?: string | null;
    end_date?: string | null;
}

interface LedgerVM {
    doc_title: string;
    filters: {
        start_date?: string | null;
        end_date?: string | null;
        user_selected_start_date?: string | null;
        user_selected_end_date?: string | null;
        actual_start_date?: string | null;
        actual_end_date?: string | null;
    };
    client_id: string;
    client_name: string;
    company_name: string;
    mobile: string;
    email: string;
    gstin: string;
    address: string;
    opening_balance: number;
    transactions: any[];
    totals: {
        totalAmount: number;
        totalPayment: number;
        totalBalance: number;
    };
    footer_note: string;
    logo: string;
}

// Utility Functions
const sanitizeUuid = (raw: unknown): string => {
    let s = String(raw ?? "");
    s = s.replace(/^:+/, "").replace(/^"+|"+$/g, "").trim();
    s = s.replace(/[\u0000-\u001F\u007F]/g, "");
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
    return s.replace(/\/+$/, "");
};

const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (recommended for prod/docker)
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.access(fromEnv);
            return path.resolve(fromEnv);
        } catch { }
    }

    // 2️⃣ Primary standard location
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

const fileToDataUri = async (absPath: string): Promise<string | null> => {
    try {
        const buf = await fs.readFile(absPath);
        const ext = (path.extname(absPath).slice(1) || "png").toLowerCase();
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
};

async function resolveTemplateFile(rel: string): Promise<string> {
    const pathsToTry = [
        path.resolve(__dirname, "../templates", rel),
        path.resolve(__dirname, "../../templates", rel),
        path.resolve(process.cwd(), "templates", rel),
    ];

    for (const p of pathsToTry) {
        try {
            await fs.access(p);
            console.log("✅ Found template at:", p);
            return p;
        } catch {
            continue;
        }
    }
    throw new Error(`Template not found: ${rel}. Tried: ${pathsToTry.join(", ")}`);
}

const TEMPLATE_PATH_PROMISE = resolveTemplateFile("ledgerReport.hbs");

// Client Resolution
async function resolveClientId(client_id?: string | null, client_name?: string | null): Promise<string> {
    if (client_id) {
        const sanitizedId = sanitizeUuid(client_id);
        const client = await db.Client.findOne({ where: { id: sanitizedId }, attributes: ["id"] });
        if (client) return sanitizedId;
    }

    if (client_name) {
        const client = await db.Client.findOne({
            where: { client: client_name },
            attributes: ["id"]
        });
        if (client) return client.id;
        throw new Error(`Client not found with name: ${client_name}`);
    }

    throw new Error("Either client_id or client_name is required");
}

// Get Client Details - SAFE VERSION that handles missing columns
// Get Client Details - robust & normalized to { mobile, email, gstin, address }
async function getClientDetails(clientId: string): Promise<{
    mobile: string;
    email: string;
    gstin: string;
    address: string;
}> {
    try {
        // Discover columns present in public.clients
        const tableInfo = await db.sequelize.query(
            `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'clients'
      `,
            { type: db.sequelize.QueryTypes.SELECT }
        );

        const cols = new Set<string>((tableInfo as any[]).map(c => c.column_name));

        // Build a minimal attribute list using whatever exists
        const attrs: string[] = [];
        if (cols.has("mobile")) attrs.push("mobile");
        if (cols.has("email")) attrs.push("email");
        if (cols.has("email_id")) attrs.push("email_id"); // legacy name
        if (cols.has("gstin")) attrs.push("gstin");
        if (cols.has("gstn")) attrs.push("gstn");         // legacy name
        if (cols.has("address")) attrs.push("address");

        // If nothing is found, just return defaults
        if (!attrs.length) {
            return { mobile: "N/A", email: "N/A", gstin: "N/A", address: "N/A" };
        }

        const row = await db.Client.findOne({
            where: { id: clientId },
            attributes: attrs as any
        });

        const rec: any = row || {};

        // Normalize to the keys your template/VM uses
        const mobile = rec.mobile ?? "N/A";
        const email = rec.email ?? rec.email_id ?? "N/A";
        const gstin = rec.gstin ?? rec.gstn ?? "N/A";
        const address = rec.address ?? "N/A";

        return { mobile, email, gstin, address };
    } catch (e) {
        console.error("❌ Error fetching client details:", e);
        return { mobile: "N/A", email: "N/A", gstin: "N/A", address: "N/A" };
    }
}

// VM Builder
// VM Builder
async function buildLedgerVM(filters: LedgerFilters): Promise<LedgerVM> {
    const clientId = await resolveClientId(filters.client_id, filters.client_name);
    const start_date = filters.start_date || null;
    const end_date = filters.end_date || null;

    // Get additional client details (safe version that handles missing columns)
    const clientDetails = await getClientDetails(clientId);

    const sql = `
    WITH ledger_base AS (
      SELECT 
        i.client_id,
        c.client AS client_name,
        c.company AS company_name,
        (i.creation_date)::timestamptz AS txn_date,
        'INVOICE'::text AS type,
        i.invoice_no AS ref_no,
        COALESCE(i.price_inc_tax, 0)::numeric(14,2) AS debit,
        0::numeric(14,2) AS credit,
        COALESCE(i.notes, '') AS notes
      FROM public.invoices i
      JOIN public.clients c ON c.id = i.client_id
      WHERE i.client_id = :client_id::uuid

      UNION ALL

      SELECT 
        i.client_id,
        c.client AS client_name,
        c.company AS company_name,
        (ip.payment_date)::timestamptz AS txn_date,
        'PAYMENT'::text AS type,
        COALESCE(ip.pay_number, 'PAY') AS ref_no,
        0::numeric(14,2) AS debit,
        COALESCE(ip.paid_amount, 0)::numeric(14,2) AS credit,
        COALESCE(ip.notes, '') AS notes
      FROM public.invoice_payments ip
      JOIN public.invoices i ON i.id = ip.invoice_id
      JOIN public.clients c ON c.id = i.client_id
      WHERE i.client_id = :client_id::uuid
    ),
    opening AS (
      SELECT
        lb.client_id,
        COALESCE(SUM(lb.debit - lb.credit), 0)::numeric(18,2) AS opening_balance
      FROM ledger_base lb
      WHERE (:start_date::date IS NOT NULL) 
        AND (lb.txn_date::date < :start_date::date)
      GROUP BY lb.client_id
    ),
    ledger_filtered AS (
      SELECT lb.*
      FROM ledger_base lb
      WHERE 
        ( :start_date::date IS NULL OR lb.txn_date::date >= :start_date::date )
        AND ( :end_date::date   IS NULL OR lb.txn_date::date <= :end_date::date )
    ),
    date_range AS (
      SELECT 
        MIN(lf.txn_date::date) AS actual_start_date,
        MAX(lf.txn_date::date) AS actual_end_date
      FROM ledger_filtered lf
    ),
    totals AS (
      SELECT 
        lf.client_id,
        COALESCE(SUM(lf.debit),0)::numeric(18,2)  AS total_debit,
        COALESCE(SUM(lf.credit),0)::numeric(18,2) AS total_credit
      FROM ledger_filtered lf
      GROUP BY lf.client_id
    )
    SELECT 
      lf.client_id,
      lf.client_name,
      lf.company_name,
      lf.txn_date,
      lf.type,
      lf.ref_no,
      lf.debit,
      lf.credit,
      lf.notes,
      COALESCE(o.opening_balance, 0)::numeric(18,2) AS opening_balance,
      (
        COALESCE(o.opening_balance, 0)
        + SUM(lf.debit - lf.credit) OVER (
            PARTITION BY lf.client_id
            ORDER BY lf.txn_date, lf.type, lf.ref_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
      )::numeric(18,2) AS running_balance,
      COALESCE(t.total_debit, 0)::numeric(18,2)  AS total_debit,
      COALESCE(t.total_credit, 0)::numeric(18,2) AS total_credit,
      dr.actual_start_date,
      dr.actual_end_date
    FROM ledger_filtered lf
    LEFT JOIN opening o ON o.client_id = lf.client_id
    LEFT JOIN totals  t ON t.client_id = lf.client_id
    CROSS JOIN date_range dr
    ORDER BY lf.txn_date ASC, lf.type ASC, lf.ref_no ASC;
  `;

    const rows: any[] = await db.sequelize.query(sql, {
        type: db.sequelize.QueryTypes.SELECT,
        replacements: { client_id: clientId, start_date, end_date },
    });

    if (!rows.length) {
        throw new Error("No ledger data found for the client within the given date range.");
    }

    const head = rows[0];
    const opening = Number(head.opening_balance || 0);
    const totalDebit = Number(head.total_debit || 0);
    const totalCredit = Number(head.total_credit || 0);
    const closing = opening + totalDebit - totalCredit;

    const transactions = rows.map((r) => ({
        date: r.txn_date,
        transaction: r.type,
        ref_no: r.ref_no,
        amount: Number(r.debit || 0),
        payment: Number(r.credit || 0),
        running_balance: Number(r.running_balance || 0),
        notes: r.notes,
    }));

    const logo = await getLogoAsDataURL();

    // Determine which dates to show
    const displayStartDate = start_date || head.actual_start_date;
    const displayEndDate = end_date || head.actual_end_date;

    return {
        doc_title: "Client Ledger Report",
        filters: {
            start_date: displayStartDate, // Use actual dates if user didn't select
            end_date: displayEndDate,
            user_selected_start_date: start_date, // Keep original user selection
            user_selected_end_date: end_date,
            actual_start_date: head.actual_start_date, // The actual data range
            actual_end_date: head.actual_end_date
        },
        client_id: head.client_id,
        client_name: head.client_name,
        company_name: head.company_name,
        mobile: clientDetails.mobile,
        email: clientDetails.email,
        gstin: clientDetails.gstin,
        address: clientDetails.address,
        opening_balance: opening,
        transactions,
        totals: {
            totalAmount: totalDebit,
            totalPayment: totalCredit,
            totalBalance: closing,
        },
        footer_note: "Generated automatically. Values in INR. Dates in DD/MM/YYYY.",
        logo: logo,
    };
}

// Validation Schema
const ledgerSchema = Yup.object({
    q: Yup.string().trim().max(200).optional(),
    client_id: Yup.string().uuid().optional(),
    client_name: Yup.string().trim().max(200).optional(),
    start_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: Yup.number().integer().min(1).default(1),
    limit: Yup.number().integer().min(1).max(500).default(50),
});

// API Controllers
export const getClientLedger = async (req: Request, res: Response) => {
    try {
        const validated = await ledgerSchema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
        });

        const { q, client_id, client_name, start_date, end_date, page, limit } = validated;
        const offset = (page - 1) * limit;
        const q_like = q ? `%${q}%` : null;

        const finalClientId = await resolveClientId(client_id, client_name);

        const sql = `
      WITH ledger_base AS (
        SELECT 
          i.client_id,
          c.client AS client_name,
          c.company AS company_name,
          (i.creation_date)::timestamptz AS txn_date,
          'INVOICE'::text AS type,
          i.invoice_no AS ref_no,
          COALESCE(i.price_inc_tax, 0)::numeric(14,2) AS debit,
          0::numeric(14,2) AS credit,
          COALESCE(i.notes, '') AS notes
        FROM public.invoices i
        JOIN public.clients c ON c.id = i.client_id
        WHERE i.client_id = :client_id::uuid

        UNION ALL

        SELECT 
          i.client_id,
          c.client AS client_name,
          c.company AS company_name,
          (ip.payment_date)::timestamptz AS txn_date,
          'PAYMENT'::text AS type,
          COALESCE(ip.pay_number, 'PAY') AS ref_no,
          0::numeric(14,2) AS debit,
          COALESCE(ip.paid_amount, 0)::numeric(14,2) AS credit,
          COALESCE(ip.notes, '') AS notes
        FROM public.invoice_payments ip
        JOIN public.invoices i ON i.id = ip.invoice_id
        JOIN public.clients c ON c.id = i.client_id
        WHERE i.client_id = :client_id::uuid
      ),
      opening AS (
        SELECT
          lb.client_id,
          COALESCE(SUM(lb.debit - lb.credit), 0)::numeric(18,2) AS opening_balance
        FROM ledger_base lb
        WHERE (:start_date::date IS NOT NULL) 
          AND (lb.txn_date::date < :start_date::date)
        GROUP BY lb.client_id
      ),
      ledger_filtered AS (
        SELECT lb.*
        FROM ledger_base lb
        WHERE 
          ( :start_date::date IS NULL OR lb.txn_date::date >= :start_date::date )
          AND ( :end_date::date   IS NULL OR lb.txn_date::date <= :end_date::date )
      ),
      totals AS (
        SELECT 
          lf.client_id,
          COALESCE(SUM(lf.debit),0)::numeric(18,2)  AS total_debit,
          COALESCE(SUM(lf.credit),0)::numeric(18,2) AS total_credit
        FROM ledger_filtered lf
        GROUP BY lf.client_id
      ),
      counts AS (
        SELECT COUNT(*)::int AS total_count FROM ledger_filtered
      ),
      ledger_page AS (
        SELECT *
        FROM ledger_filtered
        ORDER BY txn_date ASC, type ASC, ref_no ASC
        OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
      )
      SELECT 
        lp.client_id,
        lp.client_name,
        lp.company_name,
        lp.txn_date,
        lp.type,
        lp.ref_no,
        lp.debit,
        lp.credit,
        lp.notes,
        COALESCE(o.opening_balance, 0)::numeric(18,2) AS opening_balance,
        ( COALESCE(o.opening_balance, 0)
          + SUM(lp.debit - lp.credit) OVER (
              PARTITION BY lp.client_id
              ORDER BY lp.txn_date, lp.type, lp.ref_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )
        )::numeric(18,2) AS running_balance,
        COALESCE(t.total_debit, 0)::numeric(18,2)  AS total_debit,
        COALESCE(t.total_credit, 0)::numeric(18,2) AS total_credit,
        (SELECT total_count FROM counts) AS total_count
      FROM ledger_page lp
      LEFT JOIN opening o ON o.client_id = lp.client_id
      LEFT JOIN totals t  ON t.client_id = lp.client_id
      ORDER BY lp.txn_date ASC, lp.type ASC, lp.ref_no ASC;
    `;

        const rows = await db.sequelize.query(sql, {
            type: db.sequelize.QueryTypes.SELECT,
            replacements: {
                client_id: finalClientId,
                start_date: start_date ?? null,
                end_date: end_date ?? null,
                offset,
                limit,
            },
        });

        const total_count = rows[0]?.total_count ?? 0;
        const byClient: Record<string, any> = {};

        for (const r of rows as any[]) {
            const key = r.client_id;
            if (!byClient[key]) {
                byClient[key] = {
                    client_id: r.client_id,
                    client_name: r.client_name,
                    company_name: r.company_name,
                    opening_balance: r.opening_balance,
                    total_debit: r.total_debit,
                    total_credit: r.total_credit,
                    closing_balance: Number(r.opening_balance) + Number(r.total_debit) - Number(r.total_credit),
                    entries: [],
                };
            }
            byClient[key].entries.push({
                date: r.txn_date,
                type: r.type,
                ref_no: r.ref_no,
                debit: r.debit,
                credit: r.credit,
                running_balance: r.running_balance,
                notes: r.notes,
            });
        }

        return res.json({
            success: true,
            page,
            limit,
            total_count,
            data: Object.values(byClient),
        });

    } catch (err: any) {
        console.error("Ledger API Error:", err);
        return res.status(400).json({
            success: false,
            error: err?.errors?.[0] || err?.message || "Bad request",
        });
    }
};

// Update the validation in your printLedgerHtml function
export const printLedgerHtml = async (req: Request, res: Response) => {
    try {
        const { client_id, client_name, start_date, end_date } = req.query;

        console.log("🔍 HTML Preview Request Query:", req.query);

        // Create a relaxed validation schema for HTML preview
        const htmlValidationSchema = Yup.object({
            client_id: Yup.string().uuid().optional(),
            client_name: Yup.string().trim().max(200).optional(),
            start_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
            end_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        });

        const validated = await htmlValidationSchema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
        });

        // Check if we have at least one identifier
        if (!validated.client_id && !validated.client_name) {
            // Return HTML error page instead of JSON
            const errorHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Error - Client Ledger</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                        .error { color: #d32f2f; margin: 20px 0; }
                        .info { color: #666; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <h1>Error Generating Ledger Report</h1>
                    <div class="error">Either client_id or client_name is required</div>
                    <div class="info">Please provide a client identifier and try again.</div>
                </body>
                </html>
            `;
            return res.status(400).type("html").send(errorHtml);
        }

        const vm = await buildLedgerVM({
            client_id: validated.client_id as string,
            client_name: validated.client_name as string,
            start_date: validated.start_date as string,
            end_date: validated.end_date as string,
        });

        console.log("✅ VM built successfully for HTML");

        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const template = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(template)(vm);

        console.log("✅ HTML compiled successfully");

        res.setHeader("Content-Type", "text/html");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(html);

    } catch (err: any) {
        console.error("❌ HTML Generation Error:", err);

        // Return HTML error page instead of JSON
        const errorHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error - Client Ledger</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                    .error { color: #d32f2f; margin: 20px 0; font-size: 18px; }
                    .details { color: #666; margin: 10px 0; font-size: 14px; }
                    .container { max-width: 600px; margin: 0 auto; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Error Generating Ledger Report</h1>
                    <div class="error">${err?.message || "Unknown error occurred"}</div>
                    <div class="details">Please check the parameters and try again.</div>
                </div>
            </body>
            </html>
        `;
        return res.status(500).type("html").send(errorHtml);
    }
};

// PDF Generation
async function generatePdfBuffer(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.emulateMediaType("screen");

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
        });

        return Buffer.from(pdfBuffer);
    } finally {
        await browser.close();
    }
}

export const printLedgerPdf = async (req: Request, res: Response) => {
    try {
        const { client_id, client_name, start_date, end_date, dl, download } = req.query;

        const vm = await buildLedgerVM({
            client_id: client_id as string,
            client_name: client_name as string,
            start_date: start_date as string,
            end_date: end_date as string,
        });

        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const template = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(template)(vm);

        const pdfBuffer = await generatePdfBuffer(html);
        const shouldDownload = dl === "1" || download === "1";
        const filename = `Ledger-${vm.client_name || vm.client_id}-${new Date().toISOString().split('T')[0]}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${shouldDownload ? "attachment" : "inline"}; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.setHeader("Cache-Control", "no-cache");

        return res.send(pdfBuffer);

    } catch (err: any) {
        console.error("PDF Generation Error:", err);
        return res.status(500).json({
            success: false,
            error: `Failed to generate PDF: ${err?.message || err}`,
        });
    }
};

// Debug endpoint
export const debugLedger = async (req: Request, res: Response) => {
    try {
        const { client_id, client_name, start_date, end_date } = req.query;

        const vm = await buildLedgerVM({
            client_id: client_id as string,
            client_name: client_name as string,
            start_date: start_date as string,
            end_date: end_date as string,
        });

        const hbsPath = await TEMPLATE_PATH_PROMISE;
        const template = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(template)(vm);

        // Save debug files
        await fs.writeFile("./debug_ledger.json", JSON.stringify(vm, null, 2));
        await fs.writeFile("./debug_ledger.html", html);

        return res.json({
            success: true,
            message: "Debug files generated",
            vm: {
                ...vm,
                transactions_count: vm.transactions.length,
            },
            files: {
                json: "./debug_ledger.json",
                html: "./debug_ledger.html",
            },
        });

    } catch (err: any) {
        console.error("Debug Error:", err);
        return res.status(500).json({
            success: false,
            error: err?.message || err,
        });
    }
};