import { Request, Response } from "express";
import { Op } from "sequelize";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import db from "../models";
import { v4 as uuidv4 } from "uuid";
import puppeteer, { Page, Browser } from "puppeteer";
import { create } from "domain";

// Handlebars helpers (same as AC)
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

const HVAC_SERVICE_REPORT_TEMPLATE_PATH_PROMISE = resolveTemplateFile("hvac_service_report.hbs");

// Logo handling
const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (highest priority)
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.access(fromEnv);
            return path.resolve(fromEnv);
        } catch { }
    }

    // 2️⃣ PRIMARY: public/uploads/images
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

    // 3️⃣ Fallbacks (optional)
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


const FALLBACK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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

// Check service report data
export const checkHvacServiceReportData = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing HVAC ticket ID"
            });
        }

        console.log('🔍 Checking HVAC service report data for ticket:', ticketId);

        // Check if service report exists
        const existingServiceReport = await db.HvacErpServiceReport.findOne({
            where: { hvac_erp_id: ticketId },
            attributes: [
                'id', 'hvac_erp_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
            ]
        });

        // Check if followup data exists (REQUIRED for service report)
        const followupData = await db.HVACTicketFollowup.findOne({
            where: { hvac_ticket_id: ticketId }
        });

        // Check if ticket exists
        const ticketData = await db.HVACTicket.findByPk(ticketId, {
            include: [
                {
                    model: db.Client,
                    as: "client",
                    attributes: ["id", "company", "client", "address", "city", "state", "pin_code", "contact_person", "mobile", "created_by"]
                }
            ]
        });

        console.log('✅ HVAC Check results:', {
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
        console.error("❌ Error checking HVAC service report data:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to check HVAC service report data",
            error: error.message
        });
    }
};

// Validate service report generation
export const validateHvacServiceReportGeneration = async (ticketId: string) => {
    const followupData = await db.HVACTicketFollowup.findOne({
        where: { hvac_ticket_id: ticketId }
    });

    if (!followupData) {
        throw new Error("Follow-up must be completed before generating HVAC service report");
    }

    return true;
};

// Create or update service report data
export const createHvacServiceReportData = async (req: Request, res: Response) => {
    const t = await db.sequelize.transaction();
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);
        const {
            service_report,
            service_date,
            service_type,
            company_name,
            instructed_by,
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
                message: "Invalid or missing HVAC ticket ID"
            });
        }

        // Verify ticket exists
        const ticket = await db.HVACTicket.findByPk(ticketId, {
            include: [
                {
                    model: db.Client,
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
                message: "HVAC Ticket not found"
            });
        }

        // Check if service report already exists
        const existingReport = await db.HvacErpServiceReport.findOne({
            where: { hvac_erp_id: ticketId },
            transaction: t,
            attributes: [
                'id', 'hvac_erp_id', 'report_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
            ]
        });

        let serviceReportData;

        if (existingReport) {
            // Update existing report - do NOT update report_id in updates
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
            }, { transaction: t });
        } else {
            // Create new report - DO NOT include report_id, let the database trigger generate it
            const clientName = ticket.client?.company || "";
            const contactPerson = ticket.client?.contact_person || "";
            const clientAddress = ticket.client?.address || ticket.shipping_address || "";

            serviceReportData = await db.HvacErpServiceReport.create({
                // DO NOT include report_id here - it will be generated by DB trigger
                hvac_erp_id: ticketId,
                service_report: service_report || `HVAC-SR-${Date.now()}`,
                service_date: service_date || new Date(),
                service_type: service_type || "Preventive Maintenance",
                company_name: company_name || clientName,
                instructed_by: instructed_by || contactPerson,
                address: address || clientAddress,
                model_no: model_no || "",
                serial_no: serial_no || "",
                type: type || ticket.type || "",
                observation: observation || "",
                work_done: work_done || "",
                additional_work_1: additional_work_1 || "",
                additional_work_2: additional_work_2 || "",
            }, { transaction: t });
        }

        await t.commit();

        return res.status(200).json({
            success: true,
            message: existingReport ? "HVAC service report updated successfully" : "HVAC service report created successfully",
            data: serviceReportData
        });

    } catch (error: any) {
        await t.rollback();
        console.error("Error creating HVAC service report data:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create HVAC service report data",
            error: error.message
        });
    }
};

