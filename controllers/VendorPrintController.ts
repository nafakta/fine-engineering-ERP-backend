// src/controllers/VendorPrintController.ts
import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";
import { QueryTypes } from "sequelize";

import BaseController from "./BaseController";
import logger from "../utils/logger";

import db from "../models";
import { Vendor } from "../models/vendor";
import { PurchaseOrder } from "../models/purchaseorder";
import { OrderItem } from "../models/orderitem";
import { OrderBill } from "../models/OrderBill";
import { VendorBillPayment } from "../models/VendorBillPayment";

/* ----------------------------- Helpers ----------------------------- */
// SAFE FIX: Use regex validation instead of uuid package to avoid import issues
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (s: any) => typeof s === "string" && uuidRegex.test(s);

const safeNum = (v: any, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
};
const round2 = (n: any) => Math.round(safeNum(n) * 100) / 100;

const fmtDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtQty = (v: any) => {
    const n = safeNum(v);
    return Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(3)) : "0";
};

const clampInt = (v: any, def = 2, lo = 0, hi = 20) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
};

const fmtINR = (v: any, maxDigits: any = 2, minDigits: any = undefined) => {
    const max = clampInt(maxDigits, 2, 0, 20);
    const min = clampInt(minDigits, 0, 0, max);
    return safeNum(v).toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: max,
        minimumFractionDigits: min,
    });
};

function numberToWordsINR(n: number): string {
    if (!isFinite(n)) return "";
    const a = [
        "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"
    ];
    const b = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    const inWords = (num: number): string => {
        if (num === 0) return "zero";
        if (num < 20) return a[num];
        if (num < 100) return (b[Math.floor(num / 10)] + (num % 10 ? " " + a[num % 10] : "")).trim();
        if (num < 1000) return (a[Math.floor(num / 100)] + " hundred " + (num % 100 ? inWords(num % 100) : "")).trim();
        if (num < 100000) return (inWords(Math.floor(num / 1000)) + " thousand " + (num % 1000 ? inWords(num % 1000) : "")).trim();
        if (num < 10000000) return (inWords(Math.floor(num / 100000)) + " lakh " + (num % 100000 ? inWords(num % 100000) : "")).trim();
        return (inWords(Math.floor(num / 10000000)) + " crore " + (num % 10000000 ? inWords(num % 10000000) : "")).trim();
    };
    const rupees = Math.floor(n);
    const paise = Math.round((n - rupees) * 100);
    const main = rupees === 0 ? "zero" : inWords(rupees);
    return paise ? `${main} rupees and ${inWords(paise)} paise` : `${main} rupees`;
}

/* ------------------------- Handlebars helpers ------------------------- */
let hbRegistered = false;
function registerHandlebarsHelpers() {
    if (hbRegistered) return;
    hbRegistered = true;

    Handlebars.registerHelper("inc", (v: any) => safeNum(v) + 1);
    Handlebars.registerHelper("round2", (v: any) => round2(v));
    Handlebars.registerHelper("sum", (a: any, b: any) => safeNum(a) + safeNum(b));
    Handlebars.registerHelper("sub", (a: any, b: any) => safeNum(a) - safeNum(b));
    Handlebars.registerHelper("mul", (a: any, b: any) => safeNum(a) * safeNum(b));
    Handlebars.registerHelper("eq", (a: any, b: any) => a == b);
    Handlebars.registerHelper("not", (a: any) => !a);
    Handlebars.registerHelper("or", (a: any, b: any) => a || b);
    Handlebars.registerHelper("formatDate", (v: any) => fmtDate(v));
    Handlebars.registerHelper("formatQty", (v: any) => fmtQty(v));

    // INR helper + alias for templates that use "formatCurrency"
    Handlebars.registerHelper("formatINR", function (...args: any[]) {
        const options = args[args.length - 1];
        const value = args[0];
        let max = 2;
        let min: number | undefined = undefined;
        if (args.length >= 2 && args[1] && typeof args[1] !== "object") max = args[1];
        if (options && typeof options === "object" && options.hash) {
            if (options.hash.max !== undefined) max = options.hash.max;
            if (options.hash.min !== undefined) min = options.hash.min;
        }
        try {
            return fmtINR(value, max, min);
        } catch {
            return String(safeNum(value));
        }
    });
    Handlebars.registerHelper("formatCurrency", (v: any, opts: any) => {
        const max = opts?.hash?.max ?? 2;
        const min = opts?.hash?.min ?? undefined;
        return fmtINR(v, max, min);
    });
}

/* --------------------------- Template loader --------------------------- */
type TemplateName = "purchase_order" | "order_bill" | "vendor_payment";

