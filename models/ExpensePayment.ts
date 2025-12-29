// models/ExpensePayment.ts
import {
    Sequelize,
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    UUIDV4,
} from 'sequelize';

export class ExpensePayment extends Model<
    InferAttributes<ExpensePayment>,
    InferCreationAttributes<ExpensePayment>
> {
    declare id: CreationOptional<string>;
    declare expense_id: string;
    declare account_id: string | null;
    declare user_id: string;
    declare department_id: string;
    declare amount_paid: number;
    declare payment_date: CreationOptional<Date>;
    declare payment_method: CreationOptional<string>;
    declare transaction_reference: CreationOptional<string | null>;
    declare status: CreationOptional<string>;
    declare notes: CreationOptional<string | null>;
    declare created_by: CreationOptional<string | null>;
    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
    // New columns
    declare total_expense: number;
    declare remaining_expense: number;
    // associations
    declare expense?: any;
    declare account?: any;
}

export const initExpensePaymentModel = (sequelize: Sequelize) => {
    ExpensePayment.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            expense_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'expenses',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'Accounts',
                    key: 'id'
                }
            },
            user_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            department_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'department',
                    key: 'id',
                },
                onDelete: 'RESTRICT',
            },
            amount_paid: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                defaultValue: 0,
                validate: {
                    min: 0,
                },
            },
            total_expense: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                validate: {
                    min: 0.0000001,
                },
            },
            remaining_expense: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                validate: {
                    min: 0,
                },
            },
            payment_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            payment_method: {
                type: DataTypes.STRING(50),
                allowNull: false,
                defaultValue: 'account_transfer',
                validate: {
                    isIn: [['account_transfer', 'cash', 'cheque', 'online', 'card']],
                },
            },
            transaction_reference: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            status: {
                type: DataTypes.STRING(20),
                allowNull: false,
                defaultValue: 'pending', // Changed from 'completed' to 'pending' initially
                validate: {
                    isIn: [['pending', 'completed', 'failed', 'reversed']],
                },
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: {
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
            modelName: 'ExpensePayment',
            tableName: 'expense_payment',
            schema: 'public',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            underscored: true,
            hooks: {
                beforeValidate: (expensePayment: ExpensePayment) => {
                    // Ensure consistency between total_expense, amount_paid, and remaining_expense
                    if (expensePayment.total_expense && expensePayment.amount_paid !== undefined) {
                        expensePayment.remaining_expense = Number(expensePayment.total_expense) - Number(expensePayment.amount_paid);

                        // Auto-update status based on payment amount
                        if (Number(expensePayment.remaining_expense) === 0) {
                            expensePayment.status = 'completed';
                        } else if (Number(expensePayment.amount_paid) > 0) {
                            expensePayment.status = 'pending';
                        }
                    }

                    // Validate that amount_paid doesn't exceed total_expense
                    if (expensePayment.amount_paid > expensePayment.total_expense) {
                        throw new Error('amount_paid cannot exceed total_expense');
                    }
                },
                beforeCreate: (expensePayment: ExpensePayment) => {
                    // Set initial remaining_expense if not provided
                    if (!expensePayment.remaining_expense && expensePayment.total_expense) {
                        expensePayment.remaining_expense = Number(expensePayment.total_expense) - Number(expensePayment.amount_paid || 0);
                    }

                    // Set initial status
                    if (!expensePayment.status) {
                        expensePayment.status = Number(expensePayment.amount_paid || 0) === 0 ? 'pending' :
                            (Number(expensePayment.remaining_expense) === 0 ? 'completed' : 'pending');
                    }
                },
                beforeUpdate: (expensePayment: ExpensePayment) => {
                    // Ensure remaining_expense is updated when amount_paid changes
                    const changedFields = expensePayment.changed();
                    if (changedFields && changedFields.includes('amount_paid') && expensePayment.total_expense) {
                        expensePayment.remaining_expense = Number(expensePayment.total_expense) - Number(expensePayment.amount_paid);

                        // Update status based on remaining amount
                        if (Number(expensePayment.remaining_expense) === 0) {
                            expensePayment.status = 'completed';
                        } else if (Number(expensePayment.amount_paid) > 0) {
                            expensePayment.status = 'pending';
                        }
                    }
                },
            },
            indexes: [
                { fields: ['expense_id'] },
                { fields: ['account_id'] },
                { fields: ['user_id'] },
                { fields: ['department_id'] },
                { fields: ['payment_date'] },
                { fields: ['status'] },
                { fields: ['created_at'] },
                { fields: ['expense_id', 'account_id'] },
                { fields: ['remaining_expense'] }, // New index
            ],
        }
    );

    return ExpensePayment;
};