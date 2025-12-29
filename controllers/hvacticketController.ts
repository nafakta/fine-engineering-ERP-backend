import { Request, Response } from "express";
import { Op, WhereOptions, Order, Sequelize, QueryTypes } from "sequelize";
import * as Yup from "yup";
import multer from "multer";
import path from "path";
import fs from "fs";
import db from "../models";
import { ensureDirSync, saveDataUrlPNG } from "../utils/fileUtils";
import { fmtDate, fmtINR, absolutizePath } from "../utils/format";
import puppeteer from "puppeteer";
import * as fsp from "fs/promises";
import express from "express";
import dbModels from "../models";
import {
  makeAbsoluteUrl,
  toRelativeUploadPath,
  getUploadsBaseDir,
  ensureUploadsStructure
} from "../utils/urlUtils";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";



const {
  HVACTicket,
  HVACTicketMedia,
  HVACTicketFollowup,
  sequelize,
} = db as any;


declare global {
  namespace Express {
    interface Request {
      resolvedHVACTicketId?: string;
    }
  }
}
const UUID_RX = /^[0-9a-fA-F-]{36}$/;
/* ===========================
   Validation
=========================== */

// ---- URL/path helpers ----
const PUBLIC_ROOT = path.join(process.cwd(), "public");
const UPLOADS_BASE = getUploadsBaseDir();

const ALLOWED_FILE_TYPES = [
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/avi", "video/mov"
];

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
});

const BASE_URL = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com`;

function absolutizeForServer(relPath: string) {
  if (!relPath) return null;
  if (/^https?:\/\//i.test(relPath)) return relPath;
  const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8003}`;
  const prefix = process.env.API_PREFIX || "/api/v1/compresscrmbackend";
  // if relPath already begins with /uploads, serve from static mount
  return `${base}${prefix}${relPath.startsWith("/") ? relPath : "/" + relPath}`;
}

// function toRelativeUploads(absPath: string): string {
//   let rel = path.relative(PUBLIC_ROOT, absPath);
//   if (!rel.startsWith("..")) {
//     rel = rel.split(path.sep).join("/");
//     return rel.startsWith("uploads/") ? rel : `uploads/${rel}`;
//   }
//   rel = path.relative(ROOT_UPLOADS, absPath).split(path.sep).join("/");
//   return rel.startsWith("uploads/") ? rel : `uploads/${rel}`;
// }


// Ensure you have one BASE_URL defined at module scope
async function uploadHVACFilesToS3(
  ticketId: string,
  files: Express.Multer.File[]
) {
  const uploaded: any[] = [];

  for (const file of files) {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
    const key = `hvac_tickets/${ticketId}/${Date.now()}-${safeName}`;

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

// Absolutize: returns an absolute URL or null
// Absolutize: returns an absolute URL or null
const absolutize = (rel: string | null | undefined) => {
  if (!rel) return null;
  rel = String(rel).trim();
  if (rel === "") return null;

  // If it already starts with BASE_URL, return as-is to avoid duplication
  if (rel.startsWith(BASE_URL)) {
    return rel;
  }

  // Already a proper absolute URL -> return as-is
  if (/^https?:\/\//i.test(rel)) {
    return rel;
  }

  // Fix malformed absolute URLs with single slash after protocol
  if (/^https?:\/[^/]/i.test(rel) || /^https?:\\[^\\]/i.test(rel)) {
    // Fix: http:/localhost... → http://localhost...
    const fixed = rel.replace(/^(https?):\/+/, '$1://');
    return fixed.replace(/\\/g, "/");
  }

  // Protocol-relative like //cdn.example.com
  if (rel.startsWith("//")) {
    const scheme = (BASE_URL && BASE_URL.split("://")[0]) || "http";
    return `${scheme}:${rel}`;
  }

  // Ensure rel starts with a single slash
  const normalizedRel = rel.startsWith("/") ? rel : `/${rel}`;

  // Remove any duplicate slashes
  const cleanRel = normalizedRel.replace(/\/+/g, "/");

  // Return combined URL
  return `${BASE_URL}${cleanRel}`;
};

// Normalize DB file -> final url (ticketId optional)
function normalizeMediaUrl(rawFile: any, ticketId?: string) {
  if (!rawFile) return null;
  const s = String(rawFile).trim();

  // If it already looks like a proper absolute URL, use absolutize to fix if needed
  if (s.startsWith("http") || s.startsWith("//")) {
    return absolutize(s);
  }

  // If contains uploads/ path anywhere, extract and absolutize
  const uploadsMatch = s.match(/(uploads[\\/].*)$/i);
  if (uploadsMatch) {
    const rel = `/${uploadsMatch[1].replace(/\\/g, "/")}`;
    return absolutize(rel);
  }

  // If s looks like a path already starting with /uploads
  if (s.startsWith("/uploads") || s.startsWith("uploads")) {
    const rel = s.startsWith("/") ? s : `/${s}`;
    return absolutize(rel);
  }

  // Fallback: assume filename under hvac_tickets/<ticketId> or generic uploads
  const fname = s.split(/[\\/]/).pop() || s;
  if (ticketId) return absolutize(`/uploads/hvac_tickets/${ticketId}/${fname}`);
  return absolutize(`/uploads/${fname}`);
}

const app = express();
const API_PREFIX = process.env.API_PREFIX || "/api/v1/compresscrmbackend";

app.use(`${API_PREFIX}/reports`,
  express.static(path.join(process.cwd(), "public", "reports"))
);

export const createHVACFollowupSchema = Yup.object({
  hvac_ticket_id: Yup.string().uuid("Invalid hvac_ticket_id").required("hvac_ticket_id is required"),
  notes: Yup.string()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
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
  technician_name: Yup.string()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),  // Add transformation for empty strings
  attendant_name: Yup.string()
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),  // Add transformation for empty strings
});

export const createHVACTicketSchema = Yup.object({
  caller_id: Yup.string().required(),
  subject: Yup.string().required(),
  status: Yup.string().required(),
  // market_id: Yup.string().uuid().nullable(),
  company_name: Yup.string().nullable(),
  category: Yup.string().nullable(),
  priority: Yup.string().nullable(),
  assigned_to: Yup.string().nullable(),
  description: Yup.string().nullable(),
  shipping_address: Yup.string().nullable(),
  type: Yup.string().nullable(),
});

