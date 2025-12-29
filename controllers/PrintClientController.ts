// src/controllers/PrintController.ts
import { Request, Response } from "express";
import { v4 as uuidv4, validate as uuidValidate } from "uuid"; // Fixed import
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";

import BaseController from "./BaseController";
import logger from "../utils/logger";
import { Client } from "../models/Client";
import { Estimate } from "../models/Estimate";
import { EstimateItem } from "../models/EstimateItem";
import { Invoice } from "../models/Invoice";
import { InvoiceItem } from "../models/InvoiceItem";
import { InvoicePayment } from "../models/invoicePayment";
import db from "../models";
import { QueryTypes } from "sequelize";

/** ---------------------- Shared helpers ---------------------- */
// Fixed: Using uuidValidate directly
const isUUID = (s: any) => typeof s === "string" && uuidValidate(s);

const safeNum = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};

const round2 = (n: any) => Math.round(safeNum(n) * 100) / 100;

const clampInt = (v: any, def = 2, lo = 0, hi = 20) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
};

const fmtINR = (v: any, maxDigits: any = 2, minDigits: any = undefined) => {
    const max = clampInt(maxDigits, 2, 0, 20);
    // If min not provided, default to 0 but never above max
    const min = clampInt(minDigits, 0, 0, max);

    return safeNum(v).toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: max,
        minimumFractionDigits: min,
    });
};

const fmtDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};

const fmtQty = (v: any) => {
    const n = safeNum(v);
    return n % 1 === 0 ? String(n) : n.toFixed(3);
};

function numberToWordsINR(n: number): string {
    if (!isFinite(n)) return "";
    const a = [
        "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"
    ];
    const b = [
        "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
    ];

    const inWords = (num: number): string => {
        if (num === 0) return "zero";
        if (num < 20) return a[num];
        if (num < 100)
            return (b[Math.floor(num / 10)] + (num % 10 ? " " + a[num % 10] : "")).trim();
        if (num < 1000)
            return (a[Math.floor(num / 100)] + " hundred " + (num % 100 ? inWords(num % 100) : "")).trim();
        if (num < 100000)
            return (inWords(Math.floor(num / 1000)) + " thousand " + (num % 1000 ? inWords(num % 1000) : "")).trim();
        if (num < 10000000)
            return (inWords(Math.floor(num / 100000)) + " lakh " + (num % 100000 ? inWords(num % 100000) : "")).trim();
        return (inWords(Math.floor(num / 10000000)) + " crore " + (num % 10000000 ? inWords(num % 10000000) : "")).trim();
    };

    const rupees = Math.floor(n);
    const paise = Math.round((n - rupees) * 100);
    const main = rupees === 0 ? "zero" : inWords(rupees);
    return paise ? `${main} rupees and ${inWords(paise)} paise` : `${main} rupees`;
}

/** ---------------------- Handlebars helpers ---------------------- */
let hbRegistered = false;
function registerHandlebarsHelpers() {
    if (hbRegistered) return;
    hbRegistered = true;

    Handlebars.registerHelper("inc", (v: any) => safeNum(v) + 1);
    Handlebars.registerHelper("round2", (v: any) => round2(v));
    Handlebars.registerHelper("sum", (a: any, b: any) => safeNum(a) + safeNum(b));
    Handlebars.registerHelper("sub", (a: any, b: any) => safeNum(a) - safeNum(b));
    Handlebars.registerHelper("subtract", (a: any, b: any) => safeNum(a) - safeNum(b));
    Handlebars.registerHelper("mul", (a: any, b: any) => safeNum(a) * safeNum(b));
    Handlebars.registerHelper("formatDate", (v: any) => fmtDate(v));
    Handlebars.registerHelper("formatQty", (v: any) => {
        const n = safeNum(v);
        if (!Number.isFinite(n)) return "0";
        return n % 1 === 0 ? String(n) : n.toFixed(3);
    });
    Handlebars.registerHelper("eq", (a: any, b: any) => a == b);
    Handlebars.registerHelper("not", (a: any) => !a);
    Handlebars.registerHelper("or", (a: any, b: any) => a || b);

    // Fixed: formatINR helper with proper function signature
    Handlebars.registerHelper("formatINR", function (...args: any[]) {
        // Remove the last argument (Handlebars options)
        const allArgs = args.slice(0, -1);
        const options = args[args.length - 1];

        let value = allArgs[0];
        let max = 2;
        let min: number | undefined = undefined;

        // Check for positional arguments
        if (allArgs.length >= 2 && allArgs[1] !== undefined) {
            max = Number(allArgs[1]);
        }

        // Check for named arguments in hash
        if (options && typeof options === "object" && options.hash) {
            if (options.hash.max !== undefined) max = Number(options.hash.max);
            if (options.hash.min !== undefined) min = Number(options.hash.min);
        }

        try {
            return fmtINR(value, max, min);
        } catch {
            return String(safeNum(value));
        }
    });
}

