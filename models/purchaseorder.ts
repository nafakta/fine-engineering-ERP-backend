import { Sequelize, DataTypes, Model, UUIDV4 } from "sequelize";

export class PurchaseOrder extends Model {
    declare id: string;
    declare po_number: number;
    declare vendor_id: string;
    declare delivery_address: string | null;
    declare delivery_phone: string | null;
    declare notes: string | null;
    declare status: "draft" | "approved" | "cancelled";
    declare purchase_type: "air_conditioning" | "HVAC" | null;
    declare shipping_address?: string | null;
    declare shipping_state?: string | null;
    declare created_by: string;  // NEW
    declare updated_by?: string;  // optional
    declare created_at: Date;
    declare updated_at: Date;
    declare site_issue: string | null;
    declare signed_po_file?: string | null;
    declare signed_po_uploaded_at?: Date | null;
    declare signed_po_uploaded_by?: string | null;
    static associate: (models: any) => void;
}

export const initPurchaseOrderModel = (sequelize: Sequelize) => {
    PurchaseOrder.init(
        {
            id: { type: DataTypes.UUID, defaultValue: UUIDV4, primaryKey: true, allowNull: false },
            po_number: { type: DataTypes.INTEGER, allowNull: false, autoIncrement: true },
            vendor_id: { type: DataTypes.UUID, allowNull: false, references: { model: "vendors", key: "id" } },
            delivery_address: { type: DataTypes.TEXT, allowNull: true },
            delivery_phone: { type: DataTypes.TEXT, allowNull: true },
            notes: { type: DataTypes.TEXT, allowNull: true },
            purchase_type: {
                type: DataTypes.ENUM("air_conditioning", "HVAC"),
                allowNull: true,
                defaultValue: null,
            },
            status: {
                type: DataTypes.ENUM("draft", "approved", "cancelled"),
                allowNull: false,
                defaultValue: "draft",
            },
            signed_po_file: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            signed_po_uploaded_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            signed_po_uploaded_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
            },
            shipping_address: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            shipping_state: {
                type: DataTypes.STRING(128),
                allowNull: true,
            },
            site_issue: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: { type: DataTypes.UUID, allowNull: false },
            updated_by: { type: DataTypes.UUID, allowNull: true },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            modelName: "PurchaseOrder",
            tableName: "purchase_orders",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            schema: "public",
        }
    );

    PurchaseOrder.associate = function (models) {
        PurchaseOrder.hasMany(models.VendorBillPayment, {
            foreignKey: 'purchase_order_id',
            as: 'billPayments'
        });
    };

    return PurchaseOrder;
};