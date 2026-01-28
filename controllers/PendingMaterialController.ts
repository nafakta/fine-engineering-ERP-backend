import { Request, Response } from "express";
import * as Yup from "yup";
import dbModels from "../models";

import nodemailer from "nodemailer";
import sharp from "sharp";
import fs from "fs";
import path from "path";

import { Upload } from "@aws-sdk/lib-storage";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Interface for image attachments to S3
interface TemplateAttachment {
  path: string; // S3 key
  name: string;
  type: string;
}

const DEFAULT_TO = [
    "ddkhank13@gmail.com.com",
  // "miten@amerequip.com",
  // "nirav.panchal@amerequip.com",
  // "shinoj.pillai@amerequip.com",
  // "roshan.nair@amerequip.com",
  // "Production@amerequip.com",
  // "Store@amerequip.com",
  // "Purchase@amerequip.com",
];

// ✅ SMTP (FROM fixed)
const SMTP_HOST = process.env.SMTP_HOST || "mail.dynsimulation.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "webmaster@dynsimulation.com";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || `Fine Engineering <${SMTP_USER}>`;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

// ✅ AWS S3
const AWS_REGION = process.env.AWS_REGION!;
const AWS_BUCKET = process.env.AWS_S3_BUCKET_NAME!;

const s3Client = new S3Client({
  region: AWS_REGION,
});

export default class PendingMaterialController {
  private get PendingMaterial() {
    return (dbModels as any).PendingMaterial;
  }

