import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcContractAttrs {
  id: string;
  company_name: string;
  service_frequency: string | null;
  start_date: string;
  end_date: string;
  service_type: string;
  deal_offer: string | null;
  tax_cal: string | null;
  no_of_services: number | null;
  working_address: string;
  notes: string | null;
  client_id: string;
  installment: string | null;
  payment_installment: number;
  amc_contract_no: string | null;
  is_send_to_bill: boolean;
  is_expired: boolean;
  is_renewed: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export type AmcContractCreationAttrs = Optional<
  AmcContractAttrs,
  | "id"
  | "service_frequency"
  | "deal_offer"
  | "tax_cal"
  | "no_of_services"
  | "notes"
  | "installment"
  | "payment_installment"
  | "amc_contract_no"
  | "is_send_to_bill"
  | "is_expired"
  | "is_renewed"
  | "created_at"
  | "updated_at"
>;

export class AmcContract
  extends Model<AmcContractAttrs, AmcContractCreationAttrs>
  implements AmcContractAttrs
{
  public id!: string;
  public company_name!: string;
  public service_frequency!: string | null;
  public start_date!: string;
  public end_date!: string;
  public service_type!: string;
  public deal_offer!: string | null;
  public tax_cal!: string | null;
  public no_of_services!: number | null;
  public working_address!: string;
  public notes!: string | null;
  public client_id!: string;
  public installment!: string | null;
  public payment_installment!: number;
  public amc_contract_no!: string | null;
  public is_send_to_bill!: boolean;
  public is_expired!: boolean;
  public is_renewed!: boolean;

  public readonly created_at!: Date;
  public readonly updated_at!: Date;

  static initModel(sequelize: Sequelize) {
    AmcContract.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        company_name: { 
          type: DataTypes.STRING(255), 
          allowNull: false,
          field: 'company_name'
        },
        service_frequency: { 
          type: DataTypes.STRING(100), 
          allowNull: true,
          field: 'service_frequency'
        },
        start_date: { 
          type: DataTypes.DATEONLY, 
          allowNull: false,
          field: 'start_date'
        },
        end_date: { 
          type: DataTypes.DATEONLY, 
          allowNull: false,
          field: 'end_date'
        },
        service_type: { 
          type: DataTypes.STRING(255), 
          allowNull: false,
          field: 'service_type'
        },
        deal_offer: { 
          type: DataTypes.UUID,
          allowNull: true,
          field: 'deal_offer'
        },
        tax_cal: { 
          type: DataTypes.STRING(255), 
          allowNull: true,
          field: 'tax_cal'
        },
        no_of_services: { 
          type: DataTypes.INTEGER, 
          allowNull: true,
          field: 'no_of_services'
        },
        working_address: { 
          type: DataTypes.TEXT, 
          allowNull: false,
          field: 'working_address'
        },
        notes: { 
          type: DataTypes.TEXT, 
          allowNull: true,
          field: 'notes'
        },
        client_id: { 
          type: DataTypes.UUID,
          allowNull: false,
          field: 'client_id',
          references: {
            model: 'clients',
            key: 'id'
          }
        },
        installment: { 
          type: DataTypes.STRING(255), 
          allowNull: true,
          field: 'installment'
        },
        payment_installment: { 
          type: DataTypes.DECIMAL(12, 2), 
          allowNull: false,
          defaultValue: 0,
          field: 'payment_installment'
        },
        amc_contract_no: { 
          type: DataTypes.STRING(50), 
          allowNull: true,
          unique: true,
          field: 'amc_contract_no'
        },
        is_send_to_bill: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false, 
          field: 'is_send_to_bill'
        },
        is_expired: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: 'is_expired'
        },
        is_renewed: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
          field: 'is_renewed'
        },
        created_at: { 
          type: DataTypes.DATE, 
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'created_at'
        },
        updated_at: { 
          type: DataTypes.DATE, 
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: 'updated_at'
        },
      },
      {
        sequelize,
        tableName: "amc_contract",
        schema: "public",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
        underscored: false,
      }
    );
    return AmcContract;
  }
}