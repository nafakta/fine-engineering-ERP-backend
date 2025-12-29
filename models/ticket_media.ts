// src/models/ticket_media.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

export interface TicketMediaAttributes {
    id: string;
    ticket_id: string;
    file: string;
    is_upload: boolean;
    created_by?: string | null;
    created_at?: Date;
    updated_at?: Date;
}
type Creation = Optional<TicketMediaAttributes, "id" | "created_by" | "created_at" | "updated_at">;

export function initTicketMediaModel(sequelize: Sequelize) {
    const TicketMedia = sequelize.define<Model<TicketMediaAttributes, Creation>>(
        "TicketMedia",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            ticket_id: { type: DataTypes.UUID, allowNull: false },
            file: { type: DataTypes.TEXT, allowNull: false },
            is_upload: {                     // ✅ NEW COLUMN
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            created_by: { type: DataTypes.UUID, allowNull: true },
            created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
            updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn("now") },
        },
        {
            tableName: "ticket_media",
            schema: "public",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );
    return TicketMedia;
}
