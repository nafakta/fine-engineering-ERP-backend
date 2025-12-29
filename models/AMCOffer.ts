// models/AMCOffer.ts
import {
  DataTypes,
  Model,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";

export class AMCOffer extends Model<
  InferAttributes<AMCOffer>,
  InferCreationAttributes<AMCOffer>
> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare description: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  // ⭐ ADD THIS STATIC METHOD
  static initModel(sequelize: Sequelize) {
    AMCOffer.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        title: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: DataTypes.NOW,
        },
      },
      {
        sequelize,
        tableName: "amc_offer",
        schema: "public",
        timestamps: false,
      }
    );

    return AMCOffer;
  }
}

// ⭐ KEEP THIS FOR BACKWARDS COMPATIBILITY
export function initAMCOfferModel(sequelize: Sequelize) {
  return AMCOffer.initModel(sequelize);
}