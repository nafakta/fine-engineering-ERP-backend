// src/models/VendorBillPayment.ts - UPDATED VERSION
import { Sequelize, DataTypes, Model, UUIDV4 } from "sequelize";

export class VendorBillPayment extends Model {
    declare id: string;
    declare bill_id: string;
    declare vendor_id: string;
    // declare purchase_order_id: string | null; // Add this field
    declare payment_date: Date;
    declare bill_amount: number;
    declare remaining_amount: number;
    declare paid_amount: number;
    declare paid_by: string;
    declare place_of_supply: string;
    declare payment_mode: string;
    declare payment_in: string;
    declare notes: string | null;
    declare pay_number: string | null;
    declare created_by: string | null;
    declare account_id: string | null;
    declare created_at: Date;
    declare updated_at: Date;
    declare is_paid: boolean;
    declare attachment: string | null;
    declare status: "Pending" | "Partial" | "Paid" | "Cancelled";
    vendor: any;
    static associate: (models: any) => void;
}

export const initVendorBillPaymentModel = (sequelize: Sequelize) => {
    VendorBillPayment.init(
        {
            id: { type: DataTypes.UUID, defaultValue: UUIDV4, primaryKey: true },
            bill_id: { type: DataTypes.UUID, allowNull: false },
            vendor_id: { type: DataTypes.UUID, allowNull: false },
            // purchase_order_id: {
            //     type: DataTypes.UUID,
            //     allowNull: true, // Make it optional
            //     references: {
            //         model: "purchase_orders",
            //         key: "id"
            //     }
            // },
            payment_date: { type: DataTypes.DATE, allowNull: false },
            bill_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
            remaining_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
            paid_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
            paid_by: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "System User"
            },
            place_of_supply: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "Maharashtra"
            },
            payment_mode: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "NEFT"
            },
            payment_in: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "INR"
            },
            status: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "Pending",
                validate: {
                    isIn: [["Pending", "Partial", "Paid", "Cancelled"]],
                },
            },
            notes: { type: DataTypes.TEXT, allowNull: true },
            pay_number: { type: DataTypes.TEXT, allowNull: true, unique: true },
            attachment: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: { type: DataTypes.UUID, allowNull: true },
            account_id: { type: DataTypes.UUID, allowNull: true },
            is_paid: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            modelName: "VendorBillPayment",
            tableName: "vendor_bill_payments",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            schema: "public",
        }
    );

    return VendorBillPayment;
};