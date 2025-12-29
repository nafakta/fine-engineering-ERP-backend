// ticketerp.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

export interface TicketERPAttributes {
    id: string;
    caller_id: string;
    subject: string;
    status: string;
    category?: string | null;
    priority?: string | null;
    assigned_to?: string | null;
    description?: string | null;
    created_at: Date;
    updated_at: Date;
    created_by?: string | null;
    shipping_address?: string | null;
    type?: string | null;
    client_id?: string | null;
    notes?: string | null;
}

export type TicketERPCreationAttributes = Optional<
    TicketERPAttributes,
    "id" | "category" | "priority" | "assigned_to" | "description" |
    "created_by" | "shipping_address" | "type" | "client_id"
>;

export class TicketERP extends Model<TicketERPAttributes, TicketERPCreationAttributes>
    implements TicketERPAttributes {

    public id!: string;
    public caller_id!: string;
    public subject!: string;
    public status!: string;
    public category!: string | null;
    public priority!: string | null;
    public assigned_to!: string | null;
    public description!: string | null;
    public created_at!: Date;
    public updated_at!: Date;
    public created_by!: string | null;
    public shipping_address!: string | null;
    public type!: string | null;
    public client_id!: string | null;
    public notes!: string | null;
    // Timestamps are handled by the database, so we don't need Sequelize's automatic ones
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
    client: any;
}

export function initTicketerpModel(sequelize: Sequelize): typeof TicketERP {
    TicketERP.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
                allowNull: false,
            },
            caller_id: {
                type: DataTypes.STRING(100),
                allowNull: false,
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
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            client_id: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            notes: {
                type: DataTypes.TEXT, // Same type as description
                allowNull: true,     // Allow null values
            },
        },
        {
            sequelize,
            tableName: "ticketerp",
            modelName: "TicketERP",
            timestamps: false, // We're using created_at and updated_at from DB
            underscored: false, // We're using camelCase in model but snake_case in DB
        }
    );

    return TicketERP;
}