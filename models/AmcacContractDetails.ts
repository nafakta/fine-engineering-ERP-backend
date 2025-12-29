import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcacContractDetailsAttrs {
  id: string;
  amc_contract_id: string;
  ac_type: string | null;
  maker: string | null;
  quantity: number | null;
  tr_ac: number | null;
  rate_per_ac: number | null;
  total_rate: number | null;
}

export type AmcacContractDetailsCreationAttrs = Optional<
  AmcacContractDetailsAttrs,
  | "id"
  | "ac_type"
  | "maker"
  | "quantity"
  | "tr_ac"
  | "rate_per_ac"
  | "total_rate"
>;

export class AmcacContractDetails
  extends Model<AmcacContractDetailsAttrs, AmcacContractDetailsCreationAttrs>
  implements AmcacContractDetailsAttrs
{
  public id!: string;
  public amc_contract_id!: string;
  public ac_type!: string | null;
  public maker!: string | null;
  public quantity!: number | null;
  public tr_ac!: number | null;
  public rate_per_ac!: number | null;
  public total_rate!: number | null;

  static initModel(sequelize: Sequelize) {
    AmcacContractDetails.init(
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
        ac_type: { 
          type: DataTypes.STRING(255), 
          allowNull: true,
        },
        maker: { 
          type: DataTypes.STRING(255), 
          allowNull: true,
        },
        quantity: { 
          type: DataTypes.INTEGER, 
          allowNull: true,
        },
        tr_ac: { 
          type: DataTypes.INTEGER, 
          allowNull: true,
        },
        rate_per_ac: { 
          type: DataTypes.DECIMAL, 
          allowNull: true,
        },
        total_rate: { 
          type: DataTypes.DECIMAL, 
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "amcac_contract_details",
        schema: "public",
        timestamps: false,
      }
    );
    return AmcacContractDetails;
  }
}