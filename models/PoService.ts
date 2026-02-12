import {
  Model,
  DataTypes,
  Sequelize,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";

export class PoService extends Model<
  InferAttributes<PoService>,
  InferCreationAttributes<PoService>
> {
  declare id: CreationOptional<string>;
  declare jo_category: string | null;
  declare po_no: number | null;
  declare po_date: string | null;
  declare pn_no: number | null;
  declare description: string | null;
  declare po_qnty: number | null;
  declare job_no: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare created_by: string | null;
  declare updated_by: string | null;
}

export const initPoServiceModel = (sequelize: Sequelize) => {
  PoService.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      jo_category: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      po_no: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      po_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      pn_no: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      po_qnty: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      job_no: {
        type: DataTypes.TEXT,
        allowNull: true,
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
      modelName: "PoService",
      tableName: "po_service",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
  return PoService;
};