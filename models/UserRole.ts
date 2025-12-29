import { Sequelize, DataTypes, Model } from 'sequelize';

export class UserRole extends Model {
  declare system_user_id: string;  // UUID
  declare role_id: string;  // Should also be UUID, not number
}

export const initUserRoleModel = (sequelize: Sequelize) => {
  UserRole.init({
    system_user_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: {
        model: 'system_users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    role_id: {
      type: DataTypes.UUID,  // ← CHANGE THIS FROM INTEGER TO UUID
      primaryKey: true,
      references: {
        model: 'roles',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
  }, {
    sequelize,
    modelName: 'UserRole',
    tableName: 'user_role',
    timestamps: false,
  });

  return UserRole;
};