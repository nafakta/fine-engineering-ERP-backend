// src/controllers/ticketerpController.ts
import { Request, Response } from "express";
import { Op, WhereOptions, Order, Sequelize, QueryTypes } from "sequelize";
import * as Yup from "yup";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getUploadsBaseDir, makeAbsoluteUrl } from "../utils/urlUtils";
import { toRelativeUploadPath } from "../utils/urlUtils";
import db from "../models";
import { createTicketSchema, updateTicketSchema } from "./Validations";
import { ensureDirSync, saveDataUrlPNG } from "../utils/fileUtils";
import { fmtDate, fmtINR, absolutizePath } from "../utils/format";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

const {
    TicketERP,
    Client,
    TicketFollowup,
    TicketMedia,
    ErpServiceReport,
    sequelize,
} = db as any;

declare global {
    namespace Express {
        interface Request {
            resolvedTicketId?: string;
        }
    }
}

/* ===========================
   Validation Schemas
=========================== */

export const createFollowupSchema = Yup.object({
    ticket_id: Yup.string().uuid("Invalid ticket id").required("ticket_id is required"),
    notes: Yup.string().nullable().transform((v) => (v === "" ? null : v)),
    customer_signature: Yup.string()
        .required("customer_signature is required")
        .test("is-data-url", "customer_signature must be a data URL", (v) =>
            typeof v === "string" ? v.startsWith("data:") : false
        ),
    technician_signature: Yup.string()
        .required("technician_signature is required")
        .test("is-data-url", "technician_signature must be a data URL", (v) =>
            typeof v === "string" ? v.startsWith("data:") : false
        ),
    attendant_name: Yup.string()
        .required("attendant_name is required")
        .trim(),
    technician_name: Yup.string()
        .required("technician_name is required")
        .trim(),
});

const updateFollowupSchema = Yup.object({
    followup_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, "followup_date must be YYYY-MM-DD").optional(),
    notes: Yup.string().trim().optional(),
    customer_signature_path: Yup.string().trim().optional(),
    technician_signature_path: Yup.string().trim().optional(),
});

/* ===========================
   Path / URL helpers
=========================== */

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
});

