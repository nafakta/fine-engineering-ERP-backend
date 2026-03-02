import { Model, DataTypes, Sequelize, Optional } from "sequelize";

export interface AssignToWorkerAttributes {
  id: string;

  jo_no?: string | null;
  item_no?: number | null;
  machine_category?: string | null;
  machine_size?: string | null;
  machine_code?: string | null;

  worker_name?: string | null;
  quantity_no?: number | null;
  assigning_date?: Date | string | null;
  serial_no?: string | null;
  job_id?: string | null;

  vendor_name?: string | null;

  qc_date?: Date | string | null;
  qc_quantity?: number | null;
  gatepass_no?: string | null;

  review_for?: "welding" | "vendor" | null;

  status: string;

  created_by?: string | null;
  updated_by?: string | null;

  created_at: Date;
  updated_at: Date;
}

export interface AssignToWorkerCreationAttributes
  extends Optional<AssignToWorkerAttributes, "id" | "status" | "created_at" | "updated_at"> {}

export class AssignToWorker
  extends Model<AssignToWorkerAttributes, AssignToWorkerCreationAttributes>
  implements AssignToWorkerAttributes
{
  public id!: string;

  public jo_no!: string | null;
  public item_no!: number | null;
  public machine_category!: string | null;
  public machine_size!: string | null;
  public machine_code!: string | null;

  public worker_name!: string | null;
  public quantity_no!: number | null;
  public assigning_date!: Date | string | null;
  public serial_no!: string | null;
  public job_id!: string | null;

  public vendor_name!: string | null;

  public qc_date!: Date | string | null;
  public qc_quantity!: number | null;
  public gatepass_no!: string | null;

  public review_for!: "welding" | "vendor" | null;

  public status!: string;

  public created_by!: string | null;
  public updated_by!: string | null;

  public created_at!: Date;
  public updated_at!: Date;

  static initModel(sequelize: Sequelize): typeof AssignToWorker {
    return AssignToWorker.init(
      {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

        jo_no: { type: DataTypes.TEXT, allowNull: true },
        item_no: { type: DataTypes.INTEGER, allowNull: true },
        machine_category: { type: DataTypes.TEXT, allowNull: true },
        machine_size: { type: DataTypes.TEXT, allowNull: true },
        machine_code: { type: DataTypes.TEXT, allowNull: true },

        worker_name: { type: DataTypes.TEXT, allowNull: true },
        quantity_no: { type: DataTypes.INTEGER, allowNull: true },
        assigning_date: { type: DataTypes.DATEONLY, allowNull: true },
        serial_no: { type: DataTypes.TEXT, allowNull: true },
        job_id: { type: DataTypes.UUID, allowNull: true },

        vendor_name: { type: DataTypes.TEXT, allowNull: true },

        qc_date: { type: DataTypes.DATEONLY, allowNull: true },
        qc_quantity: { type: DataTypes.INTEGER, allowNull: true },
        gatepass_no: { type: DataTypes.TEXT, allowNull: true },

        review_for: {
          type: DataTypes.STRING(20),
          allowNull: true,
          validate: { isIn: [["welding", "vendor"]] },
        },

        status: {
          type: DataTypes.STRING(255),
          allowNull: false,
          defaultValue: "in-progress",
          validate: {
            isIn: [[
              "in-progress",
              "in-review",
              "ready-for-qc",
              "qc-welding",
              "qc-vendor",
              "vendor-outsource",
              "in-welding",
              "in-vendor",
              "completed",
              "not-ok",
              "rejected",
              "machine",  // Add this line
            ]],
          },
        },

        created_by: { type: DataTypes.UUID, allowNull: true },
        updated_by: { type: DataTypes.UUID, allowNull: true },

        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      },
      {
        sequelize,
        tableName: "assign_to_worker",
        schema: "public",
        timestamps: true,
        underscored: true,
      }
    );
  }
}