export const updateHVACTicketSchema = Yup.object({
  caller_id: Yup.string().optional(),
  subject: Yup.string().optional(),
  status: Yup.string().optional(),
  // market_id: Yup.string().uuid().nullable().optional(),
  company_name: Yup.string().nullable().optional(),
  category: Yup.string().nullable().optional(),
  priority: Yup.string().nullable().optional(),
  assigned_to: Yup.string().nullable().optional(),
  description: Yup.string().nullable().optional(),
  shipping_address: Yup.string().nullable().optional(),
  type: Yup.string().nullable().optional(),
});


const reportSchema: Yup.ObjectSchema<ServiceReportFormData> = Yup.object({
  erp_id: Yup.string().required(),
  service_report: Yup.string().required(),
  service_date: Yup.string().required(),
  service_type: Yup.string().required(),
  company_name: Yup.string().required(),
  instructed_by: Yup.string().required(),
  address: Yup.string().required(),
  model_no: Yup.string().required(),
  serial_no: Yup.string().required(),
  type: Yup.string().required(),
  observation: Yup.string().nullable(),
  work_done: Yup.string().nullable(),
  additional_work_1: Yup.string().nullable(),
  additional_work_2: Yup.string().nullable(),
});

interface ServiceReportFormData {
  erp_id: string;
  service_report: string;
  service_date: string;
  service_type: string;
  company_name: string;
  instructed_by: string;
  address: string;
  model_no: string;
  serial_no: string;
  type: string;
  observation?: string | null;
  work_done?: string | null;
  additional_work_1?: string | null;
  additional_work_2?: string | null;
}

type ServiceReportFormValues = {
  erp_id: string;
  service_report: string;
  service_date: string;
  service_type: string;
  company_name: string;
  instructed_by: string;
  address: string;
  model_no: string;
  serial_no: string;
  type: string;
  observation?: string | null;
  work_done?: string | null;
  additional_work_1?: string | null;
  additional_work_2?: string | null;
};

interface ServiceReportHTMLCtx {
  ticket: any;
  media: { url?: string; mime_type?: string }[];
  custSig?: string | null;
  techSig?: string | null;
  notes?: string;
  items: { sr: number; description: string; make: string; hsn: string; qty: number; unit: string; rate: number; amount: number; }[];
  subTotal: number;
  discount: number;
  gstPct: number;
  gstAmt: number;
  grand: number;
  form: ServiceReportFormData;
}
/* ===========================
   Uploads
=========================== */


type FilesMap = Partial<Record<"files" | "file" | "attachments" | "attachments[]", Express.Multer.File[]>>;

// ---- helpers
function pickFirst(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (Array.isArray(val) && typeof val[0] === "string" && val[0].trim()) return val[0].trim();
  return undefined;
}
function isPlaceholder(v?: string) {
  return !v || v === ":hvac_ticket_id" || v.toLowerCase() === "hvac_ticket_id";
}

// ---- resolver
export function resolveHVACTicketId(req: Request, res: Response, next: any) {
  const p = req.params ?? {};
  const q = req.query ?? {};
  const b = (req.body ?? {}) as Record<string, unknown>;

  const fromHeader = pickFirst(req.headers["x-hvac-ticket-id"] as any) || pickFirst(req.headers["x-ticket-id"] as any);
  const fromParams = pickFirst((p as any).hvac_ticket_id) || pickFirst((p as any).ticket_id) || pickFirst((p as any).id);
  const fromQuery = pickFirst((q as any).hvac_ticket_id) || pickFirst((q as any).ticket_id) || pickFirst((q as any).id);
  const fromBody = pickFirst((b as any).hvac_ticket_id) || pickFirst((b as any).ticket_id) || pickFirst((b as any).id);

  req.resolvedHVACTicketId = fromParams || fromQuery || fromBody || fromHeader;

  // Debug is handy during setup
  console.log("HVAC UPLOAD HIT", {
    path: req.path,
    params: req.params,
    query: req.query,
    header: req.headers["x-hvac-ticket-id"] || req.headers["x-ticket-id"],
    resolved: req.resolvedHVACTicketId,
  });

  if (isPlaceholder(req.resolvedHVACTicketId)) {
    return res.status(400).json({
      success: false,
      error: "Valid hvac_ticket_id missing. Use /hvac/uploadticketmedia/<UUID> (not :hvac_ticket_id)",
    });
  }
  next();
}
const HVAC_UPLOAD_ROOT =
  process.env.HVAC_UPLOAD_DIR ||
  path.join(process.cwd(), "public", "uploads", "hvac_tickets");

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function uploadSignatureToS3(
  ticketId: string,
  buffer: Buffer,
  name: string
) {
  const key = `hvac_tickets/${ticketId}/followups/${name}-${Date.now()}.png`;

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tId = req.resolvedHVACTicketId;
    if (!tId) return cb(new Error("Missing hvac_ticket_id for upload destination"), "");
    const dest = path.join(HVAC_UPLOAD_ROOT, tId);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
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
  limits: { fileSize: 1000 * 1024 * 1024 }, // 1000MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/webp",
      "video/mp4", "video/avi", "video/mov",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Invalid file type"));
    }

    cb(null, true); // Accept the file
  },
});

export const withHVACUpload = (req: Request, res: Response, next: any) => {
  const handler = uploader.fields([
    { name: "files", maxCount: 20 },
    { name: "file", maxCount: 1 },
    { name: "attachments", maxCount: 20 },
    { name: "attachments[]", maxCount: 20 },
  ]);

  handler(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          error: "File size exceeds the 500MB limit",
        });
      }
      return res.status(400).json({ success: false, error: err.message || "Upload failed" });
    }

    // Proceed to the next middleware if no errors
    next();
  });
};

/* ===========================
   CRUD: HVAC Tickets
=========================== */

export const createHVACTicket = async (req: Request, res: Response) => {
  try {
    const body = await createHVACTicketSchema.validate(req.body, { abortEarly: false });
    const row = await HVACTicket.create(body as any);
    return res.status(200).json({ success: true, data: row });
  } catch (err: any) {
    const errors = err?.errors ?? err?.message ?? "Failed to create HVAC ticket";
    return res.status(400).json({ success: false, error: errors });
  }
};

