import { Model, DataTypes, Sequelize } from "sequelize";

export default (sequelize: Sequelize) => {
  class Category extends Model {
    public id!: string;
    public job_category!: string | null;
    public job_no!: string;
    public description!: string | null;
    public material_type!: string;
    public bar!: string;
    public tempp!: string;
    public qty!: number;
    public remark!: string;
    public client_name!: string | null;
    public drawing_recieved_date!: Date | null;
    public urgent_due_date!: Date | null;
    public is_urgent!: boolean;
    public created_by!: string | null;
    public updated_by!: string | null;
    public readonly created_at!: Date;
    public readonly updated_at!: Date;
  }

  Category.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      job_category: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      job_no: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true, // ✅ REQUIRED
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      material_type: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "No Tax",
      },
      bar: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "No Tax",
      },
      tempp: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "none",
      },
      qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      remark: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      client_name: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      drawing_recieved_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      urgent_due_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      is_urgent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updated_by: {
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
    },
    {
      sequelize,
      modelName: "Category",
      tableName: "category",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Category;
};