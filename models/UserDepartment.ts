// src/models/UserDepartment.ts
import {
    Model,
    DataTypes,
    Sequelize,
    Optional
} from "sequelize";

export interface UserDepartmentAttributes {
    id: string;
    user_id: string;
    department_id: string;
    created_at?: Date | null;
    updated_at?: Date | null;
}

export interface UserDepartmentCreationAttributes
    extends Optional<UserDepartmentAttributes, "id" | "created_at" | "updated_at"> { }

export class UserDepartment extends Model<UserDepartmentAttributes, UserDepartmentCreationAttributes>
    implements UserDepartmentAttributes {
    public id!: string;
    public user_id!: string;
    public department_id!: string;
    public created_at!: Date | null;
    public updated_at!: Date | null;

    // timestamps are handled by Sequelize config below
}

/**
 * initUserDepartmentModel - follow your project's init naming convention
 */
export const initUserDepartmentModel = (sequelize: Sequelize) => {
    UserDepartment.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            department_id: {
                type: DataTypes.UUID,
                allowNull: false,
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
            tableName: "user_department",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            indexes: [
                {
                    unique: true,
                    fields: ["user_id", "department_id"],
                    name: "user_department_unique",
                },
            ],
        }
    );

    return UserDepartment;
};

export default initUserDepartmentModel;