export const getHVACTicketById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }

    const row = await HVACTicket.findByPk(id, {
      include: [
        {
          model: HVACTicketFollowup,
          as: "followups",
          required: false,
          separate: true,
          order: [["created_at", "DESC"]]
        },
        {
          model: HVACTicketMedia,
          as: "media",
          required: false,
          separate: true,
          order: [["created_at", "DESC"]]
        },
        {
          model: dbModels.Client,
          as: "client",
          required: false,
          attributes: [
            "id", "company", "client", "mobile", "email_id",
            "city", "state", "pin_code", "address", "shipping_address",
            "contact_person", "contact_person_number"
          ]
        },
      ],
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        error: "HVAC Ticket not found"
      });
    }

    const ticketData = row.toJSON();

    // Add absolute URLs for media using makeAbsoluteUrl like air condition controller
    if (ticketData.media) {
      ticketData.media = ticketData.media.map((m: any) => ({
        ...m,
        url: makeAbsoluteUrl(req, m.file),
      }));
    }

    // Add absolute URLs for followups using makeAbsoluteUrl
    if (ticketData.followups) {
      ticketData.followups = ticketData.followups.map((f: any) => ({
        ...f,
        customer_signature_url: makeAbsoluteUrl(req, f.customer_signature_path),
        technician_signature_url: makeAbsoluteUrl(req, f.technician_signature_path),
      }));
    }

    return res.json({
      success: true,
      data: ticketData
    });

  } catch (error: any) {
    console.error("Error fetching HVAC ticket:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch HVAC ticket",
      details: error.message
    });
  }
};

export const listHVACTickets = async (req: Request, res: Response) => {
  try {
    const {
      q,
      status,
      priority,
      client_id,
      from,
      to,
      category,
      assigned_to,
      page = "1",
      limit = "20",
      sortBy = "created_at",
      sortDir = "desc",
    } = req.query as Record<string, string | undefined>;

    const where: WhereOptions<any> = {};
    if (status) Object.assign(where, { status });
    if (priority) Object.assign(where, { priority });
    if (client_id) Object.assign(where, { client_id });
    if (category) Object.assign(where, { category });
    if (assigned_to) Object.assign(where, { assigned_to: { [Op.iLike]: `%${assigned_to}%` } });

    if (from || to) {
      const range: any = {};
      if (from) range[Op.gte] = new Date(from);
      if (to) range[Op.lte] = new Date(to);
      Object.assign(where, { created_at: range });
    }

    if (q) {
      const like = { [Op.iLike]: `%${q}%` };
      Object.assign(where, {
        [Op.or]: [
          { subject: like },
          { description: like },
          { assigned_to: like }
        ],
      });
    }

    const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
    const offset = (pageNum - 1) * pageSize;

    const SORTABLE = new Set([
      "created_at",
      "updated_at",
      "subject",
      "status",
      "priority",
      "caller_id",
      "assigned_to",
      "category",
    ]);
    const dir: "ASC" | "DESC" = sortDir?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const col = SORTABLE.has(sortBy as any) ? (sortBy as string) : "created_at";
    const order: Order = [[col, dir]];

    const { rows, count } = await HVACTicket.findAndCountAll({
      where,
      order,
      limit: pageSize,
      offset,
      subQuery: false,
      distinct: true,
      include: [
        {
          model: dbModels.Client,
          as: "client",
          required: false
        },
        {
          model: HVACTicketMedia, // Add media count
          as: "media",
          attributes: ["id"],
          required: false
        }
      ],
    });

    // Transform to include hasMedia flag
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
    console.error("listHVACTickets error:", err?.message, err?.stack, err?.parent?.message);
    return res.status(500).json({
      success: false,
      error: err?.parent?.message || err?.message || "Failed to list HVAC tickets",
    });
  }
};

export const updateHVACTicket = async (req: Request, res: Response) => {
  try {
    const body = await updateHVACTicketSchema.validate(req.body, { abortEarly: false });
    const row = await HVACTicket.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });

    // If you want to auto-manage status-specific logic, do it here (optional)

    await row.update(body as any);
    const updated = await HVACTicket.findByPk(row.id, {
      include: [
        { model: HVACTicketFollowup, as: "followups", required: false },
        { model: HVACTicketMedia, as: "media", required: false },
      ],
    });

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    const errors = err?.errors ?? err?.message ?? "Failed to update HVAC ticket";
    return res.status(400).json({ success: false, error: errors });
  }
};

export const closeHVACTicket = async (req: Request, res: Response) => {
  try {
    const row = await HVACTicket.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    await row.update({ status: "Closed" });
    return res.json({ success: true, data: row });
  } catch {
    return res.status(500).json({ success: false, error: "Failed to close HVAC ticket" });
  }
};

export const deleteHVACTicket = async (req: Request, res: Response) => {
  try {
    const row = await HVACTicket.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    await row.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch {
    return res.status(500).json({ success: false, error: "Failed to delete HVAC ticket" });
  }
};

/* ===========================
   Media Upload
=========================== */

export const uploadHVACTicketMedia = async (req: Request, res: Response) => {
  try {
    if (!req.resolvedHVACTicketId) {
      return res.status(400).json({
        success: false,
        error: "HVAC Ticket ID not resolved.",
      });
    }

    const bag = (req.files || {}) as FilesMap;
    const files: Express.Multer.File[] = [
      ...(bag.files ?? []),
      ...(bag.file ?? []),
      ...(bag.attachments ?? []),
      ...(bag["attachments[]"] ?? []),
    ];

    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded.",
      });
    }

    const hvac_ticket_id = req.resolvedHVACTicketId;
    const ticket = await HVACTicket.findByPk(hvac_ticket_id);

    if (!ticket) {
      await Promise.allSettled(files.map((f) => fs.promises.unlink(f.path).catch(() => void 0)));
      return res.status(404).json({ success: false, error: "HVAC Ticket not found" });
    }

    const created_by =
      (req as any)?.user?.id ||
      (req as any)?.user?.system_user_id ||
      (req.headers["x-user-id"] as string) ||
      null;

    const uploaded = await uploadHVACFilesToS3(hvac_ticket_id, files);

    const mediaRecords = await HVACTicketMedia.bulkCreate(
      uploaded.map((u) => ({
        hvac_ticket_id,
        file: u.key,               // STORE S3 KEY
        mime_type: u.mime_type,
        original_name: u.original_name,
        size: u.size,
        created_by,
      })),
      { returning: true }
    );


    // Return hasMedia flag
    return res.status(201).json({
      success: true,
      count: mediaRecords.length,
      data: mediaRecords,
      hasMedia: true, // Important for frontend
      message: "Files uploaded successfully",
    });
  } catch (err: any) {
    console.error("uploadHVACTicketMedia error:", err);

    if (req.files) {
      const bag = (req.files || {}) as FilesMap;
      const files: Express.Multer.File[] = [
        ...(bag.files ?? []),
        ...(bag.file ?? []),
        ...(bag.attachments ?? []),
        ...(bag["attachments[]"] ?? []),
      ];
      await Promise.allSettled(files.map((f) => fs.promises.unlink(f.path).catch(() => void 0)));
    }

    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to upload HVAC files",
    });
  }
};


