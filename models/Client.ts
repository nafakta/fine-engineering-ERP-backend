import { Sequelize, DataTypes, Model, UUIDV4 } from 'sequelize';
import { SystemUser } from './SystemUser';

export class Client extends Model {
    declare id: string;
    declare department: string | null;
    declare company: string | null;
    declare client: string | null;
    declare mobile: string | null;
    declare email_id: string | null;
    declare city: string | null;
    declare state: string | null;
    declare pin_code: string | null;
    declare gstn: string | null;
    declare address: string | null;
    declare shipping_city: string | null;
    declare shipping_state: string | null;
    declare shipping_pincode: string | null;
    declare shipping_address: string | null;
    declare created_on: Date;
    declare updated_on: Date;
    declare created_by: string | null;
    declare updated_by: string | null;
    declare contact_person: string | null;
    declare designation: string | null;
    declare client_designation: string | null; // New field
    declare contact_person_number: string | null; // New field
}

export const initClientModel = (sequelize: Sequelize) => {
    Client.init(
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: UUIDV4,
                allowNull: false,
                primaryKey: true,
            },
            department: { type: DataTypes.TEXT, allowNull: true },
            company: { type: DataTypes.TEXT, allowNull: true },
            client: { type: DataTypes.TEXT, allowNull: true },
            mobile: { type: DataTypes.STRING(20), allowNull: true },
            email_id: { type: DataTypes.TEXT, allowNull: true },
            city: { type: DataTypes.TEXT, allowNull: true },
            state: { type: DataTypes.TEXT, allowNull: true },
            pin_code: { type: DataTypes.STRING(10), allowNull: true },
            gstn: { type: DataTypes.STRING(50), allowNull: true },
            address: { type: DataTypes.TEXT, allowNull: true },
            contact_person: { type: DataTypes.TEXT, allowNull: true },
            designation: { type: DataTypes.TEXT, allowNull: true },
            client_designation: { type: DataTypes.TEXT, allowNull: true }, // New field
            contact_person_number: { type: DataTypes.STRING(20), allowNull: true }, // New field
            shipping_city: { type: DataTypes.TEXT, allowNull: true },
            shipping_state: { type: DataTypes.TEXT, allowNull: true },
            shipping_pincode: { type: DataTypes.STRING(10), allowNull: true },
            shipping_address: { type: DataTypes.TEXT, allowNull: true },
            created_on: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false },
            updated_on: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, allowNull: false },
            created_by: { type: DataTypes.UUID, allowNull: true },
            updated_by: { type: DataTypes.UUID, allowNull: true },
        },
        {
            sequelize,
            modelName: "Client",
            tableName: "clients",
            schema: "public",
            timestamps: false, // Manage created_on/updated_on manually
            hooks: {
                beforeUpdate: (instance: Client) => {
                    instance.updated_on = new Date();
                },
            },
        }
    );

    // Correct associations in the Client model
    Client.belongsTo(SystemUser, { foreignKey: 'created_by', as: 'createdBy' });
    Client.belongsTo(SystemUser, { foreignKey: 'updated_by', as: 'updatedBy' });

    return Client;
};
