import {
    Sequelize,
    DataTypes,
    Model,
    UUIDV4,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from "sequelize";

export class EstimateItem extends Model<
    InferAttributes<EstimateItem>,
    InferCreationAttributes<EstimateItem>
> {
    declare id: CreationOptional<string>;
    declare estimate_id: string;

    // ✅ New columns
    declare item_name: string;
    declare description: string | null;

    declare unit: string | null;
    declare hsn_sac: string | null;
    declare qty: number;
    declare rate: number;
    declare amount: number | null;
    declare make: string | null;
}

export const initEstimateItemModel = (sequelize: Sequelize) => {
    EstimateItem.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            estimate_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: { model: "estimates", key: "id" },
                // onDelete behavior is set on the ASSOCIATION, not here
            },

            // ✅ New: item_name (short title of item)
            item_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },

            // ✅ New: description (detailed description; was previously item_desc)
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            unit: { type: DataTypes.TEXT, allowNull: true },
            hsn_sac: { type: DataTypes.TEXT, allowNull: true },

            qty: {
                type: DataTypes.DECIMAL(12, 3),
                allowNull: false,
                defaultValue: 1,
                get() {
                    const v = this.getDataValue("qty") as unknown as string | null;
                    return v === null ? 0 : parseFloat(v);
                },
            },
            rate: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                defaultValue: 0,
                get() {
                    const v = this.getDataValue("rate") as unknown as string | null;
                    return v === null ? 0 : parseFloat(v);
                },
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2), // stored generated column in DB
                allowNull: true,
                get() {
                    const v = this.getDataValue("amount") as unknown as string | null;
                    return v === null ? null : parseFloat(v);
                },
            },
            make: { type: DataTypes.TEXT, allowNull: true },
        },
        {
            sequelize,
            modelName: "EstimateItem",
            tableName: "estimate_items",
            timestamps: false,
            underscored: true,
            schema: "public",
        }
    );
    return EstimateItem;
};
