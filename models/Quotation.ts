// src/models/Quotation.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface QuotationAttributes {
    id: string;
    boq_id: string;
    vendor_id?: string | null;
    vendor_name: string;
    company_name: string;
    rate: number;
    quotation_date: Date;
    file_name?: string | null;
    file_path?: string | null;
    file_size?: number | null;
    file_mimetype?: string | null;
    status: "submitted" | "approved" | "rejected";
    notes?: string | null;
    created_by?: string | null;
    updated_by?: string | null;
    created_at: Date;
    updated_at: Date;
}

interface QuotationCreationAttributes extends Optional<QuotationAttributes,
    "id" | "status" | "vendor_id" | "file_name" | "file_path" | "file_size" | "file_mimetype" | "notes" | "created_by" | "updated_by" | "created_at" | "updated_at"> { }

export class Quotation extends Model<QuotationAttributes, QuotationCreationAttributes> implements QuotationAttributes {
    public id!: string;
    public boq_id!: string;
    public vendor_id?: string | null;
    public vendor_name!: string;
    public company_name!: string;
    public rate!: number;
    public quotation_date!: Date;
    public file_name?: string | null;
    public file_path?: string | null;
    public file_size?: number | null;
    public file_mimetype?: string | null;
    public status!: "submitted" | "approved" | "rejected";
    public notes?: string | null;
    public created_by?: string | null;
    public updated_by?: string | null;
    public created_at!: Date;
    public updated_at!: Date;

    // Associations
    public readonly boq?: any;
    public readonly vendor?: any;
    public readonly creator?: any;
    public readonly updater?: any;

    static associate(models: any) {
        Quotation.belongsTo(models.Boq, {
            foreignKey: "boq_id",
            as: "quotationBoq",
            onDelete: "CASCADE"
        });

        Quotation.belongsTo(models.Vendor, {
            foreignKey: "vendor_id",
            as: "vendor",
            onDelete: "SET NULL"
        });

        Quotation.belongsTo(models.SystemUser, {
            foreignKey: "created_by",
            as: "creator"
        });

        Quotation.belongsTo(models.SystemUser, {
            foreignKey: "updated_by",
            as: "updater"
        });
    }
}

export const initQuotationModel = (sequelize: Sequelize) => {
    Quotation.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            boq_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: "boqs",
                    key: "id",
                },
            },
            vendor_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "vendors",
                    key: "id",
                },
            },
            vendor_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            company_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            rate: {
                type: DataTypes.DECIMAL(15, 2),
                allowNull: false,
                validate: {
                    min: 0
                }
            },
            quotation_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
            },
            file_name: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            file_path: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            file_size: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            file_mimetype: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM("submitted", "approved", "rejected"),
                defaultValue: "submitted",
                allowNull: false,
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
            },
            updated_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
        },
        {
            sequelize,
            tableName: "quotations",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            indexes: [
                {
                    fields: ["boq_id"]
                },
                {
                    fields: ["vendor_id"]
                },
                {
                    fields: ["company_name"]
                },
                {
                    fields: ["vendor_name"] // CHANGED: from "client_name" to "vendor_name"
                },
                {
                    fields: ["rate"]
                },
                {
                    fields: ["status"]
                },
                {
                    fields: ["quotation_date"]
                }
            ]
        }
    );

    return Quotation;
};