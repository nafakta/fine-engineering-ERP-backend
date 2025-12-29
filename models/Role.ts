// src/models/Role.ts
import { Sequelize, DataTypes, Model } from "sequelize";

export class Role extends Model { }

export const initRoleModel = (sequelize: Sequelize) => {
  Role.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      level: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "Role",
      tableName: "roles",
      schema: "public",
      timestamps: false,
    }
  );

  return Role;
};
