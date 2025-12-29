// src/models/Estimate.ts
import { Sequelize, DataTypes, Model, UUIDV4, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";

export class Estimate extends Model<
    InferAttributes<Estimate>,
    InferCreationAttributes<Estimate>
> {
    declare id: CreationOptional<string>;
    declare client_id: string;
    declare subject: string | null;
    declare shipping_address: string | null;
    declare shipping_state: string | null;
    declare tax_scheme: string;
    // declare tds: number;
    declare discount_value: number;
    declare discount_type: "none" | "percent" | "flat";
    declare notes: string | null;
    declare est_no: string;
    declare created_at: Date;
    declare updated_at: Date;
    declare is_invoiced: CreationOptional<boolean>;
    declare invoiced_at: Date | null;
    declare invoice_id: string | null;
    declare created_by: string | null;
    declare total_amount: string;
    declare due_date: Date | null;
    declare service_type: string | null;
    declare status: "pending" | "approved" | "rejected" | "cancelled";
    // Note: updated_by is not in your table, so don't declare it here
}

export const initEstimateModel = (sequelize: Sequelize) => {
    Estimate.init(
        {
            id: { type: DataTypes.UUID, defaultValue: UUIDV4, primaryKey: true, allowNull: false },
            client_id: { type: DataTypes.UUID, allowNull: false, references: { model: "clients", key: "id" } },
            subject: { type: DataTypes.TEXT, allowNull: true },
            shipping_address: { type: DataTypes.TEXT, allowNull: true },
            shipping_state: { type: DataTypes.TEXT, allowNull: true },
            tax_scheme: { type: DataTypes.TEXT, allowNull: false, defaultValue: "No Tax" },
            // tds: {
            //     type: DataTypes.DECIMAL(12, 2),
            //     allowNull: false,
            //     defaultValue: 0,
            //     get() { const v = this.getDataValue("tds") as unknown as string | null; return v === null ? 0 : parseFloat(v); }
            // },
            discount_value: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                defaultValue: 0,
                get() { const v = this.getDataValue("discount_value") as unknown as string | null; return v === null ? 0 : parseFloat(v); }
            },
            discount_type: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "none",
                validate: { isIn: { args: [["none", "percent", "flat"]], msg: "discount_type must be one of: none, percent, flat" } }
            },
            notes: { type: DataTypes.TEXT, allowNull: true },
            est_no: { type: DataTypes.TEXT, allowNull: true, unique: true },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
            is_invoiced: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
            invoiced_at: { type: DataTypes.DATE, allowNull: true },
            invoice_id: { type: DataTypes.UUID, allowNull: true },
            total_amount: { type: DataTypes.TEXT, allowNull: true },
            due_date: { type: DataTypes.DATE, allowNull: true },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: 'system_users',
                    key: 'id'
                }
            },
            service_type: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            status: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "pending",
                validate: {
                    isIn: {
                        args: [["pending", "selected", "rejected", "cancelled"]], // ADD "selected" here
                        msg: "status must be one of: pending, selected, rejected, cancelled"
                    }
                }
            },
        },
        {
            sequelize,
            modelName: "Estimate",
            tableName: "estimates",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            schema: "public",
        }
    );
    return Estimate;
};