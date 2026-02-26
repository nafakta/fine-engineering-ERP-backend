import { Model, DataTypes, Sequelize, Optional } from "sequelize";

export interface AssignToWorkerAttributes {
  id: string;
  jo_no?: string;
  item_no?: number;
  machine_category?: string;
  machine_size?: string;
  machine_code?: string;
  worker_name?: string;
  worker_id?: string;
  quantity_no?: number;
  assigning_date?: Date;
  serial_no?: string;
  job_id?: string;
  status?: string;
  created_at?: Date;
  updated_at?: Date;
  created_by?: string;
  updated_by?: string;
}

export interface AssignToWorkerCreationAttributes
  extends Optional<AssignToWorkerAttributes, "id" | "status" | "created_at" | "updated_at"> {}

export class AssignToWorker
  extends Model<AssignToWorkerAttributes, AssignToWorkerCreationAttributes>
  implements AssignToWorkerAttributes {

  public id!: string;
  public jo_no!: string;
  public item_no!: number;
  public machine_category!: string;
  public machine_size!: string;
  public machine_code!: string;
  public worker_name!: string;
  public worker_id!: string;
  public quantity_no!: number;
  public assigning_date!: Date;
  public serial_no!: string;
  public job_id!: string;
  public status!: string;
  public created_at!: Date;
  public updated_at!: Date;
  public created_by!: string;
  public updated_by!: string;

  static initModel(sequelize: Sequelize): typeof AssignToWorker {
    return AssignToWorker.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        jo_no: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        item_no: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        machine_category: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        machine_size: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        machine_code: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        worker_name: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        worker_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        quantity_no: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        assigning_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        serial_no: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        job_id: {
          type: DataTypes.UUID,
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "in-progress",
          validate: {
            isIn: [
              [
                "in-progress",
                "in-review",
                "ready-for-qc",
                "completed",
                "not-ok",
                "rejected",
              ],
            ],
          },
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
        tableName: "assign_to_worker",
        schema: "public",
        timestamps: true,
        underscored: true,
      }
    );
  }
}
