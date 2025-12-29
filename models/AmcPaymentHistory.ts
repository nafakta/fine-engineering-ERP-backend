import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcPaymentHistoryAttrs {
  id: string;
  amc_contract_id: string;
  payment_date_schedule: string; // Changed from payment_date
  amount: number;
  created_at?: Date;
  updated_at?: Date;
}

export type AmcPaymentHistoryCreationAttrs = Optional<
  AmcPaymentHistoryAttrs,
  "id" | "created_at" | "updated_at"
>;

export class AmcPaymentHistory
  extends Model<AmcPaymentHistoryAttrs, AmcPaymentHistoryCreationAttrs>
  implements AmcPaymentHistoryAttrs
{
  public id!: string;
  public amc_contract_id!: string;
  public payment_date_schedule!: string; // Changed from payment_date
  public amount!: number;

  public readonly created_at!: Date;
  public readonly updated_at!: Date;

  static initModel(sequelize: Sequelize) {
    AmcPaymentHistory.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        amc_contract_id: { 
          type: DataTypes.UUID,
          allowNull: false,
          field: 'amc_contract_id',
          references: {
            model: 'amc_contract',
            key: 'id'
          }
        },
        payment_date_schedule: { // Changed from payment_date
          type: DataTypes.DATEONLY, 
          allowNull: false,
          field: 'payment_date_schedule' // Field name updated
        },
        amount: { 
          type: DataTypes.DECIMAL(12, 2), 
          allowNull: false,
          field: 'amount'
        },
        created_at: { 
          type: DataTypes.DATE, 
          allowNull: false,
          field: 'created_at'
        },
        updated_at: { 
          type: DataTypes.DATE, 
          allowNull: false,
          field: 'updated_at'
        },
      },
      {
        sequelize,
        tableName: "amc_payment_history",
        schema: "public",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
      }
    );
    return AmcPaymentHistory;
  }
}