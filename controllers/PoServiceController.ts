import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";

export default class PoServiceController {
  private get PoService() {
    return dbModels.PoService;
  }

  // -------------------------
  // CREATE
  // POST /api/v1/po-services
  // -------------------------
  public create = async (req: Request, res: Response) => {
    const createSchema = Yup.object({
      jo_category: Yup.string().nullable(),
      po_no: Yup.number().nullable(),
      po_date: Yup.date().nullable(),
      pn_no: Yup.number().nullable(),
      description: Yup.string().nullable(),
      po_qnty: Yup.number().nullable(),
      job_no: Yup.number().nullable(),
      created_by: Yup.string().uuid().nullable(),
    });

    try {
      const body = await createSchema.validate(req.body, { abortEarly: false });

      if (!this.PoService) {
        return res.status(500).json({
          success: false,
          error: "PoService model not initialized",
        });
      }

      const poService = await this.PoService.create(body);

      return res.status(201).json({
        success: true,
        data: poService,
        message: "PO Service created successfully",
      });
    } catch (err: any) {
      console.error("Create PoService Error:", err);
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
  // GET /api/v1/po-services?page=1&limit=20&q=...
  // -------------------------
  public list = async (req: Request, res: Response) => {
    try {
      if (!this.PoService) {
        return res.status(500).json({
          success: false,
          error: "PoService model not initialized",
        });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
      );
      const offset = (page - 1) * limit;
      const q = String(req.query.q ?? "").trim();

      const where: any = {};

      if (q) {
        const orConditions: any[] = [
          { description: { [Op.iLike]: `%${q}%` } },
          { jo_category: { [Op.iLike]: `%${q}%` } },
        ];

        // If q is a number, search numeric fields
        if (!isNaN(Number(q))) {
          const numQ = Number(q);
          orConditions.push({ po_no: numQ });
          orConditions.push({ pn_no: numQ });
          orConditions.push({ job_no: numQ });
        }

        where[Op.or] = orConditions;
      }

      const { rows, count } = await this.PoService.findAndCountAll({
        where,
        limit,
        offset,
        order: [["created_at", "DESC"]],
        include: [
          {
            model: dbModels.Category,
            as: "category",
            required: false,
          },
        ],
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
      console.error("List PoService Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // GET ONE
  // GET /api/v1/po-services/:id
  // -------------------------
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.PoService) {
        return res.status(500).json({
          success: false,
          error: "PoService model not initialized",
        });
      }

      const poService = await this.PoService.findByPk(id, {
        include: [
          {
            model: dbModels.Category,
            as: "category",
            required: false,
          },
        ],
      });

      if (!poService) {
        return res.status(404).json({
          success: false,
          error: "PO Service not found",
        });
      }

      return res.json({ success: true, data: poService });
    } catch (err: any) {
      console.error("Get PoService Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };

  // -------------------------
  // UPDATE
  // PUT /api/v1/po-services/:id
  // -------------------------
  public update = async (req: Request, res: Response) => {
    const updateSchema = Yup.object({
      jo_category: Yup.string().nullable(),
      po_no: Yup.number().nullable(),
      po_date: Yup.date().nullable(),
      pn_no: Yup.number().nullable(),
      description: Yup.string().nullable(),
      po_qnty: Yup.number().nullable(),
      job_no: Yup.number().nullable(),
      updated_by: Yup.string().uuid().nullable(),
    });

    try {
      const { id } = req.params;
      const body = await updateSchema.validate(req.body, { stripUnknown: true });

      if (!this.PoService) {
        return res.status(500).json({
          success: false,
          error: "PoService model not initialized",
        });
      }

      const poService = await this.PoService.findByPk(id);

      if (!poService) {
        return res.status(404).json({
          success: false,
          error: "PO Service not found",
        });
      }

      await poService.update(body);

      return res.json({
        success: true,
        data: poService,
        message: "PO Service updated successfully",
      });
    } catch (err: any) {
      console.error("Update PoService Error:", err);
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
  // DELETE /api/v1/po-services/:id
  // -------------------------
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!this.PoService) {
        return res.status(500).json({
          success: false,
          error: "PoService model not initialized",
        });
      }

      const poService = await this.PoService.findByPk(id);
      if (!poService) {
        return res.status(404).json({
          success: false,
          error: "PO Service not found",
        });
      }

      await poService.destroy();

      return res.json({
        success: true,
        message: "PO Service deleted successfully",
      });
    } catch (err: any) {
      console.error("Delete PoService Error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  };
}