import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface SystemUserSecretAttributes {
  id: string;
  user_id: string;
  secret_key: string;
  description?: string;
  created_at?: Date;
  updated_at?: Date;
}

interface SystemUserSecretCreationAttributes
  extends Optional<SystemUserSecretAttributes, "id" | "created_at" | "updated_at"> {}

class SystemUserSecret
  extends Model<SystemUserSecretAttributes, SystemUserSecretCreationAttributes>
  implements SystemUserSecretAttributes
{
  public id!: string;
  public user_id!: string;
  public secret_key!: string;
  public description?: string;
  public created_at?: Date;
  public updated_at?: Date;
}

export const initSystemUserSecretModel = (sequelize: Sequelize): typeof SystemUserSecret => {
  SystemUserSecret.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,   // ✅ Sequelize will auto-generate UUID
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      secret_key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,   // ✅ Sequelize enforces uniqueness at DB level
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: "system_user_secret",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SystemUserSecret;
};

export { SystemUserSecret };