/** ---------------------- Template loader ---------------------- */
type TemplateName = "estimate" | "invoice" | "payslip";

async function loadTemplate(templateName: TemplateName): Promise<Handlebars.TemplateDelegate> {
    const fileNameMap: Record<TemplateName, string> = {
        estimate: "invoice.hbs",
        invoice: "invoice_alt.hbs",
        payslip: "payslip.hbs"
    };

    const fileName = fileNameMap[templateName];
    const roots = [
        path.resolve(__dirname, "..", "templates"),
        path.resolve(__dirname, "..", "..", "templates"),
        path.resolve(process.cwd(), "templates"),
    ];

    let templateContent = '';
    let foundPath = '';

    for (const root of roots) {
        const filePath = path.join(root, fileName);
        try {
            await fs.access(filePath);
            templateContent = await fs.readFile(filePath, "utf-8");
            foundPath = filePath;
            logger.info("Template loaded successfully", { templateName, filePath: foundPath });
            break;
        } catch (e: any) {
            // Continue to next path
        }
    }

    if (!templateContent) {
        throw new Error(`Template file not found for ${templateName} (tried: ${fileName})`);
    }

    try {
        const compiled = Handlebars.compile(templateContent, { noEscape: true });
        return compiled;
    } catch (compileError: any) {
        logger.error("Template compilation failed", { templateName, error: compileError.message });
        throw new Error(`Template compilation failed: ${compileError.message}`);
    }
}

/** ---------------------- Company / Bank defaults ---------------------- */
const COMPANY_DEFAULT = {
    legal_name: "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED",
    address_line: "Off no.103, 1st floor, Hi Tech Premises Co-Op.Soc.Ltd, Near SCLR Road, Kurla(W)",
    city_state: "Mumbai, Maharashtra, India",
    mobile_number: "+91 8655011465",
    email_id: "sales@compressindia.in",
    website: "www.compressindia.in",
    tax_id: "27AAKCC6103D1Z0",
    state: "Maharashtra",
};

const BANK_DEFAULT = {
    account_name: "COMPRESS INDIA AIR CONDITIONING PVT. LTD",
    account_no: "50200081751743",
    bank_name: "HDFC BANK LIMITED",
    ifsc: "HDFC0007811",
    branch_addr: "NEELKANTH IT PARK, VIDYAVIHAR, MUMBAI - 400071",
};

/** ====================== CONTROLLER ====================== */
export class PrintController extends BaseController {
    constructor() {
        super();
        registerHandlebarsHelpers();
        logger.info("PrintController instantiated");
    }

