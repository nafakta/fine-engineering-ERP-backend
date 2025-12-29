import { DataTypes, Sequelize } from "sequelize";

export const initGstRecordModel = (sequelize: Sequelize) => {
    const GstRecord = sequelize.define("GstRecord", {
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
        gst_no: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        amount: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
        },
        gst_percent: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: false,
            defaultValue: 0,
        },
        gst_amount: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
        },
        total_amount: {
            type: DataTypes.DECIMAL(14, 2),
            allowNull: false,
        },
        paid_amount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        remaining_amount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        paid_status: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: "UnPaid",
            validate: {
                isIn: [["Paid", "Partially Paid", "UnPaid"]],
            },
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: "gst_records",
        timestamps: false,
    });

    return GstRecord;
};
