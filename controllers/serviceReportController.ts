// src/controllers/serviceReportController.ts
import { Request, Response } from "express";
import { Op } from "sequelize";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import puppeteer, { Page, Browser } from "puppeteer";
import { TicketFollowup } from "../models/ticket_followup";
import { TicketERP } from "../models/ticketerp";
import { Client } from "../models/Client";
import { ErpServiceReport } from "../models/erp_service_report";


// Handlebars helpers
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        name?: string;
    };
}

// Register Handlebars helpers (similar to PI controller)
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatDate", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("formatDateTime", (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN");
});
Handlebars.registerHelper("or", (v: any, fb: any) => {
    const s = String(v ?? "").trim();
    return s.length ? v : fb;
});
Handlebars.registerHelper("upperCase", (v: any) => String(v || "").toUpperCase());

Handlebars.registerHelper("checkServiceMode", function (ticketCategory: string, mode: string) {
    const category = (ticketCategory || "").toUpperCase();
    const modeUpper = mode.toUpperCase();
    return category === modeUpper ? "✔" : "";
});

// Template path resolution
async function resolveExistingPath(...segments: string[]) {
    const p = path.resolve(...segments);
    try {
        await fs.access(p);
        return p;
    } catch {
        return null;
    }
}

async function resolveTemplateFile(rel: string): Promise<string> {
    let p = await resolveExistingPath(__dirname, "../templates", rel);
    if (p) return p;
    p = await resolveExistingPath(__dirname, "../../templates", rel);
    if (p) return p;
    throw new Error(`Template not found: ${rel}`);
}

const SERVICE_REPORT_TEMPLATE_PATH_PROMISE = resolveTemplateFile("service_report.hbs");

// Logo handling (same as PI controller)
const resolveCompanyLogoPath = async (): Promise<string> => {
    // ENV override (recommended)
    if (process.env.COMPANY_LOGO_PATH) {
        try {
            await fs.access(process.env.COMPANY_LOGO_PATH);
            return path.resolve(process.env.COMPANY_LOGO_PATH);
        } catch { }
    }

    // Standard location (same everywhere)
    const standardPath = path.resolve(
        process.cwd(),
        "public",
        "uploads",
        "images",
        "compress-india-logo-traced.png"
    );

    try {
        await fs.access(standardPath);
        return standardPath;
    } catch { }

    return "";
};

const getLogoAsDataURL = async (): Promise<string> => {
    try {
        const logoPath = await resolveCompanyLogoPath();
        if (!logoPath) return FALLBACK_PIXEL;

        const buf = await fs.readFile(logoPath);
        const ext = path.extname(logoPath).slice(1).toLowerCase() || "png";
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return FALLBACK_PIXEL;
    }
};

const FALLBACK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function mimeFromExt(p: string): string {
    const ext = p.toLowerCase();
    if (ext.endsWith(".png")) return "image/png";
    if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
    if (ext.endsWith(".webp")) return "image/webp";
    if (ext.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
}

const ENCODED_LOGO_PROMISE = (async () => {
    try {
        const p = await resolveCompanyLogoPath();
        if (!p) return FALLBACK_PIXEL;
        const buf = await fs.readFile(p);
        return `data:${mimeFromExt(p)};base64,${buf.toString("base64")}`;
    } catch {
        return FALLBACK_PIXEL;
    }
})();

// Utility functions
const sanitizeUuid = (raw: unknown) => {
    let s = String(raw ?? "");
    s = s.replace(/^:+/, "").replace(/^"+|"+$/g, "").trim();
    s = s.replace(/[\u0000-\u001F\u007F]/g, "");
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
    return s.replace(/\/+$/, "");
};

const safeText = (v: any, fallback = "") => {
    const s = String(v ?? "").trim();
    return s.length ? s : fallback;
};

export const checkServiceReportData = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing ticket ID"
            });
        }

        console.log('🔍 Checking service report data for ticket:', ticketId);

        // FIX: Explicitly list attributes to avoid Sequelize trying to fetch non-existent columns
        const existingServiceReport = await ErpServiceReport.findOne({
            where: { erp_id: ticketId },
            attributes: [
                'id', 'erp_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
                // Note: NO 'client_id' here since it doesn't exist in the table
            ]
        });

        // Check if ticket followup data exists (REQUIRED for service report)
        const followupData = await TicketFollowup.findOne({
            where: { ticket_id: ticketId }
        });

        // Check if ticket exists
        const ticketData = await TicketERP.findByPk(ticketId, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["id", "company", "client", "address", "city", "state", "pin_code", "contact_person", "mobile"]
                }
            ]
        });

        console.log('✅ Check results:', {
            ticket_exists: !!ticketData,
            service_report_exists: !!existingServiceReport,
            followup_data_exists: !!followupData
        });

        return res.status(200).json({
            success: true,
            data: {
                ticket_exists: !!ticketData,
                hasServiceReport: !!existingServiceReport,
                hasFollowup: !!followupData,
                followup_required: !followupData,
                serviceReport: existingServiceReport,
                followup_data: followupData,
                ticket_data: ticketData
            }
        });

    } catch (error: any) {
        console.error("❌ Error checking service report data:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to check service report data",
            error: error.message
        });
    }
};