  // ------------------------
  // Helpers
  // ------------------------
// Helper function to escape HTML characters (for safety in the email body)
private escapeHtml(v: any) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Function to save images to S3
private async saveFilesToS3(files?: Express.Multer.File[]): Promise<TemplateAttachment[]> {
  if (!files || !Array.isArray(files) || files.length === 0) return [];

  const attachments: TemplateAttachment[] = [];

  for (const file of files) {
    const safeOriginal = file.originalname.replace(/[^\w.\- ]+/g, "_");
    const fileName = `${Date.now()}-${safeOriginal}`;

    // local folder: uploads/upload-product
    const localDir = path.join(process.cwd(), "uploads", "upload-product");
    const localPath = path.join(localDir, fileName);

    fs.mkdirSync(localDir, { recursive: true });

    // Check if the file is an image before processing it with sharp
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      try {
        // Process image with sharp only if it's a valid image buffer
        await sharp(file.buffer)
          .resize({ width: 800, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(localPath);
      } catch (error) {
        console.error("Error processing image with sharp:", error);
        throw new Error("Invalid image format or corrupted image file.");
      }
    } else {
      // If it's not an image, directly save the buffer to the file system
      fs.writeFileSync(localPath, file.buffer);
    }

    // Upload to S3
    const key = `upload-product/${fileName}`;

    try {
      await new Upload({
        client: s3Client,
        params: {
          Bucket: AWS_BUCKET,
          Key: key,
          Body: fs.createReadStream(localPath),
          ContentType: file.mimetype,
          ACL: "private",
        },
      }).done();
    } catch (uploadError) {
      console.error("Error uploading file to S3:", uploadError);
      throw new Error("File upload to S3 failed.");
    }

    attachments.push({
      path: key,
      name: file.originalname,
      type: file.mimetype,
    });

    // Delete local file after uploading to S3
    try {
      fs.unlinkSync(localPath);
    } catch {}
  }

  return attachments;
}

// Generate a signed URL for private S3 images
private async getSignedUrlForKey(key: string, expiresSeconds = 7 * 24 * 60 * 60) {
  const cmd = new GetObjectCommand({
    Bucket: AWS_BUCKET,
    Key: key,
  });

  return getSignedUrl(s3Client, cmd, { expiresIn: expiresSeconds });
}

  // ------------------------
  // CREATE
  // ------------------------
  public create = async (req: Request, res: Response) => {
    const createSchema = Yup.object({
      job_no: Yup.number().required("job_no is required"),
      item_no: Yup.number().default(0),
      description: Yup.string().nullable(),
      size: Yup.string().required("size is required"),
      moc: Yup.string().required("moc is required"),
      qty: Yup.number().default(0),
      is_completed: Yup.boolean().default(false),
      created_by: Yup.string().uuid().nullable(),
    });

    try {
      const body = await createSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (!this.PendingMaterial) {
        return res.status(500).json({
          success: false,
          error: "PendingMaterial model not initialized",
        });
      }

      const pendingMaterial = await this.PendingMaterial.create(body);

      return res.status(201).json({
        success: true,
        data: pendingMaterial,
        message: "Pending material created successfully",
      });
    } catch (err: any) {
      console.error("Create PendingMaterial Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // LIST
  // ------------------------
  public list = async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
      const offset = (page - 1) * limit;

      const where: any = {};
      if (req.query.is_completed === "true") where.is_completed = true;
      else if (req.query.is_completed === "false") where.is_completed = false;

      if (req.query.job_no) {
        const jobNo = parseFloat(String(req.query.job_no));
        if (!isNaN(jobNo)) where.job_no = jobNo;
      }

      const { rows, count } = await this.PendingMaterial.findAndCountAll({
        where,
        limit,
        offset,
        order: [["created_at", "DESC"]],
      });

      return res.json({
        success: true,
        data: rows,
        meta: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      });
    } catch (err: any) {
      console.error("List PendingMaterial Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // GET ONE
  // ------------------------
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!this.PendingMaterial) {
        return res.status(500).json({ success: false, error: "PendingMaterial model not initialized" });
      }

      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      return res.json({ success: true, data: pendingMaterial });
    } catch (err: any) {
      console.error("Get PendingMaterial Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // UPDATE
  // ------------------------
  public update = async (req: Request, res: Response) => {
    const updateSchema = Yup.object({
      job_no: Yup.number(),
      item_no: Yup.number(),
      description: Yup.string().nullable(),
      size: Yup.string(),
      moc: Yup.string(),
      qty: Yup.number(),
      is_completed: Yup.boolean(),
      updated_by: Yup.string().uuid().nullable(),
    });

    try {
      const { id } = req.params;
      const body = await updateSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (!this.PendingMaterial) {
        return res.status(500).json({ success: false, error: "PendingMaterial model not initialized" });
      }

      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      await pendingMaterial.update(body);

      return res.json({
        success: true,
        data: pendingMaterial,
        message: "Pending material updated successfully",
      });
    } catch (err: any) {
      console.error("Update PendingMaterial Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // DELETE
  // ------------------------
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!this.PendingMaterial) {
        return res.status(500).json({ success: false, error: "PendingMaterial model not initialized" });
      }

      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      await pendingMaterial.destroy();

      return res.json({
        success: true,
        message: "Pending material deleted successfully",
      });
    } catch (err: any) {
      console.error("Delete PendingMaterial Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // COMPLETE AND CREATE JOB
  // ------------------------
  public completeAndCreateJob = async (req: Request, res: Response) => {
    const schema = Yup.object({
      remark: Yup.string().nullable(),
      bin_location: Yup.string().nullable(),
      material_remark: Yup.string().nullable(),
      serial_no: Yup.number().default(0),
      mtl_challan_no: Yup.number().default(0),
      job_order_date: Yup.date().nullable(),
      mtl_rcd_date: Yup.date().nullable(),
      created_by: Yup.string().uuid().nullable(),
      urgent: Yup.boolean().default(false),
    });

    const transaction = await (dbModels as any).sequelize.transaction();

    try {
      const { id } = req.params;
      const body = await schema.validate(req.body, { stripUnknown: true });

      if (!this.PendingMaterial || !(dbModels as any).Job) {
        await transaction.rollback();
        return res.status(500).json({ success: false, error: "Model not initialized" });
      }

      const pendingMaterial = await this.PendingMaterial.findByPk(id, { transaction });

      if (!pendingMaterial) {
        await transaction.rollback();
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      if (pendingMaterial.is_completed) {
        await transaction.rollback();
        return res.status(400).json({ success: false, error: "Pending material is already completed" });
      }

      await pendingMaterial.update({ is_completed: true }, { transaction });

      const jobData = {
        ...body,
        job_type: "JOB_SERVICE",
        job_no: pendingMaterial.job_no,
        item_no: pendingMaterial.item_no,
        item_description: pendingMaterial.description
          ? `${pendingMaterial.description} - ${pendingMaterial.size}`
          : pendingMaterial.size,
        qty: pendingMaterial.qty,
        moc: pendingMaterial.moc,
        created_by: body.created_by || pendingMaterial.created_by,
      };

      const job = await (dbModels as any).Job.create(jobData, { transaction });

      await transaction.commit();

      return res.json({
        success: true,
        message: "Pending material completed and Job created successfully",
        data: { pendingMaterial, job },
      });
    } catch (err: any) {
      await transaction.rollback();
      console.error("Complete and Create Job Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ------------------------
  // ✅ SEND MAIL API (Your required format)
  // ------------------------
  public sendMail = async (req: Request, res: Response) => {
    try {
      // Validate the request body
      const schema = Yup.object({
        job_no: Yup.number().required("job_no is required"),
        followup_images: Yup.array().of(Yup.mixed().required("Image is required")).required(),
        followup_dates: Yup.array().of(Yup.string().required("Date is required")).optional(),
        cc: Yup.array().of(Yup.string().email()).optional(),
        subject: Yup.string().optional(),
      });

      const body = await schema.validate(req.body, { abortEarly: false, stripUnknown: true });

      if (!this.PendingMaterial) {
        return res.status(500).json({ success: false, error: "PendingMaterial model not initialized" });
      }

      // Fetch data based on the job number
      const where: any = { job_no: body.job_no, is_completed: false };
      const rows = await this.PendingMaterial.findAll({ where, order: [["created_at", "DESC"]] });

      if (!rows.length) {
        return res.status(404).json({ success: false, error: "No pending material found for the given job number" });
      }

      // Upload images to S3
      const uploadedFiles = await this.saveFilesToS3(req.files as Express.Multer.File[] | undefined);

      // Generate signed URLs for the uploaded images
      const signedUrls = await Promise.all(
        uploadedFiles.map(async (file) => {
          const url = await this.getSignedUrlForKey(file.path);
          return { ...file, signedUrl: url };
        })
      );

      // If followup_dates are not provided, extract them from the image filenames
      const followupDates = body.followup_dates || signedUrls.map((file) => this.extractDateFromImage(file.name));

      // Generate the HTML content for the email
      const followupBlocksHtml = signedUrls.length
        ? signedUrls
            .map((file, idx) => {
              const dateText = followupDates[idx] || "Unknown Date";
              return `
                <div style="margin:10px 0;">
                  <b>Image ${idx + 1}</b> (${dateText})
                  <div style="margin-top:8px;">
                    <img src="${file.signedUrl}" alt="followup-${idx + 1}" style="max-width:220px; border:1px solid #ddd; padding:4px; border-radius:6px;" />
                  </div>
                </div>
              `;
            })
            .join("")
        : `<div style="color:#444;">No follow-up images attached.</div>`;

      // Prepare the email details
      const subject = body.subject || "Material Pending from Amar";
      const toList = DEFAULT_TO.join(", ");
      const ccList = (body.cc?.length ? body.cc : []).join(", ");

      // Job details HTML
      const jobDetailsHtml = `
        <div><b>Job No:</b> ${body.job_no}</div>
        <div><b>Status:</b> Material Pending</div>
      `;

      // Construct the email body
      const html = `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.6;">
          <div style="font-weight:700;margin-bottom:14px;">Subject: ${subject}</div>
          <div style="margin-bottom:12px;">Dear Team,</div>
          <div style="margin-bottom:16px;">This is an urgent follow-up regarding pending materials.</div>
          <div style="font-weight:700;margin:18px 0 8px;">Job Details:</div>
          <div style="margin-bottom:12px;">${jobDetailsHtml}</div>
          <div style="font-weight:700;margin:18px 0 8px;">Pending Materials:</div>
          <div style="margin-bottom:14px;">${followupBlocksHtml}</div>
          <div style="margin-top:16px;margin-bottom:10px;">📌 <b>Multiple follow-ups already shared</b></div>
          <div style="margin-top:18px;">
            ⚠️ <b>Important:</b><br/>If pending material is not dispatched immediately, we will not be able to complete the job on time.
          </div>
          <div style="margin-top:24px;">
            Regards,<br/>Fine Engineering Team
          </div>
        </div>
      `;

      // Send the email
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: toList,
        cc: ccList || undefined,
        subject,
        html,
      });

      return res.json({
        success: true,
        message: "Email sent successfully",
        data: {
          messageId: info.messageId,
          sentTo: DEFAULT_TO,
          uploadedImages: uploadedFiles.map((file) => ({ key: file.path, name: file.name })),
          count: rows.length,
        },
      });
    } catch (err: any) {
      console.error("sendMail PendingMaterial Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // Helper function to extract dates from the image filenames (e.g., "image_2026-01-01.jpg")
  private extractDateFromImage(filename: string): string | null {
    const match = filename.match(/(\d{4}-\d{2}-\d{2})/); // Matches date format YYYY-MM-DD
    return match ? match[0] : null;
  }
}