import {
  Model,
  DataTypes,
  Sequelize,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";

export class PendingMaterial extends Model<
  InferAttributes<PendingMaterial>,
  InferCreationAttributes<PendingMaterial>
> {
  declare id: CreationOptional<string>;
  declare job_no: number;
  declare item_no: number;
  declare description: string | null;
  declare size: string;
  declare moc: string;
  declare qty: number;
  declare is_completed: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare created_by: string | null;
  declare updated_by: string | null;
}

export const initPendingMaterialModel = (sequelize: Sequelize) => {
  PendingMaterial.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      job_no: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
      },
      item_no: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      size: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      moc: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      qty: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      },
      is_completed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updated_by: {
        type: DataTypes.UUID,
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
      modelName: "PendingMaterial",
      tableName: "pending_material",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
  return PendingMaterial;
};