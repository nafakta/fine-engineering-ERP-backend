import { Sequelize, DataTypes, Model } from 'sequelize';

export class Permission extends Model { }

export const initPermissionModel = (sequelize: Sequelize) => {
  Permission.init({
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: 'Permission',
    tableName: 'permissions',
    timestamps: false,
  });

  return Permission;
};
