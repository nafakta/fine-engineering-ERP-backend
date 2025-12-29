import { DataTypes, Model, Optional, Sequelize } from "sequelize";
import { BoqItem } from "./boqitem";

interface BoqAttributes {
    id: string;
    title: string;
    boq_number: string;
    status: "draft" | "approved" | "cancelled";
    currency: string;
    notes?: string | null;
    created_by?: string | null;
    updated_by?: string | null;
    created_at: Date;
    updated_at: Date;
}

interface BoqCreationAttributes extends Optional<BoqAttributes, "id" | "status" | "currency" | "created_at" | "updated_at" | "boq_number"> { }

export class Boq extends Model<BoqAttributes, BoqCreationAttributes> implements BoqAttributes {
    public id!: string;
    public title!: string;
    public boq_number!: string;
    public status!: "draft" | "approved" | "cancelled";
    public currency!: string;
    public notes?: string | null;
    public created_by?: string | null;
    public updated_by?: string | null;
    public created_at!: Date;
    public updated_at!: Date;

    public readonly items?: any[];
    public readonly creator?: any;
    public readonly updater?: any;

    static associate(models: any) {
        Boq.hasMany(models.BoqItem, {
            foreignKey: "boq_id",
            as: "items",
            onDelete: "CASCADE"
        });
        BoqItem.hasMany(models.BoqItemFile, {
            foreignKey: "boq_item_id",
            as: "files",
            onDelete: "CASCADE"
        });
        Boq.belongsTo(models.SystemUser, {
            foreignKey: "created_by",
            as: "creator"
        });
        Boq.belongsTo(models.SystemUser, {
            foreignKey: "updated_by",
            as: "updater"
        });
    }
}

export const initBoqModel = (sequelize: Sequelize) => {
    Boq.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            title: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            boq_number: {
                type: DataTypes.TEXT,
                allowNull: true, // ✅ Change to allow null since trigger will generate it
                unique: true,
            },
            status: {
                type: DataTypes.ENUM("draft", "approved", "cancelled"),
                defaultValue: "draft",
                allowNull: false,
            },
            currency: {
                type: DataTypes.CHAR(3),
                defaultValue: "INR",
                allowNull: false,
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
            },
            updated_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id",
                },
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
            tableName: "boqs",
            underscored: true,
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    return Boq;
};