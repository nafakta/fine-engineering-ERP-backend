import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface LoanAccountAttributes {
    id: string;
    account_name: string;
    bank_name: string;
    account_number: string;
    ifsc_code: string;
    branch: string;
    mobile: string;
    reason?: string | null;
    // NEW FIELDS
    job_position?: string | null;
    aadhar_number?: string | null;
    pan_number?: string | null;
    profile_image_path?: string | null;
    profile_image_original_name?: string | null;
    profile_image_mime?: string | null;
    profile_image_size?: number | null;

    created_at: Date;
    created_by?: string | null;
    updated_at: Date;
}

interface LoanAccountCreationAttributes extends Optional<
    LoanAccountAttributes,
    | "id"
    | "reason"
    | "job_position"
    | "aadhar_number"
    | "pan_number"
    | "profile_image_path"
    | "profile_image_original_name"
    | "profile_image_mime"
    | "profile_image_size"
    | "created_at"
    | "created_by"
    | "updated_at"
> { }

export class LoanAccount
    extends Model<LoanAccountAttributes, LoanAccountCreationAttributes>
    implements LoanAccountAttributes {
    public id!: string;
    public account_name!: string;
    public bank_name!: string;
    public account_number!: string;
    public ifsc_code!: string;
    public branch!: string;
    public mobile!: string;
    public reason?: string | null;

    // NEW FIELDS
    public job_position?: string | null;
    public aadhar_number?: string | null;
    public pan_number?: string | null;
    public profile_image_path?: string | null;
    public profile_image_original_name?: string | null;
    public profile_image_mime?: string | null;
    public profile_image_size?: number | null;

    public created_at!: Date;
    public created_by?: string | null;
    public updated_at!: Date;

    static associate(models: any) {
        // Add associations here if needed
    }
}

export const initLoanAccountModel = (sequelize: Sequelize) => {
    LoanAccount.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            account_name: {
                type: DataTypes.STRING(255),
                allowNull: false
            },
            bank_name: {
                type: DataTypes.STRING(255),
                allowNull: false
            },
            account_number: {
                type: DataTypes.STRING(50),
                allowNull: false
            },
            ifsc_code: {
                type: DataTypes.STRING(20),
                allowNull: false
            },
            branch: {
                type: DataTypes.STRING(255),
                allowNull: false
            },
            mobile: {
                type: DataTypes.STRING(15),
                allowNull: false
            },
            reason: {
                type: DataTypes.TEXT,
                allowNull: true
            },

            // 🔹 NEW COLUMNS

            job_position: {
                type: DataTypes.STRING(255),
                allowNull: true
            },
            aadhar_number: {
                type: DataTypes.STRING(20),
                allowNull: true
            },
            pan_number: {
                type: DataTypes.STRING(20),
                allowNull: true
            },
            profile_image_path: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            profile_image_original_name: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            profile_image_mime: {
                type: DataTypes.STRING(100),
                allowNull: true
            },
            profile_image_size: {
                type: DataTypes.BIGINT,
                allowNull: true
            },

            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id"
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
            tableName: "loan_accounts",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at"
        }
    );

    return LoanAccount;
};
