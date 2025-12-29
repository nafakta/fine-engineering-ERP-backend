import { Model, DataTypes, Sequelize, CreationOptional } from "sequelize";

export class PiItem extends Model {
    declare id: CreationOptional<string>;
    declare pi_id: string;
    declare item_name: string;
    declare description: string;
    declare quantity: number;
    declare rate: number;
    declare unit: string | null;
    declare hsn_sac: string | null;
    declare gst_percent: number;
    declare line_total: number | null;
    declare created_at: Date;
    declare updated_at: Date;
    declare make: string | null;
}

export const initPiItemModel = (sequelize: Sequelize) => {
    PiItem.init(
        {
            id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
            pi_id: { type: DataTypes.UUID, allowNull: false, references: { model: "pi", key: "id" }, onDelete: "CASCADE" },
            item_name: { type: DataTypes.TEXT, allowNull: false },
            description: { type: DataTypes.TEXT, allowNull: false },
            quantity: { type: DataTypes.INTEGER, allowNull: false },
            make: { type: DataTypes.STRING, allowNull: true },
            rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
            unit: { type: DataTypes.STRING, allowNull: true, defaultValue: "NOS" },
            hsn_sac: { type: DataTypes.STRING, allowNull: true },
            gst_percent: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
            line_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
            created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
            updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        },
        {
            sequelize,
            modelName: "PiItem",
            tableName: "pi_items",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            schema: "public",
        }
    );
    return PiItem;
};