// src/models/invoicePayment.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface InvoicePaymentAttributes {
    id: string;
    invoice_id: string;
    account_id: string;
    pay_number: string;
    payment_date: Date;
    invoice_amount: number;
    paid_amount: number;
    paid_by: string;
    place_of_supply?: string;
    payment_mode: string;
    payment_in?: string;
    notes?: string;
    created_by?: string;
    created_at?: Date;
    updated_at?: Date;
    tds_applicable: boolean;
    tds_percent?: number;
    tds_amount: number;
    net_amount_credited?: number;
    tds_type?: 'percent' | 'fixed' | string;
}

interface InvoicePaymentCreationAttributes
    extends Optional<InvoicePaymentAttributes,
        "id" | "place_of_supply" | "payment_in" | "notes" | "created_by" |
        "created_at" | "updated_at" | "tds_percent" | "net_amount_credited" |
        "tds_type"> { }

export class InvoicePayment
    extends Model<InvoicePaymentAttributes, InvoicePaymentCreationAttributes>
    implements InvoicePaymentAttributes {

    public id!: string;
    public invoice_id!: string;
    public account_id!: string;
    public pay_number!: string;
    public payment_date!: Date;
    public invoice_amount!: number;
    public paid_amount!: number;
    public paid_by!: string;
    public place_of_supply?: string;
    public payment_mode!: string;
    public payment_in?: string;
    public notes?: string;
    public created_by?: string;
    public created_at!: Date;
    public updated_at!: Date;

    // ✅ CORRECT THESE TYPES - they should match the interface
    public tds_applicable!: boolean;           // was: string
    public tds_percent?: number;               // was: string
    public tds_amount!: number;                // was: string
    public net_amount_credited?: number;       // was: string
    public tds_type?: 'percent' | 'fixed' | string;  // was: string
}

export const initInvoicePaymentModel = (sequelize: Sequelize) => {
    InvoicePayment.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            invoice_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'invoices',
                    key: 'id',
                },
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'accounts',
                    key: 'id',
                },
            },
            pay_number: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            payment_date: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            invoice_amount: {
                type: DataTypes.DECIMAL(15, 2),
                allowNull: false,
                defaultValue: 0,
            },
            paid_amount: {
                type: DataTypes.DECIMAL(15, 2),
                allowNull: false,
                defaultValue: 0,
            },
            paid_by: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            place_of_supply: {
                type: DataTypes.STRING,
                allowNull: true, // ✅ Change from false to true
                defaultValue: null, // Add default value
            },
            payment_mode: {
                type: DataTypes.ENUM('UPI', 'Bank Transfer', 'Card', 'Cash', 'Cheque', 'NEFT', 'IMPS'),
                allowNull: false,
            },
            payment_in: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            notes: {
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
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
            tds_applicable: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            tds_percent: {
                type: DataTypes.DECIMAL(6, 2),
                allowNull: true,
            },
            tds_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0,
            },
            net_amount_credited: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            tds_type: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
        },
        {
            sequelize,
            tableName: "invoice_payments",
            modelName: "InvoicePayment",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    return InvoicePayment;
};