import { Request, Response } from "express";
import { Market } from "../models/market";
import { createMarketSchema, updateMarketSchema } from "../controllers/Validations";
import { Op } from "sequelize";

export const createMarket = async (req: Request, res: Response) => {
    try {
        const body = await createMarketSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });
        const row = await Market.create(body);
        return res.status(200).json({ success: true, data: row });
    } catch (err: any) {
        if (err.name === "ValidationError") {
            return res.status(400).json({ success: false, errors: err.errors });
        }
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to create market record" });
    }
};

export const listMarkets = async (req: Request, res: Response) => {
    try {
        const {
            q,                 // free-text search
            status,
            location,
            page = "1",
            limit = "10",
            sort = "created_at",
            order = "DESC",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit as string, 10) || 10, 1), 100);

        const where: any = {};
        if (status) where.status = status;
        if (location) where.location = location;

        if (q) {
            where[Op.or] = [
                { company_name: { [Op.iLike]: `%${q}%` } },
                { customer_name: { [Op.iLike]: `%${q}%` } },
                { mobile: { [Op.iLike]: `%${q}%` } },
                { email_id: { [Op.iLike]: `%${q}%` } },
                { location: { [Op.iLike]: `%${q}%` } },
                { review: { [Op.iLike]: `%${q}%` } },
                { assign_to_senior: { [Op.iLike]: `%${q}%` } },
            ];
        }

        const { rows, count } = await Market.findAndCountAll({
            where,
            limit: pageSize,
            offset: (pageNum - 1) * pageSize,
            order: [[sort, order.toUpperCase() === "ASC" ? "ASC" : "DESC"]],
        });

        return res.json({
            success: true,
            data: rows,
            meta: {
                page: pageNum,
                limit: pageSize,
                total: count,
                totalPages: Math.ceil(count / pageSize),
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to list market records" });
    }
};

export const getMarketById = async (req: Request, res: Response) => {
    try {
        const row = await Market.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });
        return res.json({ success: true, data: row });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to fetch market record" });
    }
};

// Get all Converted markets
export const listConvertedMarkets = async (req: Request, res: Response) => {
    try {
        const {
            q,
            location,
            page = "1",
            limit = "10",
            sort = "created_at",
            order = "DESC",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

        const where: any = { status: "Converted" };
        if (location) where.location = location;

        if (q) {
            where[Op.or] = [
                { company_name: { [Op.iLike]: `%${q}%` } },
                { customer_name: { [Op.iLike]: `%${q}%` } },
                { mobile: { [Op.iLike]: `%${q}%` } },
                { email_id: { [Op.iLike]: `%${q}%` } },
                { location: { [Op.iLike]: `%${q}%` } },
                { review: { [Op.iLike]: `%${q}%` } },
                { assign_to_senior: { [Op.iLike]: `%${q}%` } },
            ];
        }

        const { rows, count } = await Market.findAndCountAll({
            where,
            limit: pageSize,
            offset: (pageNum - 1) * pageSize,
            order: [[sort, order.toUpperCase() === "ASC" ? "ASC" : "DESC"]],
        });

        return res.json({
            success: true,
            data: rows,
            meta: {
                page: pageNum,
                limit: pageSize,
                total: count,
                totalPages: Math.ceil(count / pageSize),
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to list converted market records" });
    }
};

// Get all Pending markets
export const listPendingMarkets = async (req: Request, res: Response) => {
    try {
        const {
            q,
            location,
            page = "1",
            limit = "10",
            sort = "created_at",
            order = "DESC",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const pageSize = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

        const where: any = { status: "pending" };
        if (location) where.location = location;

        if (q) {
            where[Op.or] = [
                { company_name: { [Op.iLike]: `%${q}%` } },
                { customer_name: { [Op.iLike]: `%${q}%` } },
                { mobile: { [Op.iLike]: `%${q}%` } },
                { email_id: { [Op.iLike]: `%${q}%` } },
                { location: { [Op.iLike]: `%${q}%` } },
                { review: { [Op.iLike]: `%${q}%` } },
                { assign_to_senior: { [Op.iLike]: `%${q}%` } },
            ];
        }

        const { rows, count } = await Market.findAndCountAll({
            where,
            limit: pageSize,
            offset: (pageNum - 1) * pageSize,
            order: [[sort, order.toUpperCase() === "ASC" ? "ASC" : "DESC"]],
        });

        return res.json({
            success: true,
            data: rows,
            meta: {
                page: pageNum,
                limit: pageSize,
                total: count,
                totalPages: Math.ceil(count / pageSize),
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to list pending market records" });
    }
};


export const updateMarket = async (req: Request, res: Response) => {
    try {
        const body = await updateMarketSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });

        const row = await Market.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });

        await row.update(body);
        return res.json({ success: true, data: row });
    } catch (err: any) {
        if (err.name === "ValidationError") {
            return res.status(400).json({ success: false, errors: err.errors });
        }
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to update market record" });
    }
};

export const deleteMarket = async (req: Request, res: Response) => {
    try {
        const row = await Market.findByPk(req.params.id);
        if (!row) return res.status(404).json({ success: false, error: "Not found" });
        await row.destroy(); // hard delete (no deleted flag in schema)
        return res.json({ success: true, msg: "Deleted" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: "Failed to delete market record" });
    }
};
