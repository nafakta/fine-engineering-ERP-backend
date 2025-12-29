// src/controllers/PermissionController.ts
import { Request, Response } from "express";
import { Sequelize, QueryTypes } from "sequelize";

export default class PermissionController {
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    // GET ALL PERMISSIONS
    public getAllPermissions = async (req: Request, res: Response) => {
        try {
            const permissions = await this.sequelize.query(
                `SELECT * FROM public.permissions ORDER BY name`,
                { type: QueryTypes.SELECT }
            );

            return res.status(200).json({
                success: true,
                data: permissions
            });
        } catch (err) {
            console.error("getAllPermissions error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    // GET PERMISSION BY ID
    public getPermissionById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            const permissions = await this.sequelize.query(
                `SELECT * FROM public.permissions WHERE id = :id LIMIT 1`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT
                }
            );

            if (permissions.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Permission not found"
                });
            }

            return res.status(200).json({
                success: true,
                data: permissions[0]
            });
        } catch (err) {
            console.error("getPermissionById error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    // CREATE PERMISSION
    public createPermission = async (req: Request, res: Response) => {
        try {
            const { name, description } = req.body;

            if (!name || typeof name !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "name is required and must be a string"
                });
            }

            const [row]: any[] = await this.sequelize.query(
                `INSERT INTO public.permissions (name, description) 
                 VALUES (:name, :description) 
                 RETURNING *`,
                {
                    replacements: {
                        name: name.trim(),
                        description: description || null
                    },
                    type: QueryTypes.SELECT
                }
            );

            return res.status(201).json({
                success: true,
                data: row
            });
        } catch (err: any) {
            console.error("createPermission error:", err);

            // Handle unique constraint violation
            if (err?.original?.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "Permission with this name already exists"
                });
            }

            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    // UPDATE PERMISSION
    public updatePermission = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const { name, description } = req.body;

            // Check if permission exists
            const existing = await this.sequelize.query(
                `SELECT * FROM public.permissions WHERE id = :id LIMIT 1`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT
                }
            );

            if (existing.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Permission not found"
                });
            }

            const [row]: any[] = await this.sequelize.query(
                `UPDATE public.permissions 
                 SET name = COALESCE(:name, name),
                     description = COALESCE(:description, description)
                 WHERE id = :id
                 RETURNING *`,
                {
                    replacements: {
                        id,
                        name: name ? name.trim() : null,
                        description: description || null
                    },
                    type: QueryTypes.SELECT
                }
            );

            return res.status(200).json({
                success: true,
                data: row
            });
        } catch (err: any) {
            console.error("updatePermission error:", err);

            // Handle unique constraint violation
            if (err?.original?.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "Permission with this name already exists"
                });
            }

            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };


    // src/controllers/PermissionController.ts
    public getPermissionModules = async (req: Request, res: Response) => {
        try {
            const permissions = await this.sequelize.query(
                `SELECT * FROM public.permissions ORDER BY name`,
                { type: QueryTypes.SELECT }
            );

            // Extract modules from permission names
            const modulesMap = new Map<string, number>();

            permissions.forEach((permission: any) => {
                const permissionName = permission.name;
                let module = 'Other';

                const dotIndex = permissionName.indexOf('.');
                if (dotIndex > 0) {
                    module = permissionName.substring(0, dotIndex);
                    module = module.charAt(0).toUpperCase() + module.slice(1);
                }

                modulesMap.set(module, (modulesMap.get(module) || 0) + 1);
            });

            // Convert to array
            const modules = Array.from(modulesMap.entries()).map(([module_name, permission_count]) => ({
                module_name,
                permission_count
            })).sort((a, b) => a.module_name.localeCompare(b.module_name));

            return res.status(200).json({
                success: true,
                data: modules
            });
        } catch (err) {
            console.error("getPermissionModules error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    // DELETE PERMISSION
    // public deletePermission = async (req: Request, res: Response) => {
    //     try {
    //         const { id } = req.params;

    //         // Check if permission exists
    //         const existing = await this.sequelize.query(
    //             `SELECT * FROM public.permissions WHERE id = :id LIMIT 1`,
    //             {
    //                 replacements: { id },
    //                 type: QueryTypes.SELECT
    //             }
    //         );

    //         if (existing.length === 0) {
    //             return res.status(404).json({
    //                 success: false,
    //                 message: "Permission not found"
    //             });
    //         }

    //         // Check if permission is assigned to any role
    //         const roleAssignments = await this.sequelize.query(
    //             `SELECT COUNT(*)::int as count FROM public.role_permissions WHERE permission_id = :id`,
    //             {
    //                 replacements: { id },
    //                 type: QueryTypes.SELECT
    //             }
    //         );

    //         if (roleAssignments[0]?.count > 0) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: "Cannot delete permission. It is assigned to one or more roles."
    //             });
    //         }

    //         const deleted: any[] = await this.sequelize.query(
    //             `DELETE FROM public.permissions WHERE id = :id RETURNING *`,
    //             {
    //                 replacements: { id },
    //                 type: QueryTypes.SELECT
    //             }
    //         );

    //         return res.status(200).json({
    //             success: true,
    //             message: "Permission deleted successfully",
    //             data: deleted[0]
    //         });
    //     } catch (err) {
    //         console.error("deletePermission error:", err);
    //         return res.status(500).json({
    //             success: false,
    //             message: "Internal server error"
    //         });
    //     }
    // };

    // SEARCH PERMISSIONS
    public searchPermissions = async (req: Request, res: Response) => {
        try {
            const { search = "", page = 1, limit = 20 } = req.query;
            const offset = (Number(page) - 1) * Number(limit);

            const whereClause = search
                ? `WHERE p.name ILIKE :search OR p.description ILIKE :search`
                : "";

            // Get total count
            const countRows: any[] = await this.sequelize.query(
                `SELECT COUNT(*)::int as total FROM public.permissions p ${whereClause}`,
                {
                    replacements: { search: `%${search}%` },
                    type: QueryTypes.SELECT
                }
            );

            const total = countRows[0]?.total || 0;

            // Get paginated data
            const permissions = await this.sequelize.query(
                `SELECT p.* FROM public.permissions p ${whereClause}
                 ORDER BY p.name
                 LIMIT :limit OFFSET :offset`,
                {
                    replacements: {
                        search: `%${search}%`,
                        limit: Number(limit),
                        offset
                    },
                    type: QueryTypes.SELECT
                }
            );

            return res.status(200).json({
                success: true,
                data: permissions,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            });
        } catch (err) {
            console.error("searchPermissions error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };
}