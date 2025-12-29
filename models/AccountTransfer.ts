// src/models/AccountTransfer.ts
import { Model, DataTypes, Optional, Sequelize } from "sequelize";

interface TransferAttrs {
    id: string;
    transfer_from: string;
    transfer_to: string;
    amount: number;
    reason?: string | null;
    transfer_date?: Date;
}
type TransferCreation = Optional<TransferAttrs, "id" | "transfer_date" | "reason">;

export class AccountTransfer
    extends Model<TransferAttrs, TransferCreation>
    implements TransferAttrs {
    public id!: string;
    public transfer_from!: string;
    public transfer_to!: string;
    public amount!: number;
    public reason!: string | null;
    public transfer_date!: Date;
}

export function initAccountTransfer(sequelize: Sequelize) {
    AccountTransfer.init(
        {
            id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
            transfer_from: { type: DataTypes.UUID, allowNull: false },
            transfer_to: { type: DataTypes.UUID, allowNull: false },
            amount: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: false,
                get() {
                    const v = this.getDataValue("amount") as unknown as string;
                    return v == null ? 0 : Number(v);
                },
            },
            reason: { type: DataTypes.TEXT, allowNull: true },
            transfer_date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        },
        { sequelize, tableName: "account_transfers", schema: "public", timestamps: false }
    );

    return AccountTransfer;
}
