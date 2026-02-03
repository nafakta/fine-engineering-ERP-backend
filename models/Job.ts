import {
  Model,
  DataTypes,
  Sequelize,
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Op,
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
  declare jo_number: number | null;
  declare tso_no: string | null;
  declare serial_no: string | null;
  declare job_order_date: Date | null;
  declare mtl_rcd_date: Date | null;
  declare mtl_challan_no: number;
  declare item_description: string | null;
  declare item_no: number;
  declare product_desc: string | null;
  declare product_qty: number | null;
  declare qty: number;
  declare moc: string;
  declare remark: string | null;
  declare bin_location: string | null;
  declare material_remark: string | null;
  declare client_name: string | null;
  declare assign_to: string | null;
  declare assign_date: Date | null;
  declare urgent: CreationOptional<boolean>;
  declare urgent_due_date: Date | null;
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
      job_no: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
      }, // Nullable
      jo_number: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      tso_no: {
        type: DataTypes.TEXT,
        allowNull: true,
        unique: true,
      },
      serial_no: {
        type: DataTypes.TEXT,
        allowNull: true,
        unique: true,
      },
      job_order_date: { type: DataTypes.DATEONLY, allowNull: true },
      mtl_rcd_date: { type: DataTypes.DATEONLY, allowNull: true },
      mtl_challan_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      item_description: { type: DataTypes.TEXT, allowNull: true },
      item_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      product_desc: { type: DataTypes.TEXT, allowNull: true },
      product_qty: { type: DataTypes.INTEGER, allowNull: true },
      qty: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      moc: { type: DataTypes.TEXT, allowNull: false },
      remark: { type: DataTypes.TEXT, allowNull: true },
      bin_location: { type: DataTypes.TEXT, allowNull: true },
      material_remark: { type: DataTypes.TEXT, allowNull: true },
      client_name: { type: DataTypes.TEXT, allowNull: true },
      assign_to: { type: DataTypes.TEXT, allowNull: true },
      assign_date: { type: DataTypes.DATEONLY, allowNull: true },
      urgent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      urgent_due_date: { type: DataTypes.DATEONLY, allowNull: true },
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
      hooks: {
        beforeCreate: async (job, options) => {
          // Generate tso_no for TSO_SERVICE
          if (job.job_type === 'TSO_SERVICE') {
            const tsoPrefix = 'TSO';
            const lastTsoJob = await Job.findOne({
              where: { tso_no: { [Op.startsWith]: tsoPrefix } },
              order: [['tso_no', 'DESC']],
              transaction: options.transaction,
              paranoid: false, // Include soft-deleted records to avoid number reuse
            });

            let nextTsoNumber = 1;
            if (lastTsoJob?.tso_no) {
              const numericPart = lastTsoJob.tso_no.substring(tsoPrefix.length);
              const lastNumber = parseInt(numericPart, 10);
              if (!isNaN(lastNumber)) {
                nextTsoNumber = lastNumber + 1;
              }
            }
            const paddedTsoNumber = String(nextTsoNumber).padStart(6, '0');
            job.tso_no = `${tsoPrefix}${paddedTsoNumber}`;
          }

          // Generate serial_no for all types
          const { job_type } = job;
          let prefix = "";

          switch (job_type) {
            case "JOB_SERVICE":
              // The `isBulk` option is passed from the controller
              prefix = (options as any).isBulk ? "JMA" : "JSA";
              break;
            case "TSO_SERVICE":
              prefix = "FSA";
              break;
            case "KANBAN":
              prefix = "FKA";
              break;
            default:
              return; // Let validation handle invalid job_type
          }

          const lastJob = await Job.findOne({
            where: {
              serial_no: {
                [Op.startsWith]: prefix,
              },
            },
            order: [["serial_no", "DESC"]],
            transaction: options.transaction,
          });

          let nextNumber = 1;
          if (lastJob?.serial_no) {
            const numericPart = lastJob.serial_no.substring(prefix.length);
            const lastNumber = parseInt(numericPart, 10);
            if (!isNaN(lastNumber)) {
              nextNumber = lastNumber + 1;
            }
          }

          const paddedNumber = String(nextNumber).padStart(6, "0");
          job.serial_no = `${prefix}${paddedNumber}`;
        },
        beforeSave: async (job) => {
          if (job.job_no) {
            const category = await sequelize.models.Category.findOne({
              where: { job_no: job.job_no },
            });
            if (category) {
              job.job_category = category.getDataValue("job_category");
            }
          }
        },
      },
    }
  );

  return Job;
};