import {
  Model,
  DataTypes,
  Sequelize,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";

// Define the allowed job types for better type safety
export type JobType = 'JOB_SERVICE' | 'TSO_SERVICE' | 'KANBAN';

export class Job extends Model<
  InferAttributes<Job>,
  InferCreationAttributes<Job>
> {
  declare id: CreationOptional<string>;
  declare job_type: JobType;
  declare job_category: string | null;
  declare job_no: number | null; // Nullable
  declare serial_no: number;
  declare job_order_date: Date | null;
  declare mtl_rcd_date: Date | null;
  declare mtl_challan_no: number;
  declare item_description: string | null;
  declare item_no: number;
  declare qty: number;
  declare moc: string;
  declare remark: string | null;
  declare bin_location: string | null;
  declare material_remark: string | null;
  declare client: string | null;
  declare urgent: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare created_by: string | null;
  declare updated_by: string | null;
}

export const initJobModel = (sequelize: Sequelize) => {
  Job.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      job_type: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          isIn: [['JOB_SERVICE', 'TSO_SERVICE', 'KANBAN']],
        },
      },
      job_category: { type: DataTypes.TEXT, allowNull: true },
      job_no: { type: DataTypes.DECIMAL(14, 2), allowNull: true }, // Nullable
      serial_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      job_order_date: { type: DataTypes.DATEONLY, allowNull: true },
      mtl_rcd_date: { type: DataTypes.DATEONLY, allowNull: true },
      mtl_challan_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      item_description: { type: DataTypes.TEXT, allowNull: true },
      item_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      qty: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      moc: { type: DataTypes.TEXT, allowNull: false },
      remark: { type: DataTypes.TEXT, allowNull: true },
      bin_location: { type: DataTypes.TEXT, allowNull: true },
      material_remark: { type: DataTypes.TEXT, allowNull: true },
      client: { type: DataTypes.TEXT, allowNull: true },
      urgent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: { type: DataTypes.UUID, allowNull: true },
      updated_by: { type: DataTypes.UUID, allowNull: true },
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
      modelName: "Job",
      tableName: "jobs", // The unified table name
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Job;
};