import { Sequelize, DataTypes, Model, UUIDV4 } from "sequelize";
import { SystemUser } from "./SystemUser";

export class Department extends Model {
    declare id: string;
    declare department_name: string;
    declare created_by: string | null;
    declare updated_by: string | null;
    declare created_at: Date;
    declare updated_at: Date;
}

export const initDepartmentModel = (sequelize: Sequelize) => {
    Department.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            department_name: {
                type: DataTypes.STRING(100),
                allowNull: false,
                unique: true,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            updated_by: {
                type: DataTypes.UUID,
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
            modelName: "Department",
            tableName: "department",
            schema: "public",
            timestamps: false, // trigger handles updated_at
        }
    );

    // Optional FK associations (similar to Client)
    Department.belongsTo(SystemUser, {
        foreignKey: "created_by",
        as: "createdBy",
    });
    Department.belongsTo(SystemUser, {
        foreignKey: "updated_by",
        as: "updatedBy",
    });

    return Department;
};
