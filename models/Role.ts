// src/models/Role.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class Role extends Model {}

export const initRoleModel = (sequelize: Sequelize) => {
  Role.init(
    {
      id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4, // ✅ safest
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true, // ✅ optional but good for roles
      },
      level: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 999,
      },
    },
    {
      sequelize,
      modelName: "Role",
      tableName: "roles",
      schema: "public",
      timestamps: true,   // ✅ needed for created_at/updated_at
      underscored: true,  // ✅ created_at / updated_at
    }
  );

  return Role;
};
