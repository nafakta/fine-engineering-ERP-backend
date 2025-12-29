import { DataTypes, Model, Sequelize } from "sequelize";

export default (sequelize: Sequelize) => {
    class TdsRecord extends Model {
        public id!: string;
        public invoice_id!: string;
        public client_id!: string;
        public company_name!: string;
        public base_amount!: number;
        public tds_percent!: number;
        public tds_amount!: number;
        public total_amount!: number;
        public paid_amount!: number;
        public remaining_amount!: number;
        public paid_status!: "Paid" | "UnPaid" | "Partially Paid";
        public tds_paid!: boolean;
        public created_by!: string | null;
        public account_id!: string | null;
        public gst_no!: string | null;
        public readonly created_at!: Date;
        public readonly updated_at!: Date;
        static associate: (models: any) => void;
    }

    TdsRecord.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            invoice_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            client_id: {
                type: DataTypes.UUID,
                allowNull: false,
            },
            company_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            base_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            tds_percent: {
                type: DataTypes.DECIMAL(6, 2),
                allowNull: false,
                defaultValue: 0,
            },
            tds_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            total_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            paid_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0,
            },
            remaining_amount: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0,
            },
            paid_status: {
                type: DataTypes.ENUM("Paid", "Partially Paid", "UnPaid"),
                allowNull: true,
                defaultValue: "UnPaid",
            },
            tds_paid: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            account_id: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal("now()"),
            },
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal("now()"),
            },
            gst_no: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

        },
        {
            sequelize,
            tableName: "tds_records",
            schema: "public",
            timestamps: false, // since you’re already handling created_at/updated_at manually
            indexes: [
                { fields: ["created_at"], name: "idx_tds_records_created_at" },
                { fields: ["invoice_id"], name: "idx_tds_records_invoice_id" },
                { fields: ["paid_status"], name: "idx_tds_records_paid_status" },
            ],
        }
    );

    // 🔗 Associations (optional, if you want relations)
    TdsRecord.associate = (models: any) => {
        TdsRecord.belongsTo(models.Invoice, {
            foreignKey: "invoice_id",
            onDelete: "CASCADE",
        });
        TdsRecord.belongsTo(models.Client, {
            foreignKey: "client_id",
            onDelete: "CASCADE",
        });
        TdsRecord.belongsTo(models.Account, {
            foreignKey: "account_id",
            onDelete: "SET NULL",
        });
        TdsRecord.belongsTo(models.SystemUser, {
            foreignKey: "created_by",
            onDelete: "SET NULL",
        });
    };

    return TdsRecord;
};
