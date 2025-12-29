// src/models/Loan.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface LoanAttributes {
    id: string;
    loan_account_id: string;
    account_id: string;
    loan_type: 'TAKE_LOAN' | 'GIVE_LOAN';
    amount: number;
    start_date: Date;
    end_date?: Date | null;
    status: 'ACTIVE' | 'CLOSED' | 'SETTLED' | 'DEFAULTED';
    remaining_balance: number;
    total_principal_paid: number;
    description?: string | null;
    created_at: Date;
    updated_at: Date;
    created_by?: string | null;
}

interface LoanCreationAttributes extends Optional<
    LoanAttributes,
    | "id"
    | "end_date"
    | "total_principal_paid"
    | "description"
    | "created_at"
    | "updated_at"
    | "created_by"
> { }

// Add these interfaces for relations
export interface LoanAccountRelation {
    id: string;
    account_name: string;
    bank_name: string;
    account_number: string;
    ifsc_code?: string;
    branch?: string;
    mobile?: string;
}

export interface AccountRelation {
    id: string;
    accountname?: string;
    bankname?: string;
    accountnumber: string;
    ifsc?: string;
    branch?: string;
}

export interface LoanWithRelations extends LoanAttributes {
    loanAccount?: LoanAccountRelation;
    account?: AccountRelation;
}

export class Loan extends Model<LoanAttributes, LoanCreationAttributes> implements LoanAttributes {
    public id!: string;
    public loan_account_id!: string;
    public account_id!: string;
    public loan_type!: 'TAKE_LOAN' | 'GIVE_LOAN';
    public amount!: number;
    public start_date!: Date;
    public end_date?: Date | null;
    public status!: 'ACTIVE' | 'CLOSED' | 'SETTLED' | 'DEFAULTED';
    public remaining_balance!: number;
    public total_principal_paid!: number;
    public description?: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public created_by?: string | null;

    // Add these for TypeScript to recognize the associations
    public loanAccount?: LoanAccountRelation;
    public account?: AccountRelation;

    static associate(models: any) {
        Loan.belongsTo(models.LoanAccount, {
            foreignKey: 'loan_account_id',
            as: 'loanAccount'
        });
        Loan.belongsTo(models.Account, {
            foreignKey: 'account_id',
            as: 'account'
        });
    }
}

export const initLoanModel = (sequelize: Sequelize) => {
    Loan.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            loan_account_id: {
                type: DataTypes.STRING(255),
                allowNull: false,
                references: {
                    model: 'loan_accounts',
                    key: 'id'
                }
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'accounts',
                    key: 'id'
                }
            },
            loan_type: {
                type: DataTypes.ENUM('TAKE_LOAN', 'GIVE_LOAN'),
                allowNull: false
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            start_date: {
                type: DataTypes.DATEONLY,
                allowNull: false
            },
            end_date: {
                type: DataTypes.DATEONLY,
                allowNull: true
            },
            status: {
                type: DataTypes.ENUM('ACTIVE', 'CLOSED', 'SETTLED', 'DEFAULTED'),
                defaultValue: 'ACTIVE',
                allowNull: false
            },
            remaining_balance: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            total_principal_paid: {
                type: DataTypes.DECIMAL(14, 2),
                defaultValue: 0,
                allowNull: false
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'system_users',
                    key: 'id'
                }
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false
            }
        },
        {
            sequelize,
            tableName: "loans",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at"
        }
    );

    return Loan;
};