// src/controllers/vendorLedgerController.ts
import { Request, Response } from "express";
import { Op } from "sequelize";
import fs from "fs/promises";
import path from "path";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";
import * as Yup from "yup";
import db from "../models";
import { promisify } from "util";

export interface VendorLedgerFilters {
    start_date?: string;
    end_date?: string;
    vendor_id?: string;
}

export interface VendorLedgerTransaction {
    date: Date;
    transaction: string;
    ref_no: string;
    bill_number?: string | null;
    pay_number?: string | null;
    po_number?: number | null; // Add this for PO number
    po_id?: string | null; // Add this for PO ID
    amount: number;
    payment: number;
    running_balance: number;
    type: "bill" | "payment";
}

export interface VendorLedgerResult {
    vendor: any;
    transactions: VendorLedgerTransaction[];
    totals: {
        totalAmount: number;
        totalPayment: number;
        totalBalance: number;
    };
    dateRange?: {
        startDate: Date | null;
        endDate: Date | null;
        hasDateFilter: boolean;
        userProvidedStartDate: string | null;
        userProvidedEndDate: string | null;
    };
}

export class VendorLedgerController {
    private static parseDateOnly(d?: string): Date | null {
        if (!d) return null;
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? null : dt;
    }

    private static toNumber(n: any): number {
        if (n === null || n === undefined) return 0;
        const x = typeof n === "string" ? parseFloat(n) : Number(n);
        return Number.isFinite(x) ? x : 0;
    }

