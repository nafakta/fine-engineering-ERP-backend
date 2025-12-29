import { Sequelize, DataTypes, Model, UUIDV4 } from "sequelize";

// Define the model attributes interface
interface SystemUserActivityAttributes {
    id?: string;                // UUID
    user_activity: string | null;
    uuid?: string;
    activity_timestamp: Date | null;
    module: string | null;
    type: string | null;
    system_user_id: string | null;
}

// Define the model
export class SystemUserActivity
    extends Model<SystemUserActivityAttributes>
    implements SystemUserActivityAttributes {
    public id!: string;                     // UUID Primary Key
    public user_activity!: string | null;
    public uuid!: string;
    public activity_timestamp!: Date | null;
    public module!: string | null;
    public type!: string | null;
    public system_user_id!: string | null;
}

// Initialize and export the model
export const initSystemUserActivityModel = (sequelize: Sequelize) => {
    SystemUserActivity.init(
        {
            id: {
                type: DataTypes.UUID,      // 🔥 UUID instead of INTEGER
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            user_activity: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            uuid: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: true,
            },
            activity_timestamp: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
                allowNull: true,
            },
            module: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            type: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            system_user_id: {
                type: DataTypes.UUID,      // 🔥 Should be UUID (matches DB)
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "SystemUserActivity",
            tableName: "system_user_activity",
            timestamps: false,
        }
    );

    return SystemUserActivity;
};
