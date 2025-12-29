import { Sequelize, DataTypes, Model, UUIDV4 } from "sequelize";

export class OrderItem extends Model {
    declare id: string;
    declare po_id: string;
    declare item: string;
    declare description: string;
    declare unit: string;
    declare hsn_sac: string | null;
    declare quantity: number;
    declare rate: number;
    declare gst_pct: number;
    declare make: string | null;
}

export const initOrderItemModel = (sequelize: Sequelize) => {
    OrderItem.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true
            },
            po_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: "purchase_orders",
                    key: "id"
                }
            },
            item: {
                type: DataTypes.TEXT,
                allowNull: false
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: false
            },
            unit: {
                type: DataTypes.TEXT,
                allowNull: false
            },
            hsn_sac: {
                type: DataTypes.STRING(10),
                allowNull: true
            },
            make: {
                type: DataTypes.STRING(150),
                allowNull: true
            },
            quantity: {
                type: DataTypes.DECIMAL(12, 3),
                allowNull: false,
                get() {
                    const v = this.getDataValue("quantity") as unknown as string | null;
                    return v === null ? null : parseFloat(v);
                },
            },
            rate: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                get() {
                    const v = this.getDataValue("rate") as unknown as string | null;
                    return v === null ? null : parseFloat(v);
                },
            },
            gst_pct: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 0,
                get() {
                    const v = this.getDataValue("gst_pct") as unknown as string | null;
                    return v === null ? null : parseFloat(v);
                },
            },
        },
        {
            sequelize,
            modelName: "OrderItem",
            tableName: "order_items",
            timestamps: false,
            underscored: true,
            schema: "public",
        }
    );

    return OrderItem;
};