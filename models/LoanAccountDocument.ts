import { DataTypes, Model, Optional, Sequelize } from "sequelize";

type LoanDocType = "AADHAAR" | "PAN" | "PASSBOOK" | "PHOTO";

interface LoanAccountDocumentAttributes {
    id: string;
    loan_account_id: string;
    doc_type: LoanDocType;
    file_path: string;
    original_name?: string | null;
    mime_type?: string | null;
    file_size?: number | null;
    created_at: Date;
    created_by?: string | null;
}

interface LoanAccountDocumentCreationAttributes extends Optional<
    LoanAccountDocumentAttributes,
    "id" | "original_name" | "mime_type" | "file_size" | "created_at" | "created_by"
> { }

export class LoanAccountDocument
    extends Model<LoanAccountDocumentAttributes, LoanAccountDocumentCreationAttributes>
    implements LoanAccountDocumentAttributes {
    public id!: string;
    public loan_account_id!: string;
    public doc_type!: LoanDocType;
    public file_path!: string;
    public original_name?: string | null;
    public mime_type?: string | null;
    public file_size?: number | null;
    public created_at!: Date;
    public created_by?: string | null;

    static associate(models: any) {
        LoanAccountDocument.belongsTo(models.LoanAccount, {
            foreignKey: "loan_account_id",
            as: "loan_account"
        });
    }
}

export const initLoanAccountDocumentModel = (sequelize: Sequelize) => {
    LoanAccountDocument.init(
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
                    model: "loan_accounts",
                    key: "id"
                }
            },
            doc_type: {
                type: DataTypes.ENUM("AADHAAR", "PAN", "PASSBOOK", "PHOTO"),
                allowNull: false
            },
            file_path: {
                type: DataTypes.TEXT,
                allowNull: false
            },
            original_name: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            mime_type: {
                type: DataTypes.STRING(100),
                allowNull: true
            },
            file_size: {
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
            }
        },
        {
            sequelize,
            tableName: "loan_account_documents",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: false
        }
    );

    return LoanAccountDocument;
};