/* ===========================
   Search (flexible)
=========================== */

export const searchHVACTickets = async (req: Request, res: Response) => {
  try {
    const {
      q,
      status,
      priority,
      client_id, // NEW: replaced market_id
      from,
      to,
      assigned_to,
      category,
      page = "1",
      limit = "20",
      sortBy = "created_at",
      sortDir = "desc",
    } = req.query as Record<string, string | undefined>;

    const where: WhereOptions = {};

    if (status) (where as any).status = status;
    if (priority) (where as any).priority = priority;
    if (client_id) (where as any).client_id = client_id; // NEW: replaced market_id
    if (assigned_to) (where as any).assigned_to = { [Op.iLike]: `%${assigned_to}%` };
    if (category) (where as any).category = category;

    if (from || to) {
      (where as any).created_at = {
        ...(from ? { [Op.gte]: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { [Op.lte]: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    if (q) {
      const like = { [Op.iLike]: `%${q}%` };
      (where as any)[Op.or] = [
        { subject: like },
        { description: like },
        { assigned_to: like },
      ];
    }

    const pageNum = Math.max(parseInt(String(page), 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
    const offset = (pageNum - 1) * pageSize;

    const SORTABLE = new Set([
      "created_at",
      "updated_at",
      "subject",
      "status",
      "priority",
      "caller_id",
      "assigned_to",
      "category",
    ]);
    const dir: "ASC" | "DESC" = sortDir?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const col = SORTABLE.has(sortBy as any) ? (sortBy as string) : "created_at";
    const order: Order = [[col, dir]];

    const { rows, count } = await HVACTicket.findAndCountAll({
      where,
      order,
      limit: pageSize,
      offset,
      subQuery: false,
      distinct: true,
      include: [
        {
          model: dbModels.Client, // Include client data
          as: "client",
          required: false
        }
      ],
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
    console.error("searchHVACTickets error:", err?.message);
    return res.status(500).json({ success: false, error: err?.message || "Failed to list HVAC tickets" });
  }
};

/* ===========================
   Next Caller ID
=========================== */

function fmt(n: number, prefix = "", pad = 0) {
  const s = pad > 0 ? String(n).padStart(pad, "0") : String(n);
  return `${prefix}${s}`;
}

export const getNextHVACCallerId = async (req: Request, res: Response) => {
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
        FROM public.hvacticket
        WHERE caller_id LIKE :likePrefix
          AND regexp_replace(caller_id, CONCAT('^', :prefix), '', 'g') ~ '^[0-9]+$'
      `;
      replacements = { prefix, likePrefix: `${prefix}%` };
    } else {
      sql = `
        SELECT COALESCE(MAX(caller_id::bigint), 0) AS max_num
        FROM public.hvacticket
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
    console.error("getNextHVACCallerId error:", err?.message, err?.parent?.message);
    return res.status(500).json({
      success: false,
      error: err?.parent?.message || err?.message || "Failed to compute next HVAC caller_id",
    });
  }
};

export const createHVACFollowup = async (req: Request, res: Response) => {
  try {
    // 1) Resolve hvac_ticket_id
    const hvac_ticket_id =
      (req.params.hvac_ticket_id as string) ||
      (req.body?.hvac_ticket_id as string) ||
      (req.body?.ticket_id as string);

    if (!hvac_ticket_id) {
      return res.status(400).json({
        success: false,
        error: ["hvac_ticket_id is required"],
      });
    }

    // 2) Log raw incoming body
    console.log("🔥 createHVACFollowup - RAW body:", req.body);

    // 3) Explicit validation payload
    const validationData = {
      hvac_ticket_id,
      notes: req.body.notes,
      customer_signature: req.body.customer_signature,
      technician_signature: req.body.technician_signature,
      technician_name: req.body.technician_name,
      attendant_name: req.body.attendant_name,
    };

    // 4) Yup validation
    const body = await createHVACFollowupSchema.validate(validationData, {
      abortEarly: false,
      stripUnknown: false,
    });

    console.log("🔥 VALIDATED body:", {
      hvac_ticket_id: body.hvac_ticket_id,
      technician_name: body.technician_name,
      attendant_name: body.attendant_name,
      hasNotes: !!body.notes,
      hasCustomerSig: !!body.customer_signature,
      hasTechnicianSig: !!body.technician_signature,
    });

    // 5) Ensure ticket exists
    const t = await HVACTicket.findByPk(body.hvac_ticket_id);
    if (!t) {
      return res.status(404).json({ success: false, error: "HVAC Ticket not found" });
    }

    // 6) Who created this
    const created_by =
      (req as any)?.user?.id ||
      (req as any)?.user?.system_user_id ||
      (req.headers["x-user-id"] as string) ||
      null;

    // 7) Followup directory
    const uploadsBase = getUploadsBaseDir();
    const followupDir = path.join(
      uploadsBase,
      "hvac_tickets",
      body.hvac_ticket_id,
      "followups"
    );
    ensureDirSync(followupDir);

    const ts = Date.now();

    // 8) Save PNG signatures
    const customerKey = await uploadSignatureToS3(
      body.hvac_ticket_id,
      Buffer.from(body.customer_signature.split(",")[1], "base64"),
      "customer"
    );

    const technicianKey = await uploadSignatureToS3(
      body.hvac_ticket_id,
      Buffer.from(body.technician_signature.split(",")[1], "base64"),
      "technician"
    );

    const customerRel = toRelativeUploadPath(customerKey);
    const technicianRel = toRelativeUploadPath(technicianKey);

    // 9) Data to insert – INCLUDING NAMES
    const dbData = {
      hvac_ticket_id: body.hvac_ticket_id,
      notes: body.notes ?? null,
      customer_signature_url: `${BASE_URL}/${customerKey}`,
      technician_signature_url: `${BASE_URL}/${technicianKey}`,
      technician_name: body.technician_name ?? null,
      attendant_name: body.attendant_name ?? null,
      created_by,
    };

    console.log("🔥 DB DATA to insert:", dbData);

    // 10) Insert
    const row = await HVACTicketFollowup.create(dbData);
    const json = row.toJSON() as any;

    // 11) Enrich with URLs
    const responseData = {
      ...json,
      customer_signature_url: makeAbsoluteUrl(req, json.customer_signature_path),
      technician_signature_url: makeAbsoluteUrl(req, json.technician_signature_path),
    };

    return res.status(201).json({
      success: true,
      data: responseData,
      message: "HVAC follow-up created successfully",
    });
  } catch (err: any) {
    console.error("❌ createHVACFollowup error:", err);

    if (err?.name === "ValidationError" && Array.isArray(err?.errors)) {
      return res.status(400).json({
        success: false,
        error: err.errors, // Yup gives string[]
      });
    }

    return res.status(400).json({
      success: false,
      error: err?.message ?? "Failed to create HVAC followup",
    });
  }
};



// In hvacticketController.ts, update getHVACTicketFilesAndSignatures:
export const getHVACTicketFilesAndSignatures = async (req: Request, res: Response) => {
  try {
    const ticketIdRaw =
      (req.params.ticketId as string) ||
      (req.query.ticketId as string) ||
      (req.body?.ticketId as string) ||
      (req.headers["x-ticket-id"] as string) ||
      "";

    const ticketId = ticketIdRaw.replace(/^:+/, "").trim();
    if (!ticketId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
      return res.status(400).json({
        success: false,
        error: "Valid ticketId is required in /getHVACticketassets/:ticketId",
        received: ticketIdRaw,
      });
    }

    const ticket = await HVACTicket.findByPk(ticketId, {
      include: [
        {
          model: dbModels.Client,
          as: "client",
          attributes: ["company", "client", "contact_person", "mobile", "email_id", "address"]
        },
        {
          model: HVACTicketMedia,
          as: "media",
          required: false,
          separate: true,
          order: [["created_at", "DESC"]]
        },
        {
          model: HVACTicketFollowup,
          as: "followups",
          required: false,
          separate: true,
          order: [["created_at", "DESC"]]
        },
      ],
    });

    if (!ticket) {
      return res.status(404).json({ success: false, error: "HVAC Ticket not found" });
    }

    // Generate media URLs with makeAbsoluteUrl like air condition controller
    const media = (ticket.media || []).map((m: any) => ({
      ...m.toJSON(),
      url: `${BASE_URL}/${m.file}`,
    }));

    const followups = (ticket.followups || []).map((f: any) => ({
      ...f.toJSON(),
      customer_signature_url: makeAbsoluteUrl(req, f.customer_signature_path),
      technician_signature_url: makeAbsoluteUrl(req, f.technician_signature_path),
    }));

    // Build signatures object like air condition controller
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
      technician: {
        name: ticket.assigned_to || "Technician",
        signature: latestFollowup?.technician_signature_url || null,
      },
      company: {
        label: process.env.COMPANY_NAME || "COMPRESS INDIA AIR CONDITIONING PVT. LTD.",
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
    console.error("Error getHVACTicketFilesAndSignatures:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};

export const updateHVACTicketStatus = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status, notes } = req.body;

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
    const ticket = await HVACTicket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "HVAC Ticket not found"
      });
    }

    // Check if media exists before allowing status change
    const mediaCount = await HVACTicketMedia.count({
      where: { hvac_ticket_id: ticketId }
    });

    // Only allow status change to "Cancel" without media
    if (status !== 'Cancel' && mediaCount === 0) {
      return res.status(400).json({
        success: false,
        error: "Media files must be uploaded before updating status to " + status,
        code: "MEDIA_REQUIRED"
      });
    }

    // Check if service report and followup exist before allowing status change
    // (Only for non-Cancel statuses)
    if (status !== 'Cancel') {
      const serviceReport = await db.HvacErpServiceReport.findOne({
        where: { hvac_erp_id: ticketId }
      });

      const followupData = await HVACTicketFollowup.findOne({
        where: { hvac_ticket_id: ticketId }
      });

      if (!serviceReport) {
        return res.status(400).json({
          success: false,
          error: "HVAC service report data is required before updating status",
          code: "SERVICE_REPORT_REQUIRED"
        });
      }

      if (!followupData) {
        return res.status(400).json({
          success: false,
          error: "Follow-up data is required before updating status",
          code: "FOLLOWUP_REQUIRED"
        });
      }
    }

    // Update the status
    const updateData: any = { status };

    // Auto-set closed_at if status is being changed to Closed
    if (status === 'Closed' && ticket.status !== 'Closed') {
      updateData.closed_at = new Date();
    }

    await ticket.update(updateData);

    // Fetch the updated ticket with related data
    const updatedTicket = await HVACTicket.findByPk(ticketId, {
      include: [
        {
          model: db.Client,
          as: "client",
          attributes: ["company", "client", "contact_person", "mobile"]
        }
      ],
    });

    return res.json({
      success: true,
      message: "HVAC Ticket status updated successfully",
      data: updatedTicket
    });

  } catch (error: any) {
    console.error("updateHVACTicketStatus error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to update HVAC ticket status"
    });
  }
};

// Check if ticket has media and can update status
export const checkHVACTicketStatusEligibility = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { targetStatus } = req.query;

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }

    // Check if ticket exists
    const ticket = await HVACTicket.findByPk(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "HVAC Ticket not found"
      });
    }

    // Check media count
    const mediaCount = await HVACTicketMedia.count({
      where: { hvac_ticket_id: ticketId }
    });

    // Check service report
    const serviceReport = await db.HvacErpServiceReport.findOne({
      where: { hvac_erp_id: ticketId }
    });

    // Check followup
    const followupData = await HVACTicketFollowup.findOne({
      where: { hvac_ticket_id: ticketId }
    });

    // Determine if status can be changed
    let canChangeStatus = false;
    let reason = "";

    // For Cancel status, no media required
    if (targetStatus === 'Cancel') {
      canChangeStatus = true;
    }
    // For other statuses, media is required
    else if (mediaCount > 0) {
      // Check other requirements based on target status
      if (targetStatus === 'Closed') {
        canChangeStatus = serviceReport && followupData;
        if (!canChangeStatus) {
          reason = "Service report and follow-up data required for closing ticket";
        }
      } else {
        canChangeStatus = true;
      }
    } else {
      reason = "Media files must be uploaded first";
    }

    return res.json({
      success: true,
      data: {
        ticketId,
        currentStatus: ticket.status,
        targetStatus: targetStatus || "any",
        canChangeStatus,
        reason,
        mediaCount,
        hasMedia: mediaCount > 0,
        hasServiceReport: !!serviceReport,
        hasFollowup: !!followupData,
        requirements: {
          mediaRequired: targetStatus !== 'Cancel',
          serviceReportRequired: targetStatus === 'Closed',
          followupRequired: targetStatus === 'Closed'
        }
      }
    });
  } catch (error: any) {
    console.error("checkHVACTicketStatusEligibility error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to check ticket status eligibility"
    });
  }
};
// Check if ticket has media
// In hvacticketController.ts - update this function
export const checkHVACTicketHasMedia = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }

    // Use the correct model
    const mediaCount = await HVACTicketMedia.count({
      where: { hvac_ticket_id: ticketId }
    });

    return res.json({
      success: true,
      hasMedia: mediaCount > 0,
      mediaCount
    });
  } catch (error: any) {
    console.error("checkHVACTicketHasMedia error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to check HVAC ticket media"
    });
  }
};