const BASE_URL = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com`;

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const ROOT_UPLOADS = path.join(process.cwd(), "uploads");

const absolutize = (rel: string | null | undefined) =>
    rel ? (rel.startsWith("http") ? rel : `${BASE_URL}${rel}`) : null;

function toRelativeUploads(absPath: string): string {
    const PUBLIC_ROOT = path.join(process.cwd(), "public");
    const ROOT_UPLOADS = path.join(process.cwd(), "uploads");

    let rel = path.relative(PUBLIC_ROOT, absPath);
    if (!rel.startsWith("..")) {
        rel = rel.split(path.sep).join("/");
        return rel.startsWith("uploads/") ? `/${rel}` : `/uploads/${rel}`;
    }
    rel = path.relative(ROOT_UPLOADS, absPath).split(path.sep).join("/");
    return rel.startsWith("uploads/") ? `/${rel}` : `/uploads/${rel}`;
}

async function uploadTicketFilesToS3(
    ticketId: string,
    files: Express.Multer.File[]
) {
    const uploaded: any[] = [];

    for (const file of files) {
        const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
        const key = `tickets/${ticketId}/${Date.now()}-${safeName}`;

        await new Upload({
            client: s3Client,
            params: {
                Bucket: process.env.AWS_S3_BUCKET_NAME!,
                Key: key,
                Body: fs.createReadStream(file.path),
                ContentType: file.mimetype,
                ACL: "private",
            },
        }).done();

        uploaded.push({
            key,
            mime_type: file.mimetype,
            original_name: file.originalname,
            size: file.size,
            url: `${BASE_URL}/${key}`,
        });

        // remove local temp file
        await fs.promises.unlink(file.path).catch(() => { });
    }

    return uploaded;
}

async function uploadTicketSignatureToS3(
    ticketId: string,
    buffer: Buffer,
    name: string
) {
    const key = `tickets/${ticketId}/followups/${name}-${Date.now()}.png`;

    await new Upload({
        client: s3Client,
        params: {
            Bucket: process.env.AWS_S3_BUCKET_NAME!,
            Key: key,
            Body: buffer,
            ContentType: "image/png",
            ACL: "private",
        },
    }).done();

    return key;
}


export async function generateServiceReportVM(ticket: any, our_company: any) {
    // use latest followup (your query already orders DESC by created_at)
    const latestFollowup = ticket.followups?.[0];

    const signatures = {
        customer: {
            // Name to show under "Site Incharge Name" or Customer
            name:
                ticket.client?.contact_person ||
                ticket.client?.client ||
                ticket.client?.company ||
                "",
            signature: latestFollowup?.customer_signature_url || null,
        },
        technician: {
            // Show assigned_to or some technician field
            name: ticket.assigned_to || "Technician",
            signature: latestFollowup?.technician_signature_url || null,
        },
        company: {
            label: our_company?.name || our_company?.legal_name || "Authorized Signatory",
        },
    };

    const vm = {
        doc_title: "SERVICE REPORT",
        our_company,
        service_report_number: ticket.caller_id,
        service_date: fmtDate(ticket.created_at),
        customer: {
            contact_person:
                ticket.client?.contact_person ||
                ticket.client?.client ||
                "",
            full_address:
                ticket.client?.address ||
                `${ticket.client?.city || ""} ${ticket.client?.state || ""} ${ticket.client?.pin_code || ""}`,
        },
        equipment: {
            company_name: ticket.client?.company || "",
            model_no: ticket.model_no || "",
            serial_no: ticket.serial_no || "",
            type: ticket.category || "",
        },
        observation: ticket.observation,
        work_done: ticket.work_done,
        additional_work_1: ticket.additional_work_1,
        additional_work_2: ticket.additional_work_2,
        customer_remark: latestFollowup?.notes,
        engineer_remark: ticket.engineer_remark,
        site_incharge_name:
            ticket.site_incharge_name ||
            ticket.client?.contact_person ||
            "",
        signatures, // ⬅️ THIS is what your template uses
        ticket: {
            caller_id: ticket.caller_id,
            subject: ticket.subject,
            status: ticket.status,
            priority: ticket.priority,
            category: ticket.category,
            assigned_to: ticket.assigned_to,
        },
        followup: latestFollowup
            ? {
                notes: latestFollowup.notes,
                created_at: fmtDate(latestFollowup.created_at),
            }
            : null,
        terms: [
            "Service is provided as per agreed scope.",
            "Any replacement parts will be billed separately.",
        ],
        current_date: fmtDate(new Date()),
    };

    return vm;
}

/* ===========================
   Uploads (multer)
=========================== */

export const createNoteSchema = Yup.object({
    ticket_id: Yup.string().uuid("Invalid ticket id").required("ticket_id is required"),
    note: Yup.string().trim().required("Note content is required"),
    created_by: Yup.string().uuid("Invalid user id").optional(),
});

type FilesMap = Partial<Record<"files" | "file" | "attachments" | "attachments[]" | "images" | "videos", Express.Multer.File[]>>;

const ALLOWED_FILE_TYPES = [
    "image/jpeg", "image/png", "image/webp",
    "video/mp4", "video/avi", "video/mov", "application/pdf"
];

function pickFirst(val: unknown): string | undefined {
    if (typeof val === "string" && val.trim()) return val.trim();
    if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0].trim();
    return undefined;
}
function isPlaceholder(v?: string) {
    return !v || v === ":ticket_id" || v.toLowerCase() === "ticket_id";
}

export function resolveTicketId(req: Request, res: Response, next: any) {
    const p = req.params ?? {};
    const q = req.query ?? {};
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fromHeader = pickFirst(req.headers["x-ticket-id"] as any);
    const fromParams = pickFirst((p as any).ticket_id) || pickFirst((p as any).id);
    const fromQuery = pickFirst((q as any).ticket_id) || pickFirst((q as any).id);
    const fromBody = pickFirst((b as any).ticket_id) || pickFirst((b as any).id);

    req.resolvedTicketId = fromParams || fromQuery || fromBody || fromHeader;

    console.log("🔍 RESOLVE TICKET ID", {
        path: req.path,
        params: req.params,
        query: req.query,
        header: req.headers["x-ticket-id"],
        resolved: req.resolvedTicketId,
    });

    if (isPlaceholder(req.resolvedTicketId)) {
        return res.status(400).json({
            success: false,
            error: "Valid ticket_id missing. Use /uploadticketmedia/<UUID> (not :ticket_id).",
        });
    }
    next();
}

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), "public", "uploads", "tickets");

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const tId = req.resolvedTicketId;
        if (!tId) return cb(new Error("Missing ticket_id for upload destination"), "");
        const dest = path.join(UPLOAD_ROOT, tId);
        ensureDirSync(dest);
        cb(null, dest);
    },
    filename: (_req, file, cb) => {
        const stamped = Date.now();
        const safeOriginal = file.originalname.replace(/[^\w.\-]+/g, "_");
        cb(null, `${stamped}_${safeOriginal}`);
    },
});

const uploader = multer({
    storage,
    limits: { fileSize: 1000 * 1024 * 1024 }, // 1000MB like HVAC controller
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_FILE_TYPES.includes(file.mimetype)) {
            return cb(new Error("Invalid file type"));
        }
        cb(null, true);
    },
});

export const withUpload = (req: Request, res: Response, next: any) => {
    const handler = uploader.fields([
        { name: "files", maxCount: 20 },
        { name: "file", maxCount: 1 },
        { name: "attachments", maxCount: 20 },
        { name: "attachments[]", maxCount: 20 },
        { name: "images", maxCount: 20 },
        { name: "videos", maxCount: 10 },
    ]);

    handler(req, res, (err: any) => {
        if (err) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({ success: false, error: "File size exceeds the 1000MB limit" });
            }
            return res.status(400).json({ success: false, error: err.message || "Upload failed" });
        }
        next();
    });
};

/* ===========================
   CRUD: Tickets
=========================== */

export const createTicket = async (req: Request, res: Response) => {
    try {
        const body = await createTicketSchema.validate(req.body, { abortEarly: false });
        const row = await TicketERP.create(body as any);
        return res.status(200).json({ success: true, data: row });
    } catch (err: any) {
        const errors = err?.errors ?? err?.message ?? "Failed to create ticket";
        return res.status(400).json({ success: false, error: errors });
    }
};

export const getTicketById = async (req: Request, res: Response) => {
    try {
        const row = await TicketERP.findByPk(req.params.id, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: [
                        "company",
                        "client",
                        "contact_person",
                        "mobile",
                        "email_id",
                        "address",
                        "city",
                        "state",
                        "pin_code"
                    ],
                    required: false
                },
                { model: TicketFollowup, as: "followups", required: false },
                { model: TicketMedia, as: "media", required: false },
            ],
        });
        if (!row) return res.status(404).json({ success: false, error: "Not found" });
        return res.json({ success: true, data: row });
    } catch {
        return res.status(500).json({ success: false, error: "Failed to fetch ticket" });
    }
};

export const updateTicket = async (req: Request, res: Response) => {
    try {
        const body = await updateTicketSchema.validate(req.body, { abortEarly: false });
        const row = await TicketERP.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });

        // auto close timestamp (optional)
        if (body.status && body.status.toLowerCase() === "closed" && !(body as any).closed_at) {
            (body as any).closed_at = new Date();
        }

        await row.update(body as any);

        const updated = await TicketERP.findByPk(row.id, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["company", "client", "contact_person", "mobile"]
                }
            ],
        });

        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const errors = err?.errors ?? err?.message ?? "Failed to update ticket";
        return res.status(400).json({ success: false, error: errors });
    }
};

export const updateTicketStatus = async (req: Request, res: Response) => {
    try {
        const { ticketId } = req.params;
        const { status } = req.body;

        // Validate required fields
        if (!ticketId) {
            return res.status(400).json({
                success: false,
                error: "Ticket ID is required"
            });
        }

        if (!status) {
            return res.status(400).json({
                success: false,
                error: "Status is required"
            });
        }

        // Validate status value
        const allowedStatuses = ['Open', 'Closed', 'Cancel', 'In Progress', 'Resolved'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`
            });
        }

        // Find the ticket
        const ticket = await TicketERP.findByPk(ticketId);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                error: "Ticket not found"
            });
        }

        // Update the status
        const updateData: any = { status };

        // Auto-set closed_at if status is being changed to Closed
        if (status === 'Closed' && ticket.status !== 'Closed') {
            updateData.closed_at = new Date();
        }

        await ticket.update(updateData);

        // Fetch the updated ticket with related data
        const updatedTicket = await TicketERP.findByPk(ticketId, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["company", "client", "contact_person", "mobile"]
                }
            ],
        });

        return res.json({
            success: true,
            message: "Ticket status updated successfully",
            data: updatedTicket
        });

    } catch (error: any) {
        console.error("updateTicketStatus error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to update ticket status"
        });
    }
};

