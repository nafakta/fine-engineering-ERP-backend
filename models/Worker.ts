// src/models/Worker.ts
import { DataTypes, Model, Sequelize, Optional } from "sequelize";

interface WorkerAttributes {
    id: number;
    worker_name: string;
    mobile?: string | null;
    password_hash: string;
    created_at?: Date;
    updated_at?: Date;
}

interface WorkerCreationAttributes
    extends Optional<WorkerAttributes, "id"> { }

export class Worker
    extends Model<WorkerAttributes, WorkerCreationAttributes>
    implements WorkerAttributes {
    public id!: number;
    public worker_name!: string;
    public mobile!: string | null;
    public password_hash!: string;

    public readonly created_at!: Date;
    public readonly updated_at!: Date;

    static initModel(sequelize: Sequelize): typeof Worker {
        Worker.init(
            {
                id: {
                    type: DataTypes.BIGINT,
                    autoIncrement: true,
                    primaryKey: true,
                },
                worker_name: {
                    type: DataTypes.STRING(100),
                    allowNull: false,
                    unique: true,
                },
                mobile: {
                    type: DataTypes.STRING(20),
                    allowNull: true,
                },
                password_hash: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
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
            },
            {
                sequelize,
                tableName: "workers",
                timestamps: false,
            }
        );

        return Worker;
    }
}