// Check ticket requirements (service report + followup)
export const checkHVACTicketRequirements = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }

    const [serviceReport, followupData, mediaCount] = await Promise.all([
      db.HvacErpServiceReport.findOne({ where: { hvac_erp_id: ticketId } }),
      HVACTicketFollowup.findOne({ where: { hvac_ticket_id: ticketId } }),
      HVACTicketMedia.count({ where: { hvac_ticket_id: ticketId } })
    ]);

    // Check if media exists - crucial for service report
    if (mediaCount === 0) {
      return res.status(400).json({
        success: false,
        error: "No media files uploaded for this ticket",
        code: "NO_MEDIA_FOUND",
        data: {
          hasMedia: false,
          hasServiceReport: !!serviceReport,
          hasFollowup: !!followupData,
          serviceReport: serviceReport,
          followupData: followupData,
          mediaCount
        }
      });
    }

    return res.json({
      success: true,
      data: {
        hasMedia: mediaCount > 0,
        hasServiceReport: !!serviceReport,
        hasFollowup: !!followupData,
        serviceReport: serviceReport,
        followupData: followupData,
        mediaCount
      }
    });
  } catch (error: any) {
    console.error("checkHVACTicketRequirements error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to check HVAC ticket requirements"
    });
  }
};

export const getHVACTicketMediaCount = async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: "Ticket ID is required"
      });
    }

    const mediaCount = await HVACTicketMedia.count({
      where: { hvac_ticket_id: ticketId }
    });

    return res.json({
      success: true,
      mediaCount,
      hasMedia: mediaCount > 0
    });
  } catch (error: any) {
    console.error("getHVACTicketMediaCount error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get HVAC ticket media count"
    });
  }
};

