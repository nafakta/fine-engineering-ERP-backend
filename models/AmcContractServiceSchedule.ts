import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcContractServiceScheduleAttrs {
  id: string;
  amc_contract_id: string;
  service_no: number;
  planned_date: string;
  status: string;
  service_completed_date: string | null;
  notes: string | null;
}

export type AmcContractServiceScheduleCreationAttrs = Optional<
  AmcContractServiceScheduleAttrs,
  | "id"
  | "status"
  | "service_completed_date"
  | "notes"
>;

export class AmcContractServiceSchedule
  extends Model<AmcContractServiceScheduleAttrs, AmcContractServiceScheduleCreationAttrs>
  implements AmcContractServiceScheduleAttrs
{
  public id!: string;
  public amc_contract_id!: string;
  public service_no!: number;
  public planned_date!: string;
  public status!: string;
  public service_completed_date!: string | null;
  public notes!: string | null;

  static initModel(sequelize: Sequelize) {
    AmcContractServiceSchedule.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        amc_contract_id: { 
          type: DataTypes.UUID, 
          allowNull: false,
        },
        service_no: { 
          type: DataTypes.INTEGER, 
          allowNull: false,
        },
        planned_date: { 
          type: DataTypes.DATEONLY, 
          allowNull: false,
        },
        status: { 
          type: DataTypes.STRING(50), 
          allowNull: false,
          defaultValue: 'PENDING',
        },
        service_completed_date: { 
          type: DataTypes.DATEONLY, 
          allowNull: true,
        },
        notes: { 
          type: DataTypes.TEXT, 
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "amc_contract_service_schedule",
        schema: "public",
        timestamps: false,
      }
    );
    return AmcContractServiceSchedule;
  }
}