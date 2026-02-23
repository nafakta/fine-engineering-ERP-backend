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
export type JobType = "JOB_SERVICE" | "TSO_SERVICE" | "KANBAN";
export type JobStatus = "in-process" | "completed" | "not-ok";

export class Job extends Model<
  InferAttributes<Job>,
  InferCreationAttributes<Job>
> {
  declare id: CreationOptional<string>;
  declare job_type: JobType;
  declare job_category: string | null;
  declare job_no: string | null; // Nullable
  declare jo_number: string | null;
  declare tso_no: string | null;
  declare serial_no: string | null;
  declare job_order_date: Date | null;
  declare mtl_rcd_date: Date | null;
  declare mtl_challan_no: number;
  declare item_description: string | null;
  declare item_no: number;
  declare product_desc: string | null;
  declare kanban_job_cat: string | null;
  declare product_qty: number | null;
  declare qty: number;
  declare qty_history: number | null;
  declare moc: string;
  declare remark: string | null;
  declare bin_location: string | null;
  declare material_remark: string | null;
  declare dispatch_date: Date | null;
  declare chalan_no: string | null;
  declare reason: string | null;
  declare client_name: string | null;
  declare assign_to: string | null;
  declare assign_date: Date | null;
  declare status: JobStatus;
  declare urgent: CreationOptional<boolean>;
  declare urgent_due_date: Date | null;
  declare is_approved: CreationOptional<boolean>;
  declare rejected: CreationOptional<boolean>;
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
          isIn: [["JOB_SERVICE", "TSO_SERVICE", "KANBAN"]],
        },
      },
      job_category: { type: DataTypes.TEXT, allowNull: true },
      job_no: {
        type: DataTypes.TEXT,
        allowNull: true,
      }, // Nullable
      jo_number: {
        type: DataTypes.TEXT,
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
      mtl_challan_no: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      item_description: { type: DataTypes.TEXT, allowNull: true },
      item_no: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      product_desc: { type: DataTypes.TEXT, allowNull: true },
      kanban_job_cat: { type: DataTypes.TEXT, allowNull: true },
      product_qty: { type: DataTypes.INTEGER, allowNull: true },
      qty: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      qty_history: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      moc: { type: DataTypes.TEXT, allowNull: false },
      remark: { type: DataTypes.TEXT, allowNull: true },
      bin_location: { type: DataTypes.TEXT, allowNull: true },
      material_remark: { type: DataTypes.TEXT, allowNull: true },
      dispatch_date: { type: DataTypes.DATEONLY, allowNull: true },
      chalan_no: { type: DataTypes.TEXT, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },
      client_name: { type: DataTypes.TEXT, allowNull: true },
      assign_to: { type: DataTypes.TEXT, allowNull: true },
      assign_date: { type: DataTypes.DATEONLY, allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "in-process",
        validate: {
          isIn: [["in-process", "completed", "not-ok"]],
        },
      },
      urgent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      urgent_due_date: { type: DataTypes.DATEONLY, allowNull: true },
      is_approved: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      rejected: {
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
      hooks: {
        beforeCreate: async (job, options) => {
          // Set qty_history to initial qty
          if (job.qty !== undefined) {
            job.qty_history = job.qty;
          }

          // Generate serial_no for all types
          const { job_type } = job;
          let prefix = "";
          const isBulk = (options as any).isBulk;

          switch (job_type) {
            case "JOB_SERVICE":
              // The `isBulk` option is passed from the controller
              prefix = isBulk ? "JMA" : "JSA";
              break;
            case "TSO_SERVICE":
              prefix = isBulk ? "SMA" : "SSA";
              break;
            case "KANBAN":
              prefix = isBulk ? "KMA" : "KSA";
              break;
            default:
              return; // Let validation handle invalid job_type
          }

          // Determine identifier based on job type
          let identifier = "";
          if (job_type === "TSO_SERVICE") {
            identifier = job.tso_no || "";
          } else if (job_type === "JOB_SERVICE") {
            identifier = job.job_no || "";
          }

          const joNumber = job.jo_number || "";
          const baseSerial = identifier
            ? `${prefix}-${identifier}-${joNumber}`
            : `${prefix}-${joNumber}`;

          const lastJob = await Job.findOne({
            where: {
              serial_no: {
                [Op.iLike]: `${baseSerial}-%`,
              },
            },
            order: [
              [sequelize.fn("length", sequelize.col("serial_no")), "DESC"],
              ["serial_no", "DESC"],
            ],
            transaction: options.transaction,
          });

          let nextNumber = 1;
          if (lastJob && lastJob.serial_no) {
            // Extract the suffix after the last dash
            const suffixPart = lastJob.serial_no.substring(baseSerial.length + 1);
            const lastNum = parseInt(suffixPart, 10);
            if (!isNaN(lastNum)) {
              nextNumber = lastNum + 1;
            }
          }

          const suffix = String(nextNumber).padStart(2, "0");
          job.serial_no = `${baseSerial}-${suffix}`;
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