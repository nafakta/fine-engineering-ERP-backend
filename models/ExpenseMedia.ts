// src/models/ExpenseMedia.ts
import { Sequelize, Model, DataTypes } from 'sequelize';

export class ExpenseMedia extends Model {
    declare id: string;
    declare expense_id: string;
    declare file_path: string;
    declare file_type: string;
    declare created_at: Date;
    declare updated_at: Date;
}

export const initExpenseMediaModel = (sequelize: Sequelize) => {
    ExpenseMedia.init(
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, primaryKey: true },
            expense_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'expenses',
                    key: 'id',
                },
            },
            file_path: { type: DataTypes.STRING(255), allowNull: false },
            file_type: { type: DataTypes.STRING(50), allowNull: false },
            created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: true },
            updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: true },
        },
        {
            sequelize,
            modelName: 'ExpenseMedia',
            tableName: 'expense_media',
            schema: 'public',
            timestamps: false,
            underscored: true,
        }
    );
    return ExpenseMedia;
};
