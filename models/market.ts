import {
    DataTypes,
    Model,
    Sequelize,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional
} from "sequelize";

export interface MarketAttributes {
    id: string;
    company_name: string;
    customer_name: string;
    mobile?: string | null;
    email_id?: string | null;
    location?: string | null;
    assign_to_senior?: string | null; // <-- allow null
    status?: string | null;
    review?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

export class Market extends Model<
    InferAttributes<Market>,
    InferCreationAttributes<Market>
> implements MarketAttributes {
    declare id: CreationOptional<string>;
    declare company_name: string;
    declare customer_name: string;

    // all nullable/optional fields should be optional in the class too:
    declare mobile?: string | null;
    declare email_id?: string | null;
    declare location?: string | null;
    declare status?: string | null;
    declare assign_to_senior?: string | null; // <-- OPTIONAL + nullable
    declare review?: string | null;

    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
}

export const initMarketModel = (sequelize: Sequelize) => {
    Market.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            company_name: { type: DataTypes.STRING(255), allowNull: false },
            customer_name: { type: DataTypes.STRING(255), allowNull: false },
            mobile: { type: DataTypes.STRING(20), allowNull: true },
            email_id: { type: DataTypes.STRING(255), allowNull: true },
            location: { type: DataTypes.STRING(255), allowNull: true },
            status: { type: DataTypes.STRING(100), allowNull: true },
            assign_to_senior: {
                type: DataTypes.STRING(100),
                allowNull: true, // ✅ matches TS (optional + nullable)
            },
            review: { type: DataTypes.TEXT, allowNull: true },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
            },
        },
        {
            sequelize,
            tableName: "market",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
            underscored: true,
        }
    );
    return Market;
};
