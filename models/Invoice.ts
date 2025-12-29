import { Model, DataTypes, Sequelize, Optional } from "sequelize";

export type DiscountType = "none" | "percent" | "flat";

export interface InvoiceAttributes {
    id: string;
    estimate_id: string | null;
    client_id: string;
    invoice_no: string | null;
    creation_date: Date;
    tax_date: Date;
    created_by: string | null;
    amount: number;
    price_inc_tax: number;
    tax_amount: number;
    notes: string | null;
    paid_amount: number;
    remaining_amount: number;
    payment_status: boolean;
    payment_date: Date | null;
    tax_scheme: string | null;
    discount_type: DiscountType | null;
    discount_value: number | null;
    is_inter_state: boolean;
    pi_id: string | null;
    account_id: string | null;
    created_at: Date;
    updated_at: Date;
}

interface InvoiceCreationAttributes extends Optional<InvoiceAttributes,
    | "id"
    | "estimate_id"
    | "invoice_no"
    | "created_by"
    | "notes"
    | "paid_amount"
    | "remaining_amount"
    | "payment_status"
    | "payment_date"
    | "tax_scheme"
    | "discount_type"
    | "discount_value"
    | "is_inter_state"
    | "pi_id"
    | "account_id"
> { }

export class Invoice extends Model<InvoiceAttributes, InvoiceCreationAttributes> implements InvoiceAttributes {
    public id!: string;
    public estimate_id!: string | null;
    public client_id!: string;
    public invoice_no!: string | null;
    public creation_date!: Date;
    public tax_date!: Date;
    public created_by!: string | null;
    public amount!: number;
    public price_inc_tax!: number;
    public tax_amount!: number;
    public notes!: string | null;
    public paid_amount!: number;
    public remaining_amount!: number;
    public payment_status!: boolean;
    public payment_date!: Date | null;
    public tax_scheme!: string | null;
    public discount_type!: DiscountType | null;
    public discount_value!: number | null;
    public is_inter_state!: boolean;
    public pi_id!: string | null;
    public account_id!: string | null;
    public created_at!: Date;
    public updated_at!: Date;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

export const initInvoiceModel = (sequelize: Sequelize) => {
    Invoice.init(
        {
            id: {
                type: DataTypes.UUID,
                primaryKey: true,
                defaultValue: DataTypes.UUIDV4
            },
            estimate_id: {
                type: DataTypes.UUID,
                allowNull: true
            },
            client_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: "clients",
                    key: "id"
                },
                onUpdate: "CASCADE",
                onDelete: "RESTRICT"
            },
            invoice_no: {
                type: DataTypes.STRING,
                allowNull: true,
                unique: true
            },
            creation_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            tax_date: {
                type: DataTypes.DATEONLY,
                allowNull: false
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id"
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            price_inc_tax: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            tax_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            paid_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            remaining_amount: {
                type: DataTypes.DECIMAL(18, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            payment_status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            payment_date: {
                type: DataTypes.DATE,
                allowNull: true
            },
            tax_scheme: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            discount_type: {
                type: DataTypes.STRING,
                allowNull: true
            },
            discount_value: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: true
            },
            is_inter_state: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            pi_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "pi",
                    key: "id"
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL"
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: true
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
        },
        {
            sequelize,
            modelName: "Invoice",
            tableName: "invoices",
            schema: "public",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
        }
    );

    return Invoice;
};

// Association setup function
export const setupInvoiceAssociations = (db: any) => {
    Invoice.belongsTo(db.SystemUser, {
        foreignKey: 'created_by',
        as: 'createdByUser'
    });

    Invoice.belongsTo(db.Client, {
        foreignKey: 'client_id',
        as: 'client',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
    });

    Invoice.belongsTo(db.Pi, {
        foreignKey: 'pi_id',
        as: 'pi',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    });

    Invoice.belongsTo(db.Estimate, {
        foreignKey: 'estimate_id',
        as: 'estimate',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    });

    Invoice.hasMany(db.InvoiceItem, {
        foreignKey: 'invoice_id',
        as: 'items',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });
};