export const checkTicketHasMedia = async (req: Request, res: Response) => {
    try {
        const { ticketId } = req.params;

        if (!ticketId) {
            return res.status(400).json({
                success: false,
                error: "Ticket ID is required"
            });
        }

        const mediaCount = await TicketMedia.count({
            where: { ticket_id: ticketId }
        });

        return res.json({
            success: true,
            hasMedia: mediaCount > 0,
            mediaCount
        });
    } catch (error: any) {
        console.error("checkTicketHasMedia error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to check ticket media"
        });
    }
};

export const closeTicket = async (req: Request, res: Response) => {
    try {
        const row = await TicketERP.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });
        await row.update({ status: "Closed" });
        return res.json({ success: true, data: row });
    } catch {
        return res.status(500).json({ success: false, error: "Failed to close ticket" });
    }
};

export const deleteTicket = async (req: Request, res: Response) => {
    try {
        const row = await TicketERP.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });
        await row.destroy();
        return res.json({ success: true, message: "Deleted" });
    } catch {
        return res.status(500).json({ success: false, error: "Failed to delete ticket" });
    }
};

/* ===========================
   Upload Ticket Media
=========================== */

export const uploadTicketMedia = async (req: Request, res: Response) => {
    try {
        if (!req.resolvedTicketId) {
            return res.status(400).json({
                success: false,
                error: "Ticket ID not resolved.",
            });
        }

        const bag = (req.files || {}) as FilesMap;
        const files: Express.Multer.File[] = [
            ...(bag.files ?? []),
            ...(bag.file ?? []),
            ...(bag.attachments ?? []),
            ...(bag["attachments[]"] ?? []),
            ...(bag.images ?? []),
            ...(bag.videos ?? []),
        ];

        if (!files.length) {
            return res.status(400).json({
                success: false,
                error: "No files uploaded.",
            });
        }

        const ticket_id = req.resolvedTicketId;
        const ticket = await TicketERP.findByPk(ticket_id);
        if (!ticket) {
            await Promise.allSettled(files.map((f) => fs.promises.unlink(f.path).catch(() => void 0)));
            return res.status(404).json({ success: false, error: "Ticket not found" });
        }

        const created_by =
            (req as any)?.user?.id ||
            (req as any)?.user?.system_user_id ||
            (req.headers["x-user-id"] as string) ||
            null;

        const uploaded = await uploadTicketFilesToS3(ticket_id, files);

        const mediaRecords = await TicketMedia.bulkCreate(
            uploaded.map((u) => ({
                ticket_id,
                file: u.key, // STORE S3 KEY
                mime_type: u.mime_type,
                original_name: u.original_name,
                size: u.size,
                is_upload: true,
                created_by,
            })),
            { returning: true }
        );

        // Attach S3 URLs
        const mediaWithUrls = mediaRecords.map((r: any) => ({
            ...r.toJSON(),
            url: `${BASE_URL}/${r.file}`,
        }));

        return res.status(201).json({
            success: true,
            count: mediaRecords.length,
            data: mediaWithUrls,
            hasMedia: true,
            message: "Files uploaded successfully",
        });
    } catch (err: any) {
        console.error("uploadTicketMedia error:", err);
        if (req.files) {
            const bag = (req.files || {}) as FilesMap;
            const files: Express.Multer.File[] = [
                ...(bag.files ?? []),
                ...(bag.file ?? []),
                ...(bag.attachments ?? []),
                ...(bag["attachments[]"] ?? []),
                ...(bag.images ?? []),
                ...(bag.videos ?? []),
            ];
            await Promise.allSettled(files.map((f) => fs.promises.unlink(f.path).catch(() => void 0)));
        }

        return res.status(500).json({
            success: false,
            error: err?.message || "Failed to upload ticket files",
        });
    }
};