export const createServiceReportAndReturnUrl = async (req: Request, res: Response) => {
  try {
    // 1) Validate input
    const body = await reportSchema.validate(req.body, { abortEarly: false });
    const ticketId = (body.erp_id || "").trim();

    // 2) Fetch ticket + media + followups - UPDATED QUERY
    const sql = `
      SELECT JSON_BUILD_OBJECT(
        'id', t.id,
        'caller_id', t.caller_id,
        'client_id', t.client_id, -- NEW: replaced company_name
        'subject', t.subject,
        'status', t.status,
        'category', t.category,
        'priority', t.priority,
        'assigned_to', t.assigned_to,
        'description', t.description,
        'shipping_address', t.shipping_address,
        'created_at', t.created_at,
        'created_by', t.created_by,
        'client', COALESCE(c.client_data, '{}'::json), -- NEW: include client data
        'media', COALESCE(m.media, '[]'::json),
        'followups', COALESCE(f.followups, '[]'::json)
      ) AS ticket
      FROM public.hvacticket t
      
      -- NEW: Join with clients table
      LEFT JOIN LATERAL (
        SELECT JSON_BUILD_OBJECT(
          'id', cl.id,
          'company', cl.company,
          'client', cl.client,
          'mobile', cl.mobile,
          'email_id', cl.email_id,
          'address', cl.address,
          'city', cl.city,
          'state', cl.state,
          'pin_code', cl.pin_code
        ) AS client_data
        FROM public.clients cl
        WHERE cl.id = t.client_id
      ) c ON TRUE
      
      LEFT JOIN LATERAL (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', mm.id,
            'file', mm.file,
            'original_name', mm.original_name,
            'mime_type', mm.mime_type,
            'size', mm."size",
            'created_at', mm.created_at,
            'url', ('/uploads/hvac_tickets/' || t.id || '/' ||
                    REGEXP_REPLACE(mm.file, '^.*[\\\\/]', ''))
          )
          ORDER BY mm.created_at DESC
        ) AS media
        FROM public.hvac_ticket_media mm
        WHERE mm.hvac_ticket_id = t.id
      ) m ON TRUE
      LEFT JOIN LATERAL (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', ff.id,
            'notes', ff.notes,
            'customer_signature_url',
              CASE WHEN ff.customer_signature_path IS NULL THEN NULL
              ELSE ('/uploads/hvac_tickets/' || t.id || '/followups/' ||
                    REGEXP_REPLACE(ff.customer_signature_path, '^.*[\\\\/]', ''))
              END,
            'technician_signature_url',
              CASE WHEN ff.technician_signature_path IS NULL THEN NULL
              ELSE ('/uploads/hvac_tickets/' || t.id || '/followups/' ||
                    REGEXP_REPLACE(ff.technician_signature_path, '^.*[\\\\/]', ''))
              END,
            'created_at', ff.created_at
          )
          ORDER BY ff.created_at DESC
        ) AS followups
        FROM public.hvac_ticket_followup ff
        WHERE ff.hvac_ticket_id = t.id
      ) f ON TRUE
      WHERE t.id = $1::uuid
      LIMIT 1;
    `;

    const row = await sequelize.query(sql, {
      type: QueryTypes.SELECT,
      bind: [ticketId],
      plain: true,
    }) as any;

    if (!row || !row.ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const ticket = row.ticket;

    // 3) Normalize media/signatures/notes - UPDATED to use client data
    const media: any[] = (ticket.media || []).map((m: any) => ({
      ...m,
      url: absolutizePath(m?.url),
    }));
    const latestFollowup = Array.isArray(ticket.followups) ? ticket.followups[0] : null;
    const custSig = absolutizePath(latestFollowup?.customer_signature_url || "");
    const techSig = absolutizePath(latestFollowup?.technician_signature_url || "");
    const notes = latestFollowup?.notes || "";

    // 4) Items + totals (simple zeroed example)
    const items = [
      {
        sr: 1,
        description: ticket.subject || "HVAC Service",
        make: ticket.category || "-",
        hsn: "998717",
        qty: 1,
        unit: "JOB",
        rate: 0,
        amount: 0,
      },
    ];
    const subTotal = items.reduce((s, it) => s + (it.amount || 0), 0);
    const discount = 0;
    const taxable = subTotal - discount;
    const gstPct = 18;
    const gstAmt = Number(((taxable * gstPct) / 100).toFixed(2));
    const grand = taxable + gstAmt;

    // 5) Build HTML (pass form/body) - UPDATED to use client data
    const html = renderServiceReportHTML({
      ticket,
      media,
      custSig,
      techSig,
      notes,
      items,
      subTotal,
      discount,
      gstPct,
      gstAmt,
      grand,
      form: body as ServiceReportFormData,
    });

    // 6) Ensure output dir, render PDF to disk
    const fileBase = `service-report-${ticket.caller_id || ticket.id}-${Date.now()}.pdf`;
    const dir = path.join(process.cwd(), "public", "reports", "service-reports", ticket.id);
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, fileBase);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    await browser.close();

    // 7) Build ONE absolute URL that matches your static mount
    // const API_PREFIX = process.env.API_PREFIX || "/api/v1/compresscrmbackend";
    // const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8003}`;
    const pdfUrl = `${BASE_URL}${API_PREFIX}/servicereports/${ticket.id}/${encodeURIComponent(fileBase)}`;

    // 8) Return JSON payload
    return res.json({
      success: true,
      data: { pdf_url: pdfUrl },
    });
  } catch (err: any) {
    console.error(err);
    return res.status(400).json({ success: false, error: err?.message || "Failed to generate report" });
  }
};

