import { Request, Response } from "express";
import db from "../models";
import { ValidationError, AnyObject } from "yup";
import { Op } from "sequelize"; // ✅ Only import Op, not where
import { CreateBoqSchema, UpdateBoqSchema } from "./Validations";
import { Transaction } from "sequelize";
import puppeteer, { Page } from "puppeteer";
import * as fs from "fs";
import * as path from "path";
import Handlebars from "handlebars";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import * as crypto from "crypto";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});

const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME!;
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com`;


// Add interface for file input
interface FileUploadInput {
    fileName: string;
    fileData: string; // Base64 encoded
    mimeType: string;
    fileSize: number;
    isPrimary?: boolean;
    sortOrder?: number;
}

// Add helper to process file uploads
async function processBoqFiles(
    files: BoqItemFileInput[],
    actorId: string,
    boqItemId: string,
    transaction: Transaction
): Promise<void> {
    for (const [index, file] of files.entries()) {
        let s3Key: string;
        let filePath: string;

        if (file.file_path && file.file_path.startsWith('data:')) {
            // Handle Base64 encoded file
            const matches = file.file_path.match(/^data:(.+);base64,(.+)$/);
            if (!matches) {
                throw new Error(`Invalid Base64 file data for ${file.file_name}`);
            }

            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Upload to S3
            const uploadResult = await uploadFileToS3(buffer, file.file_name, mimeType);
            s3Key = uploadResult.key;
            filePath = uploadResult.url;
        } else if (file.file_path && (file.file_path.startsWith('http') || file.file_path.startsWith('/'))) {
            // Already uploaded file (URL or existing path)
            s3Key = file.file_path; // This might need extraction if it's a full URL
            filePath = file.file_path;
        } else {
            throw new Error(`Invalid file data for ${file.file_name}`);
        }

        await db.BoqItemFile.create(
            {
                boq_item_id: boqItemId,
                file_name: file.file_name,
                file_path: s3Key, // Store S3 key
                file_url: filePath, // Store full URL for easy access
                file_type: file.file_type,
                file_size: file.file_size,
                uploaded_by: actorId,
                is_primary: file.is_primary || false,
                sort_order: file.sort_order || index,
            },
            { transaction }
        );
    }
}

interface BoqItemFileInput {
    id?: string;
    boq_item_id?: string;
    file_name: string;
    file_path: string;
    file_type: string;
    file_size: number;
    uploaded_by?: string | null;
    is_primary?: boolean;
    sort_order?: number;
}

interface BoqItemInput {
    section_label?: string | null;
    item_code?: string | null;
    make?: string | null;                  // ✅ NEW FIELD
    description: string;
    unit: string;
    quantity: number | string;
    sort_order?: number;
    is_optional?: boolean;
    // Optional pre-computed totals (if FE sends them)
    line_subtotal?: number | string;
    line_tax?: number | string;
    line_total?: number | string;
    files?: BoqItemFileInput[]; // ✅ NEW: Add files array to each item
}

// at top of controller file
// Replace the existing parseMoney function with this corrected version
const parseMoney = (v: any): number => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
        // Handle Indian numbering system (lakhs and crores with commas)
        // Remove all commas first, then parse
        const cleaned = v.replace(/,/g, '');
        return Number(cleaned) || 0;
    }
    return Number(v) || 0;
};

// Also update the cleanNum and asNum functions to handle Indian numbering
const cleanNum = (v: any): number => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
        // Remove commas and other currency symbols, but keep decimal point
        const cleaned = v.replace(/[₹$,]/g, '').trim();
        return cleaned ? Number(cleaned) : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const asNum = (x: any): number => {
    if (x == null) return 0;
    if (typeof x === "number") return x;
    if (typeof x === "string") {
        // Remove commas and currency symbols for Indian numbering
        const cleaned = x.replace(/[₹$,]/g, '').trim();
        return cleaned ? Number(cleaned) : 0;
    }
    return Number(x) || 0;
};

// S3 Upload Function
async function uploadFileToS3(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    folder: string = "boq-files"
): Promise<{ key: string; url: string }> {
    try {
        // Generate unique file key
        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString("hex");
        const safeFileName = fileName.replace(/[^\w.\-]+/g, "_");
        const key = `${folder}/${timestamp}-${randomString}-${safeFileName}`;

        // Upload to S3
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: S3_BUCKET,
                Key: key,
                Body: fileBuffer,
                ContentType: mimeType,
                ACL: "private", // or "public-read" if you want public access
            },
        });

        await upload.done();

        return {
            key,
            url: `${S3_BASE_URL}/${key}`,
        };
    } catch (error) {
        console.error("S3 Upload Error:", error);
        throw new Error("Failed to upload file to S3");
    }
}

// Delete from S3 function
async function deleteFromS3(key: string): Promise<void> {
    try {
        const command = new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
        });
        await s3Client.send(command);
    } catch (error) {
        console.error("S3 Delete Error:", error);
        throw new Error("Failed to delete file from S3");
    }
}

// Generate signed URL for private files
async function getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = require("@aws-sdk/client-s3");

    const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
}

// Add these helper functions before your buildBoqVM function
async function enrichBoqWithFileUrls(boqData: any): Promise<any> {
    const items = boqData.items || [];

    for (const item of items) {
        const files = item.files || [];
        for (const file of files) {
            // If file has an S3 key, generate a signed URL
            if (file.file_path && !file.file_path.startsWith('http')) {
                try {
                    file.signed_url = await getSignedUrl(file.file_path, 3600); // 1 hour expiry
                } catch (error) {
                    console.error("Failed to generate signed URL for file:", file.id);
                    file.signed_url = null;
                }
            } else if (file.file_url) {
                file.signed_url = file.file_url;
            }
        }
    }

    return boqData;
}
// Register Handlebars helpers
Handlebars.registerHelper('formatDate', function (dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch {
        return 'Invalid Date';
    }
});

Handlebars.registerHelper('formatCurrency', function (amount) {
    if (amount == null) return '0.00';
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return num.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
});

Handlebars.registerHelper('formatQty', function (quantity) {
    if (quantity == null) return '0.000';
    const num = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
    return num.toLocaleString('en-IN', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
});

Handlebars.registerHelper('inc', function (index) {
    return index + 1;
});

const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || "");

const pickActorId = (req: AuthenticatedRequest) => {
    const hdr = (req.headers["x-user-id"] as string | undefined)?.trim() || "";
    const body = (req.body?.created_by as string | undefined)?.trim() || "";
    const user = (req.user?.userId || "").trim();

    const candidate = user || hdr || body;
    return isUuid(candidate) ? candidate : null;
};

const pickIdOrBoqNumber = (req: Request) => {
    const id = (req.params?.id ?? "").toString().trim() ||
        (req.query?.id as string || "").trim() ||
        (req.body?.id || "").toString().trim();

    const boq_number = (req.params as any)?.boq_number?.toString().trim() ||
        (req.query?.boq_number as string || "").trim() ||
        (req.body?.boq_number || "").toString().trim();

    return { id, boq_number };
};

// Implement the missing resolveTemplate function
async function resolveTemplate(templateName: string): Promise<string> {
    const tryPaths = [
        path.resolve(__dirname, "../templates", templateName),
        path.resolve(__dirname, "../../templates", templateName),
        path.resolve(process.cwd(), "templates", templateName),
    ];

    for (const templatePath of tryPaths) {
        try {
            await fs.promises.access(templatePath);
            return templatePath;
        } catch {
            // Continue to next path
        }
    }
    throw new Error(`Template not found: ${templateName}. Tried: ${tryPaths.join(', ')}`);
}

// Implement the missing inWordsIndian function
function inWordsIndian(num: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero Rupees Only';

    let words = '';

    // Handle rupees part
    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);

    if (rupees > 0) {
        words += convertToWords(rupees, ones, tens) + ' Rupees';
    }

    if (paise > 0) {
        if (words !== '') words += ' and ';
        words += convertToWords(paise, ones, tens) + ' Paise';
    }

    return words + ' Only';

    function convertToWords(n: number, ones: string[], tens: string[]): string {
        if (n < 20) {
            return ones[n];
        } else if (n < 100) {
            return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
        } else if (n < 1000) {
            return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + convertToWords(n % 100, ones, tens) : '');
        } else if (n < 100000) {
            return convertToWords(Math.floor(n / 1000), ones, tens) + ' Thousand' + (n % 1000 !== 0 ? ' ' + convertToWords(n % 1000, ones, tens) : '');
        } else if (n < 10000000) {
            return convertToWords(Math.floor(n / 100000), ones, tens) + ' Lakh' + (n % 100000 !== 0 ? ' ' + convertToWords(n % 100000, ones, tens) : '');
        } else {
            return convertToWords(Math.floor(n / 10000000), ones, tens) + ' Crore' + (n % 10000000 !== 0 ? ' ' + convertToWords(n % 10000000, ones, tens) : '');
        }
    }
}

// ---- Logo helpers (same behavior as ledger) ----
const FALLBACK_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (recommended)
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        try {
            await fs.promises.access(fromEnv);
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
        await fs.promises.access(primary);
        return primary;
    } catch { }

    // 3️⃣ Dev fallbacks
    const fallbacks = [
        path.resolve(__dirname, "../images/compress-india-logo-traced.png"),
        path.resolve(__dirname, "../../images/compress-india-logo-traced.png"),
    ];

    for (const p of fallbacks) {
        try {
            await fs.promises.access(p);
            return p;
        } catch { }
    }

    return "";
};

const getLogoAsDataURL = async (): Promise<string> => {
    try {
        const logoPath = await resolveLogoPath();
        if (!logoPath) return FALLBACK_PIXEL;

        const buf = await fs.promises.readFile(logoPath);
        const ext = path.extname(logoPath).slice(1).toLowerCase() || "png";
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return FALLBACK_PIXEL;
    }
};


const fileToDataUri = async (absPath: string): Promise<string | null> => {
    try {
        const buf = await fs.promises.readFile(absPath);
        const ext = (path.extname(absPath).slice(1) || "png").toLowerCase();
        const mime =
            ext === "svg" ? "image/svg+xml" :
                ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
                    "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
};


async function buildBoqVM(boqId: string) {
    const boq = await db.Boq.findByPk(boqId, {
        include: [
            {
                model: db.BoqItem,
                as: "items",
                include: [{
                    model: db.BoqItemFile,
                    as: "files",
                    separate: true,
                    order: [['sort_order', 'ASC'], ['is_primary', 'DESC']]
                }]
            },
            { model: db.SystemUser, as: "creator", attributes: ["id", "name"] },
        ],
        order: [[{ model: db.BoqItem, as: "items" }, "sort_order", "ASC"]],
    });

    if (!boq) throw new Error("BOQ not found");

    const j: any = boq.toJSON();

    // Totals from DB columns
    const totals = j.items.reduce((acc: any, item: any) => {
        acc.subtotal += Number(item.line_subtotal || 0);
        acc.tax += Number(item.line_tax || 0);
        acc.total += Number(item.line_total || 0);
        return acc;
    }, { subtotal: 0, tax: 0, total: 0 });

    // ✅ Ensure company block always has something to show
    const our_company = {
        // Short brand and legal name
        name: (process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.").trim(),
        legal_name: (process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED").trim(),

        // GST / Tax ID
        tax_id: (process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0").trim(), // keep blank if unknown

        // Address (Mumbai office)
        address_line: (process.env.COMPANY_ADDR ||
            "Off no.103, 1st floor, Hi Tech Premises Co-Op.Soc.Ltd, Near SCLR Road, Kurla (W)").trim(),
        city_state: (process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra, India").trim(),

        // Contacts
        mobile_number: (process.env.COMPANY_PHONE || "+91 8655011465").trim(),
        email_id: (process.env.COMPANY_EMAIL || "sales@compressindia.in").trim(),
        website: (process.env.COMPANY_WEBSITE || "www.compressindia.com").trim(),
    };

    // ✅ Use the robust logo finder + safe 1x1 fallback
    const logo = await getLogoAsDataURL();

    return {
        doc_title: "BILL OF QUANTITIES",
        logo,                       // <- now reliable
        boq_number: j.boq_number,
        title: j.title,
        boq_date: j.created_at,
        status: j.status,
        currency: j.currency,
        notes: j.notes,
        created_by: j.creator?.name || "N/A",
        our_company,                // <- standardized keys used by your HBS
        items: j.items || [],
        totals,
        amount_in_words: inWordsIndian(totals.total),
    };
}


/* ---------------- BOQ PDF Renderer ---------------- */
async function renderBoqPdfBuffer(boqId: string): Promise<Buffer> {
    let browser;
    try {
        const vm = await buildBoqVM(boqId);
        const tplPath = await resolveTemplate("boq.hbs");
        const tplHtml = await fs.promises.readFile(tplPath, "utf8");

        // Compile template with helpers
        const html = Handlebars.compile(tplHtml)(vm);

        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        const page: Page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: "networkidle0",
            timeout: 30000
        });

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
            timeout: 30000
        });

        return Buffer.from(pdfBuffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Create BOQ
// Enhanced createBoq function with detailed debugging
export const createBoq = async (req: AuthenticatedRequest, res: Response) => {
    let data: {
        title: string;
        currency?: string;
        notes?: string | null;
        status?: "draft" | "approved" | "cancelled";
        items: BoqItemInput[];
    };

    try {
        const validated = await CreateBoqSchema.validate(req.body as AnyObject, {
            abortEarly: false,
            stripUnknown: false, // ✅ CHANGE THIS FROM true TO false
        });

        // Cast validated data to proper type, ensuring items are BoqItemInput[]
        data = {
            title: validated.title,
            currency: validated.currency,
            notes: validated.notes,
            status: validated.status,
            items: (validated.items || []) as BoqItemInput[],
        };
    } catch (err) {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                message: "Validation errors",
                errors: err.errors,
                fields: err.inner.map((e) => e.path),
            });
        }
        return res.status(500).json({ message: "Validation failed" });
    }

    const actorId = pickActorId(req);
    if (!actorId) {
        return res.status(401).json({ message: "Missing or invalid actor id for created_by" });
    }

    const t = await db.sequelize.transaction();
    try {
        const { items, ...header } = data;

        console.log('🔍 [DEBUG] Received BOQ items:', JSON.stringify(items, null, 2));

        // Process items (no rate/discount/gst now)
        const processedItems = items.map((item, index) => {
            const quantity = parseMoney(item.quantity);
            const line_subtotal = parseMoney(item.line_subtotal ?? 0);
            const line_tax = parseMoney(item.line_tax ?? 0);
            const line_total = parseMoney(item.line_total ?? 0);

            console.log(`🔍 [DEBUG] Item ${index} parsed values:`, {
                quantity, line_subtotal, line_tax, line_total
            });

            return {
                boq_id: '',
                section_label: item.section_label,
                item_code: item.item_code,
                make: item.make ?? null,
                description: item.description,
                unit: item.unit,
                quantity,
                sort_order: item.sort_order ?? index,
                is_optional: item.is_optional ?? false,
                line_subtotal,
                line_tax,
                line_total,
                // Keep files reference for later processing
                _files: item.files || [],
            };
        });

        // Create BOQ
        const boq = await db.Boq.create(
            {
                ...header,
                status: header.status ?? "draft",
                currency: header.currency ?? "INR",
                created_by: actorId,
                updated_by: actorId,
            } as any,
            { transaction: t }
        );

        console.log(`🔍 [DEBUG] Created BOQ with id: ${boq.id}`);

        // Create items with files
        const createdItems = [];
        for (const item of processedItems) {
            const { _files, ...itemData } = item;

            // Create the item
            const createdItem = await db.BoqItem.create(
                {
                    ...itemData,
                    boq_id: boq.id
                },
                { transaction: t, returning: true }
            );

            // Create associated files if any
            if (_files && _files.length > 0) {
                await processBoqFiles(_files, actorId, createdItem.id, t);
            }

            createdItems.push(createdItem);
        }

        console.log(`🔍 [DEBUG] Created ${createdItems.length} items with files`);

        await t.commit();

        // DEBUG: Query the database directly to see what's stored
        console.log(`🔍 [DEBUG] Querying database directly...`);
        const directQuery = await db.sequelize.query(
            `
            SELECT 
                id,
                quantity,
                line_subtotal,
                line_tax,
                line_total
            FROM boq_items 
            WHERE boq_id = :boqId
        `,
            {
                replacements: { boqId: boq.id },
                type: db.sequelize.QueryTypes.SELECT
            }
        );

        console.log('🔍 [DEBUG] Direct database query results:', JSON.stringify(directQuery, null, 2));

        // Now reload through Sequelize with files
        const freshBOQ = await db.Boq.findByPk(boq.id, {
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files",
                        separate: true,
                        order: [['sort_order', 'ASC'], ['is_primary', 'DESC']]
                    }]
                },
                {
                    model: db.SystemUser,
                    as: "creator",
                    attributes: ["id", "name"]
                },
            ],
        });

        console.log('🔍 [DEBUG] Sequelize reload results with files:');
        freshBOQ?.items?.forEach((item: any, index: number) => {
            console.log(`Item ${index} has ${item.files?.length || 0} files`);
        });

        return res.status(201).json({
            success: true,
            message: "BOQ created successfully",
            data: freshBOQ
        });
    } catch (error: any) {
        await t.rollback();
        console.error("❌ Error creating BOQ:", error?.stack || error);
        return res.status(500).json({
            message: "Failed to create BOQ",
            error: error?.message || String(error),
        });
    }
};

// Update BOQ
export const updateBoq = async (req: AuthenticatedRequest, res: Response) => {
    const id = (req.params?.id as string)?.trim();
    if (!id) return res.status(400).json({ message: "Missing BOQ id" });
    if (!isUuid(id)) return res.status(400).json({ message: "Invalid BOQ id" });

    let validatedData: {
        title?: string;
        currency?: string;
        notes?: string | null;
        status?: "draft" | "approved" | "cancelled";
        items: BoqItemInput[];
    };

    try {
        // Validate first
        const rawData = await UpdateBoqSchema.validate(req.body as AnyObject, {
            abortEarly: false,
            stripUnknown: true,
        });

        // Cast and transform items to BoqItemInput[]
        validatedData = {
            title: rawData.title,
            currency: rawData.currency,
            notes: rawData.notes,
            status: rawData.status as "draft" | "approved" | "cancelled" | undefined,
            items: (rawData.items || []) as BoqItemInput[],
        };

    } catch (err: any) {
        if (err instanceof ValidationError) {
            return res.status(400).json({
                message: "Validation errors",
                errors: err.errors,
                fields: err.inner.map((e) => e.path),
            });
        }
        return res.status(500).json({ message: "Validation failed" });
    }

    const actorId = pickActorId(req);
    if (!actorId) {
        return res.status(401).json({ message: "Missing or invalid actor id for updated_by" });
    }

    const t = await db.sequelize.transaction();
    try {
        const boq = await db.Boq.findByPk(id, {
            transaction: t,
            include: [{
                model: db.BoqItem,
                as: "items",
                include: [{
                    model: db.BoqItemFile,
                    as: "files"
                }]
            }]
        });

        if (!boq) {
            await t.rollback();
            return res.status(404).json({ message: "BOQ not found" });
        }

        const { items, ...header } = validatedData;

        await boq.update(
            {
                ...header,
                updated_at: new Date(),
                updated_by: actorId
            } as any,
            { transaction: t }
        );

        // Delete all items and their files (cascade should handle files)
        await db.BoqItem.destroy({ where: { boq_id: boq.id }, transaction: t });

        // Create new items with files
        for (const item of items) {
            const { files, ...itemData } = item;

            const createdItem = await db.BoqItem.create(
                {
                    boq_id: boq.id,
                    section_label: itemData.section_label,
                    item_code: itemData.item_code,
                    make: itemData.make ?? null,
                    description: itemData.description,
                    unit: itemData.unit,
                    quantity: parseMoney(itemData.quantity),
                    sort_order: itemData.sort_order ?? 0,
                    is_optional: itemData.is_optional ?? false,
                    line_subtotal: parseMoney(itemData.line_subtotal ?? 0),
                    line_tax: parseMoney(itemData.line_tax ?? 0),
                    line_total: parseMoney(itemData.line_total ?? 0),
                },
                { transaction: t, returning: true }
            );

            if (files && files.length > 0) {
                await processBoqFiles(files, actorId, createdItem.id, t);
            }
        }

        await t.commit();

        // Reload with files
        const freshBOQ = await db.Boq.findByPk(boq.id, {
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files",
                        separate: true,
                        order: [['sort_order', 'ASC'], ['is_primary', 'DESC']]
                    }]
                },
                { model: db.SystemUser, as: "creator", attributes: ["id", "name"] },
            ],
        });

        return res.json({
            success: true,
            message: "BOQ updated successfully",
            data: freshBOQ
        });
    } catch (error: any) {
        await t.rollback();
        console.error("Error updating BOQ:", error?.stack || error);
        return res.status(500).json({
            message: "Failed to update BOQ",
            error: error?.message || String(error),
        });
    }
};

// Get All BOQs
export const getAllBoqs = async (req: Request, res: Response) => {
    try {
        const page = parseInt((req.query.page as string) || "1", 10) || 1;
        const limit = parseInt((req.query.limit as string) || "20", 10) || 20;
        const offset = (page - 1) * limit;

        const { count, rows } = await db.Boq.findAndCountAll({
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files",
                        attributes: ['id', 'file_name', 'file_type'],
                        limit: 1 // Only get first file for listing
                    }]
                },
                {
                    model: db.SystemUser,
                    as: "creator",
                    attributes: ["id", "email", "name"],
                },
            ],
            order: [
                ["created_at", "DESC"],
                [{ model: db.BoqItem, as: "items" }, "sort_order", "ASC"],
            ],
            limit,
            offset,
            distinct: true,
        });

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "No BOQs found" });
        }

        const toNum = (v: any) => (v == null ? 0 : Number(v));

        // attach per-BOQ totals
        const data = rows.map((boq: any) => {
            const items = boq.items || [];
            const totals = items.reduce(
                (acc: any, it: any) => {
                    acc.subtotal += toNum(it.line_subtotal);
                    acc.tax += toNum(it.line_tax);
                    acc.total += toNum(it.line_total);
                    return acc;
                },
                { subtotal: 0, tax: 0, total: 0 }
            );
            return { ...boq.toJSON(), totals };
        });

        const totalPages = Math.ceil(count / limit);

        return res.status(200).json({
            success: true,
            data,
            pagination: {
                total: count,
                totalPages,
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            },
        });
    } catch (error: any) {
        console.error("Error fetching BOQs:", error?.stack || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch BOQs",
            error: error?.message || String(error),
        });
    }
};


// Get BOQ by ID
export const getBoqById = async (req: Request, res: Response) => {
    const { id } = pickIdOrBoqNumber(req);
    if (!id) return res.status(400).json({ message: "Missing BOQ id" });

    try {
        const where: any = {};
        if (isUuid(id)) where.id = id;
        else where.boq_number = id;

        const boq = await db.Boq.findOne({
            where,
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files",
                        separate: true,
                        order: [['sort_order', 'ASC'], ['is_primary', 'DESC']]
                    }],
                    attributes: {
                        include: ["line_subtotal", "line_tax", "line_total"],
                    },
                },
                {
                    model: db.SystemUser,
                    as: "creator",
                    attributes: ["id", "email", "name"],
                },
            ],
            order: [[{ model: db.BoqItem, as: "items" }, "sort_order", "ASC"]],
        });

        if (!boq) {
            return res.status(404).json({ success: false, message: "BOQ not found" });
        }
        const enrichedBoq = await enrichBoqWithFileUrls(boq.toJSON());

        const items = (boq as any).items || [];

        const toNum = (v: any) => (v == null ? 0 : Number(v));

        const totals = items.reduce(
            (acc: any, it: any) => {
                acc.subtotal += toNum(it.line_subtotal);
                acc.tax += toNum(it.line_tax);
                acc.total += toNum(it.line_total);
                return acc;
            },
            { subtotal: 0, tax: 0, total: 0 }
        );

        return res.status(200).json({
            success: true,
            data: {
                ...boq.toJSON(),
                totals,
            },
        });
    } catch (error: any) {
        console.error("Error fetching BOQ:", error?.stack || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch BOQ",
            error: error?.message || String(error),
        });
    }
};


// Delete BOQ
export const deleteBoq = async (req: Request, res: Response) => {
    const id = (req.params?.id as string) || (req.body?.id ? String(req.body.id) : "");

    if (!id) {
        return res.status(400).json({ success: false, message: "Missing BOQ id", data: null });
    }
    if (!isUuid(id)) {
        return res.status(400).json({ success: false, message: "Invalid BOQ id format", data: null });
    }

    const forceDelete = String(req.query.force).toLowerCase() === "true";

    const t = await db.sequelize.transaction();
    try {
        const boq = await db.Boq.findByPk(id, { transaction: t, paranoid: false });

        if (!boq) {
            await t.rollback();
            return res.status(404).json({ success: false, message: "BOQ not found", data: null });
        }

        if ((boq as any).deletedAt && !forceDelete) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: "BOQ already deleted",
                data: { id, alreadyDeleted: true },
            });
        }

        await db.Boq.destroy({
            where: { id },
            transaction: t,
            individualHooks: true,
            force: forceDelete,
        });

        await t.commit();
        return res.json({
            success: true,
            message: forceDelete ? "BOQ permanently deleted" : "BOQ deleted",
            data: { id, force: forceDelete },
        });
    } catch (error: any) {
        await t.rollback();
        console.error(`Error deleting BOQ ${id}:`, error?.stack || error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete BOQ",
            data: { error: error?.message || String(error) },
        });
    }
};

// Search BOQs
export const searchBoqs = async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    const status = (req.query.status as string)?.trim();

    if (!q && !status) {
        return res.status(400).json({ success: false, message: "At least one search parameter is required" });
    }

    const page = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    try {
        const where: any = {};

        if (q) {
            where[Op.or] = [
                { title: { [Op.iLike]: `%${q}%` } },
                { boq_number: { [Op.iLike]: `%${q}%` } },
                { notes: { [Op.iLike]: `%${q}%` } },
            ];
        }

        if (status) {
            where.status = status;
        }

        const { count, rows } = await db.Boq.findAndCountAll({
            where,
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files",
                        attributes: ['id', 'file_name', 'file_type'],
                        limit: 1
                    }],
                    attributes: ["id", "description", "quantity", "line_total"], // ❌ rate removed
                },
            ],
            order: [["created_at", "DESC"]],
            limit,
            offset,
            distinct: true,
        });

        const totalPages = Math.ceil(count / limit);

        return res.json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                totalPages,
                currentPage: page,
                itemsPerPage: limit,
                hasNextPage: page * limit < count,
                hasPreviousPage: page > 1,
            },
            search: { q, status },
        });
    } catch (error: any) {
        console.error("BOQ search error:", error?.stack || error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// Update BOQ Status
export const updateBoqStatus = async (req: AuthenticatedRequest, res: Response) => {
    // Accept id from params, query or body (pickIdOrBoqNumber helper already handles these)
    const { id: rawIdFromPick, boq_number } = pickIdOrBoqNumber(req);
    // prefer raw id (uuid) or fallback to boq_number string
    const rawId = (rawIdFromPick || boq_number || "").toString().trim();

    // Accept status from body (string)
    const statusRaw = (req.body?.status ?? "").toString();
    const status = statusRaw.trim().toLowerCase();

    console.debug("[updateBoqStatus] incoming", {
        fromParams: req.params,
        fromQuery: req.query,
        fromBody: req.body,
        resolvedRawId: rawId,
        resolvedStatus: status,
    });

    // Basic validations
    if (!rawId) {
        return res.status(400).json({ success: false, message: "Missing BOQ id (provide :id, ?id= or { id })" });
    }
    if (!["draft", "approved", "cancelled"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid status. Allowed values: draft, approved, cancelled",
        });
    }

    // Actor / auth
    const actorId = pickActorId(req);
    if (!actorId) {
        // prefer 401 so client can re-authenticate
        return res.status(401).json({ success: false, message: "Missing or invalid actor id (authentication required)" });
    }

    const t = await db.sequelize.transaction();
    try {
        // Build where clause: accept uuid or boq_number
        const where: any = {};
        if (isUuid(rawId)) where.id = rawId;
        else where.boq_number = rawId;

        // Find BOQ within transaction
        const boq = await db.Boq.findOne({ where, transaction: t });
        if (!boq) {
            await t.rollback();
            return res.status(404).json({ success: false, message: "BOQ not found" });
        }

        // Optional: check for no-op
        if (String(boq.status || "").toLowerCase() === status) {
            await t.rollback();
            // Reload full BOQ for client
            const unchanged = await db.Boq.findByPk(boq.id, {
                include: [
                    {
                        model: db.BoqItem,
                        as: "items",
                        include: [{
                            model: db.BoqItemFile,
                            as: "files"
                        }]
                    },
                    { model: db.SystemUser, as: "creator", attributes: ["id", "email", "name"] },
                ],
            });
            return res.status(200).json({ success: true, message: `BOQ already ${status}`, data: unchanged });
        }

        // Update status & audit fields
        await boq.update(
            {
                status,
                updated_by: actorId,
                updated_at: new Date(),
            } as any,
            { transaction: t }
        );

        await t.commit();

        // Reload canonical BOQ after commit (outside tx)
        const fresh = await db.Boq.findByPk(boq.id, {
            include: [
                {
                    model: db.BoqItem,
                    as: "items",
                    include: [{
                        model: db.BoqItemFile,
                        as: "files"
                    }]
                },
                { model: db.SystemUser, as: "creator", attributes: ["id", "email", "name"] },
            ],
        });

        console.info(`[updateBoqStatus] BOQ ${boq.id} updated to ${status} by ${actorId}`);

        return res.status(200).json({
            success: true,
            message: `BOQ status updated to ${status}`,
            data: fresh,
        });
    } catch (err: any) {
        await t.rollback();
        console.error("[updateBoqStatus] error:", err?.stack || err);
        return res.status(500).json({
            success: false,
            message: "Failed to update BOQ status",
            error: err?.message || String(err),
        });
    }
};

export const printBoqPdf = async (req: Request, res: Response) => {
    try {
        const boqId = String(req.params.id || "").trim();
        if (!boqId) {
            return res.status(400).json({
                success: false,
                message: "BOQ id required"
            });
        }

        console.log(`📄 Generating PDF for BOQ: ${boqId}`);

        const buffer = await renderBoqPdfBuffer(boqId);

        if (!buffer || buffer.length === 0) {
            return res.status(500).json({
                success: false,
                message: "Generated PDF is empty"
            });
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="BOQ-${boqId}.pdf"`);
        res.setHeader("Content-Length", buffer.length);

        return res.send(buffer);

    } catch (err: any) {
        console.error("Error generating BOQ PDF:", err);

        // More specific error messages
        let errorMessage = "Failed to generate PDF";
        if (err.message?.includes("BOQ not found")) {
            errorMessage = "BOQ not found";
        } else if (err.message?.includes("Template not found")) {
            errorMessage = "PDF template not found";
        } else if (err.message?.includes("puppeteer")) {
            errorMessage = "PDF generation service unavailable";
        }

        return res.status(500).json({
            success: false,
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

export const printBoqHtml = async (req: Request, res: Response) => {
    try {
        const boqId = String(req.params.id || "").trim();
        if (!boqId) return res.status(400).type("text/plain").send("BOQ id required");
        const vm = await buildBoqVM(boqId);
        const tplPath = await resolveTemplate("boq.hbs");
        const tplHtml = await fs.promises.readFile(tplPath, "utf8");
        const html = Handlebars.compile(tplHtml)(vm);
        return res.status(200).type("html").send(html);
    } catch (err: any) {
        return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
};

export const printBoqPdfByQuery = async (req: Request, res: Response) => {
    try {
        const id = String(req.query.id || "").trim();
        if (!id) return res.status(400).send("BOQ id required in query ?id=");
        const buffer = await renderBoqPdfBuffer(id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="BOQ-${id}.pdf"`);
        res.send(buffer);
    } catch (err: any) {
        console.error("Error generating BOQ PDF (query):", err);
        res.status(500).send(`Failed to generate PDF: ${err.message || err}`);
    }
};

export const printBoqPdfFromBody = async (req: Request, res: Response) => {
    try {
        const id = String(req.body?.id || "").trim();
        if (!id) return res.status(400).json({ message: "BOQ id required in body { id }" });
        const buffer = await renderBoqPdfBuffer(id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="BOQ-${id}.pdf"`);
        res.send(buffer);
    } catch (err: any) {
        console.error("Error generating BOQ PDF (body):", err);
        res.status(500).json({ message: "Failed to generate PDF", error: err.message || String(err) });
    }
};