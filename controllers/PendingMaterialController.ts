import { Request, Response } from "express";
import * as Yup from "yup";
import dbModels from "../models";

export default class PendingMaterialController {
  private get PendingMaterial() {
    return dbModels.PendingMaterial;
  }

  // CREATE
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
      const body = await createSchema.validate(req.body, { abortEarly: false });
      const pendingMaterial = await this.PendingMaterial.create(body);
      return res.status(201).json({ success: true, data: pendingMaterial });
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // LIST
  public list = async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
      const offset = (page - 1) * limit;

      const { rows, count } = await this.PendingMaterial.findAndCountAll({
        limit,
        offset,
        order: [["created_at", "DESC"]],
      });

      return res.json({
        success: true,
        data: rows,
        meta: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // GET ONE
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }
      return res.json({ success: true, data: pendingMaterial });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // UPDATE
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
      const body = await updateSchema.validate(req.body, { stripUnknown: true });
      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      await pendingMaterial.update(body);
      return res.json({ success: true, data: pendingMaterial });
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // DELETE
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const pendingMaterial = await this.PendingMaterial.findByPk(id);
      if (!pendingMaterial) {
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }
      await pendingMaterial.destroy();
      return res.json({ success: true, message: "Pending material deleted" });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // COMPLETE AND CREATE JOB
  public completeAndCreateJob = async (req: Request, res: Response) => {
    const schema = Yup.object({
      // Fields required for Job creation that aren't in PendingMaterial
      remark: Yup.string().nullable(),
      bin_location: Yup.string().nullable(),
      material_remark: Yup.string().nullable(),
      // Optional overrides
      serial_no: Yup.number().default(0),
      mtl_challan_no: Yup.number().default(0),
      job_order_date: Yup.date().nullable(),
      mtl_rcd_date: Yup.date().nullable(),
      created_by: Yup.string().uuid().nullable(),
    });

    const transaction = await dbModels.sequelize.transaction();

    try {
      const { id } = req.params;
      const body = await schema.validate(req.body, { stripUnknown: true });

      const pendingMaterial = await this.PendingMaterial.findByPk(id, { transaction });

      if (!pendingMaterial) {
        await transaction.rollback();
        return res.status(404).json({ success: false, error: "Pending material not found" });
      }

      if (pendingMaterial.is_completed) {
        await transaction.rollback();
        return res.status(400).json({ success: false, error: "Pending material is already completed" });
      }

      // 1. Mark as completed
      await pendingMaterial.update({ is_completed: true }, { transaction });

      // 2. Create Job
      const jobData = {
        job_type: 'JOB_SERVICE', // Linked via job_no
        job_no: pendingMaterial.job_no,
        item_no: pendingMaterial.item_no,
        item_description: pendingMaterial.description 
          ? `${pendingMaterial.description} - ${pendingMaterial.size}` 
          : pendingMaterial.size,
        qty: pendingMaterial.qty,
        moc: pendingMaterial.moc,
        
        // From request body
        // remark: body.remark,
        // bin_location: body.bin_location,
        // material_remark: body.material_remark,
        // serial_no: body.serial_no,
        // mtl_challan_no: body.mtl_challan_no,
        // job_order_date: body.job_order_date,
        // mtl_rcd_date: body.mtl_rcd_date,
        created_by: body.created_by || pendingMaterial.created_by,
      };

      const job = await dbModels.Job.create(jobData, { transaction });

      await transaction.commit();

      return res.json({
        success: true,
        message: "Pending material completed and Job created successfully",
        data: {
          pendingMaterial,
          job
        }
      });

    } catch (err: any) {
      await transaction.rollback();
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}