export const validateServiceReportGeneration = async (ticketId: string) => {
    const followupData = await TicketFollowup.findOne({
        where: { ticket_id: ticketId }
    });

    if (!followupData) {
        throw new Error("Follow-up must be completed before generating service report");
    }

    return true;
};

// Create or update service report data
export const createServiceReportData = async (req: Request, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);
        const {
            service_report,
            service_date,
            service_type,
            company_name,
            instructed_by,  // This should come from request body, not contact_person
            address,
            model_no,
            serial_no,
            type,
            observation,
            work_done,
            additional_work_1,
            additional_work_2
        } = req.body;

        if (!ticketId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "Invalid or missing ticket ID"
            });
        }

        // Verify ticket exists
        const ticket = await TicketERP.findByPk(ticketId, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["id", "company", "client", "address", "city", "state", "pin_code", "contact_person", "mobile"]
                }
            ],
            transaction: t
        });

        if (!ticket) {
            await t.rollback();
            return res.status(404).json({
                success: false,
                message: "Ticket not found"
            });
        }

        // Check if service report already exists
        const existingReport = await ErpServiceReport.findOne({
            where: { erp_id: ticketId },
            transaction: t,
            attributes: [
                'id', 'erp_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
            ]
        });

        let serviceReportData;

        // Inside createServiceReportData function, update the create/update section:

        if (existingReport) {
            // Update existing report
            serviceReportData = await existingReport.update({
                service_report: service_report || existingReport.service_report,
                service_date: service_date || existingReport.service_date,
                service_type: service_type || existingReport.service_type,
                company_name: company_name || existingReport.company_name,
                instructed_by: instructed_by || existingReport.instructed_by,
                address: address || existingReport.address,
                model_no: model_no || existingReport.model_no,
                serial_no: serial_no || existingReport.serial_no,
                type: type || existingReport.type,
                observation: observation || existingReport.observation,
                work_done: work_done || existingReport.work_done,
                additional_work_1: additional_work_1 || existingReport.additional_work_1,
                additional_work_2: additional_work_2 || existingReport.additional_work_2,
                // Add report_id if provided in request
                ...(req.body.report_id && { report_id: req.body.report_id }),
            }, { transaction: t });
        } else {
            // Create new report
            const clientName = ticket.client?.company || "";
            const clientAddress = ticket.client?.address || ticket.shipping_address || "";

            const reportId = uuidv4();
            serviceReportData = await ErpServiceReport.create({
                id: reportId,
                erp_id: ticketId,
                service_report: service_report || `SR-${Date.now()}`,
                service_date: service_date || new Date(),
                service_type: service_type || "Repair",
                company_name: company_name || clientName,
                instructed_by: instructed_by || "",
                address: address || clientAddress,
                model_no: model_no || "",
                serial_no: serial_no || "",
                type: type || ticket.type || "",
                observation: observation || "",
                work_done: work_done || "",
                additional_work_1: additional_work_1 || "",
                additional_work_2: additional_work_2 || "",
                report_id: req.body.report_id || null, // Add report_id from request
            }, { transaction: t });
        }
        await t.commit();

        return res.status(200).json({
            success: true,
            message: existingReport ? "Service report updated successfully" : "Service report created successfully",
            data: serviceReportData
        });

    } catch (error: any) {
        await t.rollback();
        console.error("Error creating service report data:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create service report data",
            error: error.message
        });
    }
};

