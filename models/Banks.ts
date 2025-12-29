// src/models/Account.ts
import {
  Sequelize,
  DataTypes,
  Model,
  UUIDV4,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export class Account extends Model<
  InferAttributes<Account>,
  InferCreationAttributes<Account>
> {
  declare id: CreationOptional<string>;
  declare accountname: string | null;
  declare bankname: string | null;
  declare accountnumber: string;
  declare ifsc: string | null;
  declare branch: string | null;
  declare initialamount: number | null;

  // timestamps
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export const initAccountModel = (sequelize: Sequelize) => {
  Account.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        allowNull: false,
        primaryKey: true,
      },
      accountname: { type: DataTypes.STRING(500), allowNull: true },
      bankname: { type: DataTypes.STRING(500), allowNull: true },
      accountnumber: { type: DataTypes.STRING(50), allowNull: false },
      ifsc: { type: DataTypes.STRING(225), allowNull: true },
      branch: { type: DataTypes.STRING(500), allowNull: true },
      initialamount: { type: DataTypes.BIGINT, allowNull: true },

      // optional: explicitly define to make typings happy
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'Account',
      tableName: 'accounts',
      schema: 'public',

      // turn timestamps ON and map to snake_case cols
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Account;
};
