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
  private escapeHtml(v: any) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ✅ Upload followup images to S3 folder: upload-product/
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

      // compress images only
      if (file.mimetype?.startsWith("image/")) {
        await sharp(file.buffer)
          .resize({ width: 800, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(localPath);
      } else {
        fs.writeFileSync(localPath, file.buffer);
      }

      // upload to S3
      const key = `upload-product/${fileName}`;

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

      attachments.push({
        path: key,
        name: file.originalname,
        type: file.mimetype,
      });

      // delete local file
      try {
        fs.unlinkSync(localPath);
      } catch {}
    }

    return attachments;
  }

  // ✅ Signed URL for PRIVATE s3 images
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
      const schema = Yup.object({
        job_no: Yup.number().optional(),
        ids: Yup.array().of(Yup.string().uuid()).optional(),

        job_category: Yup.string().nullable(),
        item_description: Yup.string().nullable(),

        subject: Yup.string().optional(),
        onlyPending: Yup.boolean().default(true),
        cc: Yup.array().of(Yup.string().email()).optional(),
        followup_dates: Yup.array().of(Yup.string()).optional(),
      }).test("job_no-or-ids", "Provide either job_no or ids", (val) => {
        if (!val) return false;
        if (val.job_no) return true;
        if (Array.isArray(val.ids) && val.ids.length > 0) return true;
        return false;
      });

      // Normalize multipart body
      const rawBody: any = { ...req.body };

      if (rawBody.ids && !Array.isArray(rawBody.ids)) rawBody.ids = [rawBody.ids];
      if (rawBody.cc && !Array.isArray(rawBody.cc)) rawBody.cc = [rawBody.cc];
      if (rawBody.followup_dates && !Array.isArray(rawBody.followup_dates)) {
        rawBody.followup_dates = [rawBody.followup_dates];
      }

      if (typeof rawBody.onlyPending === "string") rawBody.onlyPending = rawBody.onlyPending === "true";
      if (typeof rawBody.job_no === "string") {
        const n = Number(rawBody.job_no);
        rawBody.job_no = Number.isFinite(n) ? n : undefined;
      }

      const body = await schema.validate(rawBody, { abortEarly: false, stripUnknown: true });

      if (!this.PendingMaterial) {
        return res.status(500).json({ success: false, error: "PendingMaterial model not initialized" });
      }

      // Fetch data
      const where: any = {};
      if (body.onlyPending !== false) where.is_completed = false;
      if (body.job_no) where.job_no = body.job_no;
      if (body.ids?.length) where.id = body.ids;

      const rows = await this.PendingMaterial.findAll({
        where,
        order: [["created_at", "DESC"]],
      });

      if (!rows.length) {
        return res.status(404).json({ success: false, error: "No pending material found for given filter" });
      }

      // Upload images
      const uploaded = await this.saveFilesToS3(req.files as Express.Multer.File[] | undefined);

      // Signed URLs
      const signed = await Promise.all(
        uploaded.map(async (u) => {
          const url = await this.getSignedUrlForKey(u.path);
          return { ...u, signedUrl: url };
        })
      );

      // Map images + dates
      const dates = body.followup_dates || [];
      const followupBlocksHtml =
        signed.length > 0
          ? signed
              .map((f: any, idx: number) => {
                const dateText = this.escapeHtml(dates[idx] || "");
                return `
                  <div style="margin:10px 0;">
                    <b>Image ${idx + 1}</b>${dateText ? ` (${dateText})` : ""}
                    <div style="margin-top:8px;">
                      <img src="${this.escapeHtml(f.signedUrl)}"
                           alt="followup-${idx + 1}"
                           style="max-width:220px;border:1px solid #ddd;padding:4px;border-radius:6px;" />
                    </div>
                  </div>
                `;
              })
              .join("")
          : `<div style="color:#444;">No follow-up images attached.</div>`;

      // Fixed recipients
      const toList = DEFAULT_TO.join(", ");
      const ccList = (body.cc?.length ? body.cc : []).join(", ");

      // Subject fixed format
      const subject = body.subject || "Subject :- Material pending from Amar";

      // ✅ THIS LINE FIXED IN CODE (AS YOU SAID)
      const fixedLine = "This is an urgent and final follow-up regarding the pending job work material";

      const jobDetailsHtml = `
        <div><b>Job No:</b> ${this.escapeHtml(body.job_no ?? "-")}</div>
        <div><b>Job Category:</b> ${this.escapeHtml(body.job_category ?? "-")}</div>
        <div><b>Item Description:</b> ${this.escapeHtml(body.item_description ?? "-")}</div>
        <div><b>Status:</b> Material Pending</div>
      `;

      const pendingMaterialTableHtml = `
        <table style="border-collapse: collapse; width:100%; font-size: 13px;">
          <thead>
            <tr>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Sr</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Job</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Item No</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Item Description</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Size</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">MOC</th>
              <th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r: any, idx: number) => `
                <tr>
                  <td style="border:1px solid #ddd;padding:8px;">${idx + 1}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${this.escapeHtml(r.job_no)}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${this.escapeHtml(r.item_no)}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${this.escapeHtml(r.description)}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${this.escapeHtml(r.size)}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${this.escapeHtml(r.moc)}</td>
                  <td style="border:1px solid #ddd;padding:8px;text-align:right;">${this.escapeHtml(r.qty)}</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      `;

      const html = `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.6;">
          <div style="font-weight:700;margin-bottom:14px;">Subject :- Material pending from Amar</div>

          <div style="margin-bottom:12px;">Dear Team Amar,</div>

          <div style="margin-bottom:12px;">${fixedLine}</div>

          <div style="margin-bottom:16px;">
            Despite repeated reminders the material is still pending due to which production is stopped and dispatch commitments are failing causing unnecessary delays
          </div>

          <div style="font-weight:700;margin:18px 0 8px;">Job Details:</div>
          <div style="margin-bottom:12px;">${jobDetailsHtml}</div>

          <div style="font-weight:700;margin:18px 0 8px;">Pending Material:</div>
          <div style="margin-bottom:14px;">${pendingMaterialTableHtml}</div>

          <div style="margin-top:16px;margin-bottom:10px;">📌 <b>multiple follow-ups already shared</b></div>
          <div style="margin: 10px 0 16px;">${followupBlocksHtml}</div>

          <div style="margin-top:18px;">
            ⚠️ <b>Important:</b><br/>
            If pending material is not dispatched immediately, we will not be able to complete the job within the planned timeline and the delay will be recorded as material pending from your side.
          </div>

          <div style="margin-top:24px;">
            Regards,<br/>
            <b>[ Pravin Durgavale ]</b><br/>
            Fine Engineering<br/>
            91+8879634270
          </div>
        </div>
      `;

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
          uploadedImages: uploaded.map((u) => ({ key: u.path, name: u.name })),
          count: rows.length,
        },
      });
    } catch (err: any) {
      console.error("sendMail PendingMaterial Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: err?.message || "Internal server error" });
    }
  };
}