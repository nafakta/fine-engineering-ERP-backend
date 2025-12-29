import {
    DataTypes,
    Model,
    Sequelize,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
    ForeignKey,
} from "sequelize";
import type { HVACTicket } from "./hvacticket";

export class HVACTicketFollowup extends Model<
    InferAttributes<HVACTicketFollowup>,
    InferCreationAttributes<HVACTicketFollowup>
> {
    declare id: CreationOptional<string>;
    declare hvac_ticket_id: ForeignKey<HVACTicket["id"]>;
    declare notes: string | null;
    declare customer_signature_path: string | null;
    declare technician_signature_path: string | null;
    declare created_by: string | null;
    declare created_at: CreationOptional<Date>;
    declare technician_name: string | null;           // New field
    declare attendant_name: string | null;            // New field
}

export function initHVACTicketFollowupModel(sequelize: Sequelize) {
    HVACTicketFollowup.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            hvac_ticket_id: {
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
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            technician_name: {                         // New field definition
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            attendant_name: {                          // New field definition
                type: DataTypes.STRING(255),
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "HVACTicketFollowup",
            tableName: "hvac_ticket_followup",
            schema: "public",
            timestamps: false,
        }
    );

    return HVACTicketFollowup;
}
