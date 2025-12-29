import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface BoqItemAttributes {
    id: string;
    boq_id: string;
    section_label?: string | null;
    item_code?: string | null;
    make?: string | null;          // 👈 NEW
    description: string;
    unit: string;
    quantity: number;
    sort_order: number;
    is_optional: boolean;
    created_at: Date;
    updated_at: Date;
    line_subtotal?: number | string | null;
    line_tax?: number | string | null;
    line_total?: number | string | null;
}

interface BoqItemCreationAttributes extends Optional<
    BoqItemAttributes,
    | "id"
    | "section_label"
    | "item_code"
    | "make"
    | "sort_order"
    | "is_optional"
    | "created_at"
    | "updated_at"
    | "line_subtotal"
    | "line_tax"
    | "line_total"
> { }

export class BoqItem
    extends Model<BoqItemAttributes, BoqItemCreationAttributes>
    implements BoqItemAttributes {
    public id!: string;
    public boq_id!: string;
    public section_label?: string | null;
    public item_code?: string | null;
    public make?: string | null;          // 👈 NEW
    public description!: string;
    public unit!: string;
    public quantity!: number;
    public sort_order!: number;
    public is_optional!: boolean;
    public created_at!: Date;
    public updated_at!: Date;
    public line_subtotal?: number | string | null;
    public line_tax?: number | string | null;
    public line_total?: number | string | null;

    public readonly boq?: any;

    static associate(models: any) {
        BoqItem.belongsTo(models.Boq, { foreignKey: "boq_id", as: "boq" });
    }
}

export const initBoqItemModel = (sequelize: Sequelize) => {
    BoqItem.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            boq_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: { model: "boqs", key: "id" },
            },
            section_label: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            item_code: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            make: {
                type: DataTypes.TEXT,
                allowNull: true,          // 👈 NEW
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            unit: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            quantity: {
                type: DataTypes.DECIMAL(14, 3),
                allowNull: false,
                validate: { min: 0.001 },
            },

            // ❌ rate / discount_pct / gst_pct removed

            sort_order: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false,
            },
            is_optional: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
                allowNull: false,
            },
            created_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },
            updated_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: false,
            },

            // match DB numeric(16,2) – Sequelize will return strings by default
            line_subtotal: {
                type: DataTypes.DECIMAL(16, 2),
                allowNull: true,
            },
            line_tax: {
                type: DataTypes.DECIMAL(16, 2),
                allowNull: true,
            },
            line_total: {
                type: DataTypes.DECIMAL(16, 2),
                allowNull: true,
            },
        },
        {
            sequelize,
            tableName: "boq_items",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    return BoqItem;
};
