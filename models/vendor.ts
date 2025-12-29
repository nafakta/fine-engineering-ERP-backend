import { DataTypes, Model, Optional, Sequelize, HasManyGetAssociationsMixin, HasManyAddAssociationMixin, HasManyHasAssociationMixin, HasManyCountAssociationsMixin, HasManyCreateAssociationMixin, Association } from "sequelize";
import { VendorDocument, VendorDocumentAttributes } from "./VendorDocument";

export interface VendorAttributes {
    id: string;
    company: string;
    vendor: string;
    mobile?: string | null;
    email_id?: string | null;
    city?: string | null;
    state?: string | null;
    pin_code?: string | null;
    gstin?: string | null;
    category?: string | null;
    address?: string | null;
    shipping_address?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

// Add this interface for the included documents
export interface VendorWithDocuments extends VendorAttributes {
    documents?: VendorDocumentAttributes[];
}

type VendorCreationAttributes = Optional<VendorAttributes, "id" | "created_at" | "updated_at">;

export class Vendor extends Model<VendorAttributes, VendorCreationAttributes> implements VendorAttributes {
    public id!: string;
    public company!: string;
    public vendor!: string;
    public mobile!: string | null;
    public email_id!: string | null;
    public city!: string | null;
    public state!: string | null;
    public pin_code!: string | null;
    public gstin!: string | null;
    public category!: string | null;
    public address!: string | null;
    public shipping_address!: string | null;
    public created_at!: Date;
    public updated_at!: Date;

    // association mixins
    public getVendorDocuments!: HasManyGetAssociationsMixin<VendorDocument>;
    public addVendorDocument!: HasManyAddAssociationMixin<VendorDocument, string>;
    public hasVendorDocument!: HasManyHasAssociationMixin<VendorDocument, string>;
    public countVendorDocuments!: HasManyCountAssociationsMixin;
    public createVendorDocument!: HasManyCreateAssociationMixin<VendorDocument>;

    // association declarations
    public readonly documents?: VendorDocument[];

    public static associations: {
        documents: Association<Vendor, VendorDocument>;
    };

    static associate() {
        Vendor.hasMany(VendorDocument, { foreignKey: "vendor_id", as: "documents", onDelete: "CASCADE" });
    }
}

export const initVendorModel = (sequelize: Sequelize) => {
    Vendor.init(
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
            company: { type: DataTypes.STRING(255), allowNull: false },
            vendor: { type: DataTypes.STRING(255), allowNull: false },
            mobile: { type: DataTypes.STRING(20) },
            email_id: { type: DataTypes.STRING(255) },
            city: { type: DataTypes.STRING(100) },
            state: { type: DataTypes.STRING(100) },
            pin_code: { type: DataTypes.STRING(10) },
            gstin: { type: DataTypes.STRING(20) },
            category: { type: DataTypes.STRING(100) },
            address: { type: DataTypes.TEXT },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            shipping_address: { type: DataTypes.TEXT },
        },
        {
            sequelize,
            modelName: "Vendor",
            tableName: "vendors",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );
    return Vendor;
};