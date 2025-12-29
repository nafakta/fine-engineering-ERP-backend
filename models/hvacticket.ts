import {
    DataTypes,
    Model,
    Sequelize,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from "sequelize";

export class HVACTicket extends Model<
    InferAttributes<HVACTicket>,
    InferCreationAttributes<HVACTicket>
> {
    declare id: CreationOptional<string>;
    declare caller_id: string;
    declare client_id: string | null;
    declare subject: string;
    declare status: string;
    declare category: string | null;
    declare priority: string | null;
    declare assigned_to: string | null;
    declare description: string | null;
    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
    declare created_by: string | null;
    declare shipping_address: string | null;
    declare type: string | null; // quoted "type" in table
}

export function initHVACTicketModel(sequelize: Sequelize) {
    HVACTicket.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4, // DB also has gen_random_uuid(); both are ok
                primaryKey: true,
            },
            caller_id: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            client_id: { // NEW: replaced market_id
                type: DataTypes.UUID,
                allowNull: true,
            },
            subject: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            status: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            category: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            priority: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            assigned_to: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            description: {
                type: DataTypes.TEXT,
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
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            shipping_address: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            type: {
                // maps to "type" column with quotes
                field: "type",
                type: DataTypes.STRING(100),
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "HVACTicket",
            tableName: "hvacticket",
            schema: "public",
            timestamps: false, // we already have created_at/updated_at
        }
    );

    return HVACTicket;
}