async function loadTemplate(templateName: TemplateName): Promise<Handlebars.TemplateDelegate> {
    const fileNameMap: Record<TemplateName, string> = {
        purchase_order: "purchaseOrder.hbs",
        order_bill: "orderBill.hbs",
        vendor_payment: "vendor_payment_receipt.hbs",
    };

    const fileName = fileNameMap[templateName];
    const roots = [
        path.resolve(__dirname, "..", "templates"),
        path.resolve(__dirname, "..", "..", "templates"),
        path.resolve(process.cwd(), "templates"),
    ];

    let templateContent = "";
    for (const root of roots) {
        const filePath = path.join(root, fileName);
        try {
            await fs.access(filePath);
            templateContent = await fs.readFile(filePath, "utf-8");
            logger.info("Vendor template loaded", { templateName, filePath });
            break;
        } catch { /* keep trying */ }
    }

    if (!templateContent) {
        throw new Error(`Template file not found for ${templateName} (tried: ${fileName})`);
    }

    try {
        return Handlebars.compile(templateContent, { noEscape: true });
    } catch (e: any) {
        logger.error("Vendor template compilation failed", { templateName, error: e?.message });
        throw new Error(`Template compilation failed: ${e?.message}`);
    }
}

/* ---------------------- Company defaults (reused) ---------------------- */
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

/* =========================== Controller =========================== */
export class VendorPrintController extends BaseController {
    constructor() {
        super();
        registerHandlebarsHelpers();
        logger.info("VendorPrintController instantiated");
    }

    /* --------------------------- VM Builders --------------------------- */
    private safeGet(obj: any, path: string, defaultValue: any = "-") {
        const keys = path.split('.');
        let result = obj;
        for (const key of keys) {
            if (result === null || result === undefined) return defaultValue;
            result = result[key];
        }
        return result === null || result === undefined ? defaultValue : result;
    }

    private buildPOVM(po: any, vendor: any, items: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        const rows = items.map((it: any) => {
            const qty = n(it.quantity ?? it.qty);
            const rate = n(it.rate);
            const total = n(it.total ?? qty * rate);
            return {
                description: this.safeGet(it, 'item_desc', this.safeGet(it, 'description', this.safeGet(it, 'name', '-'))),
                hsn_sac: this.safeGet(it, 'hsn_sac', this.safeGet(it, 'hsn_code', '')),
                make: this.safeGet(it, "make", ""),
                qty,
                unit: this.safeGet(it, 'unit', 'NOS'),
                rate,
                total,
            };
        });

        const subTotal = rows.reduce((a: number, r: any) => a + n(r.total), 0);
        const discount = n(this.safeGet(po, 'discount_value', 0));
        const totalAmount = subTotal - discount;
        const defaultGST = 18;
        const gstAmount = round2((totalAmount * defaultGST) / 100);
        const grandTotal = round2(totalAmount + gstAmount);

        return {
            doc_title: "PURCHASE ORDER",
            logo: "",
            our_company: { ...COMPANY_DEFAULT },
            vendor: {
                vendor: this.safeGet(vendor, 'vendor', '-'),
                company: this.safeGet(vendor, 'company', '-'),
                mobile: this.safeGet(vendor, 'mobile', this.safeGet(vendor, 'phone', '-')),
                email_id: this.safeGet(vendor, 'email_id', this.safeGet(vendor, 'email', '-')),
                city: this.safeGet(vendor, 'city', '-'),
                state: this.safeGet(vendor, 'state', '-'),
                gstin: this.safeGet(vendor, 'gstin', '-'),
                address: this.safeGet(vendor, 'address', '-')
            },
            po_number: this.safeGet(po, 'po_number', this.safeGet(po, 'id', '-')),
            po_date: this.safeGet(po, 'created_at', this.safeGet(po, 'created_on', new Date())),
            delivery_address: this.safeGet(po, 'delivery_address', COMPANY_DEFAULT.address_line),
            delivery_phone: this.safeGet(po, 'delivery_phone', COMPANY_DEFAULT.mobile_number),
            subject: this.safeGet(po, 'subject', `Purchase Order ${this.safeGet(po, 'po_number', this.safeGet(po, 'id', ''))}`),
            status: this.safeGet(po, 'status', 'draft'),
            items: rows,
            sub_total: subTotal,
            discount_value: discount,
            total_amount: totalAmount,
            default_gst_percent: defaultGST,
            gst_amount: gstAmount,
            grand_total: grandTotal,
            amount_in_words: `Amount in Words: ${numberToWordsINR(grandTotal)}`,
            contact_person: this.safeGet(vendor, 'vendor', '-'),
            contact_person_designation: "Vendor"
        };
    }