    private static async getVendorLedgerData(
        filters: VendorLedgerFilters
    ): Promise<VendorLedgerResult[]> {
        // helpers
        const toPlain = (m: any) => (m?.get ? m.get({ plain: true }) : m);
        const toNum = (v: any) => VendorLedgerController.toNumber(v);
        const toDate = (v: any): Date => (v instanceof Date ? v : new Date(String(v)));

        // Build WHEREs with optional ranges
        const billWhere: any = {};
        const payWhere: any = {};

        if (filters.vendor_id) {
            billWhere.vendor_id = filters.vendor_id;
            payWhere.vendor_id = filters.vendor_id;
        }

        // Store original filters to know if user provided dates
        const hasDateFilter = !!(filters.start_date || filters.end_date);

        if (filters.start_date && filters.end_date) {
            billWhere.bill_date = { [Op.between]: [filters.start_date, filters.end_date] };
            payWhere.payment_date = { [Op.between]: [filters.start_date, filters.end_date] };
        } else if (filters.start_date) {
            billWhere.bill_date = { [Op.gte]: filters.start_date };
            payWhere.payment_date = { [Op.gte]: filters.start_date };
        } else if (filters.end_date) {
            billWhere.bill_date = { [Op.lte]: filters.end_date };
            payWhere.payment_date = { [Op.lte]: filters.end_date };
        }

        // --- fetch (with correct aliases) -----------------------------------------
        const [bills, payments] = await Promise.all([
            db.OrderBill.findAll({
                where: billWhere,
                include: [
                    {
                        model: db.Vendor,
                        as: "vendorRef",
                        required: true,
                        attributes: [
                            "id",
                            "vendor",
                            "company",
                            "mobile",
                            "email_id",
                            "city",
                            "state",
                            "gstin",
                            "address",
                        ],
                    },
                    {
                        model: db.PurchaseOrder,
                        as: "purchaseOrder",
                        required: false,
                        attributes: ["id", "po_number"],
                    },
                ],
                order: [["bill_date", "ASC"]],
            }),
            db.VendorBillPayment.findAll({
                where: payWhere,
                include: [
                    {
                        model: db.Vendor,
                        as: "vendor",
                        required: true,
                        attributes: [
                            "id",
                            "vendor",
                            "company",
                            "mobile",
                            "email_id",
                            "city",
                            "state",
                            "gstin",
                            "address",
                        ],
                    },
                    {
                        model: db.OrderBill,
                        as: "orderBill",
                        required: false,
                        attributes: ["id", "bill_number"],
                        include: [{
                            model: db.PurchaseOrder,
                            as: "purchaseOrder",
                            required: false,
                            attributes: ["id", "po_number"],
                        }],
                    },
                ],
                order: [["payment_date", "ASC"]],
            }),
        ]);

        // --- group by vendor -------------------------------------------------------
        const vendorMap = new Map<string, VendorLedgerResult>();
        const vendorDateRanges = new Map<string, { minDate: Date | null; maxDate: Date | null }>();

        // Helper to initialize ledger
        const initializeLedger = (vendorData: any, vendorId: string, date: Date) => {
            vendorMap.set(vendorId, {
                vendor: vendorData,
                transactions: [],
                totals: { totalAmount: 0, totalPayment: 0, totalBalance: 0 },
                dateRange: {
                    startDate: null,
                    endDate: null,
                    hasDateFilter: hasDateFilter,
                    userProvidedStartDate: filters.start_date || null,
                    userProvidedEndDate: filters.end_date || null,
                },
            });
            vendorDateRanges.set(vendorId, {
                minDate: date,
                maxDate: date,
            });
        };

        // Process Bills (Debit entries)
        for (const bill of bills) {
            const b = bill as any;
            const vendorId: string = b.vendor_id;
            const billDate = toDate(b.bill_date);
            const billNumber = b.bill_number || `BILL-${String(b.id).slice(0, 8)}`;

            // Get PO number if available
            const poNumber = b.purchaseOrder?.po_number || null;
            const poId = b.purchaseOrder?.id || null;

            // Create reference number showing both bill number and PO number
            let refNo = billNumber;
            if (poNumber) {
                refNo = `${billNumber} (PO: ${poNumber})`;
            }

            if (!vendorMap.has(vendorId)) {
                initializeLedger(toPlain(b.vendorRef), vendorId, billDate);
            }

            const ledger = vendorMap.get(vendorId)!;
            const dateRange = vendorDateRanges.get(vendorId)!;

            // Update min/max dates
            if (!dateRange.minDate || billDate < dateRange.minDate) {
                dateRange.minDate = billDate;
            }
            if (!dateRange.maxDate || billDate > dateRange.maxDate) {
                dateRange.maxDate = billDate;
            }

            ledger.transactions.push({
                date: billDate,
                transaction: "Purchase Bill",
                ref_no: refNo,
                bill_number: billNumber,
                po_number: poNumber,
                po_id: poId,
                amount: toNum(b.total_amount),
                payment: 0,
                running_balance: 0,
                type: "bill",
            });
        }

        // Process Payments (Credit entries)
        for (const payment of payments) {
            const pay = payment as any;
            const vendorId: string = pay.vendor_id;
            const paymentDate = toDate(pay.payment_date);
            const payNumber = pay.pay_number || `PAY-${String(pay.id).slice(0, 8)}`;

            // Get PO number if available (from payment's purchaseOrder or through orderBill)
            const poNumber = pay.purchaseOrder?.po_number ||
                (pay.orderBill?.purchaseOrder?.po_number) || null;
            const poId = pay.purchaseOrder?.id ||
                (pay.orderBill?.purchaseOrder?.id) || null;

            // Get Bill number from associated orderBill
            const billNumber = pay.orderBill?.bill_number || null;

            // Create reference number showing ONLY payment number and bill number
            // Format: PAY_NUMBER (Bill: BILL_NUMBER)
            let refNo = payNumber;
            if (billNumber) {
                refNo = `${payNumber} (Bill: ${billNumber})`;
            }
            // PO number is NOT included in the payment reference

            if (!vendorMap.has(vendorId)) {
                initializeLedger(toPlain(pay.vendor), vendorId, paymentDate);
            }

            const ledger = vendorMap.get(vendorId)!;
            const dateRange = vendorDateRanges.get(vendorId)!;

            // Update min/max dates
            if (!dateRange.minDate || paymentDate < dateRange.minDate) {
                dateRange.minDate = paymentDate;
            }
            if (!dateRange.maxDate || paymentDate > dateRange.maxDate) {
                dateRange.maxDate = paymentDate;
            }

            ledger.transactions.push({
                date: paymentDate,
                transaction: "Payment",
                ref_no: refNo,
                pay_number: payNumber,
                bill_number: billNumber,
                po_number: poNumber,
                po_id: poId,
                amount: 0,
                payment: toNum(pay.paid_amount),
                running_balance: 0,
                type: "payment",
            });
        }

        // --- sort, compute running balance & totals --------------------------------
        for (const [vendorId, ledger] of vendorMap) {
            const dateRange = vendorDateRanges.get(vendorId);

            // Sort by date; for same date, show bills before payments
            ledger.transactions.sort((a, b) => {
                const da = a.date.getTime();
                const db = b.date.getTime();
                if (da !== db) return da - db;
                // bills (debit) first
                if (a.type === b.type) return 0;
                return a.type === "bill" ? -1 : 1;
            });

            let running = 0;
            let totalAmt = 0;
            let totalPay = 0;

            for (const t of ledger.transactions) {
                if (t.type === "bill") {
                    running += t.amount;
                    totalAmt += t.amount;
                } else {
                    running -= t.payment;
                    totalPay += t.payment;
                }
                t.running_balance = running;
            }

            ledger.totals.totalAmount = totalAmt;
            ledger.totals.totalPayment = totalPay;
            ledger.totals.totalBalance = running;

            // Set actual date range based on data
            if (dateRange && ledger.dateRange) {
                if (!hasDateFilter) {
                    // When no date filter provided, show the actual min/max dates from data
                    ledger.dateRange.startDate = dateRange.minDate;
                    ledger.dateRange.endDate = dateRange.maxDate;
                } else {
                    // When date filter provided, use user's selected dates or fallback to actual dates
                    ledger.dateRange.startDate = filters.start_date
                        ? new Date(filters.start_date)
                        : dateRange.minDate;
                    ledger.dateRange.endDate = filters.end_date
                        ? new Date(filters.end_date)
                        : dateRange.maxDate;
                }
            }
        }

        return Array.from(vendorMap.values());
    }

