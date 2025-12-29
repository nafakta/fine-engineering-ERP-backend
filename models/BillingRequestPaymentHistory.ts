// src/models/BillingRequestPaymentHistory.ts
import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from "sequelize";

export interface BillingRequestPaymentHistoryAttributes {
  id: string;
  billing_request_id: string;
  basic_amount: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export type BillingRequestPaymentHistoryCreationAttributes = Optional<
  BillingRequestPaymentHistoryAttributes,
  "id" | "status" | "created_at" | "updated_at"
>;

export class BillingRequestPaymentHistory
  extends Model<
    BillingRequestPaymentHistoryAttributes,
    BillingRequestPaymentHistoryCreationAttributes
  >
  implements BillingRequestPaymentHistoryAttributes
{
  public id!: string;
  public billing_request_id!: string;
  public basic_amount!: number;
  public tax_amount!: number;
  public total_amount!: number;
  public status!: string;
  public created_at!: Date;
  public updated_at!: Date;

  public static initModel(
    sequelize: Sequelize
  ): typeof BillingRequestPaymentHistory {
    return BillingRequestPaymentHistory.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4,
        },
        billing_request_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        basic_amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false,
          get(): number {
            const value = this.getDataValue('basic_amount');
            return value === null || value === undefined ? 0 : parseFloat(value as any);
          },
          set(value: number): void {
            this.setDataValue('basic_amount', value.toString() as any);
          }
        },
        tax_amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false,
          get(): number {
            const value = this.getDataValue('tax_amount');
            return value === null || value === undefined ? 0 : parseFloat(value as any);
          },
          set(value: number): void {
            this.setDataValue('tax_amount', value.toString() as any);
          }
        },
        total_amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false,
          get(): number {
            const value = this.getDataValue('total_amount');
            return value === null || value === undefined ? 0 : parseFloat(value as any);
          },
          set(value: number): void {
            this.setDataValue('total_amount', value.toString() as any);
          }
        },
        status: {
          type: DataTypes.STRING(50),
          allowNull: false,
          defaultValue: "pending",
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
        tableName: "billing_request_payment_history",
        underscored: true,
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      }
    );
  }
}

export default BillingRequestPaymentHistory;