    private buildOrderBillVM(bill: any, vendor: any, po: any, items: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        const rows = items.map((it: any) => {
            const qty = n(it.quantity ?? it.qty);
            const rate = n(it.rate);
            const gst_pct = n(
                it.gst_pct ??
                it.gst_percent ??
                po?.gst_percent ??
                bill?.gst_percent ??
                18
            );
            const total = n(it.total ?? it.line_total ?? qty * rate);

            return {
                description: this.safeGet(
                    it,
                    "item_desc",
                    this.safeGet(it, "description", this.safeGet(it, "name", "-"))
                ),
                hsn_sac: this.safeGet(it, "hsn_sac", this.safeGet(it, "hsn_code", "")),
                make: this.safeGet(it, "make", ""),        // ✅ MAKE is mapped
                qty,
                unit: this.safeGet(it, "unit", "NOS"),
                rate,
                gst_percent: gst_pct,
                total,
            };
        });

        const sub = rows.reduce((a: number, r: any) => a + n(r.total), 0);
        const discount = n(this.safeGet(bill, "discount_value", 0));

        // ✅ Taxable base BEFORE GST
        const taxableBase = Math.max(0, sub - discount);

        // ✅ Prefer bill.gst_percent, then po.gst_percent, then 18
        const gstPct = n(
            this.safeGet(bill, "gst_percent", this.safeGet(po, "gst_percent", 18))
        );

        // ✅ Prefer stored total_tax, else compute from taxableBase
        const tax = n(
            this.safeGet(
                bill,
                "total_tax",
                round2((taxableBase * gstPct) / 100)
            )
        );

        // ✅ Prefer stored total_amount, else taxableBase + tax
        const grand = n(
            this.safeGet(
                bill,
                "total_amount",
                round2(taxableBase + tax)
            )
        );

        return {
            doc_title: "ORDER BILL",
            logo: "",
            our_company: { ...COMPANY_DEFAULT },
            vendor: {
                vendor: this.safeGet(vendor, "vendor", "-"),
                company: this.safeGet(vendor, "company", "-"),
                mobile: this.safeGet(vendor, "mobile", this.safeGet(vendor, "phone", "-")),
                email_id: this.safeGet(vendor, "email_id", this.safeGet(vendor, "email", "-")),
                city: this.safeGet(vendor, "city", "-"),
                state: this.safeGet(vendor, "state", "-"),
                gstin: this.safeGet(vendor, "gstin", "-"),
                address: this.safeGet(vendor, "address", "-"),
            },
            po: {
                po_number: this.safeGet(po, "po_number", this.safeGet(po, "id", "-")),
                creator_name: this.safeGet(po, "created_by", "-"),
            },
            bill_number: this.safeGet(bill, "bill_number", this.safeGet(bill, "id", "-")),
            bill_date: this.safeGet(
                bill,
                "bill_date",
                this.safeGet(bill, "created_at", new Date())
            ),
            payment_status: this.safeGet(bill, "payment_status", "pending"),
            delivery_address: this.safeGet(
                po,
                "delivery_address",
                COMPANY_DEFAULT.address_line
            ),
            subject: this.safeGet(
                bill,
                "subject",
                `Order Bill for PO ${this.safeGet(po, "po_number", "")}`
            ),

            items: rows,

            // ✅ Totals object used by the template
            totals: {
                subtotal: sub,
                discount,
                total_amount: taxableBase,      // BEFORE GST (for "TOTAL AMOUNT" row)
                gst_percent: gstPct,
                tax,
                grand,
                amount_in_words: numberToWordsINR(grand),
            },

            // ✅ Backward-compatible top-level keys (your HBS also checks these)
            sub_total: sub,
            discount_value: discount,
            gst_amount: tax,
            grand_total: grand,
            default_gst_percent: gstPct,
            amount_in_words: numberToWordsINR(grand),

            contact_person: this.safeGet(vendor, "vendor", "-"),
            contact_person_designation: "Vendor",
        };
    }