// Update the listTickets function to include media count
export const listTickets = async (req: Request, res: Response) => {
    try {
        const {
            q, status, priority, client_id, from, to, assigned_to,
            page = "1", limit = "20", sortBy = "created_at", sortDir = "desc",
        } = req.query as Record<string, string | undefined>;

        const where: WhereOptions<any> = {};
        if (status) Object.assign(where, { status });
        if (priority) Object.assign(where, { priority });
        if (client_id) Object.assign(where, { client_id });
        if (assigned_to) Object.assign(where, { assigned_to: { [Op.iLike]: `%${assigned_to}%` } });

        if (from || to) {
            const range: any = {};
            if (from) range[Op.gte] = new Date(from);
            if (to) range[Op.lte] = new Date(to);
            Object.assign(where, { created_at: range });
        }

        if (q) {
            const likeQ = { [Op.iLike]: `%${q}%` };
            Object.assign(where, {
                [Op.or]: [
                    { subject: likeQ },
                    { description: likeQ },
                    { assigned_to: likeQ },
                    { caller_id: likeQ }
                ],
            });
        }

        const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
        const offset = (pageNum - 1) * pageSize;

        const SORTABLE = new Set([
            "created_at", "updated_at", "subject", "status", "priority",
            "caller_id", "assigned_to", "category",
        ]);
        const dir: "ASC" | "DESC" = sortDir?.toUpperCase() === "ASC" ? "ASC" : "DESC";
        const col = SORTABLE.has(sortBy as any) ? (sortBy as string) : "created_at";
        const order: Order = [[col, dir]];

        const { rows, count } = await TicketERP.findAndCountAll({
            where,
            order,
            limit: pageSize,
            offset,
            subQuery: false,
            distinct: true,
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["company", "client", "contact_person", "mobile"],
                    required: false
                },
                {
                    model: TicketMedia,
                    as: "media",
                    attributes: ["id"], // Only count, don't load all media data
                    required: false
                }
            ]
        });

        // Transform data to include hasMedia flag
        const transformedRows = rows.map((ticket: any) => ({
            ...ticket.toJSON(),
            hasMedia: ticket.media && ticket.media.length > 0
        }));

        return res.json({
            success: true,
            data: transformedRows,
            page: pageNum,
            limit: pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
        });
    } catch (err: any) {
        console.error("listTickets error:", err?.message, err?.stack, err?.parent?.message);
        return res.status(500).json({
            success: false,
            error: err?.parent?.message || err?.message || "Failed to list tickets",
        });
    }
};

