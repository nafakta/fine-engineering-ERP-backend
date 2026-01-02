// src/models/Role.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class Role extends Model {
  declare id: string;
  declare name: string;
  declare level: number;
  declare created_at: Date;
  declare updated_at: Date;
}

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
      modelName: "Role",
      tableName: "roles",
      schema: "public",
      timestamps: true,   // ✅ needed for created_at/updated_at
      underscored: true,  // ✅ created_at / updated_at
    }
  );

  return Role;
};
