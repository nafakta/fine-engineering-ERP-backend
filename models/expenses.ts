// models/Expense.ts
import {
    Sequelize,
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    UUIDV4,
} from 'sequelize';
import { ExpenseMedia } from './ExpenseMedia';
import { ExpensePayment } from './ExpensePayment';

export class Expense extends Model<
    InferAttributes<Expense>,
    InferCreationAttributes<Expense>
> {
    declare id: CreationOptional<string>;
    declare user_id: string;
    declare reason: string;
    declare amount: number;
    declare expense_date: string;
    declare transaction_date: CreationOptional<Date | null>;
    declare description: CreationOptional<string | null>;
    declare short_description: CreationOptional<string | null>;
    declare department_id: CreationOptional<string | null>;
    declare status: CreationOptional<string>;
    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;

    // ── NEW: add the declaration for is_account so TS knows this attribute exists
    declare is_account: CreationOptional<boolean>;

    // associations
    declare media?: ExpenseMedia[];
    declare payments?: ExpensePayment[];
}

export const initExpenseModel = (sequelize: Sequelize) => {
    Expense.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            reason: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            amount: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                validate: { min: 0.01 },
            },
            expense_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
            },
            transaction_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            short_description: { // NEW
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            department_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'department',
                    key: 'id',
                },
                onDelete: 'SET NULL',
            },

            // ── NEW: is_account attribute
            is_account: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },

            status: {
                type: DataTypes.STRING(20),
                allowNull: false,
                defaultValue: 'pending',
                validate: {
                    isIn: [['pending', 'approved', 'rejected', 'paid']],
                },
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
            modelName: 'Expense',
            tableName: 'expenses',
            schema: 'public',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            underscored: true,
            indexes: [
                { fields: ['user_id'] },
                { fields: ['department_id'] },
                { fields: ['status'] },
                { fields: ['expense_date'] },
                { fields: ['created_at'] },
            ],
        }
    );

    return Expense;
};