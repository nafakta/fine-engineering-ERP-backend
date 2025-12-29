import { Sequelize, Model, DataTypes, ModelStatic, Optional } from 'sequelize';
import { Account } from './Banks';  // Make sure you're importing Account model correctly

interface SettlementAttributes {
    id: string;
    account_id: string;
    transaction_type: 'credit' | 'debit';
    amount: number;
    description?: string | null;
    reason?: string | null;
    created_at?: Date;
    created_by?: string | null;
}

interface SettlementCreationAttributes
    extends Optional<SettlementAttributes, 'id' | 'description' | 'reason' | 'created_at' | 'created_by'> { }

class Settlement extends Model<SettlementAttributes, SettlementCreationAttributes>
    implements SettlementAttributes {
    public id!: string;
    public account_id!: string;
    public transaction_type!: 'credit' | 'debit';
    public amount!: number;
    public description!: string | null;
    public reason!: string | null;
    public created_at!: Date;
    public created_by!: string | null;

    // Define associations here
    static associate() {
        this.belongsTo(Account, { foreignKey: 'account_id', as: 'from_account' });  // Relationship for 'from_account'
        this.belongsTo(Account, { foreignKey: 'account_id', as: 'to_account' });    // Relationship for 'to_account'
    }
}

export function initSettlementModel(sequelize: Sequelize): ModelStatic<Settlement> {
    Settlement.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            transaction_type: {
                type: DataTypes.ENUM('credit', 'debit'),
                allowNull: false,
            },
            amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            reason: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: 'Settlement',
            tableName: 'account_settelment',
            timestamps: false,
            underscored: true,
        }
    );

    // Call associate method to define relationships
    Settlement.associate();

    return Settlement as ModelStatic<Settlement>;
}

export default initSettlementModel;