/* ===========================
   Search Tickets (flexible)
=========================== */

export const searchTickets = async (req: Request, res: Response) => {
    try {
        const {
            q, status, priority, client_id, from, to, assigned_to,
            page = "1", limit = "20", sortBy = "created_at", sortDir = "desc",
        } = req.query as Record<string, string | undefined>;

        const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
        const assignedTo = clean(assigned_to);
        const qtext = clean(q);

        const where: WhereOptions = {};
        if (status) (where as any).status = status;
        if (priority) (where as any).priority = priority;
        if (client_id) (where as any).client_id = client_id;

        if (from || to) {
            (where as any).created_at = {
                ...(from ? { [Op.gte]: new Date(`${from}T00:00:00.000Z`) } : {}),
                ...(to ? { [Op.lte]: new Date(`${to}T23:59:59.999Z`) } : {}),
            };
        }

        const andGroup: any[] = [];

        if (assignedTo) {
            andGroup.push({
                assigned_to: { [Op.iLike]: `%${assignedTo}%` }
            });
        }

        if (qtext) {
            const like = { [Op.iLike]: `%${qtext}%` };
            andGroup.push({
                [Op.or]: [
                    { subject: like },
                    { description: like },
                    { caller_id: like },                // 🔍 search by caller_id
                    Sequelize.where(Sequelize.col("client.company"), like),
                    Sequelize.where(Sequelize.col("client.client"), like),
                    Sequelize.where(Sequelize.col("client.contact_person"), like),
                    { "$serviceReports.report_id$": like }, // 🔍 search by report_id
                ],
            });
        }

        if (andGroup.length) (where as any)[Op.and] = andGroup;

        const includeClient: any = {
            model: Client,
            as: "client",
            attributes: ["company", "client", "contact_person", "mobile"],
            required: false,
        };

        const includeServiceReports: any = {
            model: ErpServiceReport,
            as: "serviceReports", // 👈 must match association alias
            attributes: ["id", "report_id", "service_date"],
            required: false,
        };

        const SORTABLE_TICKET = new Set([
            "created_at",
            "updated_at",
            "subject",
            "status",
            "priority",
            "caller_id",
        ]);
        const dir: "ASC" | "DESC" = sortDir?.toUpperCase() === "ASC" ? "ASC" : "DESC";
        let order: Order;

        if (sortBy === "company") {
            order = [[{ model: Client, as: "client" } as any, "company", dir]];
        } else if (sortBy === "client_name") {
            order = [[{ model: Client, as: "client" } as any, "client", dir]];
        } else if (sortBy === "contact_person") {
            order = [[{ model: Client, as: "client" } as any, "contact_person", dir]];
        } else {
            const col = SORTABLE_TICKET.has(sortBy as any) ? (sortBy as string) : "created_at";
            order = [[col, dir]];
        }

        const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
        const offset = (pageNum - 1) * pageSize;

        const { rows, count } = await TicketERP.findAndCountAll({
            where,
            include: [includeClient, includeServiceReports], // 👈 use serviceReports alias
            order,
            limit: pageSize,
            offset,
            subQuery: false,
            distinct: true,
        });

        return res.json({
            success: true,
            data: rows,
            page: pageNum,
            limit: pageSize,
            total: count,
            totalPages: Math.ceil(count / pageSize),
        });
    } catch (err: any) {
        console.error("searchTickets error:", err?.message);
        return res.status(500).json({ success: false, error: err?.message || "Failed to search tickets" });
    }
};


