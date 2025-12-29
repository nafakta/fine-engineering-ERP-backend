import { Sequelize, DataTypes, Model } from 'sequelize';

export class RolePermission extends Model { }

export const initRolePermissionModel = (sequelize: Sequelize) => {
  RolePermission.init({
    role_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    permission_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
  }, {
    sequelize,
    modelName: 'RolePermission',
    tableName: 'role_permissions',
    timestamps: false,
  });

  return RolePermission;
};
