// controllers/AMCOfferController.ts
import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models"; // ⭐ IMPORT FROM MODELS INDEX

export default class AMCOfferController {
  // Get the AMCOffer model from dbModels
  private get AMCOffer() {
    return dbModels.AMCOffer;
  }

  // -------------------------
  // CREATE
  // POST /api/v1/amc-offers-create
  // -------------------------
  public create = async (req: Request, res: Response) => {
    const createSchema = Yup.object({
      title: Yup.string().trim().max(255).required("title is required"),
      description: Yup.string().nullable(),
    });

    try {
      await createSchema.validate(req.body, { abortEarly: false });

      const { title, description } = req.body as {
        title: string;
        description?: string | null;
      };

      // Check if model is available
      if (!this.AMCOffer) {
        return res.status(500).json({ 
          success: false, 
          error: "AMCOffer model not initialized" 
        });
      }

      const offer = await this.AMCOffer.create({
        title: title.trim(),
        description: description ?? null,
      });

      return res.status(201).json({ 
        success: true, 
        data: offer,
        message: "AMC Offer created successfully"
      });
    } catch (err: any) {
      console.error("Create AMC Offer Error:", err);
      
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  };

  // -------------------------
  // LIST
  // GET /api/v1/amc-offers?page=1&limit=20&q=...
  // -------------------------
  public list = async (req: Request, res: Response) => {
    try {
      // Check if model is available
      if (!this.AMCOffer) {
        return res.status(500).json({ 
          success: false, 
          error: "AMCOffer model not initialized" 
        });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
      const offset = (page - 1) * limit;

      const q = String(req.query.q ?? "").trim();

      const where = q
        ? {
            [Op.or]: [
              { title: { [Op.iLike]: `%${q}%` } },
              { description: { [Op.iLike]: `%${q}%` } },
            ],
          }
        : undefined;

      const { rows, count } = await this.AMCOffer.findAndCountAll({
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
      console.error("List AMC Offers Error:", err);
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  };

  // -------------------------
  // EDIT (UPDATE)
  // PUT /api/v1/amc-offers/:id
  // -------------------------
  public update = async (req: Request, res: Response) => {
    const updateSchema = Yup.object({
      title: Yup.string().trim().max(255).optional(),
      description: Yup.string().nullable().optional(),
    });

    try {
      await updateSchema.validate(req.body, { abortEarly: false });

      const { id } = req.params;

      // Check if model is available
      if (!this.AMCOffer) {
        return res.status(500).json({ 
          success: false, 
          error: "AMCOffer model not initialized" 
        });
      }

      const offer = await this.AMCOffer.findByPk(id);
      if (!offer) {
        return res.status(404).json({ 
          success: false, 
          error: "AMC offer not found" 
        });
      }

      const { title, description } = req.body as {
        title?: string;
        description?: string | null;
      };

      if (typeof title !== "undefined") offer.title = title.trim();
      if (typeof description !== "undefined") offer.description = description ?? null;

      // manually update updated_at
      offer.updated_at = new Date();

      await offer.save();

      return res.json({ 
        success: true, 
        data: offer,
        message: "AMC Offer updated successfully"
      });
    } catch (err: any) {
      console.error("Update AMC Offer Error:", err);
      
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  };
}