/* ===========================
   Next Caller ID
=========================== */

function fmt(n: number, prefix = "", pad = 0) {
    const s = pad > 0 ? String(n).padStart(pad, "0") : String(n);
    return `${prefix}${s}`;
}

export const getNextCallerId = async (req: Request, res: Response) => {
    try {
        if (!sequelize) {
            return res.status(500).json({ success: false, error: "Sequelize not initialized" });
        }

        const prefix = (req.query.prefix as string) || "";
        const pad = Number(req.query.pad ?? 0) || 0;

        let sql: string;
        let replacements: Record<string, any> = {};

        if (prefix) {
            sql = `
        SELECT COALESCE(
          MAX( (regexp_replace(caller_id, CONCAT('^', :prefix), '', 'g'))::bigint ),
          0
        ) AS max_num
        FROM public.ticketerp
        WHERE caller_id LIKE :likePrefix
          AND regexp_replace(caller_id, CONCAT('^', :prefix), '', 'g') ~ '^[0-9]+$'
      `;
            replacements = { prefix, likePrefix: `${prefix}%` };
        } else {
            sql = `
        SELECT COALESCE(MAX(caller_id::bigint), 0) AS max_num
        FROM public.ticketerp
        WHERE caller_id ~ '^[0-9]+$'
      `;
        }

        const [row]: any[] = await sequelize.query(sql, {
            type: QueryTypes.SELECT,
            replacements,
        });

        const nextNumber = Number(row?.max_num || 0) + 1;
        const next = fmt(nextNumber, prefix, pad);

        return res.json({ success: true, next, nextNumber, prefix, pad });
    } catch (err: any) {
        console.error("getNextCallerId error:", err?.message, err?.parent?.message);
        return res.status(500).json({
            success: false,
            error: err?.parent?.message || err?.message || "Failed to compute next caller_id",
        });
    }
};

