import { DataTypes, Model, Sequelize, Optional } from "sequelize";

export interface InvoiceItemAttrs {
    id: string;
    invoice_id: string;
    item_name: string;
    description?: string | null; // ✅ Change to optional
    quantity: number;
    rate: string | number;
    make?: string | null;
    unit?: string | null;
    hsn_sac?: string | null;
    gst_percent?: string | number | null;
    line_total?: string | null;

    created_at?: Date;
    updated_at?: Date;
}

type InvoiceItemCreation = Optional<
    InvoiceItemAttrs,
    "id" | "unit" | "hsn_sac" | "make" | "gst_percent" | "line_total" | "description" // ✅ Add description to optional
>;

export class InvoiceItem extends Model<InvoiceItemAttrs, InvoiceItemCreation> implements InvoiceItemAttrs {
    public id!: string;
    public invoice_id!: string;
    public item_name!: string;
    public description?: string | null; // ✅ Change to optional
    public quantity!: number;
    public make?: string | null;
    public rate!: string | number;
    public unit?: string | null;
    public hsn_sac?: string | null;
    public gst_percent?: string | number | null;
    public line_total?: string | null;

    public readonly created_at!: Date;
    public readonly updated_at!: Date;
}

export const initInvoiceItemModel = (sequelize: Sequelize) => {
    InvoiceItem.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            invoice_id: { type: DataTypes.UUID, allowNull: false },
            item_name: { type: DataTypes.STRING(255), allowNull: false },
            description: { type: DataTypes.TEXT, allowNull: true }, // ✅ Change to allowNull: true
            make: { type: DataTypes.TEXT, allowNull: true },
            quantity: { type: DataTypes.INTEGER, allowNull: false },
            rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
            unit: { type: DataTypes.TEXT, allowNull: true, defaultValue: "NOS" },
            hsn_sac: { type: DataTypes.TEXT, allowNull: true },
            gst_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: true, defaultValue: 0 },
            line_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
        },
        {
            sequelize,
            modelName: "InvoiceItem",
            tableName: "invoice_items",
            schema: "public",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
        }
    );
    return InvoiceItem;
};