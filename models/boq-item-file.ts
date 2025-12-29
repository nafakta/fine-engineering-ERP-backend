// models/boq-item-file.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

interface BoqItemFileAttributes {
    id: string;
    boq_item_id: string;
    file_name: string;
    file_path: string;
    file_type: string;
    file_size: number;
    uploaded_by?: string | null;
    is_primary: boolean;
    sort_order: number;
    created_at: Date;
    updated_at: Date;
}

interface BoqItemFileCreationAttributes extends Optional<
    BoqItemFileAttributes,
    | "id"
    | "uploaded_by"
    | "is_primary"
    | "sort_order"
    | "created_at"
    | "updated_at"
> { }

export class BoqItemFile extends Model<BoqItemFileAttributes, BoqItemFileCreationAttributes> implements BoqItemFileAttributes {
    public id!: string;
    public boq_item_id!: string;
    public file_name!: string;
    public file_path!: string;
    public file_type!: string;
    public file_size!: number;
    public uploaded_by?: string | null;
    public is_primary!: boolean;
    public sort_order!: number;
    public created_at!: Date;
    public updated_at!: Date;

    public readonly boq_item?: any;
    public readonly uploader?: any;

    static associate(models: any) {
        BoqItemFile.belongsTo(models.BoqItem, {
            foreignKey: "boq_item_id",
            as: "boqItem",
            onDelete: "CASCADE"
        });
        BoqItemFile.belongsTo(models.SystemUser, {
            foreignKey: "uploaded_by",
            as: "uploader",
            onDelete: "SET NULL"
        });
    }
}

export const initBoqItemFileModel = (sequelize: Sequelize) => {
    BoqItemFile.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            boq_item_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: { model: "boq_items", key: "id" },
            },
            file_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            file_path: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            file_type: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            file_size: {
                type: DataTypes.BIGINT,
                allowNull: false,
            },
            uploaded_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
            },
            is_primary: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
                allowNull: false,
            },
            sort_order: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
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
        },
        {
            sequelize,
            tableName: "boq_item_files",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    return BoqItemFile;
};