    /** ---------- VM BUILDERS ---------- */
    private buildEstimateVM(estimate: any, client: any, items: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        const subTotal = items.reduce((acc, it) => acc + n(it.amount ?? n(it.qty) * n(it.rate)), 0);
        const discountVal = n(estimate.discount_value);
        const totalAmount = subTotal - discountVal;

        const gstPercent = 18;
        const gstAmount = round2((totalAmount * gstPercent) / 100);
        const grandTotal = round2(totalAmount + gstAmount);

        return {
            doc_title: "QUOTATION / ESTIMATE",
            logo: "",
            our_company: { ...COMPANY_DEFAULT },
            invoice_number: estimate.est_no ?? estimate.id,
            invoice_date: fmtDate(estimate.created_at ?? estimate.created_on),
            customer_name: client?.client ?? client?.contact_person ?? client?.company ?? "-",
            customer_company: client?.company ?? "-",
            customer_gstin: client?.gstn ?? "",
            customer_email: client?.email_id ?? "",
            customer_phone: client?.mobile ?? "",
            contact_person: client?.contact_person ?? "",
            contact_person_designation: client?.client_designation ?? client?.designation ?? "",
            customer_address: client?.address ?? "",
            customer_city_state: [client?.city, client?.state].filter(Boolean).join(", "),
            shipping_address: client?.shipping_address ?? client?.address ?? "",
            subject: estimate.subject ?? "",
            items: items.map((it, index) => ({
                sr: index + 1,
                name: it.item_desc,
                hsn: it.hsn_sac ?? "",
                make: it.make ?? "",
                qty: n(it.qty),
                unit: it.unit ?? "NOS",
                price: n(it.rate),
                gst_percent: "",
                line_total: n(it.amount ?? n(it.qty) * n(it.rate)),
            })),
            sub_total: subTotal,
            discount_value: discountVal,
            total_amount: totalAmount,
            gst_amount: gstAmount,
            gst_percent: gstPercent,
            grand_total: grandTotal,
            amount_in_words: `Amount in Words: ${numberToWordsINR(grandTotal)}`,
        };
    }

    private buildInvoiceVM(inv: any, client: any, items: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        const subTotal = items.reduce((acc, it) => acc + n(it.line_total ?? n(it.quantity) * n(it.rate)), 0);
        const discountAmt = n(inv.discount_value);
        const totalAmt = subTotal - discountAmt;

        const gstPercent = n(inv.tax_rate) || 18;
        const gstAmount = round2((totalAmt * gstPercent) / 100);
        const grandTotal = round2(totalAmt + gstAmount);

        return {
            doc_title: "TAX INVOICE",
            logo: "",
            our_company: { ...COMPANY_DEFAULT },
            pi_no: inv.invoice_no ?? inv.id,
            quotation_date: fmtDate(inv.creation_date),
            invoice_date: fmtDate(inv.creation_date),
            terms_label: "DUE ON RECEIPT.",
            tax_date: fmtDate(inv.tax_date),
            customer: {
                company: client?.company ?? client?.client ?? "-",
                address: client?.address ?? "",
                state: client?.state ?? "",
                gstin: client?.gstn ?? "",
                city_state: [client?.city, client?.state].filter(Boolean).join(", "),
            },
            customer_company: client?.company ?? "-",
            customer_name: client?.client ?? client?.contact_person ?? "-",
            customer_address: client?.address ?? "",
            customer_city_state: [client?.city, client?.state].filter(Boolean).join(", "),
            customer_gstin: client?.gstn ?? "",
            customer_email: client?.email_id ?? "",
            customer_phone: client?.mobile ?? "",
            items: items.map((it, idx) => ({
                sr: idx + 1,
                description: it.description,
                name: it.description,
                hsn_sac: it.hsn_sac ?? "",
                make: it.make ?? "",
                hsn: it.hsn_sac ?? "",
                qty: n(it.quantity),
                quantity: n(it.quantity),
                unit: it.unit ?? "NOS",
                rate: n(it.rate),
                price: n(it.rate),
                line_total: n(it.line_total ?? n(it.quantity) * n(it.rate)),
                total: n(it.line_total ?? n(it.quantity) * n(it.rate)),
            })),
            sub_total: subTotal,
            discount_amount: discountAmt,
            discount_value: discountAmt,
            total_amount: totalAmt,
            gst_amount: gstAmount,
            gst_percent: gstPercent,
            grand_total: grandTotal,
            amount_in_words: numberToWordsINR(grandTotal),
            bank: { ...BANK_DEFAULT },
        };
    }

