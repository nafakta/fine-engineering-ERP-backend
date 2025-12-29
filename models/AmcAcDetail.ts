import { Model, DataTypes, Optional, Sequelize } from "sequelize";

export interface AmcAcDetailAttrs {
  id: number;
  amc_estimate_id: number | null;
  ac_type: string | null;
  maker: string | null;
  quantity: number | null;
  tr_ac: number | null;
  rate_per_ac: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AmcAcDetailCreationAttrs = Optional<
  AmcAcDetailAttrs,
  | "id"
  | "amc_estimate_id"
  | "ac_type"
  | "maker"
  | "quantity"
  | "tr_ac"
  | "rate_per_ac"
  | "createdAt"
  | "updatedAt"
>;

export class AmcAcDetail
  extends Model<AmcAcDetailAttrs, AmcAcDetailCreationAttrs>
  implements AmcAcDetailAttrs
{
  public id!: number;
  public amc_estimate_id!: number | null;
  public ac_type!: string | null;
  public maker!: string | null;
  public quantity!: number | null;
  public tr_ac!: number | null;
  public rate_per_ac!: number | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  static initModel(sequelize: Sequelize) {
    AmcAcDetail.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        amc_estimate_id: { type: DataTypes.INTEGER, allowNull: true },
        ac_type: { type: DataTypes.STRING(255), allowNull: true },
        maker: { type: DataTypes.STRING(255), allowNull: true },
        quantity: { type: DataTypes.INTEGER, allowNull: true },
        tr_ac: { type: DataTypes.INTEGER, allowNull: true },
        rate_per_ac: { type: DataTypes.DECIMAL, allowNull: true },
      },
      {
        sequelize,
        tableName: "amcac_details",
        schema: "public",
      }
    );
    return AmcAcDetail;
  }
}