async function buildServiceReportVM(ticketId: string) {
    const serviceReport = await db.ErpServiceReport.findOne({
        where: { erp_id: ticketId },
        include: [
            {
                model: db.TicketERP,
                as: "ticket",
                include: [
                    {
                        model: db.Client,
                        as: "client",
                        attributes: [
                            "id", "company", "client", "mobile", "email_id",
                            "city", "state", "pin_code", "gstn", "address",
                            "contact_person", "designation", "client_designation", "contact_person_number"
                        ]
                    }
                ],
                attributes: [
                    "id", "caller_id", "subject", "status", "category", "priority",
                    "assigned_to", "description", "created_at", "updated_at",
                    "created_by", "shipping_address", "type", "client_id"
                ]
            }
        ]
    });

    if (!serviceReport) {
        throw new Error("Service report not found");
    }

    const j: any = serviceReport.toJSON();
    const ticket = j.ticket;
    const client = ticket?.client || {};

    // Get followup data
    const followupData = await db.TicketFollowup.findOne({
        where: { ticket_id: ticketId },
        order: [["created_at", "DESC"]]
    });

    const logoDataUrl = await getLogoAsDataURL();

    // Company information
    const our_company = {
        name: process.env.COMPANY_SHORT || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED",
        legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED",
        address_line: process.env.COMPANY_ADDR || "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Naga Near SCLR Road, Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
        city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
        mobile_number: process.env.COMPANY_MOBILE_NUMBER || "8655 0114 65 / 9920 5299 61 / 9152 1571 14",
        email_id: process.env.COMPANY_EMAIL || "sales.compressindia@gmail.com / info@compressindia.com",
        website: process.env.COMPANY_WEBSITE ||
            "www.compressindia.in / www.compressindia.com / www.compressindia.co.in",
    };

    // Customer information
    const customer = {
        company: safeText(client.company),
        name: safeText(client.client),
        contact_person: safeText(client.contact_person),
        designation: safeText(client.designation || client.client_designation),
        phone: safeText(client.contact_person_number || client.mobile),
        email: safeText(client.email_id),
        address: safeText(client.address),
        city: safeText(client.city),
        state: safeText(client.state),
        pin_code: safeText(client.pin_code),
        full_address: [
            safeText(client.address),
            safeText(client.city),
            safeText(client.state),
            safeText(client.pin_code)
        ].filter(Boolean).join(", ")
    };

    // Get ticket category and determine service mode flags
    const ticketCategory = (ticket?.category || "").toString().toUpperCase();

    // Build absolute URLs for signatures
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.COMPRESS_CRM_PORT || 3000}`;

    // Helper function to create absolute URL from relative path
    const makeAbsoluteUrl = (relativePath: string | null) => {
        if (!relativePath) return null;
        if (relativePath.startsWith('http')) return relativePath;
        // Ensure path starts with /
        const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
        return `${baseUrl}${normalizedPath}`;
    };

    const customerSignaturePath = followupData?.customer_signature_path;
    const technicianSignaturePath = followupData?.technician_signature_path;

    const vm = {
        doc_title: "SERVICE REPORT",
        doc_label: "Service Report Number",
        logo: logoDataUrl,

        // Service Report Details
        service_report_number: j.service_report,
        service_date: new Date(j.service_date).toLocaleDateString("en-IN"),
        service_type: j.service_type,

        // Report ID from ErpServiceReport model
        report_id: j.report_id || "",

        // Service Mode Flags - based on ticket category
        service_mode_amc: ticketCategory === "AMC",
        service_mode_general: ticketCategory === "GENERAL",
        service_mode_maintenance: ticketCategory === "MAINTENANCE",
        service_mode_service: ticketCategory === "SERVICE",

        // Company Information
        our_company,
        customer,

        // Equipment Details
        equipment: {
            company_name: j.company_name,
            instructed_by: j.instructed_by,
            address: j.address,
            model_no: j.model_no,
            serial_no: j.serial_no,
            type: j.type
        },

        // Work Details
        observation: j.observation,
        work_done: j.work_done,
        additional_work_1: j.additional_work_1,
        additional_work_2: j.additional_work_2,

        // Site Incharge Name (from followupData.attendant_name)
        site_incharge_name: safeText(followupData?.attendant_name),

        // Ticket Information
        ticket: {
            id: ticket?.id,
            subject: ticket?.subject,
            status: ticket?.status,
            priority: ticket?.priority,
            category: ticket?.category,
            assigned_to: ticket?.assigned_to,
            description: ticket?.description,
            created_at: ticket?.created_at ? new Date(ticket.created_at).toLocaleDateString("en-IN") : "",
            caller_id: ticket?.caller_id
        },

        // Followup Information
        followup: followupData ? {
            notes: followupData.notes,
            customer_signature: customerSignaturePath,
            technician_signature: technicianSignaturePath,
            created_at: followupData.created_at ? new Date(followupData.created_at).toLocaleDateString("en-IN") : "",
            attendant_name: followupData.attendant_name,
            technician_name: followupData.technician_name
        } : null,

        // Signatures section - CRITICAL FIX HERE
        signatures: {
            customer: {
                label: "Customer Signature",
                signature: customerSignaturePath ? makeAbsoluteUrl(customerSignaturePath) : null
            },
            technician: {
                label: "Technician Signature",
                name: safeText(followupData?.technician_name || "Technician"),
                signature: technicianSignaturePath ? makeAbsoluteUrl(technicianSignaturePath) : null
            },
            company: {
                label: "For " + our_company.name,
                signature: null
            }
        },

        // Terms and conditions
        terms: [
            "All repairs are guaranteed for 30 days from the date of service completion.",
            "Company is not responsible for any damages occurred during transit.",
            "Any additional work not mentioned in this report will be charged separately.",
            "Payment terms: Net 15 days from invoice date.",
            "Warranty void if equipment is tampered with by unauthorized personnel."
        ],

        current_date: new Date().toLocaleDateString("en-IN")
    };

    console.log('Signature debug:', {
        customerSignaturePath,
        technicianSignaturePath,
        customerSignatureUrl: vm.signatures.customer.signature,
        technicianSignatureUrl: vm.signatures.technician.signature
    });

    return vm;
}

// Generate Service Report PDF
async function renderServiceReportPdfBuffer(ticketId: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
        const vm = await buildServiceReportVM(ticketId);
        const hbsPath = await SERVICE_REPORT_TEMPLATE_PATH_PROMISE;
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
                await fs.writeFile(path.resolve(process.cwd(), "service-report-debug.html"), html);
                console.warn("PDF generation produced a very small buffer — debug HTML written to service-report-debug.html");
            } catch { }
            throw new Error("Service report PDF generation failed (empty or too small buffer). Check service-report-debug.html");
        }

        return pdfBuffer;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to render service report PDF: ${msg}`);
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore close errors
        }
    }
}