// Build HVAC service report view model
async function buildHvacServiceReportVM(ticketId: string) {
    const serviceReport = await db.HvacErpServiceReport.findOne({
        where: { hvac_erp_id: ticketId },
        include: [
            {
                model: db.HVACTicket,
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
        throw new Error("HVAC service report not found");
    }

    const j: any = serviceReport.toJSON();
    const ticket = j.ticket;
    const client = ticket?.client || {};

    // Get followup data
    const followupData = await db.HVACTicketFollowup.findOne({
        where: { hvac_ticket_id: ticketId },
        order: [["created_at", "DESC"]]
    });

    const logoDataUrl = await getLogoAsDataURL();

    // Determine service mode based on ticket category
    const ticketCategory = ticket?.category?.toLowerCase() || "";
    let service_mode_amc = false;
    let service_mode_general = false;
    let service_mode_maintenance = false;
    let service_mode_services = false;

    // Map categories to service modes
    if (ticketCategory.includes('amc') || ticketCategory.includes('contract') || ticketCategory.includes('annual')) {
        service_mode_amc = true;
    } else if (ticketCategory.includes('maintenance') || ticketCategory.includes('preventive') || ticketCategory.includes('corrective')) {
        service_mode_maintenance = true;
    } else if (ticketCategory.includes('general') || ticketCategory.includes('routine') || ticketCategory.includes('regular')) {
        service_mode_general = true;
    } else if (ticketCategory.includes('service') || ticketCategory.includes('repair') || ticketCategory.includes('breakdown')) {
        service_mode_services = true;
    } else {
        // Default to General if no specific category matches
        service_mode_general = true;
    }

    // Company information
    const our_company = {
        name: process.env.COMPANY_SHORT || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED",
        legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED",
        address_line: process.env.COMPANY_ADDR || "BP 6337, Yaoundé",
        city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
        mobile_number: process.env.COMPANY_MOBILE_NUMBER || "8655 0114 65 / 9920 5299 61 / 9152 1571 14",
        email_id: process.env.COMPANY_EMAIL || "sales.compressindia@gmail.com / info@compressindia.com",
        website: process.env.COMPANY_WEBSITE || "www.compressindia.com",
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

    const vm = {
        doc_title: "HVAC SERVICE REPORT",
        doc_label: "HVAC Service Report Number",
        logo: logoDataUrl,

        // Service mode flags - based on ticket category
        service_mode_amc,
        service_mode_general,
        service_mode_maintenance,
        service_mode_services,

        // Service Report Details - Include the auto-generated report_id
        service_report_number: j.service_report,
        report_id: j.report_id || "",
        service_date: new Date(j.service_date).toLocaleDateString("en-IN"),
        service_type: j.service_type,

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
            caller_id: ticket?.caller_id,
            created_by: ticket?.created_by
        },

        // Followup Information
        followup: followupData ? {
            notes: followupData.notes,
            customer_signature: followupData.customer_signature_path,
            technician_signature: followupData.technician_signature_path,
            technician_name: followupData.technician_name,
            attendant_name: followupData.attendant_name,
            created_at: followupData.created_at ? new Date(followupData.created_at).toLocaleDateString("en-IN") : ""
        } : null,

        // Signatures section
        signatures: {
            customer: {
                label: "Customer Signature",
                signature: followupData?.customer_signature_path
            },
            technician: {
                label: "Technician Signature",
                name: safeText(followupData?.technician_name || ""),
                signature: followupData?.technician_signature_path
            },
            // Site Incharge Name (from attendant_name)
            site_incharge_name: safeText(followupData?.attendant_name),
            company: {
                label: "For " + our_company.name,
                signature: null
            }
        },

        // Terms and conditions
        terms: [
            "All HVAC repairs are guaranteed for 30 days from the date of service completion.",
            "Company is not responsible for any damages occurred during transit.",
            "Any additional work not mentioned in this report will be charged separately.",
            "Payment terms: Net 15 days from invoice date.",
            "Warranty void if HVAC equipment is tampered with by unauthorized personnel."
        ],

        current_date: new Date().toLocaleDateString("en-IN")
    };

    return vm;
}

// Generate HVAC Service Report PDF
async function renderHvacServiceReportPdfBuffer(ticketId: string): Promise<Buffer> {
    let browser: Browser | null = null;
    try {
        const vm = await buildHvacServiceReportVM(ticketId);
        const hbsPath = await HVAC_SERVICE_REPORT_TEMPLATE_PATH_PROMISE;
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
                await fs.writeFile(path.resolve(process.cwd(), "hvac-service-report-debug.html"), html);
                console.warn("HVAC PDF generation produced a very small buffer — debug HTML written to hvac-service-report-debug.html");
            } catch { }
            throw new Error("HVAC service report PDF generation failed (empty or too small buffer). Check hvac-service-report-debug.html");
        }

        return pdfBuffer;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to render HVAC service report PDF: ${msg}`);
    } finally {
        try {
            await browser?.close();
        } catch {
            // ignore close errors
        }
    }
}

// Main endpoint to generate HVAC service report
export const generateHvacServiceReport = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing HVAC ticket ID"
            });
        }

        // Validate that follow-up exists
        await validateHvacServiceReportGeneration(ticketId);

        // Check if service report data exists
        const serviceReport = await db.HvacErpServiceReport.findOne({
            where: { hvac_erp_id: ticketId },
            attributes: [
                'id', 'hvac_erp_id', 'service_report', 'service_date', 'service_type',
                'company_name', 'instructed_by', 'address', 'model_no', 'serial_no',
                'type', 'observation', 'work_done', 'additional_work_1',
                'additional_work_2', 'pdf_path', 'pdf_url', 'created_at'
            ]
        });

        if (!serviceReport) {
            return res.status(404).json({
                success: false,
                message: "HVAC service report data not found. Please create HVAC service report data first.",
                code: "SERVICE_REPORT_DATA_REQUIRED"
            });
        }

        // Generate PDF
        const pdfBuffer = await renderHvacServiceReportPdfBuffer(ticketId);

        // Update PDF path in database if needed
        const pdfFileName = `hvac-service-report-${ticketId}-${Date.now()}.pdf`;
        const pdfPath = path.join(process.cwd(), 'uploads', 'hvac-service-reports', pdfFileName);

        // Ensure directory exists
        await fs.mkdir(path.dirname(pdfPath), { recursive: true });

        // Save PDF file
        await fs.writeFile(pdfPath, pdfBuffer);

        // Update database with PDF path
        await db.HvacErpServiceReport.update(
            {
                pdf_path: pdfPath,
                pdf_url: `/uploads/hvac-service-reports/${pdfFileName}`,
            },
            {
                where: { hvac_erp_id: ticketId },
                fields: ['pdf_path', 'pdf_url']
            }
        );

        const download = String(req.query.dl || req.query.download) === "1";
        const filename = `HVAC-Service-Report-${serviceReport.service_report}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        return res.end(pdfBuffer);

    } catch (error: any) {
        console.error("Error generating HVAC service report:", error);

        if (error.message.includes("Follow-up must be completed")) {
            return res.status(400).json({
                success: false,
                message: error.message,
                code: "FOLLOWUP_REQUIRED"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to generate HVAC service report",
            error: error.message
        });
    }
};

// HTML preview endpoint
export const previewHvacServiceReportHtml = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).type("text/plain").send("Invalid or missing HVAC ticket ID");
        }

        const vm = await buildHvacServiceReportVM(ticketId);
        const hbsPath = await HVAC_SERVICE_REPORT_TEMPLATE_PATH_PROMISE;
        const tpl = await fs.readFile(hbsPath, "utf-8");
        const html = Handlebars.compile(tpl)(vm);

        return res.status(200).type("html").send(html);
    } catch (error: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${error?.message || error}`);
    }
};

// Complete workflow endpoint
export const hvacServiceReportWorkflow = async (req: Request, res: Response) => {
    try {
        const ticketId = sanitizeUuid(req.params.ticketId);

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing HVAC ticket ID"
            });
        }

        // Step 1: Check if follow-up exists (REQUIRED)
        const followupData = await db.HVACTicketFollowup.findOne({
            where: { hvac_ticket_id: ticketId }
        });

        if (!followupData) {
            return res.status(400).json({
                success: false,
                message: "Follow-up must be completed before generating HVAC service report",
                code: "FOLLOWUP_REQUIRED"
            });
        }

        // Step 2: Check if service report data exists
        const serviceReport = await db.HvacErpServiceReport.findOne({
            where: { hvac_erp_id: ticketId }
        });

        if (!serviceReport) {
            return res.status(404).json({
                success: false,
                message: "HVAC service report data not found. Please create HVAC service report data first.",
                code: "SERVICE_REPORT_DATA_REQUIRED"
            });
        }

        // Step 3: Generate and return PDF
        return await generateHvacServiceReport(req, res);

    } catch (error: any) {
        console.error("Error in HVAC service report workflow:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to complete HVAC service report workflow",
            error: error.message
        });
    }
};