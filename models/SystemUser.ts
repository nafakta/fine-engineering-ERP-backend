// models/SystemUser.ts
import { Sequelize, DataTypes, Model, UUIDV4 } from 'sequelize';
import db from '../models';

export class SystemUser extends Model {
  declare id: string;
  declare name: string;
  declare mobile_number?: string;
  declare email?: string;
  declare password?: string;
  declare created_at?: Date;
  declare updated_at?: Date;
  declare totp_secret?: string;
  declare deleted_at?: Date;
}

export const initSystemUserModel = (sequelize: Sequelize) => {
  SystemUser.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: UUIDV4,
        primaryKey: true,
      },
      name: DataTypes.STRING,
      mobile_number: DataTypes.STRING,
      email: DataTypes.STRING,
      password: DataTypes.STRING,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
      totp_secret: DataTypes.STRING,
      deleted_at: DataTypes.DATE,
    },
    {
      sequelize,
      modelName: 'SystemUser',
      tableName: 'system_users',
      timestamps: false,  // manually manage timestamps
    }
  );

  return SystemUser;
};
