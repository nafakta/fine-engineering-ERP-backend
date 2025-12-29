import { DataTypes, Model, Optional, Sequelize } from "sequelize";

export interface AmcDealPackageAttrs {
  id: string;
  package_name: string;
  package_details: string;
  is_active: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

type CreationAttrs = Optional<
  AmcDealPackageAttrs,
  "id" | "is_active" | "created_by" | "updated_by" | "created_at" | "updated_at"
>;

export default function AmcDealPackageModel(sequelize: Sequelize) {
  class AmcDealPackage
    extends Model<AmcDealPackageAttrs, CreationAttrs>
    implements AmcDealPackageAttrs
  {
    public id!: string;
    public package_name!: string;
    public package_details!: string;
    public is_active!: boolean;
    public created_by?: string | null;
    public updated_by?: string | null;
    public created_at?: Date;
    public updated_at?: Date;
  }

  AmcDealPackage.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: sequelize.literal("gen_random_uuid()"),
        primaryKey: true,
      },
      package_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      package_details: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("NOW()"),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("NOW()"),
      },
    },
    {
      sequelize,
      tableName: "amc_deal_packages",
      modelName: "AmcDealPackage",
      timestamps: false,
    }
  );

  return AmcDealPackage;
}