    private buildVendorPaymentVM(pay: any, bill: any, vendor: any, history: any[]) {
        const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        // bill totals
        const billAmount = n(this.safeGet(bill, 'total_amount', this.safeGet(bill, 'bill_amount', 0)));
        const paidAmount = n(this.safeGet(pay, 'paid_amount', 0));

        // Build rolling balance after each payment date (sorted)
        const sorted = [...history].sort(
            (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
        );

        let runningPaid = 0;
        const paymentHistory = sorted.map((h) => {
            runningPaid += n(h.paid_amount);
            const balance_after_payment = Math.max(0, billAmount - runningPaid);
            return {
                invoice_number: this.safeGet(bill, 'bill_number', this.safeGet(bill, 'id', '-')),
                invoice_date: fmtDate(this.safeGet(bill, 'bill_date', this.safeGet(bill, 'created_at'))),
                invoice_amount: billAmount,
                payment_amount: n(h.paid_amount),
                payment_date: fmtDate(h.payment_date),
                balance_after_payment,
                is_current_invoice: h.id === pay.id,
            };
        });

        const totals = {
            bill_amount: billAmount,
            paid_amount: paidAmount,
            remaining_after: Math.max(0, billAmount - runningPaid),
        };

        return {
            logo: "",
            company_display_name: COMPANY_DEFAULT.legal_name,
            receipt_no: this.safeGet(pay, 'pay_number', this.safeGet(pay, 'id', '-')),
            receipt_date: fmtDate(this.safeGet(pay, 'payment_date')),
            invoice: {
                invoice_no: this.safeGet(bill, 'bill_number', this.safeGet(bill, 'id', '-')),
                invoice_date: fmtDate(this.safeGet(bill, 'bill_date', this.safeGet(bill, 'created_at'))),
            },
            payment: {
                payment_mode: this.safeGet(pay, 'payment_mode', 'NEFT'),
                payment_date: fmtDate(this.safeGet(pay, 'payment_date')),
                payment_in: this.safeGet(pay, 'payment_in', 'INR'),
                paid_by: this.safeGet(pay, 'paid_by', 'System User'),
                notes: this.safeGet(pay, 'notes', ''),
                ref_no: this.safeGet(pay, 'ref_no', null)
            },
            place_of_supply: this.safeGet(vendor, 'state') ?
                `${this.safeGet(vendor, 'city', '')}${this.safeGet(vendor, 'city') && this.safeGet(vendor, 'state') ? ', ' : ''}${this.safeGet(vendor, 'state', '')}`
                : COMPANY_DEFAULT.state,
            subject: `Payment against Bill ${this.safeGet(bill, 'bill_number', this.safeGet(bill, 'id', '-'))}`,
            customer: {
                company: this.safeGet(vendor, 'company', this.safeGet(vendor, 'vendor', '-')),
                name: this.safeGet(vendor, 'vendor', '-'),
                address: this.safeGet(vendor, 'address', '-'),
                city_state: [this.safeGet(vendor, 'city'), this.safeGet(vendor, 'state')].filter(Boolean).join(", ") || "-",
                gstin: this.safeGet(vendor, 'gstin', '-'),
                contact: this.safeGet(vendor, 'mobile', this.safeGet(vendor, 'email_id', '-')),
            },
            payment_history: paymentHistory,
            amounts: totals,
            amount_in_words: numberToWordsINR(totals.paid_amount),
            terms: [
                "Payment subject to realization.",
                "This is a computer-generated receipt.",
            ],
        };
    }

    /* ----------------------- PDF rendering (shared) ----------------------- */
    private async renderTemplateToPDF(templateName: TemplateName, vm: any, logoUrl = ""): Promise<Buffer> {
        let browser: any = null;
        try {
            vm.logo = logoUrl || "";

            // Debug: Log the view model to see what data is being passed
            logger.debug(`Rendering ${templateName} PDF with data:`, {
                templateName,
                vmKeys: Object.keys(vm),
                itemsCount: vm.items?.length || 0,
                vendor: vm.vendor ? `${vm.vendor.company} - ${vm.vendor.vendor}` : 'No vendor'
            });

            const template = await loadTemplate(templateName);
            const html = template(vm);

            const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            browser = await puppeteer.launch({
                headless: true,
                executablePath,
                args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
            await page.emulateMediaType("screen");

            const pdf = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "10mm", right: "10mm", bottom: "12mm", left: "10mm" },
                timeout: 30000,
            });

            if (!pdf?.length) throw new Error("Empty PDF buffer generated");

            logger.info(`PDF generated successfully for ${templateName}`, {
                templateName,
                pdfSize: pdf.length
            });

            return pdf;
        } catch (error: any) {
            logger.error(`PDF rendering failed for ${templateName}`, {
                templateName,
                error: error?.message,
                vm: JSON.stringify(vm, null, 2) // Log full view model for debugging
            });
            throw error;
        } finally {
            if (browser) {
                try { await browser.close(); } catch { /* ignore */ }
            }
        }
    }

    /* --------------------------- PDF Endpoints --------------------------- */

