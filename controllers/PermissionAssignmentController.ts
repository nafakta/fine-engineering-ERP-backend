// src/controllers/PermissionAssignmentController.ts
import { Request, Response } from "express";
import { Sequelize, QueryTypes } from "sequelize";

export default class PermissionAssignmentController {
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    // ────────────────────────────────────────────────
    // ASSIGN PERMISSIONS TO ROLE
    // POST /role-permissions
    // ────────────────────────────────────────────────
    public assignPermissionsToRole = async (req: Request, res: Response) => {
        try {
            const { role_id, permission_ids } = req.body;

            if (!role_id || !Array.isArray(permission_ids)) {
                return res.status(400).json({
                    success: false,
                    message: "role_id and permission_ids array are required"
                });
            }

            // Start transaction
            await this.sequelize.query('BEGIN');

            try {
                // Delete existing permissions for this role
                await this.sequelize.query(
                    `DELETE FROM public.role_permissions WHERE role_id = :role_id`,
                    { replacements: { role_id }, type: QueryTypes.DELETE }
                );

                // Insert new permissions
                for (const perm_id of permission_ids) {
                    await this.sequelize.query(
                        `INSERT INTO public.role_permissions (role_id, permission_id) 
                         VALUES (:role_id, :perm_id) 
                         ON CONFLICT (role_id, permission_id) DO NOTHING`,
                        { replacements: { role_id, perm_id }, type: QueryTypes.INSERT }
                    );
                }

                await this.sequelize.query('COMMIT');

                return res.status(200).json({
                    success: true,
                    message: "Permissions assigned successfully"
                });
            } catch (error) {
                await this.sequelize.query('ROLLBACK');
                throw error;
            }
        } catch (err) {
            console.error("assignPermissionsToRole error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    // ────────────────────────────────────────────────
    // GET PERMISSIONS BY ROLE ID
    // GET /role-permissions/:role_id
    // ────────────────────────────────────────────────
    public getPermissionsByRole = async (req: Request, res: Response) => {
        try {
            const { role_id } = req.params;

            const permissions = await this.sequelize.query(
                `SELECT p.* 
                 FROM public.permissions p
                 INNER JOIN public.role_permissions rp ON rp.permission_id = p.id
                 WHERE rp.role_id = :role_id
                 ORDER BY p.name`,
                {
                    replacements: { role_id },
                    type: QueryTypes.SELECT
                }
            );

            return res.status(200).json({
                success: true,
                data: permissions
            });
        } catch (err) {
            console.error("getPermissionsByRole error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    public getAllPermissionsWithStatus = async (req: Request, res: Response) => {
        try {
            const { role_id } = req.params;

            const permissions = await this.sequelize.query(
                `SELECT 
                p.*,
                CASE 
                    WHEN rp.role_id IS NOT NULL THEN true 
                    ELSE false 
                END as is_assigned
             FROM public.permissions p
             LEFT JOIN public.role_permissions rp ON rp.permission_id = p.id AND rp.role_id = :role_id
             ORDER BY p.name`,
                {
                    replacements: { role_id },
                    type: QueryTypes.SELECT
                }
            );

            // Add module name to each permission
            const permissionsWithModules = permissions.map((permission: any) => {
                const permissionName = permission.name;
                let module = 'Other';

                const dotIndex = permissionName.indexOf('.');
                if (dotIndex > 0) {
                    module = permissionName.substring(0, dotIndex);
                    module = module.charAt(0).toUpperCase() + module.slice(1);
                }

                return {
                    ...permission,
                    module_name: module
                };
            });

            return res.status(200).json({
                success: true,
                data: permissionsWithModules
            });
        } catch (err) {
            console.error("getAllPermissionsWithStatus error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

    public getPermissionsByModuleForRole = async (req: Request, res: Response) => {
        try {
            const { role_id } = req.params;

            // Get all permissions with their assignment status
            const permissions = await this.sequelize.query(
                `SELECT 
                p.*,
                CASE 
                    WHEN rp.role_id IS NOT NULL THEN true 
                    ELSE false 
                END as is_assigned
             FROM public.permissions p
             LEFT JOIN public.role_permissions rp ON rp.permission_id = p.id AND rp.role_id = :role_id
             ORDER BY p.name`,
                {
                    replacements: { role_id },
                    type: QueryTypes.SELECT
                }
            );

            // Extract module from permission name (e.g., "market.view" -> "market")
            const permissionsWithModules = permissions.map((permission: any) => {
                const permissionName = permission.name;
                let module = 'Other';

                // Extract module from permission name
                const dotIndex = permissionName.indexOf('.');
                if (dotIndex > 0) {
                    module = permissionName.substring(0, dotIndex);
                    // Capitalize first letter
                    module = module.charAt(0).toUpperCase() + module.slice(1);
                }

                return {
                    ...permission,
                    module_name: module
                };
            });

            // Get unique modules
            const modules = Array.from(
                new Set(permissionsWithModules.map((p: any) => p.module_name))
            ).sort();

            // Group permissions by module
            const permissionsByModule: Record<string, any[]> = {};
            permissionsWithModules.forEach((permission: any) => {
                const moduleName = permission.module_name;
                if (!permissionsByModule[moduleName]) {
                    permissionsByModule[moduleName] = [];
                }
                permissionsByModule[moduleName].push(permission);
            });

            return res.status(200).json({
                success: true,
                data: {
                    modules,
                    permissionsByModule,
                    allPermissions: permissionsWithModules // Include all permissions
                }
            });
        } catch (err) {
            console.error("getPermissionsByModuleForRole error:", err);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    };

}