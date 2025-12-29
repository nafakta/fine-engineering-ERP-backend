// src/models/AmcPackage.ts
import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcPackageAttrs {
  id: string;
  name: string;
  created_at?: Date;
  updated_at?: Date;
}

export type AmcPackageCreationAttrs = Optional<
  AmcPackageAttrs,
  "id" | "created_at" | "updated_at"
>;

export class AmcPackage
  extends Model<AmcPackageAttrs, AmcPackageCreationAttrs>
  implements AmcPackageAttrs
{
  public id!: string;
  public name!: string;
  public created_at!: Date;
  public updated_at!: Date;

  static initModel(sequelize: Sequelize) {
    return AmcPackage.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
        },
      },
      {
        sequelize,
        tableName: "amc_package", // matches your DDL
        schema: "public",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
        underscored: true,
      }
    );
  }
}
