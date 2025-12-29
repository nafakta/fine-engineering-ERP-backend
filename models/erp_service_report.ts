// src/models/erp_service_report.ts
import { DataTypes, Model, Optional, Sequelize } from "sequelize";

export interface ErpServiceReportAttributes {
    id: string;
    erp_id: string;
    service_report: string;
    service_date: Date;
    service_type: string;
    company_name: string;
    instructed_by: string;
    address: string;
    model_no: string;
    serial_no: string;
    type: string;
    observation?: string | null;
    work_done?: string | null;
    additional_work_1?: string | null;
    additional_work_2?: string | null;
    pdf_path?: string | null;
    pdf_url?: string | null;
    created_at: Date;
    client_id?: string | null;
    report_id?: string | null;
    created_by?: string | null;
}

export type ErpServiceReportCreationAttributes = Optional<
    ErpServiceReportAttributes,
    "id" | "observation" | "work_done" | "additional_work_1" | "additional_work_2" | "pdf_path" | "pdf_url" | "created_at" | "report_id"
>;

export class ErpServiceReport extends Model<ErpServiceReportAttributes, ErpServiceReportCreationAttributes>
    implements ErpServiceReportAttributes {

    public id!: string;
    public erp_id!: string;
    public service_report!: string;
    public service_date!: Date;
    public service_type!: string;
    public company_name!: string;
    public instructed_by!: string;
    public address!: string;
    public model_no!: string;
    public serial_no!: string;
    public type!: string;
    public observation!: string | null;
    public work_done!: string | null;
    public additional_work_1!: string | null;
    public additional_work_2!: string | null;
    public pdf_path!: string | null;
    public pdf_url!: string | null;
    public created_at!: Date;
    public client_id!: string | null;
    public report_id!: string | null;
    public created_by!: string | null;
    // Remove updatedAt since it doesn't exist in the database
    // public readonly updatedAt!: Date;
}

export function initErpServiceReportModel(sequelize: Sequelize): typeof ErpServiceReport {
    ErpServiceReport.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
                allowNull: false,
            },
            erp_id: {
                type: DataTypes.UUID,
                allowNull: false,
                references: {
                    model: 'ticketerp',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            service_report: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            service_date: {
                type: DataTypes.DATEONLY,
                allowNull: false,
            },
            service_type: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            company_name: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            instructed_by: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            address: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            model_no: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            serial_no: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            type: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            observation: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            work_done: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            additional_work_1: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            additional_work_2: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            pdf_path: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            pdf_url: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            client_id: {
                type: DataTypes.UUID,
                allowNull: true,
            },
            report_id: {
                type: DataTypes.STRING(50),
                allowNull: true,
                unique: true, // matches CONSTRAINT erp_service_report_report_id_key UNIQUE (report_id)
            },
            created_by: {
                type: DataTypes.UUID,
                allowNull: true,
            },
        },
        {
            sequelize,
            tableName: "erp_service_report",
            modelName: "ErpServiceReport",
            timestamps: false, // Disable Sequelize timestamps since we only have created_at
            underscored: true, // Use snake_case for field names
        }
    );

    return ErpServiceReport;
}