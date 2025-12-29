// controllers/DepartmentController.ts
import { Request, Response } from "express";
import { Sequelize, QueryTypes } from "sequelize";

export default class DepartmentController {
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    // CREATE: POST /api/departments
    public createDepartment = async (req: Request, res: Response) => {
        try {
            const { department_name, created_by } = req.body;

            if (!department_name || typeof department_name !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "department_name is required",
                });
            }

            const [rows] = await this.sequelize.query(
                `
        INSERT INTO public.department (department_name, created_by)
        VALUES (:department_name, :created_by)
        RETURNING *;
        `,
                {
                    replacements: {
                        department_name: department_name.trim(),
                        created_by: created_by ?? null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(201).json({
                success: true,
                data: rows,
            });
        } catch (err: any) {
            // Handle unique constraint error for department_name
            if (err?.original?.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "Department name already exists",
                });
            }

            console.error("createDepartment error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };

    // LIST: GET /api/departments?search=&page=&limit=
    public getDepartments = async (req: Request, res: Response) => {
        try {
            const search = (req.query.search as string) || "";
            const page = parseInt((req.query.page as string) || "1", 10);
            const limit = parseInt((req.query.limit as string) || "20", 10);
            const offset = (page - 1) * limit;

            const whereClause = search
                ? `WHERE d.department_name ILIKE :search`
                : "";

            // Total count
            const countRows: any[] = await this.sequelize.query(
                `
        SELECT COUNT(*)::int AS total
        FROM public.department d
        ${whereClause};
        `,
                {
                    replacements: {
                        search: `%${search}%`,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            const total = countRows[0]?.total ?? 0;

            // Data
            const departments: any[] = await this.sequelize.query(
                `
        SELECT
          d.*,
          su1.name AS created_by_name,
          su2.name AS updated_by_name
        FROM public.department d
        LEFT JOIN public.system_users su1 ON su1.id = d.created_by
        LEFT JOIN public.system_users su2 ON su2.id = d.updated_by
        ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT :limit OFFSET :offset;
        `,
                {
                    replacements: {
                        search: `%${search}%`,
                        limit,
                        offset,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(200).json({
                success: true,
                data: departments,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            });
        } catch (err) {
            console.error("getDepartments error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };

    // GET BY ID: GET /api/departments/:id
    public getDepartmentById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const rows: any[] = await this.sequelize.query(
                `
        SELECT
          d.*,
          su1.name AS created_by_name,
          su2.name AS updated_by_name
        FROM public.department d
        LEFT JOIN public.system_users su1 ON su1.id = d.created_by
        LEFT JOIN public.system_users su2 ON su2.id = d.updated_by
        WHERE d.id = :id
        LIMIT 1;
        `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Department not found",
                });
            }

            return res.status(200).json({
                success: true,
                data: rows[0],
            });
        } catch (err) {
            console.error("getDepartmentById error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };

    // UPDATE: PUT /api/departments/:id
    public updateDepartment = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { department_name, updated_by } = req.body;

            // First check if exists
            const existing: any[] = await this.sequelize.query(
                `
        SELECT *
        FROM public.department
        WHERE id = :id
        LIMIT 1;
        `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (existing.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Department not found",
                });
            }

            const [rows] = await this.sequelize.query(
                `
        UPDATE public.department
        SET
          department_name = COALESCE(:department_name, department_name),
          updated_by = COALESCE(:updated_by, updated_by)
        WHERE id = :id
        RETURNING *;
        `,
                {
                    replacements: {
                        id,
                        department_name: department_name ?? null,
                        updated_by: updated_by ?? null,
                    },
                    type: QueryTypes.SELECT,
                }
            );

            return res.status(200).json({
                success: true,
                data: rows,
            });
        } catch (err: any) {
            if (err?.original?.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "Department name already exists",
                });
            }

            console.error("updateDepartment error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };

    // DELETE: DELETE /api/departments/:id
    public deleteDepartment = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const deleted: any[] = await this.sequelize.query(
                `
        DELETE FROM public.department
        WHERE id = :id
        RETURNING *;
        `,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (deleted.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Department not found",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Department deleted successfully",
                data: deleted[0],
            });
        } catch (err) {
            console.error("deleteDepartment error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    };
}
