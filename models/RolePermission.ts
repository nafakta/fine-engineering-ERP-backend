// src/models/RolePermission.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class RolePermission extends Model {
  declare role_id: string;
  declare permission_id: string;
  declare created_at: Date;
  declare updated_at: Date;
}

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
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
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
