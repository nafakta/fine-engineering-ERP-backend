import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";

export default class CategoryController {
  // Get the Category model from dbModels
  private get Category() {
    return dbModels.Category;
  }

  // -------------------------
  // CREATE
  // POST /api/v1/categories
  // -------------------------
  public create = async (req: Request, res: Response) => {
    const createSchema = Yup.object({
      job_category: Yup.string().nullable(),
      job_no: Yup.number().default(0),
      description: Yup.string().nullable(),
      material_type: Yup.string().default("No Tax"),
      bar: Yup.string().default("No Tax"),
      tempp: Yup.string().default("none"),
      qty: Yup.number().default(0),
      remark: Yup.string().required("Remark is required"),
      is_urgent: Yup.boolean().default(false),
      created_by: Yup.string().uuid().nullable(),
    });

    try {
      await createSchema.validate(req.body, { abortEarly: false });

      const {
        job_category,
        job_no,
        description,
        material_type,
        bar,
        tempp,
        qty,
        remark,
        is_urgent,
        created_by,
      } = req.body;

      // Check if model is available
      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const category = await this.Category.create({
        job_category,
        job_no: job_no || 0,
        description,
        material_type: material_type || "No Tax",
        bar: bar || "No Tax",
        tempp: tempp || "none",
        qty: qty || 0,
        remark,
        is_urgent: is_urgent ?? false,
        created_by,
      });

      return res.status(201).json({
        success: true,
        data: category,
        message: "Category created successfully",
      });
    } catch (err: any) {
      console.error("Create Category Error:", err);

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
  // GET /api/v1/categories?page=1&limit=20&q=...
  // -------------------------
  public list = async (req: Request, res: Response) => {
    try {
      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
      );
      const offset = (page - 1) * limit;

      const q = String(req.query.q ?? "").trim();

      const where = q
        ? {
            [Op.or]: [
              { job_category: { [Op.iLike]: `%${q}%` } },
              { description: { [Op.iLike]: `%${q}%` } },
              { remark: { [Op.iLike]: `%${q}%` } },
            ],
          }
        : undefined;

      const { rows, count } = await this.Category.findAndCountAll({
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
      console.error("List Category Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // GET ONE
  // GET /api/v1/categories/:id
  // -------------------------
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const category = await this.Category.findByPk(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      return res.json({
        success: true,
        data: category,
      });
    } catch (err: any) {
      console.error("Get Category Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // UPDATE
  // PUT /api/v1/categories/:id
  // -------------------------
  public update = async (req: Request, res: Response) => {
    const updateSchema = Yup.object({
      job_category: Yup.string().nullable(),
      job_no: Yup.number(),
      description: Yup.string().nullable(),
      material_type: Yup.string(),
      bar: Yup.string(),
      tempp: Yup.string(),
      qty: Yup.number(),
      remark: Yup.string(),
      is_urgent: Yup.boolean(),
      updated_by: Yup.string().uuid().nullable(),
    });

    try {
      await updateSchema.validate(req.body, { abortEarly: false });
      const { id } = req.params;

      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const category = await this.Category.findByPk(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      const {
        job_category,
        job_no,
        description,
        material_type,
        bar,
        tempp,
        qty,
        remark,
        is_urgent,
        updated_by,
      } = req.body;

      if (job_category !== undefined) category.job_category = job_category;
      if (job_no !== undefined) category.job_no = job_no;
      if (description !== undefined) category.description = description;
      if (material_type !== undefined) category.material_type = material_type;
      if (bar !== undefined) category.bar = bar;
      if (tempp !== undefined) category.tempp = tempp;
      if (qty !== undefined) category.qty = qty;
      if (remark !== undefined) category.remark = remark;
      if (is_urgent !== undefined) category.is_urgent = is_urgent;
      if (updated_by !== undefined) category.updated_by = updated_by;

      // manually update updated_at
      category.updated_at = new Date();

      await category.save();

      return res.json({
        success: true,
        data: category,
        message: "Category updated successfully",
      });
    } catch (err: any) {
      console.error("Update Category Error:", err);

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
  // DELETE /api/v1/categories/:id
  // -------------------------
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const category = await this.Category.findByPk(id);
      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      await category.destroy();

      return res.json({
        success: true,
        message: "Category deleted successfully",
      });
    } catch (err: any) {
      console.error("Delete Category Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // MARK URGENT
  // POST /api/v1/categories/mark-urgent
  // -------------------------
  public markUrgent = async (req: Request, res: Response) => {
    const schema = Yup.object({
      job_no: Yup.number().required("job_no is required"),
    });

    try {
      await schema.validate(req.body);
      const { job_no } = req.body;

      if (!this.Category) {
        return res.status(500).json({
          success: false,
          error: "Category model not initialized",
        });
      }

      const category = await this.Category.findOne({ where: { job_no } });

      if (!category) {
        return res.status(404).json({
          success: false,
          error: "Category not found",
        });
      }

      category.is_urgent = true;
      await category.save();

      return res.json({
        success: true,
        message: "Category marked as urgent successfully",
        data: category,
      });
    } catch (err: any) {
      console.error("Mark Urgent Category Error:", err);
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
}