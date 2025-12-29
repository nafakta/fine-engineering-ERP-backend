import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcEstimateAttrs {
  id: string;
  service_frequency: string | null;
  start_date: string; // DATEONLY
  end_date: string;   // DATEONLY
  service_type: string;
  deal_offer: string | null; // uuid
  payment_date: string | null; // DATEONLY
  tax_cal: string | null;
  no_of_services: number | null;
  working_address: string;
  notes: string | null;
  client_id: string | null; // uuid
  installment: string | null;
  estimate_no: string | null;
  is_create_contract: boolean; // ✅ NEW

  created_at?: Date;
  updated_at?: Date;
}

export type AmcEstimateCreationAttrs = Optional<
  AmcEstimateAttrs,
  | "id"
  | "service_frequency"
  | "deal_offer"
  | "payment_date"
  | "tax_cal"
  | "no_of_services"
  | "notes"
  | "client_id"
  | "installment"
  | "estimate_no"
  | "created_at"
  | "updated_at"
  | "is_create_contract" // ✅ optional because DB has default true
>;

export class AmcEstimate
  extends Model<AmcEstimateAttrs, AmcEstimateCreationAttrs>
  implements AmcEstimateAttrs
{
  public id!: string;
  public service_frequency!: string | null;
  public start_date!: string;
  public end_date!: string;
  public service_type!: string;
  public deal_offer!: string | null;
  public payment_date!: string | null;
  public tax_cal!: string | null;
  public no_of_services!: number | null;
  public working_address!: string;
  public notes!: string | null;
  public client_id!: string | null;
  public installment!: string | null;
  public estimate_no!: string | null;
  public is_create_contract!: boolean; // ✅ NEW

  public readonly created_at!: Date;
  public readonly updated_at!: Date;

  static initModel(sequelize: Sequelize) {
    AmcEstimate.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4, // matches gen_random_uuid() behavior
          primaryKey: true,
        },

        service_frequency: {
          type: DataTypes.STRING(100),
          allowNull: true,
          field: "service_frequency",
        },

        start_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
          field: "start_date",
        },

        end_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
          field: "end_date",
        },

        service_type: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "service_type",
        },

        deal_offer: {
          type: DataTypes.UUID,
          allowNull: true,
          field: "deal_offer",
        },

        payment_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
          field: "payment_date",
        },

        tax_cal: {
          type: DataTypes.STRING(255),
          allowNull: true,
          field: "tax_cal",
        },

        no_of_services: {
          type: DataTypes.INTEGER,
          allowNull: true,
          field: "no_of_services",
        },

        working_address: {
          type: DataTypes.TEXT,
          allowNull: false,
          field: "working_address",
        },

        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
          field: "notes",
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: "created_at",
        },

        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
          field: "updated_at",
        },

        client_id: {
          type: DataTypes.UUID,
          allowNull: true,
          field: "client_id",
        },

        installment: {
          type: DataTypes.STRING(255),
          allowNull: true,
          field: "installment",
        },

        estimate_no: {
          type: DataTypes.STRING(20),
          allowNull: true,
          field: "estimate_no",
        },

        is_create_contract: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
          field: "is_create_contract",
        },
      },
      {
        sequelize,
        tableName: "amc_estimates",
        schema: "public",
        timestamps: true,
        createdAt: "created_at",
        updatedAt: "updated_at",
        underscored: false,
      }
    );

    return AmcEstimate;
  }
}