// Main endpoint to generate service report
export const generateServiceReport = async (req: Request, res: Response) => {
    let serviceReport: ErpServiceReport | null = null;

    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing ticket ID"
            });
        }

        console.log(`📋 Generating service report for ticket ID: ${ticketId}`);

        // Validate that follow-up exists
        await validateServiceReportGeneration(ticketId);

        // Check if service report data exists - Include all necessary fields
        serviceReport = await ErpServiceReport.findOne({
            where: { erp_id: ticketId },
            attributes: [
                'id', 'erp_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
            ]
        });

        if (!serviceReport) {
            return res.status(404).json({
                success: false,
                message: "Service report data not found. Please create service report data first.",
                code: "SERVICE_REPORT_DATA_REQUIRED"
            });
        }

        // Validate required fields
        const requiredFields = [
            'service_report',
            'service_date',
            'service_type',
            'company_name',
            'instructed_by',
            'address',
            'model_no',
            'serial_no',
            'type'
        ];

        const missingFields = requiredFields.filter(field => {
            const value = (serviceReport as any)[field];
            return !value || String(value).trim() === '';
        });

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required service report fields: ${missingFields.join(', ')}`,
                code: "INCOMPLETE_DATA",
                missingFields
            });
        }

        console.log('✅ Service report data validated:', {
            service_report: serviceReport.service_report,
            instructed_by: serviceReport.instructed_by,
            has_observation: !!serviceReport.observation,
            has_work_done: !!serviceReport.work_done
        });

        // Generate PDF
        console.log('📄 Generating PDF...');
        const pdfBuffer = await renderServiceReportPdfBuffer(ticketId);

        // Update PDF path in database if needed
        const timestamp = Date.now();
        const pdfFileName = `service-report-${serviceReport.service_report}-${timestamp}.pdf`;
        const pdfPath = path.join(process.cwd(), 'uploads', 'service-reports', pdfFileName);

        // Ensure directory exists
        await fs.mkdir(path.dirname(pdfPath), { recursive: true });

        // Save PDF file
        await fs.writeFile(pdfPath, pdfBuffer);
        console.log(`💾 PDF saved to: ${pdfPath}`);

        // Update database with PDF path
        await ErpServiceReport.update(
            {
                pdf_path: pdfPath,
                pdf_url: `/uploads/service-reports/${pdfFileName}`,
            },
            {
                where: { erp_id: ticketId },
                fields: ['pdf_path', 'pdf_url']
            }
        );

        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `Service-Report-${serviceReport.service_report}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);

        console.log(`✅ Service report generated successfully: ${filename}`);
        return res.end(pdfBuffer);

    } catch (error: any) {
        console.error("❌ Error generating service report:", error);

        // Log additional diagnostic information
        if (serviceReport) {
            console.error('Service Report Data at time of error:', {
                id: serviceReport.id,
                erp_id: serviceReport.erp_id,
                service_report: serviceReport.service_report,
                instructed_by: serviceReport.instructed_by,
                company_name: serviceReport.company_name,
                model_no: serviceReport.model_no,
                serial_no: serviceReport.serial_no
            });
        }

        if (error.message.includes("Follow-up must be completed")) {
            return res.status(400).json({
                success: false,
                message: error.message,
                code: "FOLLOWUP_REQUIRED"
            });
        }

        if (error.message.includes("Service report not found")) {
            return res.status(404).json({
                success: false,
                message: error.message,
                code: "SERVICE_REPORT_NOT_FOUND"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to generate service report",
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// HTML preview endpoint
export const previewServiceReportHtml = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).type("text/plain").send("Invalid or missing ticket ID");
        }

        const vm = await buildServiceReportVM(ticketId);
        const hbsPath = await SERVICE_REPORT_TEMPLATE_PATH_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);

        return res.status(200).type("html").send(html);
    } catch (error: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${error?.message || error}`);
    }
};

// Complete workflow endpoint
export const serviceReportWorkflow = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing ticket ID"
            });
        }

        // Step 1: Check if follow-up exists (REQUIRED)
        const followupData = await TicketFollowup.findOne({
            where: { ticket_id: ticketId }
        });

        if (!followupData) {
            return res.status(400).json({
                success: false,
                message: "Follow-up must be completed before generating service report",
                code: "FOLLOWUP_REQUIRED"
            });
        }

        // Step 2: Check if service report data exists
        const serviceReport = await ErpServiceReport.findOne({
            where: { erp_id: ticketId }
        });

        if (!serviceReport) {
            return res.status(404).json({
                success: false,
                message: "Service report data not found. Please create service report data first.",
                code: "SERVICE_REPORT_DATA_REQUIRED"
            });
        }

        // Step 3: Generate and return PDF
        return await generateServiceReport(req, res);

    } catch (error: any) {
        console.error("Error in service report workflow:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to complete service report workflow",
            error: error.message
        });
    }
};