    // === /vendors/ledger/list → return FULL ledgers (what your frontend expects)
    static async getVendorLedgerList(req: Request, res: Response) {
        try {
            const filters: VendorLedgerFilters = {
                start_date: req.query.start_date as string,
                end_date: req.query.end_date as string,
                vendor_id: req.query.vendor_id as string,
            };

            const ledgers = await VendorLedgerController.getVendorLedgerData(filters);

            // If your frontend expects total_count of the first vendor's transactions:
            const total_count = ledgers.length > 0 ? ledgers[0].transactions.length : 0;

            return res.json({
                success: true,
                data: ledgers,
                total_count,
                filters,
                // Add metadata about date range
                dateRangeInfo: ledgers.length > 0 ? {
                    hasDateFilter: !!filters.start_date || !!filters.end_date,
                    userProvidedStartDate: filters.start_date,
                    userProvidedEndDate: filters.end_date,
                    actualStartDate: ledgers[0]?.dateRange?.startDate,
                    actualEndDate: ledgers[0]?.dateRange?.endDate,
                } : null,
            });
        } catch (error) {
            console.error("Error fetching vendor ledger list:", error);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    }

    // === /vendors/ledger/report → single vendor PDF
    static async getVendorLedgerReport(req: Request, res: Response) {
        try {
            const filters: VendorLedgerFilters = {
                start_date: req.query.start_date as string,
                end_date: req.query.end_date as string,
                vendor_id: req.query.vendor_id as string,
            };

            const ledgers = await VendorLedgerController.getVendorLedgerData(filters);

            if (ledgers.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No data found for the given filters",
                });
            }

            if (filters.vendor_id && ledgers.length === 1) {
                const ledger = ledgers[0];
                const pdfBytes = await VendorLedgerController.generateVendorPDF(ledger, filters);
                const buf = Buffer.from(pdfBytes);

                const filename = `vendor-ledger-${ledger.vendor.vendor}-${filters.start_date || "all"}-to-${filters.end_date || "now"}.pdf`;
                const inline = String(req.query.inline || "").toLowerCase() === "1";

                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Length", buf.length.toString());
                res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);

                return res.end(buf);
            }

