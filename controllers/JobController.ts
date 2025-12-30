import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";
import { JobType } from "../models/Job"; // Import the type

export default class JobController {
  private get Job() {
    return dbModels.Job;
  }

  // -------------------------
  // CREATE
  // POST /api/v1/jobs
  // -------------------------
  public create = async (req: Request, res: Response) => {
    // Define the static list of Kanban categories.
    // TODO: Update this list with your actual static Kanban categories.
    const KANBAN_CATEGORIES = ['RAW_MATERIAL', 'IN_PROGRESS', 'FINISHED_GOODS'];

    const createSchema = Yup.object({
      job_type: Yup.string()
        .oneOf(['JOB_SERVICE', 'TSO_SERVICE', 'KANBAN'] as JobType[])
        .required("job_type is required"),
      job_category: Yup.string().when('job_type', {
        is: 'KANBAN',
        then: (schema) => schema
          .oneOf(KANBAN_CATEGORIES, `For KANBAN, job_category must be one of: ${KANBAN_CATEGORIES.join(', ')}`)
          .required("job_category is required for KANBAN jobs"),
        otherwise: (schema) => schema.nullable(),
      }),
      job_no: Yup.number().when('job_type', {
        is: 'JOB_SERVICE',
        then: (schema) => schema.required("job_no is required for JOB_SERVICE jobs").typeError("job_no must be a number"),
        otherwise: (schema) => schema.nullable(),
      }),
      serial_no: Yup.number().default(0),
      job_order_date: Yup.date().nullable(),
      mtl_rcd_date: Yup.date().nullable(),
      mtl_challan_no: Yup.number().default(0),
      item_description: Yup.string().nullable(),
      item_no: Yup.number().default(0),
      qty: Yup.number().default(0),
      moc: Yup.string().required("moc is required"),
      remark: Yup.string().nullable(),
      bin_location: Yup.string().nullable(),
      material_remark: Yup.string().nullable(),
      created_by: Yup.string().uuid().nullable(),
    });

    try {
      const body = await createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });

      if (!this.Job) {
        return res.status(500).json({
          success: false,
          error: "Job model not initialized",
        });
      }

      const job = await this.Job.create(body);

      return res.status(201).json({
        success: true,
        data: job,
        message: "Job created successfully",
      });
    } catch (err: any) {
      console.error("Create Job Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // LIST
  // GET /api/v1/jobs?page=1&limit=20&q=...&job_type=...
  // -------------------------
  public list = async (req: Request, res: Response) => {
    try {
      if (!this.Job) {
        return res.status(500).json({
          success: false,
          error: "Job model not initialized",
        });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
      );
      const offset = (page - 1) * limit;
      const q = String(req.query.q ?? "").trim();
      const jobType = req.query.job_type as JobType | undefined;

      const where: any = {};

      if (jobType && ['JOB_SERVICE', 'TSO_SERVICE', 'KANBAN'].includes(jobType)) {
        where.job_type = jobType;
      }

      if (q) {
        where[Op.or] = [
          { job_category: { [Op.iLike]: `%${q}%` } },
          { item_description: { [Op.iLike]: `%${q}%` } },
          { moc: { [Op.iLike]: `%${q}%` } },
          { remark: { [Op.iLike]: `%${q}%` } },
        ];
      }

      const { rows, count } = await this.Job.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit,
        offset,
      });

      return res.json({
        success: true,
        data: rows,
        meta: {
          page,
          limit,
          total: count,
          totalPages: Math.max(1, Math.ceil(count / limit)),
        },
      });
    } catch (err: any) {
      console.error("List Job Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // GET ONE
  // GET /api/v1/jobs/:id
  // -------------------------
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.Job) {
        return res.status(500).json({
          success: false,
          error: "Job model not initialized",
        });
      }

      const job = await this.Job.findByPk(id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      return res.json({ success: true, data: job });
    } catch (err: any) {
      console.error("Get Job Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // UPDATE
  // PUT /api/v1/jobs/:id
  // -------------------------
  public update = async (req: Request, res: Response) => {
    // Define the static list of Kanban categories.
    // TODO: Update this list with your actual static Kanban categories.
    const KANBAN_CATEGORIES = ['RAW_MATERIAL', 'IN_PROGRESS', 'FINISHED_GOODS'];

    // In update, all fields are optional
    const updateSchema = Yup.object({
      job_category: Yup.string().nullable(),
      job_no: Yup.number().nullable(),
      serial_no: Yup.number(),
      job_order_date: Yup.date().nullable(),
      mtl_rcd_date: Yup.date().nullable(),
      mtl_challan_no: Yup.number(),
      item_description: Yup.string().nullable(),
      item_no: Yup.number(),
      qty: Yup.number(),
      moc: Yup.string(),
      remark: Yup.string(),
      bin_location: Yup.string(),
      material_remark: Yup.string(),
      updated_by: Yup.string().uuid().nullable(),
    });

    try {
      const body = await updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      const { id } = req.params;

      if (!this.Job) {
        return res.status(500).json({
          success: false,
          error: "Job model not initialized",
        });
      }

      const job = await this.Job.findByPk(id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }
      
      // Conditional validation for update
      if (job.job_type === 'JOB_SERVICE' && 'job_no' in body && body.job_no === null) {
        return res.status(400).json({ success: false, error: "job_no cannot be null for JOB_SERVICE" });
      }
      if (job.job_type === 'KANBAN' && 'job_category' in body) {
        if (!body.job_category) {
          return res.status(400).json({ success: false, error: "job_category is required for KANBAN jobs and cannot be set to null." });
        }
        if (!KANBAN_CATEGORIES.includes(body.job_category)) {
          return res.status(400).json({ success: false, error: `Invalid Kanban category. Must be one of: ${KANBAN_CATEGORIES.join(', ')}` });
        }
      }

      await job.update(body);

      return res.json({
        success: true,
        data: job,
        message: "Job updated successfully",
      });
    } catch (err: any) {
      console.error("Update Job Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // DELETE
  // DELETE /api/v1/jobs/:id
  // -------------------------
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.Job) {
        return res.status(500).json({
          success: false,
          error: "Job model not initialized",
        });
      }

      const job = await this.Job.findByPk(id);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
        });
      }

      await job.destroy();

      return res.json({
        success: true,
        message: "Job deleted successfully",
      });
    } catch (err: any) {
      console.error("Delete Job Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };
}