// controllers/LoanAccountController.ts
import { Request, Response } from "express";
import BaseController from "./BaseController";
import logger from "../utils/logger";
import DBServices from "../database/DBService";
import { QueryTypes } from "sequelize";
import * as Yup from "yup";
import multer from "multer";
import path from "path";
import fs from "fs";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

// Validation Schemas
const createLoanAccountSchema = Yup.object({
    account_name: Yup.string().required("Account name is required").trim(),
    bank_name: Yup.string().required("Bank name is required").trim(),
    account_number: Yup.string().required("Account number is required").trim(),
    ifsc_code: Yup.string().required("IFSC code is required").trim(),
    branch: Yup.string().required("Branch is required").trim(),
    mobile: Yup.string().required("Mobile number is required").trim(),
    reason: Yup.string().optional().nullable(),

    // NEW optional fields
    job_position: Yup.string().optional().nullable().trim(),
    aadhar_number: Yup.string().optional().nullable().trim(),
    pan_number: Yup.string().optional().nullable().trim()
});

const updateLoanAccountSchema = Yup.object({
    id: Yup.string().required("Loan account ID is required"),
    account_name: Yup.string().optional().trim(),
    bank_name: Yup.string().optional().trim(),
    account_number: Yup.string().optional().trim(),
    ifsc_code: Yup.string().optional().trim(),
    branch: Yup.string().optional().trim(),
    mobile: Yup.string().optional().trim(),
    reason: Yup.string().optional().nullable(),

    // NEW optional fields
    job_position: Yup.string().optional().nullable().trim(),
    aadhar_number: Yup.string().optional().nullable().trim(),
    pan_number: Yup.string().optional().nullable().trim()
});

const deleteLoanAccountSchema = Yup.object({
    id: Yup.string().required("Loan account ID is required"),
});

const getLoanAccountSchema = Yup.object({
    id: Yup.string().required("Loan account ID is required"),
});

const listLoanAccountsSchema = Yup.object({
    page: Yup.number().integer().min(1).default(1),
    limit: Yup.number().integer().min(1).max(100).default(20),
    order: Yup.mixed<"ASC" | "DESC">().oneOf(["ASC", "DESC"]).default("DESC"),
    search: Yup.string().optional(),
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "uploads", "loan-documents");
        // Ensure upload directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    },
});

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "eu-north-1",
});

