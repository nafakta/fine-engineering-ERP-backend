// models/pi.ts - Complete fixed version
import { Model, DataTypes, Sequelize, Optional } from "sequelize";

interface PiAttributes {
    id: string;
    estimate_id: string | null;
    pi_no: string | null;
    creation_date: Date;
    tax_date: Date;
    created_by: string | null;
    price_inc_tax: number;
    tax_amount: number;
    notes: string | null;
    payment_status: boolean;
    payment_date: Date | null;
    tax_scheme: string | null;
    discount_type: string | null;
    discount_value: number | null;
    is_inter_state: boolean;
    created_at: Date;
    updated_at: Date;
    client_id: string;
    amount: number;
    iscreated: boolean;
    amc_contract_id: string | null;
}

// ✅ Make ALL non-primary key fields optional for creation
interface PiCreationAttributes extends Optional<PiAttributes,
    | "id"
    | "estimate_id"
    | "pi_no"
    | "notes"
    | "payment_status"
    | "payment_date"
    | "tax_scheme"
    | "discount_type"
    | "discount_value"
    | "is_inter_state"
    | "amc_contract_id"
    | "iscreated"
    | "created_at"
    | "updated_at"
    | "creation_date"
    | "tax_date"
    | "created_by"
> { }

export class Pi extends Model<PiAttributes, PiCreationAttributes> implements PiAttributes {
    public id!: string;
    public estimate_id!: string | null;
    public pi_no!: string | null;
    public creation_date!: Date;
    public tax_date!: Date;
    public created_by!: string | null;
    public price_inc_tax!: number;
    public tax_amount!: number;
    public notes!: string | null;
    public payment_status!: boolean;
    public payment_date!: Date | null;
    public tax_scheme!: string | null;
    public discount_type!: string | null;
    public discount_value!: number | null;
    public is_inter_state!: boolean;
    public created_at!: Date;
    public updated_at!: Date;
    public client_id!: string;
    public amount!: number;
    public iscreated!: boolean;
    public amc_contract_id!: string | null;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

export const initPiModel = (sequelize: Sequelize) => {
    Pi.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
                allowNull: false
            },
            estimate_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "estimates",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            },
            pi_no: {
                type: DataTypes.STRING,
                allowNull: true,
                unique: true
            },
            creation_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            tax_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "system_users",
                    key: "id"
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
            },
            price_inc_tax: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            tax_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            payment_status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            payment_date: {
                type: DataTypes.DATE,
                allowNull: true
            },
            tax_scheme: {
                type: DataTypes.STRING,
                allowNull: true
            },
            discount_type: {
                type: DataTypes.STRING,
                allowNull: true
            },
            discount_value: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: true,
                defaultValue: 0.00
            },
            is_inter_state: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            client_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: "clients",
                    key: "id"
                },
                onUpdate: "CASCADE",
                onDelete: "RESTRICT"
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0.00
            },
            iscreated: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false
            },
            amc_contract_id: {
                type: DataTypes.UUID,
                allowNull: true,
                references: {
                    model: "amc_contract",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            }
        },
        {
            sequelize,
            modelName: "Pi",
            tableName: "pi",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
            schema: "public",
        }
    );

    return Pi;
};

export const setupPiAssociations = (db: any) => {
    Pi.belongsTo(db.Client, {
        foreignKey: 'client_id',
        as: 'client',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
    });

    Pi.hasMany(db.PiItem, {
        foreignKey: 'pi_id',
        as: 'items',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    });

    Pi.belongsTo(db.Estimate, {
        foreignKey: 'estimate_id',
        as: 'estimate',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    });

    Pi.belongsTo(db.SystemUser, {
        foreignKey: 'created_by',
        as: 'createdBy',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
    });

    if (db.AmcContract) {
        Pi.belongsTo(db.AmcContract, {
            foreignKey: 'amc_contract_id',
            as: 'amcContract',
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE'
        });
    }
};