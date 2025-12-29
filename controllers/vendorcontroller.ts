// src/controllers/vendor.controller.ts
import express, { Request, Response, Router } from "express";
import { Op, WhereOptions } from "sequelize";
import * as Yup from "yup";
import { Vendor } from "../models/vendor";
import { VendorDocument } from "../models/VendorDocument";
import { createVendorSchema, updateVendorSchema } from "../controllers/Validations";
import multer from "multer";
import { Upload } from "@aws-sdk/lib-storage";
import { S3Client } from "@aws-sdk/client-s3";

// =======================
// S3 CONFIG
// =======================
const s3Client = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
});
console.log("AWS_REGION =", process.env.AWS_REGION);

const BUCKET = process.env.AWS_S3_BUCKET_NAME!;
const BASE_URL = `https://${BUCKET}.s3.amazonaws.com`;

// =======================
// TYPES
// =======================
type DocType =
    | "gst_certificate"
    | "msme_certificate"
    | "aadhaar_card"
    | "pan_card"
    | "attachment";

// =======================
// MULTER (MEMORY)
// =======================
const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = new Set([
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]);
        if (!allowed.has(file.mimetype)) {
            return cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
        cb(null, true);
    },
});

const vendorUploadFields = uploader.fields([
    { name: "gst_certificate", maxCount: 1 },
    { name: "msme_certificate", maxCount: 1 },
    { name: "aadhaar_card", maxCount: 1 },
    { name: "pan_card", maxCount: 1 },
    { name: "attachments", maxCount: 50 },
    { name: "attachments[]", maxCount: 50 },
]);

// =======================
// S3 UPLOAD HELPER
// =======================
async function uploadToS3(
    file: Express.Multer.File,
    vendorId: string,
    docType: DocType
) {
    const key = `vendors/${vendorId}/${docType}/${Date.now()}-${file.originalname}`;

    await new Upload({
        client: s3Client,
        params: {
            Bucket: BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: "private",
        },
    }).done();

    return {
        key,
        url: `${BASE_URL}/${key}`,
    };
}

// =======================
// URL BUILDER
// =======================
function absolutize(filePath: string): string {
    if (!filePath) return "";
    if (filePath.startsWith("http")) return filePath;
    return `${BASE_URL}/${filePath.replace(/^\/+/, "")}`;
}

// =======================
// CREATE
// =======================
export async function createVendor(req: Request, res: Response) {
    vendorUploadFields(req, res, async (err) => {
        try {
            if (err) return res.status(400).json({ success: false, error: err.message });

            const payload = await createVendorSchema.validate(req.body, {
                abortEarly: false,
                stripUnknown: true,
            });

            // REMOVE THIS SECTION:
            // if (req.body.site_issue !== undefined) {
            //     payload.site_issue = req.body.site_issue;
            // }

            const vendor = await Vendor.create(payload as any);

            const files = req.files as Record<string, Express.Multer.File[]>;

            for (const single of ["gst_certificate", "msme_certificate", "aadhaar_card", "pan_card"] as const) {
                const file = files?.[single]?.[0];
                if (file) {
                    const { key } = await uploadToS3(file, vendor.id, single);
                    await VendorDocument.create({
                        vendor_id: vendor.id,
                        document_type: single,
                        file_path: key,
                        file_name: file.originalname,
                        file_type: file.mimetype,
                        file_size: file.size,
                    });
                }
            }

            const attachments = [
                ...(files?.["attachments"] ?? []),
                ...(files?.["attachments[]"] ?? []),
            ];

            for (const file of attachments) {
                const { key } = await uploadToS3(file, vendor.id, "attachment");
                await VendorDocument.create({
                    vendor_id: vendor.id,
                    document_type: "attachment",
                    file_path: key,
                    file_name: file.originalname,
                    file_type: file.mimetype,
                    file_size: file.size,
                });
            }

            return res.json({ success: true, data: vendor });
        } catch (e: any) {
            return res.status(400).json({ success: false, error: e.errors || e.message });
        }
    });
}

