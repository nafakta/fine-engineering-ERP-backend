// src/controllers/RoleController.ts
import { Request, Response } from "express";
import { Sequelize, QueryTypes } from "sequelize";

export default class RoleController {
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    // ────────────────────────────────────────────────
    // CREATE ROLE
    // POST /roles
    // ────────────────────────────────────────────────
    public createRole = async (req: Request, res: Response) => {
        try {
            const { name, level } = req.body;

            if (!name || typeof name !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "name is required and must be a string",
                });
            }

            if (level === undefined || isNaN(Number(level))) {
                return res.status(400).json({
                    success: false,
                    message: "level is required and must be a number",
                });
            }

            const lvl = Number(level);

            const [row]: any[] = await this.sequelize.query(
                `
                INSERT INTO public.roles ("name", "level")
                VALUES (:name, :level)
                RETURNING *;
                `,
                {
                    replacements: { name: name.trim(), level: lvl },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(201).json({ success: true, data: row });
        } catch (err) {
            console.error("createRole error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    };

    // ────────────────────────────────────────────────
    // GET ROLE LIST (SEARCH + PAGINATION)
    // GET /roles?search=&page=&limit=
    // ────────────────────────────────────────────────
    public getRoles = async (req: Request, res: Response) => {
        try {
            const search = (req.query.search as string) ?? "";
            const page = Number(req.query.page ?? 1);
            const limit = Number(req.query.limit ?? 20);
            const offset = (page - 1) * limit;

            const whereClause = search ? `WHERE r."name" ILIKE :search` : "";

            // Total count
            const countRows: any[] = await this.sequelize.query(
                `
                SELECT COUNT(*)::int AS total
                FROM public.roles r
                ${whereClause};
                `,
                {
                    replacements: { search: `%${search}%` },
                    type: QueryTypes.SELECT,
                }
            );

            const total = countRows[0]?.total ?? 0;

            // Data query
            const roles = await this.sequelize.query(
                `
                SELECT r.*
                FROM public.roles r
                ${whereClause}
                ORDER BY r."level" ASC, r."name" ASC
                LIMIT :limit OFFSET :offset;
                `,
                {
                    replacements: { search: `%${search}%`, limit, offset },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(200).json({
                success: true,
                data: roles,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (err) {
            console.error("getRoles error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    };

    // ────────────────────────────────────────────────
    // GET ROLE BY ID
    // GET /roles/:id
    // ────────────────────────────────────────────────
    public getRoleById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const rows = await this.sequelize.query(
                `
                SELECT *
                FROM public.roles
                WHERE id = :id
                LIMIT 1;
                `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) {
                return res.status(404).json({
                    success: false,
                    message: "Role not found",
                });
            }

            return res.status(200).json({ success: true, data: rows[0] });
        } catch (err) {
            console.error("getRoleById error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    };

    // ────────────────────────────────────────────────
    // UPDATE ROLE
    // PUT /roles/:id
    // ────────────────────────────────────────────────
    public updateRole = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { name, level } = req.body;

            // Check existence
            const existing = await this.sequelize.query(
                `
                SELECT * FROM public.roles WHERE id = :id LIMIT 1;
                `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!existing.length) {
                return res.status(404).json({
                    success: false,
                    message: "Role not found",
                });
            }

            let parsedLevel: number | null = null;
            if (level !== undefined) {
                if (isNaN(Number(level))) {
                    return res.status(400).json({
                        success: false,
                        message: "level must be a number",
                    });
                }
                parsedLevel = Number(level);
            }

            const [row]: any[] = await this.sequelize.query(
                `
                UPDATE public.roles
                SET
                    "name"  = COALESCE(:name, "name"),
                    "level" = COALESCE(:level, "level")
                WHERE id = :id
                RETURNING *;
                `,
                {
                    replacements: {
                        id,
                        name: name ? String(name).trim() : null,
                        level: parsedLevel,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(200).json({ success: true, data: row });
        } catch (err) {
            console.error("updateRole error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    };

    // ────────────────────────────────────────────────
    // DELETE ROLE
    // DELETE /roles/:id
    // ────────────────────────────────────────────────
    public deleteRole = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const deleted: any[] = await this.sequelize.query(
                `
                DELETE FROM public.roles
                WHERE id = :id
                RETURNING *;
                `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!deleted.length) {
                return res.status(404).json({
                    success: false,
                    message: "Role not found",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Role deleted successfully",
                data: deleted[0],
            });
        } catch (err) {
            console.error("deleteRole error:", err);
            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    };
}
