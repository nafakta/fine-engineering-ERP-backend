// src/models/RolePermission.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class RolePermission extends Model {}

export const initRolePermissionModel = (sequelize: Sequelize) => {
  RolePermission.init(
    {
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      permission_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      sequelize,
      modelName: "RolePermission",
      tableName: "role_permissions",
      schema: "public",
      timestamps: true,   // ✅ needed for created_at/updated_at
      underscored: true,  // ✅ created_at / updated_at
    }
  );

  return RolePermission;
};