/* ===========================
   Followups (data URL signatures)
=========================== */

export const createFollowup = async (req: Request, res: Response) => {
    try {
        const ticket_id = (req.params.ticket_id as string) || (req.body?.ticket_id as string);
        const body = await createFollowupSchema.validate({ ...req.body, ticket_id }, { abortEarly: false });

        const t = await TicketERP.findByPk(body.ticket_id);
        if (!t) return res.status(404).json({ success: false, error: "Ticket not found" });

        const created_by =
            (req as any)?.user?.id ||
            (req as any)?.user?.system_user_id ||
            (req.headers["x-user-id"] as string) ||
            null;

        // const uploadsBase = getUploadsBaseDir();
        // const followupDir = path.join(uploadsBase, "tickets", body.ticket_id, "followups");
        // ensureDirSync(followupDir);

        const customerKey = await uploadTicketSignatureToS3(
            body.ticket_id,
            Buffer.from(body.customer_signature.split(",")[1], "base64"),
            "customer"
        );

        const technicianKey = await uploadTicketSignatureToS3(
            body.ticket_id,
            Buffer.from(body.technician_signature.split(",")[1], "base64"),
            "technician"
        );

        const ts = Date.now();

        const row = await TicketFollowup.create({
            ticket_id: body.ticket_id,
            notes: body.notes ?? null,
            customer_signature_path: customerKey,
            technician_signature_path: technicianKey,
            attendant_name: body.attendant_name ?? null, // Add this
            technician_name: body.technician_name ?? null, // Add this
            created_by,
        });

        // Add absolute URLs to response
        const responseData = {
            ...row.toJSON(),
            customer_signature_url: `${BASE_URL}/${customerKey}`,
            technician_signature_url: `${BASE_URL}/${technicianKey}`,
        };

        return res.status(201).json({ success: true, data: responseData });
    } catch (err: any) {
        if (err?.name === "ValidationError" && Array.isArray(err?.errors)) {
            return res.status(400).json({ success: false, error: err.errors });
        }
        return res.status(400).json({ success: false, error: err?.message ?? "Failed to create followup" });
    }
};

/* ===========================
   Assets (media + signatures) — model-based (no fragile table names)
=========================== */

