// src/models/LoanTransaction.ts
import {
    Sequelize,
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    UUIDV4,
} from 'sequelize';

export class LoanTransaction extends Model<
    InferAttributes<LoanTransaction>,
    InferCreationAttributes<LoanTransaction>
> {
    declare id: CreationOptional<string>;
    declare loan_id: string;
    declare amount: number;
    declare transaction_date: Date;
    declare principal_amount: number | null;
    declare remaining_balance: number;
    declare description: string | null;
    declare created_at: CreationOptional<Date>;
    declare created_by: string | null;
    declare account_id: string | null;
}

export const initLoanTransactionModel = (sequelize: Sequelize) => {
    LoanTransaction.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                primaryKey: true,
            },
            loan_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'loans',
                    key: 'id',
                },
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            transaction_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            principal_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            remaining_balance: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'system_users',
                    key: 'id',
                },
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'accounts',
                    key: 'id',
                },
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
        },
        {
            sequelize,
            tableName: 'loan_transactions',
            underscored: true,
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: false,
        }
    );

    return LoanTransaction;
};