const BASE_URL = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com`;

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Accept any file field name for flexibility
        cb(null, true);
    },
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

async function uploadLoanFileToS3(
    loanAccountId: string,
    file: Express.Multer.File
) {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
    const key = `loan-documents/${loanAccountId}/${Date.now()}-${safeName}`;

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

    // cleanup temp file
    await fs.promises.unlink(file.path).catch(() => { });

    return {
        key,
        url: `${BASE_URL}/${key}`,
    };
}

export default class LoanAccountController extends BaseController {
    db_services: DBServices = new DBServices();

    constructor() {
        super();
        logger.info("LoanAccountController instantiated");
    }

    // In your LoanAccountController - createLoanAccount method
    public createLoanAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const t = await this.db_services.sequelizeWriter.transaction();

        try {
            console.log('=== CREATE LOAN ACCOUNT ===');
            console.log('Request body:', req.body);
            console.log('Request files:', req.files);

            // Authentication check
            const authUser = req.user;
            if (!authUser || !authUser.userId) {
                await t.rollback();
                return this.sendError(res, {}, "Unauthorized - Please login again", 401);
            }

            // Validate request body
            await createLoanAccountSchema.validate(req.body, { abortEarly: false });

            const {
                account_name,
                bank_name,
                account_number,
                ifsc_code,
                branch,
                mobile,
                reason,
                job_position,
                aadhar_number,
                pan_number
            } = req.body;

            // Check if account number already exists
            const existingAccount = await this.db_services.sequelizeWriter.query(
                `SELECT id FROM loan_accounts WHERE account_number = :account_number`,
                {
                    replacements: { account_number },
                    type: QueryTypes.SELECT,
                    transaction: t
                }
            );

            if (existingAccount.length > 0) {
                await t.rollback();
                return this.sendError(res, {}, "Account number already exists", 409);
            }

            // Generate UUID for new loan account
            const loanAccountId = this.generateUUID();

            // Insert new loan account (include new scalar fields)
            await this.db_services.sequelizeWriter.query(
                `INSERT INTO loan_accounts (
        id, account_name, bank_name, account_number, ifsc_code,
        branch, mobile, reason, job_position, aadhar_number, pan_number,
        created_by, created_at, updated_at
      ) VALUES (
        :id, :account_name, :bank_name, :account_number, :ifsc_code,
        :branch, :mobile, :reason, :job_position, :aadhar_number, :pan_number,
        :created_by, NOW(), NOW()
      )`,
                {
                    replacements: {
                        id: loanAccountId,
                        account_name: account_name.trim(),
                        bank_name: bank_name.trim(),
                        account_number: account_number.trim(),
                        ifsc_code: ifsc_code.trim().toUpperCase(),
                        branch: branch.trim(),
                        mobile: mobile.trim(),
                        reason: reason?.trim() || null,
                        job_position: job_position?.trim() || null,
                        aadhar_number: aadhar_number?.trim() || null,
                        pan_number: pan_number?.trim() || null,
                        created_by: authUser.userId
                    },
                    type: QueryTypes.INSERT,
                    transaction: t
                }
            );

            // Handle file uploads
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

            if (files) {
                console.log("Processing uploaded files:", Object.keys(files));

                for (const [fieldName, fileArray] of Object.entries(files)) {
                    if (fileArray && fileArray.length > 0) {
                        const file = fileArray[0];

                        // AADHAAR, PAN, PASSBOOK, PHOTO from field name (profile image)
                        const docType = (fieldName || '').toUpperCase();
                        const uploaded = await uploadLoanFileToS3(loanAccountId, file);

                        console.log(`Saving document: ${docType} - ${file.originalname}`);

                        // Insert into loan_account_documents
                        await this.db_services.sequelizeWriter.query(
                            `INSERT INTO loan_account_documents (
          loan_account_id, doc_type, file_path, original_name,
          mime_type, file_size, created_by, created_at
        ) VALUES (
          :loan_account_id, :doc_type, :file_path, :original_name,
          :mime_type, :file_size, :created_by, NOW()
        )`,
                            {
                                replacements: {
                                    loan_account_id: loanAccountId,
                                    doc_type: docType,
                                    file_path: uploaded.key,
                                    original_name: file.originalname,
                                    mime_type: file.mimetype,
                                    file_size: file.size,
                                    created_by: authUser.userId
                                },
                                type: QueryTypes.INSERT,
                                transaction: t
                            }
                        );

                        // If this is a profile image (PHOTO or PROFILE_IMAGE) update loan_accounts profile image fields
                        if (docType === 'PHOTO' || docType === 'PROFILE_IMAGE') {
                            await this.db_services.sequelizeWriter.query(
                                `UPDATE loan_accounts
               SET profile_image_path = :profile_image_path,
                   profile_image_original_name = :profile_image_original_name,
                   profile_image_mime = :profile_image_mime,
                   profile_image_size = :profile_image_size,
                   updated_at = NOW()
               WHERE id = :id`,
                                {
                                    replacements: {
                                        id: loanAccountId,
                                        profile_image_path: uploaded.key,
                                        profile_image_original_name: file.originalname,
                                        profile_image_mime: file.mimetype,
                                        profile_image_size: file.size
                                    },
                                    type: QueryTypes.UPDATE,
                                    transaction: t
                                }
                            );
                        }
                    }
                }
            }

            await t.commit();

            return this.sendSuccess(
                res,
                { loan_account_id: loanAccountId },
                "Loan account created successfully",
                201
            );

        } catch (err: any) {
            await t.rollback();
            console.error('Error in createLoanAccount:', err);

            if (err instanceof Yup.ValidationError) {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }

            // Handle multer errors
            if (err.message && err.message.includes('Invalid file type')) {
                return this.sendError(res, {}, err.message, 400);
            }

            return this.sendError(res, err, "Internal server error", 500);
        }
    };

    public getLoanAccounts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const {
                page = 1,
                limit = 10,
                search = "",
                order = "DESC",
                branch = ""
            } = req.query as any;

            const offset = (Number(page) - 1) * Number(limit);

            // Fixed COUNT query with table alias
            let countQuery = `SELECT COUNT(*) as count FROM loan_accounts la`;
            let dataQuery = `
        SELECT 
            la.id,
            la.account_name,
            la.bank_name,
            la.account_number,
            la.ifsc_code,
            la.branch,
            la.mobile,
            la.reason,
            la.job_position,
            la.aadhar_number,
            la.pan_number,
            la.profile_image_path,
            la.profile_image_original_name,
            la.profile_image_mime,
            la.profile_image_size,
            la.created_at,
            la.updated_at,
            su.name as created_by_name,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', lad.id,
                        'doc_type', lad.doc_type,
                        'file_path', lad.file_path,
                        'original_name', lad.original_name,
                        'mime_type', lad.mime_type,
                        'file_size', lad.file_size,
                       'created_at', lad.created_at 

                    )
                ) FILTER (WHERE lad.id IS NOT NULL), '[]'
            ) as documents
        FROM loan_accounts la
        LEFT JOIN system_users su ON la.created_by::uuid = su.id
        LEFT JOIN loan_account_documents lad ON la.id = lad.loan_account_id
        `;

            let whereConditions: string[] = [];
            let replacements: any = {
                limit: Number(limit),
                offset: offset
            };

            // Search filter
            if (search && search.trim() !== '') {
                const searchPattern = `%${search.trim()}%`;
                whereConditions.push(`
                (la.account_name ILIKE :search 
                OR la.bank_name ILIKE :search 
                OR la.account_number ILIKE :search 
                OR la.branch ILIKE :search)
            `);
                replacements.search = searchPattern;
            }

            // Branch filter
            if (branch && branch.trim() !== '') {
                const branchPattern = `%${branch.trim()}%`;
                whereConditions.push(`la.branch ILIKE :branch`);
                replacements.branch = branchPattern;
            }

            // Apply WHERE conditions
            if (whereConditions.length > 0) {
                const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
                countQuery += ` ${whereClause}`;
                dataQuery += ` ${whereClause}`;
            }

            // Fixed GROUP BY and ORDER BY
            dataQuery += `
        GROUP BY la.id, su.name
        ORDER BY la.created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT :limit OFFSET :offset
        `;

            console.log('COUNT Query:', countQuery);
            console.log('DATA Query:', dataQuery);
            console.log('Replacements:', replacements);

            // Get total count
            const totalCountResult: any[] = await this.db_services.sequelizeReader.query(
                countQuery,
                {
                    replacements: replacements, // Use same replacements
                    type: QueryTypes.SELECT
                }
            );

            const totalCount = parseInt(totalCountResult[0]?.count || 0);
            const totalPages = Math.ceil(totalCount / Number(limit));

            // Get data with documents
            const loanAccounts: any[] = await this.db_services.sequelizeReader.query(
                dataQuery,
                {
                    replacements: replacements, // Use same replacements
                    type: QueryTypes.SELECT
                }
            );

            // Add absolute URLs to documents and profile_image
            const loanAccountsWithUrls = loanAccounts.map(account => ({
                ...account,
                profile_image_url: account.profile_image_path
                    ? `${BASE_URL}/${account.profile_image_path}`
                    : null,
                documents: (account.documents || []).map((doc: any) => ({
                    ...doc,
                    url: doc.file_path ? `${BASE_URL}/${doc.file_path}` : null
                }))
            }));

            this.sendSuccess(
                res,
                {
                    loan_accounts: loanAccountsWithUrls,
                    pagination: {
                        page: Number(page),
                        limit: Number(limit),
                        totalPages,
                        totalCount
                    },
                    filters: {
                        search: search || '',
                        branch: branch || '',
                        order
                    }
                },
                "Loan accounts retrieved successfully",
                200
            );

        } catch (err: any) {
            console.error('Error in getLoanAccounts:', err);
            logger.error("Error in getLoanAccounts", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };

    // Get Loan Account by ID with Documents
    public getLoanAccountById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            await getLoanAccountSchema.validate(req.body, { abortEarly: false });

            const { id } = req.body;

            const query = `
            SELECT 
                la.id,
                la.account_name,
                la.bank_name,
                la.account_number,
                la.ifsc_code,
                la.branch, // ✅ Branch is included
                la.mobile,
                la.reason,
                la.job_position,
                la.aadhar_number,
                la.pan_number,
                la.profile_image_path,
                la.profile_image_original_name,
                la.profile_image_mime,
                la.profile_image_size,
                la.created_at,
                la.updated_at,
                su.name as created_by_name,
               COALESCE(
                    json_agg(
                        json_build_object(
                            'id', lad.id,
                            'doc_type', lad.doc_type,
                            'file_path', lad.file_path,
                            'original_name', lad.original_name,
                            'mime_type', lad.mime_type,
                            'file_size', lad.file_size,
                            'created_at', lad.created_at
                        )
                    ) FILTER (WHERE lad.id IS NOT NULL),
                    '[]'
                ) AS documents

            FROM loan_accounts la
            LEFT JOIN system_users su ON la.created_by::uuid = su.id
            LEFT JOIN loan_account_documents lad ON la.id = lad.loan_account_id
            WHERE la.id = :id
            GROUP BY la.id, su.name
        `;

            const loanAccount: any[] = await this.db_services.sequelizeReader.query(
                query,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT
                }
            );

            if (loanAccount.length === 0) {
                return this.sendError(res, {}, "Loan account not found", 404);
            }

            // Add absolute URLs to documents and profile image
            const loanAccountWithUrls = {
                ...loanAccount[0],
                profile_image_url: loanAccount[0].profile_image_path ? this.absolutizeUrl(req, loanAccount[0].profile_image_path) : null,
                documents: loanAccount[0].documents.map((doc: any) => ({
                    ...doc,
                    url: doc.file_path ? `${BASE_URL}/${doc.file_path}` : null

                }))
            };

            this.sendSuccess(
                res,
                { loan_account: loanAccountWithUrls },
                "Loan account retrieved successfully",
                200
            );

        } catch (err: any) {
            if (err instanceof Yup.ValidationError) {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }

            logger.error("Error in getLoanAccountById", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };

    // Update Loan Account with File Upload
    public updateLoanAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const t = await this.db_services.sequelizeWriter.transaction();

        // 🔍 Debug:
        console.log("=== UPDATE LOAN ACCOUNT ===");
        console.log("Headers:", req.headers);
        console.log("Body:", req.body);
        console.log("Files:", req.files);

        const authUser = req.user;
        if (!authUser || !authUser.userId) {
            await t.rollback();
            return this.sendError(res, {}, "Unauthorized - Please login again", 401);
        }

        try {
            // 1️⃣ Validate body
            await updateLoanAccountSchema.validate(req.body, { abortEarly: false });

            const {
                id,
                account_name,
                bank_name,
                account_number,
                ifsc_code,
                branch,
                mobile,
                reason,
                job_position,
                aadhar_number,
                pan_number
            } = req.body;

            // 2️⃣ Check loan account exists
            const existingAccount: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, account_number FROM loan_accounts WHERE id = :id`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                    transaction: t,
                }
            );

            if (existingAccount.length === 0) {
                await t.rollback();
                return this.sendError(res, {}, "Loan account not found", 404);
            }

            // 3️⃣ Check account number uniqueness (if changed)
            if (account_number && account_number !== existingAccount[0].account_number) {
                const accountExists: any[] = await this.db_services.sequelizeWriter.query(
                    `SELECT id FROM loan_accounts 
         WHERE account_number = :account_number 
           AND id != :id`,
                    {
                        replacements: { account_number, id },
                        type: QueryTypes.SELECT,
                        transaction: t,
                    }
                );

                if (accountExists.length > 0) {
                    await t.rollback();
                    return this.sendError(res, {}, "Account number already exists", 409);
                }
            }

            // 4️⃣ Build dynamic UPDATE fields
            const updateFields: string[] = [];
            const replacements: any = { id, updated_by: authUser.userId };

            if (account_name) {
                updateFields.push("account_name = :account_name");
                replacements.account_name = account_name.trim();
            }
            if (bank_name) {
                updateFields.push("bank_name = :bank_name");
                replacements.bank_name = bank_name.trim();
            }
            if (account_number) {
                updateFields.push("account_number = :account_number");
                replacements.account_number = account_number.trim();
            }
            if (ifsc_code) {
                updateFields.push("ifsc_code = :ifsc_code");
                replacements.ifsc_code = ifsc_code.trim().toUpperCase();
            }
            if (branch) {
                updateFields.push("branch = :branch");
                replacements.branch = branch.trim();
            }
            if (mobile) {
                updateFields.push("mobile = :mobile");
                replacements.mobile = mobile.trim();
            }
            if (reason !== undefined) {
                updateFields.push("reason = :reason");
                replacements.reason = reason?.trim() || null;
            }

            // NEW scalar fields
            if (job_position !== undefined) {
                updateFields.push("job_position = :job_position");
                replacements.job_position = job_position?.trim() || null;
            }
            if (aadhar_number !== undefined) {
                updateFields.push("aadhar_number = :aadhar_number");
                replacements.aadhar_number = aadhar_number?.trim() || null;
            }
            if (pan_number !== undefined) {
                updateFields.push("pan_number = :pan_number");
                replacements.pan_number = pan_number?.trim() || null;
            }

            // 5️⃣ Deletion markers (for existing docs)
            const deleteDocuments = this.collectDeleteMarkers(req.body);
            const hasDeletes = deleteDocuments.length > 0;

            // 6️⃣ New uploads (AADHAAR / PAN / PASSBOOK / PHOTO)
            // Router uses loanUpload.fields([...]), so req.files is a map:
            // { AADHAAR?: File[], PAN?: File[], PASSBOOK?: File[], PHOTO?: File[] }
            const filesMap = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            const hasFiles =
                !!filesMap &&
                Object.values(filesMap).some((arr) => Array.isArray(arr) && arr.length > 0);

            // If nothing to change at all
            if (updateFields.length === 0 && !hasDeletes && !hasFiles) {
                await t.rollback();
                return this.sendError(res, {}, "No fields or documents to update", 400);
            }

            // 7️⃣ Update scalar fields if provided
            if (updateFields.length > 0) {
                updateFields.push("updated_at = NOW()");

                await this.db_services.sequelizeWriter.query(
                    `UPDATE loan_accounts 
         SET ${updateFields.join(", ")} 
         WHERE id = :id`,
                    {
                        replacements,
                        type: QueryTypes.UPDATE,
                        transaction: t,
                    }
                );
            }

            // 8️⃣ Handle document deletions
            if (hasDeletes) {
                await this.handleDocumentDeletions(id, deleteDocuments, t);
            }

            // 9️⃣ Handle new document uploads
            if (filesMap) {
                console.log("Files map keys:", Object.keys(filesMap));

                for (const [fieldName, fileArray] of Object.entries(filesMap)) {
                    if (!fileArray || fileArray.length === 0) continue;

                    const file = fileArray[0];

                    // Use field name (AADHAAR / PAN / PASSBOOK / PHOTO) as main docType
                    const fieldUpper = fieldName.toUpperCase();
                    const docType =
                        this.determineDocType(file.originalname, fieldUpper) || fieldUpper;

                    // Safety: only allow known types including PHOTO
                    if (!["AADHAAR", "PAN", "PASSBOOK", "PHOTO", "PROFILE_IMAGE"].includes(docType)) {
                        console.warn(`Skipping unknown docType for field ${fieldName}`);
                        continue;
                    }

                    // Delete existing doc of same type for this loan account
                    await this.db_services.sequelizeWriter.query(
                        `DELETE FROM loan_account_documents 
           WHERE loan_account_id = :loan_account_id 
             AND doc_type = :doc_type`,
                        {
                            replacements: { loan_account_id: id, doc_type: docType },
                            type: QueryTypes.DELETE,
                            transaction: t,
                        }
                    );

                    const uploaded = await uploadLoanFileToS3(id, file);

                    await this.db_services.sequelizeWriter.query(
                        `INSERT INTO loan_account_documents (
            loan_account_id, doc_type, file_path, original_name,
            mime_type, file_size, created_by, created_at
          ) VALUES (
            :loan_account_id, :doc_type, :file_path, :original_name,
            :mime_type, :file_size, :created_by, NOW()
          )`,
                        {
                            replacements: {
                                loan_account_id: id,
                                doc_type: docType,
                                file_path: uploaded.key,
                                original_name: file.originalname,
                                mime_type: file.mimetype,
                                file_size: file.size,
                                created_by: authUser.userId,
                            },
                            type: QueryTypes.INSERT,
                            transaction: t,
                        }
                    );

                    // If profile image, update loan_accounts profile_image_* fields
                    if (docType === 'PHOTO' || docType === 'PROFILE_IMAGE') {
                        await this.db_services.sequelizeWriter.query(
                            `UPDATE loan_accounts
         SET profile_image_path = :profile_image_path,
             profile_image_original_name = :profile_image_original_name,
             profile_image_mime = :profile_image_mime,
             profile_image_size = :profile_image_size,
             updated_at = NOW()
         WHERE id = :id`,
                            {
                                replacements: {
                                    id,
                                    profile_image_path: uploaded.key, // ✅ FIXED
                                    profile_image_original_name: file.originalname,
                                    profile_image_mime: file.mimetype,
                                    profile_image_size: file.size
                                },
                                type: QueryTypes.UPDATE,
                                transaction: t
                            }
                        );
                    }
                }
            }

            await t.commit();

            this.sendSuccess(
                res,
                { loan_account_id: id },
                "Loan account updated successfully",
                200
            );
        } catch (err: any) {
            await t.rollback();

            if (err instanceof Yup.ValidationError) {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }

            logger.error("Error in updateLoanAccount", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };
    // Get Loan Account by Account Number with Documents

    public getLoanAccountByNumber = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { account_number } = req.body;

            if (!account_number) {
                return this.sendError(res, {}, "Account number is required", 400);
            }

            const query = `
        SELECT 
          la.id,
          la.account_name,
          la.bank_name,
          la.account_number,
          la.ifsc_code,
          la.branch,
          la.mobile,
          la.reason,
          la.job_position,
          la.aadhar_number,
          la.pan_number,
          la.profile_image_path,
          la.profile_image_original_name,
          la.profile_image_mime,
          la.profile_image_size,
          la.created_at,
          la.updated_at,
          su.name as created_by_name,
          COALESCE(
            json_agg(
              json_build_object(
                'id', lad.id,
                'doc_type', lad.doc_type,
                'file_path', lad.file_path,
                'original_name', lad.original_name,
                'mime_type', lad.mime_type,
                'file_size', lad.file_size,
                'created_at', lad.created_at
              )
            ) FILTER (WHERE lad.id IS NOT NULL), '[]'
          ) as documents
        FROM loan_accounts la
        LEFT JOIN system_users su ON la.created_by::uuid = su.id
        LEFT JOIN loan_account_documents lad ON la.id = lad.loan_account_id
        WHERE la.account_number = :account_number
        GROUP BY la.id, su.name
      `;

            const loanAccount: any[] = await this.db_services.sequelizeReader.query(
                query,
                {
                    replacements: { account_number },
                    type: QueryTypes.SELECT
                }
            );

            if (loanAccount.length === 0) {
                return this.sendError(res, {}, "Loan account not found", 404);
            }

            // Add absolute URLs to documents and profile image
            const loanAccountWithUrls = {
                ...loanAccount[0],
                profile_image_url: loanAccount[0].profile_image_path ? this.absolutizeUrl(req, loanAccount[0].profile_image_path) : null,
                documents: loanAccount[0].documents.map((doc: any) => ({
                    ...doc,
                    url: this.absolutizeUrl(req, doc.file_path)
                }))
            };

            this.sendSuccess(
                res,
                { loan_account: loanAccountWithUrls },
                "Loan account retrieved successfully",
                200
            );

        } catch (err: any) {
            logger.error("Error in getLoanAccountByNumber", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };

    // Get Loan Accounts Stats
    public getLoanAccountsStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const statsQuery = `
        SELECT 
          COUNT(*) as total_accounts,
          COUNT(DISTINCT bank_name) as total_banks,
          COUNT(DISTINCT branch) as total_branches,
          MAX(created_at) as latest_created
        FROM loan_accounts
      `;

            const stats: any[] = await this.db_services.sequelizeReader.query(
                statsQuery,
                {
                    type: QueryTypes.SELECT
                }
            );

            this.sendSuccess(
                res,
                { stats: stats[0] },
                "Loan accounts statistics retrieved successfully",
                200
            );

        } catch (err: any) {
            logger.error("Error in getLoanAccountsStats", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };

    // Delete Loan Account (Hard Delete)
    public deleteLoanAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const t = await this.db_services.sequelizeWriter.transaction();

        // Authentication check
        const authUser = req.user;
        if (!authUser || !authUser.userId) {
            await t.rollback();
            return this.sendError(res, {}, "Unauthorized - Please login again", 401);
        }

        try {
            await deleteLoanAccountSchema.validate(req.body, { abortEarly: false });

            const { id } = req.body;

            // Check if loan account exists
            const existingAccount: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, account_name FROM loan_accounts 
         WHERE id = :id`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                    transaction: t
                }
            );

            if (existingAccount.length === 0) {
                await t.rollback();
                return this.sendError(res, {}, "Loan account not found", 404);
            }

            // Get documents to delete physical files
            const documents: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT file_path FROM loan_account_documents WHERE loan_account_id = :id`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                    transaction: t
                }
            );

            // Delete physical files
            for (const doc of documents) {
                return res.redirect(`${BASE_URL}/${doc.file_path}`);
            }

            // Hard delete the loan account (CASCADE will handle documents)
            await this.db_services.sequelizeWriter.query(
                `DELETE FROM loan_accounts 
         WHERE id = :id`,
                {
                    replacements: { id },
                    type: QueryTypes.DELETE,
                    transaction: t
                }
            );

            await t.commit();

            this.sendSuccess(
                res,
                {},
                "Loan account deleted successfully",
                200
            );

        } catch (err: any) {
            await t.rollback();

            if (err instanceof Yup.ValidationError) {
                return this.sendError(res, {}, err.errors.join(", "), 400);
            }

            logger.error("Error in deleteLoanAccount", { error: err });
            this.sendError(res, err, "Internal server error", 500);
        }
    };

    // Download Document
    public downloadDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { document_id } = req.params;

            const document: any[] = await this.db_services.sequelizeReader.query(
                `SELECT * FROM loan_account_documents WHERE id = :document_id`,
                {
                    replacements: { document_id },
                    type: QueryTypes.SELECT
                }
            );

            if (document.length === 0) {
                return this.sendError(res, {}, "Document not found", 404);
            }

            const doc = document[0];
            const absolutePath = path.join(process.cwd(), doc.file_path.replace(/^\//, ''));

            if (!fs.existsSync(absolutePath)) {
                return this.sendError(res, {}, "File not found on server", 404);
            }

            res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${doc.original_name}"`);

            const fileStream = fs.createReadStream(absolutePath);
            fileStream.pipe(res);

        } catch (err: any) {
            logger.error("Error in downloadDocument", { error: err });
            this.sendError(res, err, "Error downloading document", 500);
        }
    };

    // Helper Methods
    private determineDocType(filename: string, fieldname: string): string | null {
        const validTypes = ['AADHAAR', 'PAN', 'PASSBOOK', 'PHOTO', 'PROFILE_IMAGE'];

        // Check fieldname first
        if (validTypes.includes(fieldname.toUpperCase())) {
            return fieldname.toUpperCase();
        }

        // Check filename patterns
        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.includes('aadhaar') || lowerFilename.includes('aadhar')) return 'AADHAAR';
        if (lowerFilename.includes('pan')) return 'PAN';
        if (lowerFilename.includes('passbook') || lowerFilename.includes('bank')) return 'PASSBOOK';
        if (lowerFilename.includes('photo') || lowerFilename.includes('profile')) return 'PHOTO';

        return null;
    }

    private collectDeleteMarkers(body: any): string[] {
        const deleteMarkers: string[] = [];

        Object.entries(body).forEach(([key, value]) => {
            if (
                key === "documents_delete" ||
                key === "documents_delete[]" ||
                key.startsWith("documents_delete[")
            ) {
                if (Array.isArray(value)) {
                    value.forEach((v) => {
                        if (v != null && String(v).trim() !== "") {
                            deleteMarkers.push(String(v));
                        }
                    });
                } else if (value != null && String(value).trim() !== "") {
                    deleteMarkers.push(String(value));
                }
            }
        });

        return deleteMarkers;
    }

    private async handleDocumentDeletions(loanAccountId: string, deleteDocuments: string[], transaction: any): Promise<void> {
        for (const documentId of deleteDocuments) {
            const document: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT id, file_path FROM loan_account_documents 
         WHERE id = :document_id AND loan_account_id = :loan_account_id`,
                {
                    replacements: { document_id: documentId, loan_account_id: loanAccountId },
                    type: QueryTypes.SELECT,
                    transaction
                }
            );

            if (document.length > 0) {
                // Delete physical file
                const absolutePath = path.join(process.cwd(), document[0].file_path.replace(/^\//, ''));
                await deleteFromS3(document[0].file_path);

                // Delete database record
                await this.db_services.sequelizeWriter.query(
                    `DELETE FROM loan_account_documents 
           WHERE id = :document_id`,
                    {
                        replacements: { document_id: documentId },
                        type: QueryTypes.DELETE,
                        transaction
                    }
                );
            }
        }
    }

    private absolutizeUrl(req: Request, file_path?: string | null): string | null {
        if (!file_path) return null;
        const base = `${req.protocol}://${req.get("host")}`;
        const clean = file_path.startsWith("/") ? file_path : `/${file_path}`;
        return `${base}${clean}`;
    }

    // Helper method to generate UUID
    private generateUUID(): string {
        return 'la_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}
function deleteFromS3(file_path: any) {
    throw new Error("Function not implemented.");
}