export const getTicketFilesAndSignatures = async (req: Request, res: Response) => {
    try {
        const ticketIdRaw =
            (req.params.ticketId as string) ||
            (req.query.ticketId as string) ||
            (req.body?.ticketId as string) ||
            (req.headers["x-ticket-id"] as string) ||
            "";

        const ticketId = ticketIdRaw.replace(/^:+/, "").trim();

        if (
            !ticketId ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)
        ) {
            return res.status(400).json({
                success: false,
                error: "Valid ticketId is required in /getTicketAssets/:ticketId",
                received: ticketIdRaw,
            });
        }

        const ticket = await TicketERP.findByPk(ticketId, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["company", "client", "contact_person", "mobile", "email_id", "address"],
                },
                {
                    model: TicketMedia,
                    as: "media",
                    required: false,
                    separate: true,
                    order: [["created_at", "DESC"]],
                },
                {
                    model: TicketFollowup,
                    as: "followups",
                    required: false,
                    separate: true,
                    order: [["created_at", "DESC"]],
                },
            ],
        });

        if (!ticket) {
            return res.status(404).json({ success: false, error: "Ticket not found" });
        }

        /* -----------------------------
           MEDIA (S3)
        ----------------------------- */
        const media = (ticket.media || []).map((m: any) => ({
            ...m.toJSON(),
            url: `${BASE_URL}/${m.file}`, // ✅ S3 URL
        }));

        /* -----------------------------
           FOLLOWUPS (S3)
        ----------------------------- */
        const followups = (ticket.followups || []).map((f: any) => ({
            ...f.toJSON(),
            customer_signature_url: f.customer_signature_path
                ? `${BASE_URL}/${f.customer_signature_path}`
                : null,
            technician_signature_url: f.technician_signature_path
                ? `${BASE_URL}/${f.technician_signature_path}`
                : null,
            attendant_name: f.attendant_name,
            technician_name: f.technician_name,
        }));

        /* -----------------------------
           SIGNATURES OBJECT
        ----------------------------- */
        const latestFollowup = followups[0] || null;

        const signatures = {
            customer: {
                name:
                    ticket.client?.contact_person ||
                    ticket.client?.client ||
                    ticket.client?.company ||
                    "",
                signature: latestFollowup?.customer_signature_url || null,
            },
            signatures: {
                customer_signed_by: latestFollowup?.attendant_name || "Attendant",
                technician_signed_by: ticket.assigned_to || "Technician",
                company_signed_by: process.env.COMPANY_NAME || "Authorized Signatory",
            },
            technician: {
                name: ticket.assigned_to || "Technician",
                signature: latestFollowup?.technician_signature_url || null,
            },
            company: {
                label: process.env.COMPANY_NAME || "Authorized Signatory",
            },
        };

        return res.json({
            success: true,
            data: {
                ...ticket.toJSON(),
                media,
                followups,
                signatures,
            },
        });
    } catch (error: any) {
        console.error("Error getTicketFilesAndSignatures:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal Server Error",
        });
    }
};

export const createNote = async (req: Request, res: Response) => {
    try {
        // Validate request body
        const body = await createNoteSchema.validate(req.body, { abortEarly: false });

        // Check if ticket exists
        const ticket = await TicketERP.findByPk(body.ticket_id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                error: "Ticket not found"
            });
        }

        // Get created_by from user context or request body
        const created_by = body.created_by ||
            (req as any)?.user?.id ||
            (req as any)?.user?.system_user_id ||
            (req.headers["x-user-id"] as string) ||
            null;

        // Get existing notes (if any)
        const currentNotes = ticket.notes || "";

        // Format the new note with timestamp and separator
        const timestamp = new Date().toISOString();
        const userInfo = created_by ? `[User: ${created_by}]` : '[System]';
        const separator = currentNotes ? "\n\n---\n\n" : "";

        const newNoteEntry = `${separator}**${timestamp}** ${userInfo}\n${body.note}`;

        // Combine with existing notes (new notes appended at the end)
        const updatedNotes = currentNotes + newNoteEntry;

        // Update the ticket with new notes
        await ticket.update({
            notes: updatedNotes,
            updated_at: new Date() // Update the timestamp
        });

        // Fetch the updated ticket to return
        const updatedTicket = await TicketERP.findByPk(body.ticket_id, {
            include: [
                {
                    model: Client,
                    as: "client",
                    attributes: ["company", "client", "contact_person", "mobile"]
                }
            ],
        });

        return res.status(201).json({
            success: true,
            message: "Note added successfully",
            data: {
                ticket: updatedTicket,
                note: body.note,
                timestamp,
                created_by
            }
        });

    } catch (err: any) {
        if (err?.name === "ValidationError" && Array.isArray(err?.errors)) {
            return res.status(400).json({
                success: false,
                error: err.errors.map((e: any) => e.message).join(", ")
            });
        }

        console.error("createNote error:", err?.message);
        return res.status(400).json({
            success: false,
            error: err?.message ?? "Failed to add note"
        });
    }
};