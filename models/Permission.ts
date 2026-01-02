// src/models/Permission.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class Permission extends Model {
  declare id: string;
  declare name: string;
  declare description: string;
  declare created_at: Date;
  declare updated_at: Date;
}

export const initPermissionModel = (sequelize: Sequelize) => {
  Permission.init(
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4, // ✅ correct for UUID PK
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      modelName: "Permission",
      tableName: "permissions",
      schema: "public",
      timestamps: true,     // ✅ needed because seed inserts created_at/updated_at
      underscored: true,    // ✅ created_at / updated_at
    }
  );

  return Permission;
};