    public renderPurchaseOrderPDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logo = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid purchase order id", 400);
            }

            const po = await PurchaseOrder.findByPk(id);
            if (!po) {
                return this.sendError(res, { id }, "Purchase order not found", 404);
            }

            const vendor = await Vendor.findByPk(po.vendor_id);
            if (!vendor) {
                return this.sendError(res, { vendor_id: po.vendor_id }, "Vendor not found", 404);
            }

            let items: any[] = [];
            try {
                items = await OrderItem.findAll({
                    where: { po_id: po.id },
                    order: [["id", "ASC"]]
                });

                logger.debug("PO items fetched", {
                    po_id: po.id,
                    itemsCount: items.length,
                    items: items.map(i => ({
                        id: i.id,
                        description: i.item_desc || i.description,
                        quantity: i.quantity,
                        rate: i.rate
                    }))
                });
            } catch (e: any) {
                logger.error("PO items fetch failed", {
                    po_id: po.id,
                    error: e?.message,
                    stack: e?.stack
                });
                items = [];
            }

            const vm = this.buildPOVM(po, vendor, items);

            // Log the complete view model for debugging
            logger.debug("Purchase Order View Model", {
                po_number: vm.po_number,
                vendor: vm.vendor,
                itemsCount: vm.items.length,
                totals: {
                    sub_total: vm.sub_total,
                    grand_total: vm.grand_total
                }
            });

            const pdf = await this.renderTemplateToPDF("purchase_order", vm, logo);

            const filename = `purchase_order_${vm.po_number}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderPurchaseOrderPDF error", {
                err: err?.message,
                stack: err?.stack,
                id: req.params.id
            });
            return this.sendError(res, {}, `Failed to render PO PDF: ${err?.message}`, 500);
        }
    };

    public renderOrderBillPDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logo = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid bill id", 400);
            }

            const bill = await OrderBill.findByPk(id);
            if (!bill) {
                return this.sendError(res, { id }, "Order bill not found", 404);
            }

            const vendor = await Vendor.findByPk(bill.vendor_id);
            if (!vendor) {
                return this.sendError(res, { vendor_id: bill.vendor_id }, "Vendor not found", 404);
            }

            const po = bill.po_id ? await PurchaseOrder.findByPk(bill.po_id) : null;

            let items: any[] = [];
            try {
                if (bill.po_id) {
                    // ✅ Use the same pattern as Purchase Order
                    items = await OrderItem.findAll({
                        where: { po_id: bill.po_id },
                        order: [["id", "ASC"]],
                        // attributes: ["item_desc", "unit", "hsn_sac", "quantity", "rate", "total", "make"], // optional
                    });
                } else {
                    // If no PO ID, try to get items from bill_items table if it exists
                    items = await db.sequelize.query(
                        `SELECT description, unit, hsn_sac, quantity, rate, total, make
       FROM bill_items 
       WHERE bill_id = :bill_id 
       ORDER BY id ASC`,
                        {
                            replacements: { bill_id: bill.id },
                            type: QueryTypes.SELECT,
                        }
                    ).catch(() => []); // If table doesn't exist, return empty array
                }

                logger.debug("Order Bill items fetched", {
                    bill_id: bill.id,
                    po_id: bill.po_id,
                    itemsCount: items.length,
                });
            } catch (e: any) {
                logger.error("Order bill items query failed", {
                    bill_id: bill.id,
                    po_id: bill.po_id,
                    error: e?.message,
                });
                items = [];
            }

            const vm = this.buildOrderBillVM(bill, vendor, po, items);

            logger.debug("Order Bill View Model", {
                bill_number: vm.bill_number,
                vendor: vm.vendor,
                itemsCount: vm.items.length,
                totals: vm.totals
            });

            const pdf = await this.renderTemplateToPDF("order_bill", vm, logo);

            const filename = `order_bill_${vm.bill_number}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderOrderBillPDF error", {
                err: err?.message,
                stack: err?.stack,
                id: req.params.id
            });
            return this.sendError(res, {}, `Failed to render Order Bill PDF: ${err?.message}`, 500);
        }
    };

    public renderVendorPaymentPDF = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logo = String(req.query.logo || "");

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid vendor payment id", 400);
            }

            const pay = await VendorBillPayment.findByPk(id);
            if (!pay) {
                return this.sendError(res, { id }, "Vendor payment not found", 404);
            }

            const bill = await OrderBill.findByPk(pay.bill_id);
            if (!bill) {
                return this.sendError(res, { bill_id: pay.bill_id }, "Related bill not found", 404);
            }

            const vendor = await Vendor.findByPk(pay.vendor_id);
            if (!vendor) {
                return this.sendError(res, { vendor_id: pay.vendor_id }, "Vendor not found", 404);
            }

            const history = await VendorBillPayment.findAll({
                where: { bill_id: bill.id },
                order: [["payment_date", "ASC"]],
            });

            const vm = this.buildVendorPaymentVM(pay, bill, vendor, history);

            logger.debug("Vendor Payment View Model", {
                receipt_no: vm.receipt_no,
                vendor: vm.customer,
                amounts: vm.amounts,
                historyCount: vm.payment_history?.length || 0
            });

            const pdf = await this.renderTemplateToPDF("vendor_payment", vm, logo);

            const filename = `vendor_payment_${vm.receipt_no}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            res.setHeader("Content-Length", String(pdf.length));
            return res.status(200).end(pdf);
        } catch (err: any) {
            logger.error("renderVendorPaymentPDF error", {
                err: err?.message,
                stack: err?.stack,
                id: req.params.id
            });
            return this.sendError(res, {}, `Failed to render Vendor Payment PDF: ${err?.message}`, 500);
        }
    };

    /* ---------------------- Vendor activity & search ---------------------- */

    public getVendorActivity = async (req: Request, res: Response) => {
        try {
            const { vendorId } = req.params;
            const qRaw = String(req.query.q ?? "").trim();

            if (!isUUID(vendorId)) {
                return this.sendError(res, { vendorId }, "Invalid vendor id", 400);
            }

            const escapeLike = (s: string) => s.replace(/([%_\\])/g, "\\$1");
            const pat = `%${escapeLike(qRaw)}%`;
            const wantFilter = qRaw.length > 0;

            const rows: any[] = await db.sequelize.query(
                `
            WITH pay_agg AS (
                SELECT
                    vbp.bill_id,
                    SUM(vbp.paid_amount) AS total_paid,
                    MAX(vbp.payment_date) AS last_payment_date
                FROM vendor_bill_payments vbp
                GROUP BY vbp.bill_id
            ),

            -- Get all purchase orders with their bills and payment info
            po_with_bills AS (
                SELECT
                    'PURCHASE_ORDER'::text AS type,
                    po.id AS po_id,
                    po.po_number::text AS po_number,
                    po.created_at AS created_at,
                    po.status::text AS po_status,
                    ob.id AS bill_id,
                    ob.bill_number::text AS bill_number,
                    ob.total_amount AS bill_amount,
                    COALESCE(pa.total_paid, 0) AS total_paid,
                    (COALESCE(ob.total_amount, 0) - COALESCE(pa.total_paid, 0)) AS remaining_amount,
                    CASE
                        WHEN ob.id IS NULL THEN 'No Bill'::text
                        WHEN (COALESCE(ob.total_amount, 0) - COALESCE(pa.total_paid, 0)) <= 0 THEN 'Paid'::text
                        WHEN COALESCE(pa.total_paid, 0) > 0 THEN 'Partially Paid'::text
                        ELSE 'Unpaid'::text
                    END AS payment_status,
                    lp.id AS latest_payment_id,
                    lp.pay_number::text AS latest_payment_number
                FROM purchase_orders po
                LEFT JOIN order_bills ob ON ob.po_id = po.id AND ob.vendor_id = po.vendor_id
                LEFT JOIN pay_agg pa ON pa.bill_id = ob.id
                LEFT JOIN LATERAL (
                    SELECT vbp2.id, vbp2.pay_number
                    FROM vendor_bill_payments vbp2
                    WHERE vbp2.bill_id = ob.id
                    ORDER BY vbp2.payment_date DESC, vbp2.created_at DESC
                    LIMIT 1
                ) lp ON true
                WHERE po.vendor_id = :vendorId
            ),

            -- Get standalone bills (without POs) if any exist
            standalone_bills AS (
                SELECT
                    'ORDER_BILL'::text AS type,
                    NULL::uuid AS po_id,
                    NULL::text AS po_number,
                    ob.created_at AS created_at,
                    NULL::text AS po_status,
                    ob.id AS bill_id,
                    ob.bill_number::text AS bill_number,
                    ob.total_amount AS bill_amount,
                    COALESCE(pa.total_paid, 0) AS total_paid,
                    (COALESCE(ob.total_amount, 0) - COALESCE(pa.total_paid, 0)) AS remaining_amount,
                    CASE
                        WHEN (COALESCE(ob.total_amount, 0) - COALESCE(pa.total_paid, 0)) <= 0 THEN 'Paid'::text
                        WHEN COALESCE(pa.total_paid, 0) > 0 THEN 'Partially Paid'::text
                        ELSE 'Unpaid'::text
                    END AS payment_status,
                    lp.id AS latest_payment_id,
                    lp.pay_number::text AS latest_payment_number
                FROM order_bills ob
                LEFT JOIN pay_agg pa ON pa.bill_id = ob.id
                LEFT JOIN LATERAL (
                    SELECT vbp2.id, vbp2.pay_number
                    FROM vendor_bill_payments vbp2
                    WHERE vbp2.bill_id = ob.id
                    ORDER BY vbp2.payment_date DESC, vbp2.created_at DESC
                    LIMIT 1
                ) lp ON true
                WHERE ob.vendor_id = :vendorId
                AND ob.po_id IS NULL
            )

            -- Combine all results with explicit casting
            SELECT 
                type::text,
                po_id::uuid,
                po_number::text,
                created_at::timestamp,
                po_status::text,
                bill_id::uuid, 
                bill_number::text,
                bill_amount::decimal,
                total_paid::decimal,
                remaining_amount::decimal,
                payment_status::text,
                latest_payment_id::uuid,
                latest_payment_number::text
            FROM (
                SELECT * FROM po_with_bills
                UNION ALL
                SELECT * FROM standalone_bills
            ) combined
            WHERE (
                :wantFilter = false
                OR po_number ILIKE :pat
                OR bill_number ILIKE :pat
                OR payment_status ILIKE :pat
            )
            ORDER BY created_at DESC
            `,
                {
                    replacements: { vendorId, pat, wantFilter },
                    type: QueryTypes.SELECT
                }
            );

            // Normalize for your table + provide all necessary IDs for frontend links
            const normalized = rows.map((r: any) => ({
                type: r.type as "PURCHASE_ORDER" | "ORDER_BILL",
                id: r.po_id ?? r.bill_id,                    // unique id per row for React key
                date: r.created_at,

                // PO Information
                poId: r.po_id ?? null,
                poNumber: r.po_number ?? "—",
                poStatus: r.po_status ?? "—",

                // Bill Information
                billId: r.bill_id ?? null,
                billNumber: r.bill_number ?? "—",
                billAmount: Number(r.bill_amount) || 0,

                // Payment Information
                totalPaid: Number(r.total_paid) || 0,
                remainingAmount: Number(r.remaining_amount) || 0,
                paymentStatus: r.payment_status,

                // Latest Payment (for receipt link)
                latestPaymentId: r.latest_payment_id ?? null,
                latestPaymentNumber: r.latest_payment_number ?? null,

                // For backward compatibility with your existing frontend
                labelNo: r.po_number ?? r.bill_number ?? "—", // Show PO number or Bill number as label
                billNo: r.bill_number ?? "—",               // Show Bill number
            }));

            logger.debug("Vendor activity loaded", {
                vendorId,
                totalRows: normalized.length,
                poCount: normalized.filter(r => r.type === 'PURCHASE_ORDER').length,
                billCount: normalized.filter(r => r.type === 'ORDER_BILL').length,
                withBills: normalized.filter(r => r.billId !== null).length,
                withPayments: normalized.filter(r => r.latestPaymentId !== null).length
            });

            return this.sendSuccess(res, { rows: normalized }, "Vendor activity loaded", 200);
        } catch (err: any) {
            logger.error("getVendorActivity error", {
                vendorId: req.params.vendorId,
                error: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, { error: err?.message }, "Failed to load vendor activity", 500);
        }
    };


    public vendorsByDoc = async (req: Request, res: Response) => {
        try {
            const qRaw = String(req.query.q ?? "").trim();
            const limit = Math.min(Number(req.query.limit ?? 20), 100);
            const offset = Math.max(Number(req.query.offset ?? 0), 0);

            if (!qRaw) {
                return this.sendSuccess(res, { rows: [], total: 0 }, "OK", 200);
            }

            const escapeLike = (s: string) => s.replace(/([%_\\])/g, "\\$1");
            const pat = `%${escapeLike(qRaw)}%`;

            const rows = await db.sequelize.query(
                `
            WITH matches AS (
                -- Purchase Orders
                SELECT
                    v.id AS vendor_id,
                    COALESCE(NULLIF(v.company,''), NULLIF(v.vendor,''), '-') AS vendor_name,
                    v.address, v.city, v.state,
                    po.po_number AS doc_no,
                    po.id AS doc_id,
                    'PO'::text AS doc_type,
                    po.created_at AS doc_created_at
                FROM purchase_orders po
                JOIN vendors v ON v.id = po.vendor_id
                WHERE (
                    po.po_number::text ILIKE :pat 
                    OR po.id::text ILIKE :pat
                    OR COALESCE(v.company,'') ILIKE :pat
                    OR COALESCE(v.vendor,'') ILIKE :pat
                )

                UNION ALL

                -- Order Bills
                SELECT
                    v.id AS vendor_id,
                    COALESCE(NULLIF(v.company,''), NULLIF(v.vendor,''), '-') AS vendor_name,
                    v.address, v.city, v.state,
                    ob.bill_number AS doc_no,
                    ob.id AS doc_id,
                    'BILL'::text AS doc_type,
                    ob.created_at AS doc_created_at
                FROM order_bills ob
                JOIN vendors v ON v.id = ob.vendor_id
                WHERE (
                    ob.bill_number ILIKE :pat 
                    OR ob.id::text ILIKE :pat
                    OR COALESCE(v.company,'') ILIKE :pat
                    OR COALESCE(v.vendor,'') ILIKE :pat
                )
            ),
            ranked AS (
                SELECT m.*, 
                       ROW_NUMBER() OVER (PARTITION BY m.vendor_id ORDER BY m.doc_created_at DESC) AS rn
                FROM matches m
            )
            SELECT * FROM ranked
            WHERE rn = 1
            ORDER BY doc_created_at DESC
            LIMIT :limit OFFSET :offset
            `,
                { replacements: { pat, limit, offset }, type: QueryTypes.SELECT }
            );

            const totalRows = await db.sequelize.query(
                `
            WITH matches AS (
                SELECT v.id AS vendor_id
                FROM purchase_orders po
                JOIN vendors v ON v.id = po.vendor_id
                WHERE (
                    po.po_number::text ILIKE :pat 
                    OR po.id::text ILIKE :pat
                    OR COALESCE(v.company,'') ILIKE :pat
                    OR COALESCE(v.vendor,'') ILIKE :pat
                )
                UNION
                SELECT v.id AS vendor_id
                FROM order_bills ob
                JOIN vendors v ON v.id = ob.vendor_id
                WHERE (
                    ob.bill_number ILIKE :pat 
                    OR ob.id::text ILIKE :pat
                    OR COALESCE(v.company,'') ILIKE :pat
                    OR COALESCE(v.vendor,'') ILIKE :pat
                )
            )
            SELECT COUNT(DISTINCT vendor_id) AS total FROM matches
            `,
                { replacements: { pat }, type: QueryTypes.SELECT }
            );

            const total = Number((totalRows?.[0] as any)?.total ?? 0);

            logger.debug("Vendors by document search", {
                query: qRaw,
                results: rows.length,
                total
            });

            return this.sendSuccess(res, { rows, total }, "OK", 200);
        } catch (err: any) {
            logger.error("vendorsByDoc error", {
                query: req.query.q,
                error: err?.message,
                stack: err?.stack
            });
            return this.sendError(res, {}, "Failed to search vendors by document number", 500);
        }
    };

    /* ---------------------- Additional Utility APIs ---------------------- */

    public getVendorDetails = async (req: Request, res: Response) => {
        try {
            const { vendorId } = req.params;

            if (!isUUID(vendorId)) {
                return this.sendError(res, { vendorId }, "Invalid vendor id", 400);
            }

            const vendor = await Vendor.findByPk(vendorId, {
                attributes: { exclude: ['created_at', 'updated_at'] }
            });

            if (!vendor) {
                return this.sendError(res, { vendorId }, "Vendor not found", 404);
            }

            return this.sendSuccess(res, { vendor }, "Vendor details loaded", 200);
        } catch (err: any) {
            logger.error("getVendorDetails error", {
                vendorId: req.params.vendorId,
                error: err?.message
            });
            return this.sendError(res, {}, "Failed to load vendor details", 500);
        }
    };

    public validatePdfGeneration = async (req: Request, res: Response) => {
        try {
            const { type, id } = req.params;

            if (!isUUID(id)) {
                return this.sendError(res, { id }, "Invalid ID", 400);
            }

            let exists = false;
            let entity: PurchaseOrder | OrderBill | VendorBillPayment | null = null;
            let details: { number: string | number | null; vendor_id: string | null } | null = null;

            switch (type) {
                case 'po':
                    entity = await PurchaseOrder.findByPk(id);
                    if (entity) {
                        exists = true;
                        details = {
                            number: (entity as PurchaseOrder).po_number,
                            vendor_id: (entity as PurchaseOrder).vendor_id
                        };
                    }
                    break;
                case 'bill':
                    entity = await OrderBill.findByPk(id);
                    if (entity) {
                        exists = true;
                        details = {
                            number: (entity as OrderBill).bill_number,
                            vendor_id: (entity as OrderBill).vendor_id
                        };
                    }
                    break;
                case 'payment':
                    entity = await VendorBillPayment.findByPk(id);
                    if (entity) {
                        exists = true;
                        details = {
                            number: (entity as VendorBillPayment).pay_number,
                            vendor_id: (entity as VendorBillPayment).vendor_id
                        };
                    }
                    break;
                default:
                    return this.sendError(res, { type }, "Invalid type. Use 'po', 'bill', or 'payment'", 400);
            }

            return this.sendSuccess(res, {
                exists,
                type,
                id,
                details
            }, "Validation complete", 200);
        } catch (err: any) {
            logger.error("validatePdfGeneration error", {
                type: req.params.type,
                id: req.params.id,
                error: err?.message
            });
            return this.sendError(res, {}, "Failed to validate PDF generation", 500);
        }
    };
}

export default new VendorPrintController();