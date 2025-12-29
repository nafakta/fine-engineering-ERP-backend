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

export class HVACTicketMedia extends Model<
    InferAttributes<HVACTicketMedia>,
    InferCreationAttributes<HVACTicketMedia>
> {
    declare id: CreationOptional<string>;
    declare hvac_ticket_id: ForeignKey<HVACTicket["id"]>;
    declare file: string;
    declare created_by: string | null;
    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
    declare original_name: string | null;
    declare mime_type: string | null;
    declare size: number | null;
}

export function initHVACTicketMediaModel(sequelize: Sequelize) {
    HVACTicketMedia.init(
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
            file: {
                type: DataTypes.TEXT,
                allowNull: false,
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
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            original_name: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            mime_type: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            size: {
                type: DataTypes.BIGINT,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "HVACTicketMedia",
            tableName: "hvac_ticket_media",
            schema: "public",
            timestamps: false,
        }
    );

    return HVACTicketMedia;
}