// =======================
// LIST
// =======================
export async function getVendors(req: Request, res: Response) {
    try {
        const {
            page = "1",
            limit = "10",
            q,
            city,
            state,
            category,
            includeDocs,
        } = req.query as any;

        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);

        const where: any = {};

        if (q) {
            where[Op.or] = [
                { company: { [Op.iLike]: `%${q}%` } },
                { vendor: { [Op.iLike]: `%${q}%` } },
            ];
        }
        if (city) where.city = { [Op.iLike]: city };
        if (state) where.state = { [Op.iLike]: state };
        if (category) where.category = { [Op.iLike]: category };

        const { rows, count } = await Vendor.findAndCountAll({
            where,
            include: includeDocs === "1"
                ? [{ model: VendorDocument, as: "documents" }]
                : [],
            offset: (pageNum - 1) * limitNum,
            limit: limitNum,
            order: [['created_at', 'DESC']] // Add ordering
        });

        const data = rows.map(v => {
            const d = v.toJSON() as any;
            if (includeDocs === "1" && d.documents) {
                d.documents = d.documents.map((doc: any) => ({
                    ...doc,
                    file_url: absolutize(doc.file_path),
                }));
            }
            return d;
        });

        const totalPages = Math.ceil(count / limitNum);

        res.json({
            success: true,
            data: {
                vendors: data, // Changed from just 'data' to 'data.vendors'
                count,
                totalPages, // Add totalPages
                currentPage: pageNum,
                limit: limitNum
            },
            meta: {
                total: count,
                pages: totalPages,
                page: pageNum,
                limit: limitNum
            }
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
}

// =======================
// GET BY ID
// =======================
export async function getVendorById(req: Request, res: Response) {
    const vendor = await Vendor.findByPk(req.params.id, {
        include: [{ model: VendorDocument, as: "documents" }],
    });

    if (!vendor) {
        return res.status(404).json({ success: false, error: "Vendor not found" });
    }

    const data = vendor.toJSON() as any;
    data.documents = (data.documents || []).map((d: any) => ({
        ...d,
        file_url: absolutize(d.file_path),
    }));

    res.json({ success: true, data });
}

// =======================
// UPDATE
// =======================
export async function updateVendor(req: Request, res: Response) {
    vendorUploadFields(req, res, async (err) => {
        try {
            if (err) return res.status(400).json({ success: false, error: err.message });

            const id = req.params.id;
            const vendor = await Vendor.findByPk(id);
            if (!vendor) return res.status(404).json({ success: false, error: "Vendor not found" });

            const payload = await updateVendorSchema.validate(req.body, {
                abortEarly: false,
                stripUnknown: true,
            });

            await vendor.update(payload as any);

            const files = req.files as Record<string, Express.Multer.File[]>;

            for (const single of ["gst_certificate", "msme_certificate", "aadhaar_card", "pan_card"] as const) {
                const file = files?.[single]?.[0];
                if (file) {
                    const { key } = await uploadToS3(file, vendor.id, single);
                    await VendorDocument.create({
                        vendor_id: vendor.id,
                        document_type: single,
                        file_path: key,
                        file_name: file.originalname,
                        file_type: file.mimetype,
                        file_size: file.size,
                    });
                }
            }

            res.json({ success: true, message: "Vendor updated" });
        } catch (e: any) {
            res.status(400).json({ success: false, error: e.errors || e.message });
        }
    });
}

// =======================
// DELETE
// =======================
export async function deleteVendor(req: Request, res: Response) {
    const deleted = await Vendor.destroy({ where: { id: req.params.id } });
    if (!deleted) {
        return res.status(404).json({ success: false, error: "Vendor not found" });
    }
    res.json({ success: true });
}

// ---------- SEARCH ----------
export async function searchVendors(req: Request, res: Response) {
    try {
        const src: any = { ...(req.query as any), ...(req.body as any) };

        const clean = (v: unknown) => {
            if (v == null) return undefined;
            if (typeof v !== "string") return v as any;
            const t = v.trim();
            if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return undefined;
            return t;
        };

        const normalized = {
            start_date: clean(src.start_date),
            end_date: clean(src.end_date),
            vendor_name:
                clean(src.vendor_name) ??
                clean(src.vendor) ??
                clean(src.company) ??
                clean(src.q),
            category: clean(src.category),
            page: clean(src.page),
            limit: clean(src.limit),
            sortBy: clean(src.sortBy),
            sortOrder: clean(src.sortOrder),
        };

        const schema = Yup.object({
            start_date: Yup.string().optional(),
            end_date: Yup.string().optional(),
            vendor_name: Yup.string().optional(),
            category: Yup.string().optional(),
            page: Yup.number().integer().min(1).default(1),
            limit: Yup.number().integer().min(1).max(100).default(10),
            sortBy: Yup.string().oneOf(["created_at", "updated_at"]).default("created_at"),
            sortOrder: Yup.string().oneOf(["ASC", "DESC", "asc", "desc"]).default("DESC"),
        });

        const qp = await schema.validate(normalized, {
            abortEarly: false,
            stripUnknown: true,
        });

        const { start_date, end_date, vendor_name, category } = qp as {
            start_date?: string;
            end_date?: string;
            vendor_name?: string;
            category?: string;
        };

        if (!start_date && !end_date && !vendor_name && !category) {
            return res.status(400).json({
                success: false,
                message:
                    "Provide at least one filter: start_date/end_date, vendor_name, or category.",
            });
        }

        const page = Number(qp.page);
        const limit = Number(qp.limit);
        const sortBy = String(qp.sortBy);
        const sortOrder =
            String(qp.sortOrder).toUpperCase() === "ASC" ? "ASC" : "DESC";

        const where: WhereOptions = {};

        // Date filter
        if (start_date || end_date) {
            const start = start_date
                ? new Date(`${start_date}T00:00:00.000Z`)
                : new Date("1970-01-01T00:00:00.000Z");

            const end = end_date
                ? new Date(`${end_date}T23:59:59.999Z`)
                : new Date("2999-12-31T23:59:59.999Z");

            (where as any).created_at = { [Op.between]: [start, end] };
        }

        // Vendor name / company
        if (vendor_name) {
            (where as any)[Op.or] = [
                { company: { [Op.iLike]: `%${vendor_name}%` } },
                { vendor: { [Op.iLike]: `%${vendor_name}%` } },
                // REMOVED: { site_issue: { [Op.iLike]: `%${vendor_name}%` } },
            ];
        }

        // Category
        if (category) {
            (where as any).category = { [Op.iLike]: `%${category}%` };
        }

        const { rows, count } = await Vendor.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sortOrder]],
        });

        return res.json({
            success: true,
            data: {
                vendors: rows, // Changed from just 'rows' to 'vendors'
                count,
                totalPages: Math.ceil(count / limit),
                currentPage: page,
                limit
            },
            meta: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit),
            },
            message: count === 0 ? "No vendors matched your filters." : undefined,
        });
    } catch (err: any) {
        return res.status(400).json({
            success: false,
            message: "Invalid input",
            errors: Array.isArray(err?.errors)
                ? err.errors
                : [String(err?.message || err)],
        });
    }
}