// GET /servicereports/:ticketId/:file
export const streamServiceReportPdf = async (req: Request, res: Response) => {
  try {
    const { ticketId, file } = req.params;

    const filePath = path.resolve(
      process.cwd(), "public", "reports", "service-reports", ticketId, file
    );

    await fsp.access(filePath); // <-- use fs/promises

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${file}"`);
    return res.sendFile(filePath);
  } catch (err: any) {
    console.error("streamServiceReportPdf error:", err?.message);
    return res.status(404).send("Report not found");
  }
};

// ---- HTML template (3-up on desktop, 2-up on mobile) ----
// ---- HTML template (3-up on desktop, 2-up on mobile) ----
function renderServiceReportHTML(ctx: {
  ticket: any;
  media: { url?: string; mime_type?: string }[];
  custSig?: string | null;
  techSig?: string | null;
  notes?: string;
  items: { sr: number; description: string; make: string; hsn: string; qty: number; unit: string; rate: number; amount: number; }[];
  subTotal: number;
  discount: number;
  gstPct: number;
  gstAmt: number;
  grand: number;
  form: ServiceReportFormData;
}) {
  const t = ctx.ticket;
  const f = ctx.form;
  const client = t.client || {}; // Get client data

  // Use client.company instead of company_name
  const companyName = client.company || "-";

  // Only image files for the gallery
  const images = (ctx.media || []).filter(m => (m.url || "").match(/\.(png|jpe?g|webp|gif|bmp|svg)$/i)).slice(0, 12);

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Service Report – ${t.caller_id || t.id}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; }
  .container { padding: 8px 12px 16px; }

  /* Header (match your letterhead) */
  .brand {
    border-bottom: 2px solid #222;
    padding-bottom: 8px; margin-bottom: 10px;
  }
  .brand h1 { margin:0; font-size: 18px; text-transform: uppercase; }
  .brand small { display:block; color:#444; margin-top:2px; line-height:1.3; }

  /* Details grid like your sample */
  .grid {
    display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin: 10px 0 12px;
  }
  .panel {
    border:1px solid #ddd; border-radius:4px;
  }
  .panel .ttl {
    background:#f4f6f9; border-bottom:1px solid #ddd; padding:6px 8px; font-weight:700; font-size:12px;
  }
  .panel .body { padding:8px; font-size:12px; line-height:1.4; white-space:pre-line; }

  /* Two columns for "QUOTE TO/SHIPPING TO" style blocks */
  .twocol {
    display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top: 8px;
  }

  /* Details rows */
  .kv { display:grid; grid-template-columns: 170px 1fr; gap:8px; font-size:12px; margin-bottom:4px; }

  /* Items table */
  table {
    width:100%; border-collapse:collapse; margin-top: 8px; font-size:12px;
  }
  th, td { border:1px solid #ddd; padding:6px 6px; vertical-align:top; }
  thead th { background:#f4f6f9; font-weight:700; }
  tfoot td { border:none; padding:4px 0; }
  .right { text-align:right; }
  .center { text-align:center; }

  /* Media gallery: 3-up desktop, 2-up mobile */
  .gallery {
    display:grid; gap:8px; margin-top:10px;
    grid-template-columns: repeat(3, 1fr);
  }
  .gallery img {
    width:100%; height:120px; object-fit:cover; border:1px solid #ddd; border-radius:4px;
  }
  @media (max-width: 680px) {
    .grid { grid-template-columns: 1fr; }
    .twocol { grid-template-columns: 1fr; }
    .gallery { grid-template-columns: repeat(2, 1fr); }
  }

  /* Footer note like sample */
  .terms {
    margin-top: 10px; font-size:11px; line-height:1.45;
    border-top:1px dashed #bbb; padding-top:8px;
  }
  .terms ol { margin:6px 0 0 16px; padding:0; }
  .muted { color:#666; }

  .signs {
    display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top: 12px; align-items:end;
  }
  .sigBox { border:1px dashed #bbb; border-radius:4px; padding:8px; min-height:110px; }
  .sigBox img { max-width:100%; max-height:80px; display:block; }
  .sigCap { margin-top:6px; font-size:12px; text-align:center; }
</style>
</head>
<body>
  <div class="container">
    <!-- Company Header -->
    <div class="brand">
      <h1>COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.</h1>
      <small>
        Off no. 103, 1st Floor, Hi-Tech Commercial Complex, V.B Nagar, Near SCLR Road, Kurla (W) Mumbai 400070<br/>
        9920 5299 61 / 8655 0114 65 / 9152 1571 14 • info@compressindia.com • www.compressindia.com<br/>
        GST NUMBER : 27AAKCC6103D1Z0
      </small>
    </div>

    <!-- Report title / IDs -->
    <div class="grid">
      <div class="panel">
        <div class="ttl">SERVICE REPORT</div>
        <div class="body">
          <div class="kv"><div>Caller ID</div><div>${t.caller_id || "-"}</div></div>
          <div class="kv"><div>Status</div><div>${t.status || "-"}</div></div>
          <div class="kv"><div>Created Date</div><div>${fmtDate(t.created_at)}</div></div>
          <div class="kv"><div>Assigned To</div><div>${t.assigned_to || "-"}</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="ttl">JOB DETAILS</div>
        <div class="body">
          <div class="kv"><div>Subject</div><div>${t.subject || "-"}</div></div>
          <div class="kv"><div>Category</div><div>${t.category || "-"}</div></div>
          <div class="kv"><div>Priority</div><div>${t.priority || "-"}</div></div>
        </div>
      </div>
    </div>

    <!-- Address blocks styled like "QUOTE TO / SHIPPING TO" -->
    <div class="twocol">
      <div class="panel">
        <div class="ttl">QUOTE TO</div>
        <div class="body">
          <strong>${companyName}</strong><br/>
          ${client.address ? client.address.replace(/\n/g, "<br/>") : ""}
          ${t.description ? t.description.replace(/\n/g, "<br/>") : ""}
        </div>
      </div>
      <div class="panel">
        <div class="ttl">SHIPPING TO</div>
        <div class="body">
          ${t.shipping_address ? t.shipping_address.replace(/\n/g, "<br/>") : "-"}
        </div>
      </div>
    </div>

    <!-- Items (services/parts) -->
    <table>
      <thead>
        <tr>
          <th class="center" style="width:40px;">SR.</th>
          <th>DESCRIPTION</th>
          <th class="center" style="width:80px;">MAKE</th>
          <th class="center" style="width:80px;">HSN/SAC</th>
          <th class="center" style="width:50px;">QTY</th>
          <th class="center" style="width:60px;">UNIT</th>
          <th class="right" style="width:90px;">RATE</th>
          <th class="right" style="width:100px;">AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        ${ctx.items.map(it => `
          <tr>
            <td class="center">${it.sr}</td>
            <td>${it.description}</td>
            <td class="center">${it.make}</td>
            <td class="center">${it.hsn}</td>
            <td class="center">${it.qty}</td>
            <td class="center">${it.unit}</td>
            <td class="right">${fmtINR(it.rate)}</td>
            <td class="right">${fmtINR(it.amount)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <!-- Totals -->
    <table style="margin-top:6px;">
      <tbody>
        <tr>
          <td style="border:none;"></td>
          <td style="border:none; width:50%;"></td>
          <td style="border:none; width:25%;" class="right">SUB TOTAL :</td>
          <td style="border:none; width:25%;" class="right">${fmtINR(ctx.subTotal)}</td>
        </tr>
        <tr>
          <td style="border:none;"></td><td style="border:none;"></td>
          <td class="right" style="border:none;">DISCOUNT :</td>
          <td class="right" style="border:none;">${fmtINR(ctx.discount)}</td>
        </tr>
        <tr>
          <td style="border:none;"></td><td style="border:none;"></td>
          <td class="right" style="border:none;">GST @ ${ctx.gstPct}% :</td>
          <td class="right" style="border:none;">${fmtINR(ctx.gstAmt)}</td>
        </tr>
        <tr>
          <td style="border:none;"></td><td style="border:none;"></td>
          <td class="right" style="border-top:1px solid #222; font-weight:700;">GRAND TOTAL :</td>
          <td class="right" style="border-top:1px solid #222; font-weight:700;">${fmtINR(ctx.grand)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Gallery (3-up desktop / 2-up mobile) -->
    ${images.length ? `
    <div class="panel" style="margin-top:10px;">
      <div class="ttl">ATTACHMENT PHOTOS</div>
      <div class="body">
        <div class="gallery">
          ${images.map(i => `<img src="${i.url}" alt="attachment"/>`).join("")}
        </div>
      </div>
    </div>
    ` : ""}

    <!-- Signatures -->
    <div class="signs">
      <div class="sigBox">
        ${ctx.custSig ? `<img src="${ctx.custSig}" alt="Customer Signature"/>` : `<div class="muted">No customer signature</div>`}
        <div class="sigCap">Customer Signature</div>
      </div>
      <div class="sigBox">
        ${ctx.techSig ? `<img src="${ctx.techSig}" alt="Technician Signature"/>` : `<div class="muted">No technician signature</div>`}
        <div class="sigCap">Technician Signature</div>
      </div>
    </div>

    <!-- Notes -->
    ${ctx.notes ? `
      <div class="panel" style="margin-top:10px;">
        <div class="ttl">WORK NOTES</div>
        <div class="body">${ctx.notes.replace(/\n/g, "<br/>")}</div>
      </div>
    ` : ""}

    <!-- Terms (styled like your sample) -->
    <div class="terms">
      <strong>Terms & Conditions :</strong>
      <ol>
        <li>50% advance payment along with P.O & remaining 50% immediately after completion of the job.</li>
        <li>Any additional work beyond the agreed scope will be charged extra as per actuals.</li>
        <li>Natural/accidental damages are not covered.</li>
        <li>Client's work order/permission is mandatory to proceed.</li>
      </ol>
      <div class="muted" style="margin-top:6px;">*** THANKS FOR YOUR VALUABLE BUSINESS WITH COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED ***</div>
    </div>
  </div>
</body>
</html>
`;
}