    private buildPaymentVM(pay: any, invoice: any, client: any, history: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        const paymentHistory = history.map((h) => ({
            invoice_number: invoice.invoice_no ?? invoice.id,
            invoice_date: fmtDate(invoice.creation_date),
            invoice_amount: n(invoice.amount ?? invoice.price_inc_tax ?? 0),
            payment_amount: n(h.paid_amount),
            payment_date: fmtDate(h.payment_date),
            is_current_invoice: h.id === pay.id,
        }));

        const totals = {
            paid: n(pay.paid_amount),
            invoice_amount: n(pay.invoice_amount || invoice.price_inc_tax || invoice.amount),
            balance_after: Math.max(0, n(invoice.remaining_amount)),
        };

        return {
            logo: "",
            company_display_name: COMPANY_DEFAULT.legal_name,
            receipt_no: pay.pay_number || pay.id,
            receipt_date: fmtDate(pay.payment_date),
            invoice: {
                invoice_no: invoice.invoice_no ?? invoice.id,
                invoice_date: fmtDate(invoice.creation_date),
            },
            payment: {
                payment_mode: pay.payment_mode,
                payment_date: fmtDate(pay.payment_date),
                payment_in: pay.payment_in ?? "",
                paid_by: pay.paid_by,
                notes: pay.notes ?? "",
            },
            customer: {
                company: client?.company ?? client?.client ?? "-",
                name: client?.contact_person ?? client?.client ?? "",
                address: client?.address ?? "",
                city_state: [client?.city, client?.state].filter(Boolean).join(", "),
                gstin: client?.gstn ?? "",
                contact: client?.mobile ?? client?.email_id ?? "",
            },
            payment_history: paymentHistory,
            amounts: totals,
            amount_in_words: numberToWordsINR(totals.paid),
        };
    }

    /** ---------- PDF RENDERING ---------- */
    private async renderTemplateToPDF(
        templateName: TemplateName,
        vm: any,
        logoUrl: string = ""
    ): Promise<Buffer> {
        let browser: any = null;

        try {
            vm.logo = logoUrl || "";

            logger.info("Starting PDF generation", { templateName });

            const template = await loadTemplate(templateName);
            const html = template(vm);

            logger.info("HTML generated successfully", {
                templateName,
                htmlLength: html.length,
            });

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

            const pdf = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" },
            } as any);

            if (!pdf || pdf.length === 0) {
                throw new Error("Empty PDF buffer generated");
            }

