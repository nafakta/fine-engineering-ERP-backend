// src/models/ticket_followup.ts
import {
    DataTypes,
    Model,
    Sequelize,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    ForeignKey,
} from "sequelize";
// ⬇️ make this a TYPE-ONLY import to avoid runtime cycle
import type { TicketERP } from "./ticketerp";

export class TicketFollowup extends Model<
    InferAttributes<TicketFollowup>,
    InferCreationAttributes<TicketFollowup>
> {
    declare id: CreationOptional<string>;
    declare ticket_id: ForeignKey<TicketERP["id"]>;
    declare notes: string | null;
    declare customer_signature_path: string | null;
    declare technician_signature_path: string | null;
    declare created_by: string | null;
    declare created_at: CreationOptional<Date>;
    declare attendant_name: string | null;           // New field
    declare technician_name: string | null;
}

export function initTicketFollowupModel(sequelize: Sequelize) {
    TicketFollowup.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            ticket_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            customer_signature_path: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            technician_signature_path: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            attendant_name: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            technician_name: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            sequelize,
            tableName: "ticket_followup",
            schema: "public",
            timestamps: false,
        }
    );

    return TicketFollowup;
}