            return res.status(400).json({
                success: false,
                message: "Combined PDF for multiple vendors is not implemented. Please select a single vendor.",
            });
        } catch (error) {
            console.error("Error generating vendor ledger report:", error);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    }

    static async printVendorLedgerHtml(req: Request, res: Response) {
        try {
            const filters: VendorLedgerFilters = {
                start_date: req.query.start_date as string,
                end_date: req.query.end_date as string,
                vendor_id: req.query.vendor_id as string,
            };

            // Validate vendor_id early
            if (!filters.vendor_id) {
                return res.status(400).json({
                    success: false,
                    message: "vendor_id is required",
                });
            }

            // Fetch data
            const ledgers = await VendorLedgerController.getVendorLedgerData(filters);

            if (!Array.isArray(ledgers) || ledgers.length === 0) {
                console.warn(`[VendorLedger] No ledger rows found for vendor_id=${filters.vendor_id}`);
                return res.status(404).json({
                    success: false,
                    message: "No data found for the given filters",
                });
            }

            const ledger = ledgers[0];

            // Register helpers (idempotent)
            VendorLedgerController.registerHandlebarsHelpers();

            // Get logo as data URL (returns fallback if not found)
            const logoDataUrl = await VendorLedgerController.getLogoAsDataURL();


            // Resolve template path using your helper (tries multiple locations)
            let templatePath: string;
            try {
                templatePath = await VendorLedgerController.resolveTemplateFile("vendorLedgerTemplate.hbs");
            } catch (err) {
                console.error("[VendorLedger] Template resolution failed:", err);
                return res.status(500).json({
                    success: false,
                    message: "Template file not found - checked multiple locations",
                });
            }

            // Read and compile template
            let templateContent: string;
            try {
                templateContent = await fs.readFile(templatePath, "utf8");
            } catch (err) {
                console.error("[VendorLedger] Failed to read template:", templatePath, err);
                return res.status(500).json({
                    success: false,
                    message: "Failed to read template file",
                });
            }

            let template: HandlebarsTemplateDelegate;
            try {
                template = Handlebars.compile(templateContent);
            } catch (err) {
                console.error("[VendorLedger] Handlebars compile error:", err);
                return res.status(500).json({
                    success: false,
                    message: "Template compilation error",
                });
            }

            // Ensure vendor is a plain object (Sequelize instances have .get)
            const vendorPlain =
                (ledger.vendor as any)?.get ? (ledger.vendor as any).get({ plain: true }) : ledger.vendor;

            // Prepare data for template (safe defaults)
            const htmlContent = template({
                doc_title: "Vendor Ledger Report",
                vendor: vendorPlain,
                transactions: ledger.transactions || [],
                totals: ledger.totals || { totalAmount: 0, totalPayment: 0, totalBalance: 0 },
                filters,
                dateRange: ledger.dateRange || {},
                logo: logoDataUrl,
                footer_note: "This is a computer-generated report for preview only.",
            });

            res.setHeader("Content-Type", "text/html");
            return res.send(htmlContent);

        } catch (error) {
            // Catch-all with logging
            console.error("❌ Error in printVendorLedgerHtml:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
                error: (error && (error as Error).message) || String(error),
            });
        }
    }


    private static async resolveTemplateFile(rel: string): Promise<string> {
        const pathsToTry = [
            path.resolve(__dirname, "../templates", rel),
            path.resolve(__dirname, "../../templates", rel),
            path.resolve(process.cwd(), "templates", rel),
            path.resolve(__dirname, "../views", rel), // Try views directory too
            path.resolve(__dirname, "../../views", rel),
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
    private static async generateVendorPDF(
        ledger: VendorLedgerResult,
        filters: any
    ): Promise<Uint8Array> {
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        try {
            const page = await browser.newPage();
            VendorLedgerController.registerHandlebarsHelpers();

            const templatePath = path.join(__dirname, "../templates/vendorLedgerTemplate.hbs");

            // Use async file reading since you're using fs/promises
            const templateContent = await fs.readFile(templatePath, "utf8");
            const template = Handlebars.compile(templateContent);

            const vendorPlain =
                (ledger.vendor as any)?.get ? (ledger.vendor as any).get({ plain: true }) : ledger.vendor;

            // Get logo as base64 data URL
            const logoDataUrl = await VendorLedgerController.getLogoAsDataURL();

            const htmlContent = template({
                doc_title: "Vendor Ledger Report",
                vendor: vendorPlain,
                transactions: ledger.transactions,
                totals: ledger.totals,
                filters,
                dateRange: ledger.dateRange,
                logo: logoDataUrl,
                footer_note:
                    "This is a computer-generated report and does not require signature.",
            });

            await page.setContent(htmlContent, { waitUntil: "networkidle0" });
            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
            });
            return pdfBuffer;
        } finally {
            await browser.close();
        }
    }

    private static readonly FALLBACK_PIXEL =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    private static async resolveLogoPath(): Promise<string> {
        // 1️⃣ ENV override (highest priority)
        const fromEnv = process.env.COMPANY_LOGO_PATH;
        if (fromEnv) {
            try {
                await fs.access(fromEnv);
                return path.resolve(fromEnv);
            } catch { }
        }

        // 2️⃣ PRIMARY location
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
    }

    private static async getLogoAsDataURL(): Promise<string> {
        try {
            const logoPath = await VendorLedgerController.resolveLogoPath();
            if (!logoPath) return VendorLedgerController.FALLBACK_PIXEL;

            const buf = await fs.readFile(logoPath);
            const ext = path.extname(logoPath).slice(1).toLowerCase() || "png";
            return `data:image/${ext};base64,${buf.toString("base64")}`;
        } catch {
            return VendorLedgerController.FALLBACK_PIXEL;
        }
    }


    private static registerHandlebarsHelpers(): void {
        Handlebars.registerHelper("formatDate", (date: Date) => {
            if (!date) return "N/A";
            return new Date(date).toLocaleDateString("en-IN");
        });

        Handlebars.registerHelper("formatINR", (amount: number) => {
            const val = VendorLedgerController.toNumber(amount);
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                minimumFractionDigits: 2,
            }).format(val);
        });

        Handlebars.registerHelper("inc", (index: number) => index + 1);
        Handlebars.registerHelper("or", (a: any, b: any) => a || b);
        Handlebars.registerHelper("now", () => new Date());
    }
}

export default VendorLedgerController;