            logger.info("PDF generated successfully", {
                templateName,
                pdfSize: pdf.length,
            });
            return pdf;
        } catch (error: any) {
            logger.error("PDF generation failed", {
                templateName,
                error: error.message,
                stack: error.stack,
            });
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (e) {
                    logger.warn("Browser close error", { error: e });
                }
            }
        }
    }

    /** --------------------- PDF endpoints --------------------- */
    public renderEstimatePDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logoUrl = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid estimate id", 400);
            }

            const estimate = await Estimate.findByPk(id);
            if (!estimate) {
                return this.sendError(res, { id }, "Estimate not found", 404);
            }

            const client = await Client.findByPk(estimate.client_id);
            const items = await EstimateItem.findAll({
                where: { estimate_id: estimate.id },
                order: [["id", "ASC"]],
            });

            const vm = this.buildEstimateVM(estimate, client, items);
            const pdf = await this.renderTemplateToPDF("estimate", vm, logoUrl);

            const filename = `estimate_${vm.invoice_number}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderEstimatePDF error", {
                err: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, {}, `Failed to render estimate PDF: ${err?.message}`, 500);
        }
    };

    public renderInvoicePDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logoUrl = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid invoice id", 400);
            }

            const inv = await Invoice.findByPk(id);
            if (!inv) {
                return this.sendError(res, { id }, "Invoice not found", 404);
            }

            const client = await Client.findByPk(inv.client_id);
            const items = await InvoiceItem.findAll({
                where: { invoice_id: inv.id },
                order: [["created_at", "ASC"]],
            });

            const vm = this.buildInvoiceVM(inv, client, items);
            const pdf = await this.renderTemplateToPDF("invoice", vm, logoUrl);

            const filename = `invoice_${vm.pi_no}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderInvoicePDF error", {
                err: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, {}, `Failed to render invoice PDF: ${err?.message}`, 500);
        }
    };

    public renderPaymentPDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logoUrl = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid payment id", 400);
            }

            const pay = await InvoicePayment.findByPk(id);
            if (!pay) {
                return this.sendError(res, { id }, "Payment not found", 404);
            }

            const invoice = await Invoice.findByPk(pay.invoice_id);
            if (!invoice) {
                return this.sendError(res, { invoice_id: pay.invoice_id }, "Related invoice not found", 404);
            }

            const client = await Client.findByPk(invoice.client_id);
            const history = await InvoicePayment.findAll({
                where: { invoice_id: invoice.id },
                order: [["payment_date", "ASC"]],
            });

            const vm = this.buildPaymentVM(pay, invoice, client, history);
            const pdf = await this.renderTemplateToPDF("payslip", vm, logoUrl);

            const filename = `payment_${vm.receipt_no}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderPaymentPDF error", {
                err: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, {}, `Failed to render payment PDF: ${err?.message}`, 500);
        }
    };

    // GET /api/print/client-activity/:clientId?q=<optional search>
    public getClientActivity = async (req: Request, res: Response) => {
        const { clientId } = req.params;
        const searchTerm = String(req.query.q ?? "").trim();

        try {
            // 1. Enhanced validation
            if (!isUUID(clientId)) {
                return this.sendError(res, { clientId }, "Invalid client ID format", 400);
            }

            // 2. Verify client exists first
            const clientExists = await Client.findByPk(clientId, {
                attributes: ['id'],
                raw: true
            });

            if (!clientExists) {
                return this.sendError(res, { clientId }, "Client not found", 404);
            }

            // 3. Prepare search pattern safely
            let searchPattern = '';
            let hasSearchTerm = false;

            if (searchTerm.length > 0) {
                searchPattern = `%${searchTerm.replace(/([%_\\])/g, "\\$1")}%`;
                hasSearchTerm = true;
            }

            // 4. Optimized SQL with parameterized queries and CTE
            const query = `
            WITH invoice_data AS (
                SELECT 
                    i.id AS invoice_id,
                    i.created_at AS created_at,
                    i.invoice_no AS invoice_no,
                    i.client_id,
                    i.estimate_id,
                    COALESCE(i.price_inc_tax, i.amount, 0) AS invoice_amount,
                    COALESCE(SUM(ip.paid_amount), 0) AS total_paid,
                    CASE 
                        WHEN COALESCE(SUM(ip.paid_amount), 0) >= COALESCE(i.price_inc_tax, i.amount, 0) 
                        THEN 'Paid' 
                        ELSE 'Unpaid' 
                    END AS payment_status,
                    MAX(ip.payment_date) AS last_payment_date
                FROM invoices i
                LEFT JOIN invoice_payments ip ON ip.invoice_id = i.id
                WHERE i.client_id = :clientId
                GROUP BY i.id, i.created_at, i.invoice_no, i.estimate_id, i.price_inc_tax, i.amount
            ),
            latest_payments AS (
                SELECT DISTINCT ON (invoice_id)
                    invoice_id,
                    id AS payment_id,
                    pay_number AS payment_number
                FROM invoice_payments
                WHERE invoice_id IN (SELECT invoice_id FROM invoice_data)
                ORDER BY invoice_id, payment_date DESC, created_at DESC
            ),
            estimate_data AS (
                SELECT 
                    e.id AS estimate_id,
                    e.created_at AS created_at,
                    e.est_no AS est_no,
                    e.subject AS subject,
                    0 AS total_paid,
                    0 AS invoice_amount,
                    '—' AS payment_status
                FROM estimates e
                WHERE e.client_id = :clientId
                  AND NOT EXISTS (
                      SELECT 1 FROM invoices i 
                      WHERE i.estimate_id = e.id
                  )
                  AND (COALESCE(e.est_no, '') <> '' OR COALESCE(e.subject, '') <> '')
            )
            
            SELECT 
                'INVOICE' AS type,
                id.invoice_id AS id,
                id.created_at,
                id.invoice_no AS label_no,
                id.estimate_id,
                e.est_no AS estimate_no,
                COALESCE(e.subject, '') AS subject,
                id.total_paid,
                id.invoice_amount,
                id.payment_status,
                lp.payment_id AS latest_payment_id,
                lp.payment_number AS latest_payment_number,
                id.last_payment_date
            FROM invoice_data id
            LEFT JOIN estimates e ON e.id = id.estimate_id
            LEFT JOIN latest_payments lp ON lp.invoice_id = id.invoice_id
            
            ${hasSearchTerm ? `
                WHERE (
                    id.invoice_no ILIKE :searchPattern
                    OR COALESCE(e.est_no, '') ILIKE :searchPattern
                    OR COALESCE(e.subject, '') ILIKE :searchPattern
                    OR id.payment_status ILIKE :searchPattern
                )
            ` : ''}
            
            UNION ALL
            
            SELECT 
                'ESTIMATE' AS type,
                ed.estimate_id AS id,
                ed.created_at,
                '—' AS label_no,
                ed.estimate_id,
                ed.est_no AS estimate_no,
                ed.subject AS subject,
                ed.total_paid,
                ed.invoice_amount,
                ed.payment_status,
                NULL AS latest_payment_id,
                NULL AS latest_payment_number,
                NULL AS last_payment_date
            FROM estimate_data ed
            
            ${hasSearchTerm ? `
                WHERE (
                    ed.est_no ILIKE :searchPattern
                    OR ed.subject ILIKE :searchPattern
                )
            ` : ''}
            
            ORDER BY created_at DESC
        `;

            // 5. Execute query with proper parameters
            const replacements: any = { clientId };
            if (hasSearchTerm) {
                replacements.searchPattern = searchPattern;
            }

            const rows: any[] = await db.sequelize.query(query, {
                replacements,
                type: QueryTypes.SELECT,
                logging: false // Changed from console.log to false for production
            });

            // 6. Transform data for frontend
            const normalized = rows.map((row: any) => ({
                type: row.type as "INVOICE" | "ESTIMATE",
                id: row.id,
                created_at: row.created_at,
                invoiceId: row.type === 'INVOICE' ? row.id : null,
                estimateId: row.type === 'ESTIMATE' ? row.id : row.estimate_id,
                labelNo: row.label_no || "—",
                estimateNo: row.estimate_no || "—",
                subject: row.subject || "—",
                paymentStatus: row.payment_status,
                latestPaymentId: row.latest_payment_id || null,
                latestPaymentNumber: row.latest_payment_number || null,
                lastPaymentDate: row.last_payment_date,
                invoiceAmount: row.invoice_amount,
                totalPaid: row.total_paid,
                balanceDue: Math.max(0, row.invoice_amount - row.total_paid)
            }));

            // 7. Return success response
            return this.sendSuccess(res, {
                rows: normalized,
                clientId,
                searchTerm: searchTerm || null,
                count: normalized.length
            }, "Client activity loaded successfully", 200);

        } catch (error: any) {
            // 8. Enhanced error handling with logging
            logger.error("getClientActivity failed", {
                error: error.message,
                stack: error.stack,
                clientId,
                searchTerm,
                originalError: error.original?.message || error.original
            });

            // 9. Provide more specific error messages
            let errorMessage = "Failed to load client activity";
            let statusCode = 500;

            if (error.name === 'SequelizeDatabaseError') {
                errorMessage = "Database error occurred";
            } else if (error.name === 'SequelizeConnectionError') {
                errorMessage = "Database connection failed";
                statusCode = 503;
            }

            return this.sendError(res, {
                error: error.message,
                type: error.name
            }, errorMessage, statusCode);
        }
    };

    public clientsByDoc = async (req: Request, res: Response) => {
        try {
            logger.info("clientsByDoc API called", {
                query: req.query,
                originalUrl: req.originalUrl
            });

            const qRaw = String(req.query.q ?? "").trim();
            const limit = Math.min(Number(req.query.limit ?? 20), 100);
            const offset = Math.max(Number(req.query.offset ?? 0), 0);

            if (!qRaw) {
                logger.info("Empty search query");
                return this.sendSuccess(res, { rows: [], total: 0 }, "Empty search query", 200);
            }

            // Escape for LIKE pattern
            const escapeLike = (s: string) => s.replace(/([%_\\])/g, "\\$1");
            const pat = `%${escapeLike(qRaw)}%`;

            logger.info("Searching with pattern", { pat, qRaw });

            try {
                const rows = await db.sequelize.query(
                    `
