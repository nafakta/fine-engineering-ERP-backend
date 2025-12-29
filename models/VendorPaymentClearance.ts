// src/models/VendorPaymentClearance.ts
import {
    Sequelize,
    DataTypes,
    Model,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    Association,
    BelongsToGetAssociationMixin,
    NonAttribute,
} from "sequelize";
import { VendorBillPayment } from "./VendorBillPayment";
import { Vendor } from "./vendor";
import { Account } from "./Banks";
import { OrderBill } from "./OrderBill"; // Assuming you have this model

export class VendorPaymentClearance extends Model<
    InferAttributes<VendorPaymentClearance>,
    InferCreationAttributes<VendorPaymentClearance>
> {
    declare id: CreationOptional<string>;

    // Foreign keys - ONLY THESE THREE ARE REQUIRED
    declare vendor_id: string;
    declare bill_id: string;
    declare purchase_order_id: string;

    // All other fields are optional/creation optional
    declare vendor_bill_payment_id: CreationOptional<string | null>;
    declare account_id: CreationOptional<string | null>;

    // Payment information - all optional
    declare payment_date: CreationOptional<Date | null>;
    declare payment_mode: CreationOptional<string | null>;
    declare payment_in: CreationOptional<string | null>;
    declare cheque_number: CreationOptional<string | null>;
    declare transaction_reference: CreationOptional<string | null>;
    declare bank_name: CreationOptional<string | null>;

    // Amount tracking - all optional
    declare total_amount: CreationOptional<number | null>;
    declare paid_amount: CreationOptional<number | null>;
    declare previous_paid_amount: CreationOptional<number | null>;
    declare remaining_amount: CreationOptional<number | null>;
    declare balance_amount: CreationOptional<number | null>;

    // Payment status tracking - all optional
    declare payment_status: CreationOptional<'PENDING' | 'PARTIAL' | 'FULL' | 'CANCELLED' | null>;
    declare is_fully_paid: CreationOptional<boolean | null>;
    declare payment_stage: CreationOptional<'FIRST' | 'INTERIM' | 'FINAL' | null>;

    // Payment details - all optional
    declare cleared_amount: CreationOptional<number | null>;
    declare cleared_date: CreationOptional<Date | null>;
    declare clearance_status: CreationOptional<'PENDING' | 'CLEARED' | 'BOUNCED' | null>;
    declare clearance_notes: CreationOptional<string | null>;

    // Additional details - all optional
    declare paid_by: CreationOptional<string | null>;
    declare place_of_supply: CreationOptional<string | null>;
    declare notes: CreationOptional<string | null>;
    declare attachment: CreationOptional<string | null>;

    // Audit fields
    declare created_by: CreationOptional<string | null>;
    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
    declare updated_by: CreationOptional<string | null>;

    // Associations
    declare vendor?: NonAttribute<Vendor>;
    declare bill?: NonAttribute<OrderBill>; // Added bill association
    declare vendorBillPayment?: NonAttribute<VendorBillPayment>;
    declare account?: NonAttribute<Account>;

    // Association methods
    declare getVendor: BelongsToGetAssociationMixin<Vendor>;
    declare getBill: BelongsToGetAssociationMixin<OrderBill>; // Added getBill method
    declare getVendorBillPayment: BelongsToGetAssociationMixin<VendorBillPayment>;
    declare getAccount: BelongsToGetAssociationMixin<Account>;

    static associations: {
        vendor: Association<VendorPaymentClearance, Vendor>;
        bill: Association<VendorPaymentClearance, OrderBill>;
        vendorBillPayment: Association<VendorPaymentClearance, VendorBillPayment>;
        account: Association<VendorPaymentClearance, Account>;
    };

    static associate(models: any) {
        VendorPaymentClearance.belongsTo(models.Vendor, {
            foreignKey: 'vendor_id',
            as: 'vendor',
        });

        VendorPaymentClearance.belongsTo(models.OrderBill, {
            foreignKey: 'bill_id',
            as: 'bill',
        });

        VendorPaymentClearance.belongsTo(models.VendorBillPayment, {
            foreignKey: 'vendor_bill_payment_id',
            as: 'vendorBillPayment',
        });

        VendorPaymentClearance.belongsTo(models.Account, {
            foreignKey: 'account_id',
            as: 'account',
        });
    }
}

export const initVendorPaymentClearanceModel = (sequelize: Sequelize) => {
    VendorPaymentClearance.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            // ONLY THESE THREE ARE REQUIRED
            vendor_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'vendors',
                    key: 'id',
                },
            },
            bill_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'order_bills',
                    key: 'id'
                }
            },
            purchase_order_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },

            // ALL OTHER FIELDS ARE OPTIONAL/NULLABLE
            vendor_bill_payment_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'vendor_bill_payments',
                    key: 'id',
                },
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'accounts',
                    key: 'id',
                },
            },

            // Payment information - all nullable
            payment_date: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            payment_mode: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            payment_in: {
                type: DataTypes.STRING(10),
                allowNull: true,
            },
            cheque_number: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            transaction_reference: {
                type: DataTypes.STRING(255),
                allowNull: true,
                unique: true,
            },
            bank_name: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },

            // Amount tracking - all nullable
            total_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            paid_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            previous_paid_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            remaining_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            balance_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },

            // Payment status tracking - all nullable
            payment_status: {
                type: DataTypes.ENUM('PENDING', 'PARTIAL', 'FULL', 'CANCELLED'),
                allowNull: true,
            },
            is_fully_paid: {
                type: DataTypes.BOOLEAN,
                allowNull: true,
            },
            payment_stage: {
                type: DataTypes.ENUM('FIRST', 'INTERIM', 'FINAL'),
                allowNull: true,
            },

            // Payment details - all nullable
            cleared_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            cleared_date: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            clearance_status: {
                type: DataTypes.ENUM('PENDING', 'CLEARED', 'BOUNCED'),
                allowNull: true,
            },
            clearance_notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            // Additional details - all nullable
            paid_by: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            place_of_supply: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            attachment: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            // Audit fields
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            updated_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            sequelize,
            modelName: 'VendorPaymentClearance',
            tableName: 'vendor_payment_clearence',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            underscored: true,
            schema: 'public',
        }
    );

    return VendorPaymentClearance;
};