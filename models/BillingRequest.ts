// src/models/BillingRequest.ts
import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from "sequelize";

export interface BillingRequestAttributes {
  id: string;
  amc_contract_id: string;
  company_name: string;
  basic_amount: number;
  tax_amount: number;
  total_amount: number;
  created_at: Date;
  updated_at: Date;
  client_id: string | null;  // Add this line
}

export type BillingRequestCreationAttributes = Optional<
  BillingRequestAttributes,
  "id" | "created_at" | "updated_at" | "client_id"  // Add client_id here
>;

export class BillingRequest
  extends Model<BillingRequestAttributes, BillingRequestCreationAttributes>
  implements BillingRequestAttributes
{
  public id!: string;
  public amc_contract_id!: string;
  public company_name!: string;
  public basic_amount!: number;
  public tax_amount!: number;
  public total_amount!: number;
  public created_at!: Date;
  public updated_at!: Date;
  public client_id!: string | null;  // Add this line

  public static initModel(sequelize: Sequelize): typeof BillingRequest {
    return BillingRequest.init(
      {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: DataTypes.UUIDV4,
        },
        amc_contract_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        company_name: {
          type: DataTypes.STRING(255),
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
            // Convert number to string for DECIMAL type
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
        // Add client_id field
        client_id: {
          type: DataTypes.UUID,
          allowNull: true,  // Set to false if it should be NOT NULL
          // Add this if you want to add a foreign key reference:
          // references: {
          //   model: 'clients', // or whatever your client table is called
          //   key: 'id'
          // }
        },
      },
      {
        sequelize,
        tableName: "billing_request",
        underscored: true,
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      }
    );
  }
}

export default BillingRequest;