WITH matches AS (
    SELECT
        c.id AS client_id,
        COALESCE(NULLIF(c.company,''), NULLIF(c.client,''), c.contact_person, '-') AS client_name,
        c.address,
        c.city,
        c.state,
        c.gstn,
        c.email_id,
        c.mobile,
        e.est_no AS doc_no,
        e.id AS doc_id,
        'ESTIMATE'::text AS doc_type,
        e.created_at AS doc_created_at,
        e.subject AS doc_subject
    FROM estimates e
    INNER JOIN clients c ON c.id = e.client_id
    WHERE (
        e.est_no ILIKE :pat
        OR e.subject ILIKE :pat
    )

    UNION ALL

    SELECT
        c.id AS client_id,
        COALESCE(NULLIF(c.company,''), NULLIF(c.client,''), c.contact_person, '-') AS client_name,
        c.address,
        c.city,
        c.state,
        c.gstn,
        c.email_id,
        c.mobile,
        i.invoice_no AS doc_no,
        i.id AS doc_id,
        'INVOICE'::text AS doc_type,
        i.created_at AS doc_created_at,
        NULL::text AS doc_subject
    FROM invoices i
    INNER JOIN clients c ON c.id = i.client_id
    WHERE (
        i.invoice_no ILIKE :pat
    )
)
SELECT * FROM matches
ORDER BY doc_created_at DESC
LIMIT :limit OFFSET :offset
                `,
                    {
                        replacements: { pat, limit, offset },
                        type: QueryTypes.SELECT
                    }
                );

                const totalRows = await db.sequelize.query(
                    `
