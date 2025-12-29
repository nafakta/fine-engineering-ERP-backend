import { DataTypes, Model, Optional, Sequelize } from "sequelize";

export type DocType =
    | "gst_certificate"
    | "msme_certificate"
    | "aadhaar_card"
    | "pan_card"
    | "attachment";

export interface VendorDocumentAttributes {
    id: string;
    vendor_id: string;
    document_type: DocType;
    file_path: string;     // relative path like `/uploads/vendor_documents/<vendor_id>/<filename>`
    file_name: string;     // original filename
    file_type: string;     // mimetype
    file_size?: number | null; // bytes
    uploaded_at?: Date | null;
    created_at?: Date | null;
    updated_at?: Date | null;
}

type VendorDocumentCreationAttributes = Optional<
    VendorDocumentAttributes,
    "id" | "uploaded_at" | "created_at" | "updated_at" | "file_size"
>;

export class VendorDocument
    extends Model<VendorDocumentAttributes, VendorDocumentCreationAttributes>
    implements VendorDocumentAttributes {
    public id!: string;
    public vendor_id!: string;
    public document_type!: DocType;
    public file_path!: string;
    public file_name!: string;
    public file_type!: string;
    public file_size!: number | null;
    public uploaded_at!: Date | null;
    public created_at!: Date | null;
    public updated_at!: Date | null;
}

export const initVendorDocumentModel = (sequelize: Sequelize) => {
    VendorDocument.init(
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
            vendor_id: { type: DataTypes.UUID, allowNull: false },
            document_type: {
                type: DataTypes.ENUM("gst_certificate", "msme_certificate", "aadhaar_card", "pan_card", "attachment"),
                allowNull: false,
            },
            file_path: { type: DataTypes.STRING(500), allowNull: false },
            file_name: { type: DataTypes.STRING(255), allowNull: false },
            file_type: { type: DataTypes.STRING(100), allowNull: false },
            file_size: { type: DataTypes.BIGINT, allowNull: true },
            uploaded_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            modelName: "VendorDocument",
            tableName: "vendor_documents",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );
    return VendorDocument;
};