WITH matches AS (
    SELECT c.id AS client_id
    FROM estimates e
    INNER JOIN clients c ON c.id = e.client_id
    WHERE (
        e.est_no ILIKE :pat
        OR e.subject ILIKE :pat
    )
    UNION ALL
    SELECT c.id AS client_id
    FROM invoices i
    INNER JOIN clients c ON c.id = i.client_id
    WHERE (
        i.invoice_no ILIKE :pat
    )
)
SELECT COUNT(*) AS total FROM matches
                `,
                    { replacements: { pat }, type: QueryTypes.SELECT }
                );

                const total = Number((totalRows?.[0] as any)?.total ?? 0);

                logger.info("Search completed", {
                    searchTerm: qRaw,
                    resultsFound: rows.length,
                    totalMatches: total
                });

                return this.sendSuccess(res, { rows, total }, "Search completed", 200);

            } catch (dbError: any) {
                logger.error("Database error in clientsByDoc", {
                    error: dbError.message,
                    stack: dbError.stack
                });
                return this.sendError(res, {}, `Database error: ${dbError.message}`, 500);
            }

        } catch (err: any) {
            logger.error("clientsByDoc fatal error", {
                error: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, {}, `Server error: ${err?.message}`, 500);
        }
    };

}

export default new PrintController();