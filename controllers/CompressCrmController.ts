import { Request, Response } from "express";
import BaseController from "./BaseController";
import logger from "../utils/logger";
import DBServices from "../database/DBService";
import { SystemUserSecret } from "../models/SystemUserSecret";
import { SystemUserActivity } from "../models/SystemUserActivity";
import { QueryTypes } from "sequelize";
import bcrypt from "bcrypt";
import "../config/production/env_config";
import speakeasy from "speakeasy";
import jwt from "jsonwebtoken";
import qrcode from "qrcode";
import { v4 as uuidv4 } from "uuid";
import * as Yup from "yup";
import { JWT_SECRET } from "../config/jwt";
import {
  createUserSchema,
  deleteUserSchema,
  getUserDetailsSchema,
  updateUserSchema,
  loginSchema,
  verifytotpSchema,
  fetchsecretkeySchema,
  deletesecretkeySchema,
  resetPasswordSchema,
  logUserActivitySchema,
  filteruseractivitySchema,
} from "./Validations";
import { tokenBlacklist } from "../utils/tokenBlacklisted";
// ✅ Always load from ENV (never hardcode in production)
// const SECRET_KEY = process.env.JWT_SECRET || "fallback_secret";

// const JWT_SECRET = process.env.JWT_SECRET || "super_secret_change_me";

export default class CompressCrmController extends BaseController {

  db_services: DBServices = new DBServices();
  constructor() {
    super();
    logger.info("Compresscrm instantiated");

  }

  public createUser = async (req: Request, res: Response): Promise<void> => {
    const t = await this.db_services.sequelizeWriter.transaction();

    try {
      // 🔒 Authentication check using userId
      const authUser = (req as any)?.user;
      if (!authUser || !authUser.userId) {
        await t.rollback();
        return this.sendError(res, {}, "Unauthorized - Please login again", 401);
      }

      await createUserSchema.validate(req.body, { abortEarly: false });
      const { name, mobile_number, email, password, roleLevel, departmentId } = req.body;

      // Check if user already exists
      const existing = await this.db_services.sequelizeWriter.query(
        `SELECT email, mobile_number
       FROM public.system_users
      WHERE (email = :email OR mobile_number = :mobile_number)
        AND deleted_at IS NULL`,
        {
          replacements: { email, mobile_number },
          type: QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (existing.length) {
        const msgs: string[] = [];
        if (existing.some((u: any) => u.email === email))
          msgs.push("Email is already in use");
        if (existing.some((u: any) => u.mobile_number === mobile_number))
          msgs.push("Mobile number is already in use");
        await t.rollback();
        return this.sendError(res, {}, msgs.join(", "), 409);
      }

      const userId = uuidv4();
      const hash = await bcrypt.hash(password, 10);

      // Create system user
      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.system_users
         (id, name, mobile_number, email, password, created_at, updated_at)
     VALUES (:id, :name, :mobile_number, :email, :password, NOW(), NOW())`,
        {
          replacements: { id: userId, name, mobile_number, email, password: hash },
          type: QueryTypes.INSERT,
          transaction: t,
        }
      );

      // Get role details
      const roleRows = await this.db_services.sequelizeWriter.query(
        `SELECT id, name FROM public.roles WHERE level = :roleLevel`,
        { replacements: { roleLevel }, type: QueryTypes.SELECT, transaction: t }
      );

      if (!roleRows.length) {
        await t.rollback();
        return this.sendError(res, {}, "Role not found", 404);
      }

      const roleId = (roleRows[0] as any).id;
      const roleName = (roleRows[0] as any).name;

      // Insert into user_role
      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.user_role (system_user_id, role_id)
     VALUES (:userId, :roleId)`,
        {
          replacements: { userId, roleId },
          type: QueryTypes.INSERT,
          transaction: t,
        }
      );

      // NEW: Insert into user_department table if departmentId is provided
      let departmentAssigned = false;
      if (departmentId) {
        try {
          // Try to insert directly - the department check might be handled by foreign key constraint
          await this.db_services.sequelizeWriter.query(
            `INSERT INTO public.user_department (user_id, department_id, created_at, updated_at)
         VALUES (:userId, :departmentId, NOW(), NOW())`,
            {
              replacements: { userId, departmentId },
              type: QueryTypes.INSERT,
              transaction: t,
            }
          );
          departmentAssigned = true;
        } catch (deptError: any) {
          // If it fails due to foreign key constraint, the department doesn't exist
          // Or the user_department table might not exist
          console.warn("Error assigning department:", deptError.message);
          // Don't rollback the entire transaction - just skip department assignment
          logger.warn("Skipping department assignment due to error");
        }
      }

      // Check role permissions
      const rolePerms = await this.db_services.sequelizeWriter.query(
        `SELECT permission_id FROM public.role_permissions WHERE role_id = :roleId`,
        { replacements: { roleId }, type: QueryTypes.SELECT, transaction: t }
      );

      if (!rolePerms.length) {
        await t.rollback();
        return this.sendError(
          res,
          {},
          `No permissions assigned to the role ${roleName}`,
          404
        );
      }

      // 📝 Activity log
      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.system_user_activity 
       (user_activity, activity_timestamp, module, type, system_user_id)
     VALUES (:user_activity, NOW(), :module, :type, :system_user_id)`,
        {
          replacements: {
            user_activity: `Created user ${name}`,
            module: "user_management",
            type: "create",
            system_user_id: authUser.userId,
          },
          type: QueryTypes.INSERT,
          transaction: t,
        }
      );

      // Commit everything
      await t.commit();

      return this.sendSuccess(
        res,
        {
          userId,
          role: roleName,
          departmentAssigned
        },
        "User registered successfully with role and permissions" +
        (departmentAssigned ? " and department assignment" : "")
      );
    } catch (err: any) {
      try {
        await t.rollback();
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }

      if (err instanceof Yup.ValidationError) {
        return this.sendError(res, {}, err.errors.join(", "), 400);
      }
      logger.error("Error in createUser", { error: err });
      return this.sendError(res, err, "Internal server error", 500);
    }
  };

  //Function to Handle Rest password
  public resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body

      await resetPasswordSchema.validate(req.body, { abortEarly: false });

      const { email, new_password } = req.body;

      // Ensure either email or mobile number is provided


      // Find user by email or mobile number
      const userQuery = `
        SELECT id FROM system_users 
        WHERE (email = :email ) 
        AND deleted_at IS NULL;
      `;

      const user = await this.db_services.sequelizeReader.query(userQuery, {
        replacements: { email, },
        type: QueryTypes.SELECT,
      });

      if (!user || user.length === 0) {
        return this.sendError(res, {}, "User not found", 404);
      }

      const userId = (user[0] as any).id;

      // Hash the new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(new_password, saltRounds);

      // Update password
      const updatePasswordQuery = `
        UPDATE system_users 
        SET password = :hashedPassword, updated_at = NOW()
        WHERE id = :userId;
      `;

      await this.db_services.sequelizeWriter.query(updatePasswordQuery, {
        replacements: { hashedPassword, userId },
        type: QueryTypes.UPDATE,
      });

      this.sendSuccess(res, { userId }, "Password reset successfully", 200);
    } catch (err: unknown) {
      if (err instanceof Yup.ValidationError) {
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        logger.error("Error occurred in resetPassword", { error: err });
        this.sendError(res, err, "Internal server error", 500);
      }
    }
  };
  // Function to handle user login
  public authLogin = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      await loginSchema.validate(req.body, { abortEarly: false });

      const { email, password } = req.body;

      // Query to fetch user details along with their role
      const userDetailsQuery = `
        SELECT 
          system_users.id, 
          system_users.name, 
          system_users.password, 
          system_users.mobile_number,
          user_role.role_id, 
          roles.name AS role_name, 
          roles.level AS role_level
        FROM 
          system_users
        LEFT JOIN 
          user_role ON user_role.system_user_id = system_users.id
        LEFT JOIN 
          roles ON roles.id = user_role.role_id
        WHERE 
          system_users.email = :email 
          AND system_users.deleted_at IS NULL
      `;

      const userDetailsResults: any[] = await this.db_services.sequelizeWriter.query(userDetailsQuery, {
        replacements: { email },
        type: QueryTypes.SELECT,
      });

      if (userDetailsResults.length === 0) {
        this.sendError(res, {}, "Invalid credentials", 401);
        return;
      }

      const user = userDetailsResults[0];

      // Compare password with stored hash
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        this.sendError(res, {}, "Invalid credentials", 401);
        return;
      }

      // Query to fetch permissions based on the user's role
      const rolePermissionsQuery = `
        SELECT 
          permissions.id AS permission_id, 
          permissions.name AS permission_name, 
          permissions.description AS permission_description
        FROM 
          role_permissions
        INNER JOIN 
          permissions ON permissions.id = role_permissions.permission_id
        WHERE 
          role_permissions.role_id = :role_id
      `;
      const rolePermissionsResults: any[] = await this.db_services.sequelizeWriter.query(rolePermissionsQuery, {
        replacements: { role_id: user.role_id },
        type: QueryTypes.SELECT,
      });

      // Deduplicate and structure permissions
      const uniquePermissions = Array.from(
        new Map(
          rolePermissionsResults.map((permission) => [permission.permission_id, permission])
        ).values()
      );

      // Fetch the user's secret key from the system_user_secret table
      const secretKeyQueryText = `
        SELECT secret_key
        FROM system_user_secret
        WHERE user_id = :user_id
      `;
      const secretKeyResult: any[] = await this.db_services.sequelizeWriter.query(secretKeyQueryText, {
        replacements: { user_id: user.id },
        type: QueryTypes.SELECT,
      }) || []; // Ensure it defaults to an empty array

      const secretKey = secretKeyResult.length > 0 ? secretKeyResult[0].secret_key : null;


      // Prepare the response data
      const responseData = {
        id: user.id,
        name: user.name,
        mobile_number: user.mobile_number,
        role: {
          id: user.role_id,
          name: user.role_name,
          level: user.role_level,
        },
        permissions: uniquePermissions.map((permission) => ({
          id: permission.permission_id,
          name: permission.permission_name,
          description: permission.permission_description,

        })),
        secretKey, // Include the secret key if available
      };

      // Send success response
      this.sendSuccess(res, responseData, "Login successful", 200);
    } catch (err) {
      if (err instanceof Yup.ValidationError) {
        // Handle validation errors
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        // Log and handle internal errors
        console.error("Error occurred in authLogin:", err);
        this.sendError(res, {}, "Internal server error", 500);
      }
    }
  };
  // Function to handle user logout
  public logout = async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return this.sendError(res, null, "Unauthorized: No token provided", 401);
      }

      const token = authHeader.split(" ")[1];

      // Add the token to the blacklist
      tokenBlacklist.add(token);

      logger.info(`Token blacklisted: ${token}`);

      return this.sendSuccess(res, {}, "Logged out successfully", 200);
    } catch (error) {
      logger.error("Logout error:", error);
      return this.sendError(res, error, "Internal server error", 500);
    }
  };
  // Function to handle  get user details
  public getUserDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      await getUserDetailsSchema.validate(req.body, { abortEarly: false });

      const { id } = req.body;

      // Log the ID for debugging
      console.log("Received User ID:", id);

      // SQL query to get user details along with their role, excluding soft deleted users
      const userDetailsQuery = `
        SELECT 
          system_users.id,
          system_users.name, 
          system_users.email, 
          system_users.mobile_number,
          system_users.password, 
          system_users.created_at, 
          system_users.updated_at,
          user_role.role_id, 
          roles.name AS role_name,
          roles.level AS role_level
        FROM 
          system_users
        LEFT JOIN 
          user_role ON user_role.system_user_id = system_users.id
        LEFT JOIN 
          roles ON roles.id = user_role.role_id
        WHERE 
          system_users.id = :id
          AND system_users.deleted_at IS NULL
      `;

      // Execute query to fetch user details
      const userDetailsResults: any[] = await this.db_services.sequelizeWriter.query(userDetailsQuery, {
        replacements: { id },
        type: QueryTypes.SELECT,
      });

      if (userDetailsResults.length === 0) {
        this.sendError(res, {}, "User not found or already deleted", 404);
        return;
      }

      const user = userDetailsResults[0];
      // Query to fetch permissions from role_permissions
      const rolePermissionsQuery = `
        SELECT 
          permissions.id AS permission_id, 
          permissions.name AS permission_name, 
          permissions.description AS permission_description
        FROM 
          role_permissions
        INNER JOIN 
          permissions ON permissions.id = role_permissions.permission_id
        WHERE 
          role_permissions.role_id = :role_id
      `;
      const rolePermissionsResults: any[] = await this.db_services.sequelizeWriter.query(rolePermissionsQuery, {
        replacements: { role_id: user.role_id },
        type: QueryTypes.SELECT,
      });
      // Combine and deduplicate permissions
      const allPermissions = [
        ...rolePermissionsResults,
      ];
      const uniquePermissions = Array.from(
        new Map(
          allPermissions.map((permission) => [permission.permission_id, permission])
        ).values()
      );

      // Prepare the response data, including role and permissions
      const userDetails = {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile_number: user.mobile_number,
        password: user.password, // Optional: Be cautious with exposing passwords
        created_at: user.created_at,
        updated_at: user.updated_at,
        role: {
          id: user.role_id,
          name: user.role_name,
          level: user.role_level,
        },
        permissions: uniquePermissions.map((permission) => ({
          id: permission.permission_id,
          name: permission.permission_name,
          description: permission.permission_description,
        })),
      };

      // Send success response with the retrieved user details (including role and permissions)
      this.sendSuccess(res, userDetails, "User details retrieved successfully", 200);
    } catch (err) {
      if (err instanceof Yup.ValidationError) {
        // Handle validation errors
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        // Log the error for debugging
        logger.error("Database query error:", { error: err });
        this.sendError(res, err, "Server error", 500);
      }
    }
  };
  public getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const offset = (page - 1) * limit;

      // Fetch total count
      const totalCountResult = await this.db_services.sequelizeWriter.query(
        `SELECT COUNT(*) as count FROM system_users WHERE deleted_at IS NULL`,
        { type: QueryTypes.SELECT }
      );
      const totalCount = (totalCountResult[0] as { count: number }).count;
      const totalPages = Math.ceil(totalCount / limit);

      // Query with proper UUID joins
      const query = `
      SELECT 
        su.id,
        su.name, 
        su.email, 
        su.mobile_number, 
        COALESCE(r.name, 'No Role') AS role
      FROM 
        system_users su
      LEFT JOIN 
        user_role ur ON su.id = ur.system_user_id
      LEFT JOIN 
        roles r ON ur.role_id = r.id
      WHERE 
        su.deleted_at IS NULL
      ORDER BY 
        su.created_at DESC
      LIMIT :limit OFFSET :offset;
    `;

      const users: any[] = await this.db_services.sequelizeWriter.query(query, {
        type: QueryTypes.SELECT,
        replacements: { limit, offset },
      });

      if (users.length === 0) {
        this.sendError(res, {}, "No users found", 404);
        return;
      }

      this.sendSuccess(
        res,
        { users, page, limit, totalPages },
        "User details retrieved successfully",
        200
      );

    } catch (err: any) {
      console.error("Error in getAllUsers:", err);
      this.sendError(res, {}, "Database error: " + err.message, 500);
    }
  };
  // Get all Roles  along with role_id
  public getRoles = async (req: Request, res: Response): Promise<void> => {
    try {
      // SQL query to get roles with level descriptions
      const query = `
        SELECT 
          id, 
          name, 
          level, 
          CASE 
            WHEN level = 1 THEN 'Admin' 
            WHEN level = 2 THEN 'Non-Admin' 
            ELSE 'Unknown' 
          END AS role_description
        FROM 
          roles
        ORDER BY 
          level ASC; -- Order by level for better readability
      `;

      // Execute query using Sequelize
      const roles: any[] = await this.db_services.sequelizeWriter.query(query, {
        type: QueryTypes.SELECT,
      });

      // Log the query results for debugging
      console.log("Query results:", roles);

      if (roles.length === 0) {
        // If no roles are found, return a 404 response
        this.sendError(res, {}, "No roles found", 404);
        return;
      }

      // Send success response with the retrieved role details
      this.sendSuccess(res, roles, "Roles retrieved successfully", 200);
    } catch (err: any) {
      // Log the error for debugging
      console.error("Database query error:", err);

      // Send appropriate error response based on the type of error
      if (err.name === "SequelizeDatabaseError") {
        this.sendError(res, {}, "Database error: " + err.message, 500);
      } else {
        this.sendError(res, err, "Server error", 500);
      }
    }
  };
  // Function to handle update user details
  public UpdateUser = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      await updateUserSchema.validate(req.body, { abortEarly: false });

      const { id, name, mobile_number, email } = req.body;

      // Fetch the current user details from the database
      const currentUser: any[] = await this.db_services.sequelizeReader.query(
        "SELECT email, mobile_number, name FROM system_users WHERE id = :id AND deleted_at IS NULL",
        {
          replacements: { id },
          type: QueryTypes.SELECT,
        }
      );

      if (!currentUser || currentUser.length === 0) {
        this.sendError(res, {}, "User not found", 404);
        return;
      }

      const { email: currentEmail, mobile_number: currentMobileNumber, name: currentName } = currentUser[0];

      // Check if all provided fields are the same as the existing values
      if (
        (!name || name === currentName) &&
        (!mobile_number || mobile_number === currentMobileNumber) &&
        (!email || email === currentEmail)
      ) {
        this.sendSuccess(res, {}, "No changes detected", 204);
        return;
      }

      // Check if the email is changing and already in use
      if (email && email !== currentEmail) {
        const existingEmail: any[] = await this.db_services.sequelizeReader.query(
          "SELECT COUNT(*) AS count FROM system_users WHERE email = :email",
          {
            replacements: { email },
            type: QueryTypes.SELECT,
          }
        );

        if (existingEmail[0]?.count > 0) {
          this.sendError(res, {}, "Email already in use", 409);
          return;
        }
      }

      // Check if the mobile number is changing and already in use
      if (mobile_number && mobile_number !== currentMobileNumber) {
        const existingMobileNumber: any[] = await this.db_services.sequelizeReader.query(
          "SELECT COUNT(*) AS count FROM system_users WHERE mobile_number = :mobile_number",
          {
            replacements: { mobile_number },
            type: QueryTypes.SELECT,
          }
        );

        if (existingMobileNumber[0]?.count > 0) {
          this.sendError(res, {}, "Mobile number already in use", 409);
          return;
        }
      }

      // Build the SQL query dynamically for the update
      const updateFields: string[] = [];
      const replacements: { [key: string]: any } = { id };

      if (name && name !== currentName) {
        updateFields.push("name = :name");
        replacements.name = name;
      }
      if (mobile_number && mobile_number !== currentMobileNumber) {
        updateFields.push("mobile_number = :mobile_number");
        replacements.mobile_number = mobile_number;
      }
      if (email && email !== currentEmail) {
        updateFields.push("email = :email");
        replacements.email = email;
      }

      // Execute the update query only if there are fields to update
      const queryText = `
      UPDATE system_users
      SET ${updateFields.join(", ")}, updated_at = NOW()
      WHERE id = :id
    `;

      const [affectedRows]: any = await this.db_services.sequelizeWriter.query(
        queryText,
        {
          replacements,
          type: QueryTypes.UPDATE,
        }
      );

      if (affectedRows === 0) {
        this.sendError(res, {}, "User not found", 404);
        return;
      }

      this.sendSuccess(res, { userId: id }, "User updated successfully", 200);
    } catch (err: unknown) {
      if (err instanceof Yup.ValidationError) {
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        logger.error("Error occurred in UpdateUser", { error: err });
        this.sendError(res, err, "Internal server error", 500);
      }
    }
  };
  // Function to delete user
  public deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      await deleteUserSchema.validate(req.body, { abortEarly: false });

      const { id } = req.body;

      // SQL query to check if the user exists and is not already soft-deleted
      const userCheckQuery = `
        SELECT * FROM system_users
        WHERE id = :id AND deleted_at IS NULL;
      `;

      // Execute the SELECT query
      const [user] = await this.db_services.sequelizeWriter.query(userCheckQuery, {
        replacements: { id },
        type: QueryTypes.SELECT, // SELECT query to fetch user
      });

      // Check if the user exists
      if (!user) {
        // If no user is found or already deleted, return an error
        this.sendError(res, {}, "User not found or already deleted", 404);
        return;
      }

      // Proceed to soft delete the user by updating the deleted_at column
      const softDeleteQuery = `
        UPDATE system_users
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = :id;
      `;

      await this.db_services.sequelizeWriter.query(softDeleteQuery, {
        replacements: { id },
        type: QueryTypes.UPDATE, // UPDATE query to mark the record as deleted
      });

      // Send success response
      this.sendSuccess(res, {}, "User marked as deleted successfully", 200);
    } catch (err: unknown) {
      if (err instanceof Yup.ValidationError) {
        // Handle validation errors
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        // Handle other errors
        this.sendError(res, err, "Internal server error", 500);
      }
    }
  };
  //   // Function to Handle  generateqrcode 
  // ✅ Generate QR Code
  public generateQRCode = async (req: Request, res: Response): Promise<void> => {
    try {

      // Generate a new secret
      const secret = speakeasy.generateSecret({
        name: "Compress",
        length: 20,
      });

      // Generate QR code
      const qrCodeDataURL = await qrcode.toDataURL(secret.otpauth_url!);

      // Send QR code details to the client
      this.sendSuccess(
        res,
        {
          secret: secret.base32,
          otpauthUrl: secret.otpauth_url,
          qrCodeDataURL,
        },
        "QR code generated successfully"
      );
    } catch (error) {
      this.sendError(res, error, "Failed to generate QR code");
    }
  };
  // Function to Handle verify TOTP
  public verifyTOTP = async (req: Request, res: Response): Promise<void> => {
    try {
      await verifytotpSchema.validate(req.body, { abortEarly: false });
      const { token, secretKey, userId } = req.body;

      if (!token || !secretKey || !userId) {
        return this.sendError(res, null, "Token, secretKey, and userId are required", 400);
      }

      // Verify the TOTP token
      const isVerified = speakeasy.totp.verify({
        secret: secretKey,
        encoding: "base32",
        token,
      });

      if (!isVerified) {
        return this.sendError(res, null, "Invalid TOTP token", 400);
      }

      // Save the secret key
      await this.saveUserSecrets(userId, [secretKey]);

      // Generate JWT token with centralized secret
      const jwtPayload = {
        system_user_id: userId,
        userId: userId,
        secretKey
      };

      console.log("🔄 Generating JWT with secret:", JWT_SECRET ? `Set (length: ${JWT_SECRET.length})` : "Not set");

      const jwtToken = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: "24h" });
      console.log("✅ JWT Token Generated - Payload:", jwtPayload);

      return this.sendSuccess(
        res,
        { token: jwtToken },
        "TOTP verified successfully"
      );
    } catch (error) {
      console.error("❌ TOTP Verification Error:", error);
      return this.sendError(res, error, "Failed to verify TOTP");
    }
  };


  // Helper method to store multiple unique secret keys
  private saveUserSecrets = async (userId: string, secretKeys: string[]): Promise<void> => {

    // Dynamically generate the values part of the SQL query
    const values = secretKeys
      .map((_, index) => `(:userId, :secretKey${index}, 'Authenticator apps', NOW(), NOW())`)
      .join(', ');

    // Dynamically create replacements object
    const replacements = secretKeys.reduce(
      (acc, secretKey, index) => ({
        ...acc,
        [`secretKey${index}`]: secretKey,
      }),
      { userId, } as { [key: string]: string }
    );

    // Execute the query with Sequelize
    await this.db_services.sequelizeWriter.query(
      `INSERT INTO public.system_user_secret (user_id, secret_key, description, created_at, updated_at)
    VALUES ${values}
    ON CONFLICT (secret_key) DO NOTHING`,
      {
        replacements,
        type: QueryTypes.INSERT,
      }
    );
  };
  // Function to Handle  Fetchsecert 
  public fetchSecretKey = async (req: Request, res: Response): Promise<void> => {
    try {
      await fetchsecretkeySchema.validate(req.body, { abortEarly: false });
      const { userId } = req.body;

      // Validate the userId parameter
      if (!userId) {
        this.sendError(res, null, "User ID is required", 400);
        return;
      }

      // Query to fetch the secret key for the given user ID
      const query = `
      SELECT secret_key, description
      FROM system_user_secret
      WHERE user_id = :userId;
    `;

      const result = await this.db_services.sequelizeWriter.query(query, {
        replacements: { userId },
        type: QueryTypes.SELECT,
      });

      // Check if a secret key was found
      if (result.length === 0) {
        this.sendError(res, { secretKey: null }, "No secret key found for the user");
        return;
      }

      // Extract the description of secret key
      const { description } = result[0] as { description: string };

      // Respond with the secret key
      this.sendSuccess(res, { description: description }, "Description Of Secret key fetched successfully");
    } catch (error) {
      console.error("Error fetching secret key:", error);
      this.sendError(res, error, "Failed to fetch secret key");
    }
  };
  // Function to Handle Deletesecert 
  public deleteSecretKey = async (req: Request, res: Response): Promise<void> => {
    try {
      await deletesecretkeySchema.validate(req.body, { abortEarly: false });

      const { userId } = req.body;

      // Validate the userId parameter
      if (!userId) {
        this.sendError(res, null, "User ID is required", 400);
        return;
      }

      // Check if the secret key exists for the user
      const checkQuery = `
        SELECT id
        FROM system_user_secret
        WHERE user_id = :userId;
      `;
      const existingKey = await this.db_services.sequelizeWriter.query(checkQuery, {
        replacements: { userId },
        type: QueryTypes.SELECT,
      });

      if (existingKey.length === 0) {
        this.sendError(res, null, "No secret key found for the user", 404);
        return;
      }

      // Delete the secret key for the user
      const deleteQuery = `
        DELETE FROM system_user_secret
        WHERE user_id = :userId;
      `;
      await this.db_services.sequelizeWriter.query(deleteQuery, {
        replacements: { userId },
        type: QueryTypes.DELETE,
      });

      // Respond with success
      this.sendSuccess(res, {}, "Secret key deleted successfully", 200);
    } catch (error) {
      console.error("Error deleting secret key:", error);
      this.sendError(res, error, "Failed to delete secret key");
    }
  };
  // Function to handle user activity
  public logUserActivity = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body (include module and type in the schema validation)
      await logUserActivitySchema.validate(req.body, { abortEarly: false });

      const { userId, userActivity, module, type } = req.body; // Extract module and type
      console.log("Request body:", req.body);

      // Check if the user exists in the system_users table
      const userExists = await this.db_services.sequelizeReader.query(
        `SELECT id FROM system_users WHERE id = :userId`,
        {
          replacements: { userId },
          type: QueryTypes.SELECT,
        }
      );

      if (userExists.length > 0) {
        // Log the user activity with module and type
        await this.db_services.sequelizeWriter.query(
          `INSERT INTO system_user_activity (user_activity, uuid, activity_timestamp, module, type) 
             VALUES (:userActivity, :userId, CURRENT_TIMESTAMP, :module, :type)`,
          {
            replacements: { userActivity, userId, module, type },
            type: QueryTypes.INSERT,
          }
        );

        // Send success response
        this.sendSuccess(res, { userActivity }, "User activity logged successfully!", 200);
      } else {
        // User does not exist
        this.sendError(res, {}, "User does not exist", 404);
      }
    } catch (err: unknown) {
      if (err instanceof Yup.ValidationError) {
        // Handle validation errors
        this.sendError(res, {}, err.errors.join(", "), 400);
      } else {
        // Handle other errors
        logger.error("Error occurred in loguseractivity", { error: err });
        this.sendError(res, err, "Internal server error", 500);
      }
    }
  };
  // Get all user activities
  public getAllUserActivities = async (req: Request, res: Response): Promise<void> => {
    try {
      // Extract pagination parameters from the request query with default values
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const offset = (page - 1) * limit;

      // Fetch the total count of records
      const totalCountResult = await this.db_services.sequelizeReader.query(
        `SELECT COUNT(*) as count 
           FROM system_user_activity sua
           JOIN system_users su ON sua.uuid = su.id`,

        { type: QueryTypes.SELECT }
      );
      const totalCount = (totalCountResult[0] as { count: number }).count;

      // Calculate total pages
      const totalPages = Math.ceil(totalCount / limit);

      // Fetch the activities with pagination, including the name
      const activities = await this.db_services.sequelizeReader.query(
        `SELECT sua.*, su.name 
           FROM system_user_activity sua
           JOIN system_users su ON sua.uuid = su.id
           ORDER BY sua.activity_timestamp DESC
           LIMIT :limit OFFSET :offset`,
        {
          type: QueryTypes.SELECT,
          replacements: { limit, offset },
        }
      );

      // Send success response
      this.sendSuccess(
        res,
        { activities, page, limit, totalPages },
        "Fetched all user activities successfully!",
        200
      );
    } catch (err: unknown) {
      // Log the error for debugging
      logger.error("Error occurred in getAllUserActivities", { error: err });
      this.sendError(res, err, "Internal server error", 500);
    }
  };
  // Filter user activities
  public filterUserActivities = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate the request body
      await filteruseractivitySchema.validate(req.body, { abortEarly: false });

      // Extract filters from the request body
      const { uuId, userActivity, startDate, endDate, module, type } = req.body;
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const offset = (page - 1) * limit;

      const filters: string[] = [];
      const replacements: any = {};

      // Build the filters based on the provided fields
      if (uuId) {
        filters.push("sua.uuid = :uuId");
        replacements.uuId = uuId;
      }

      if (userActivity) {
        filters.push("LOWER(sua.user_activity) = LOWER(:userActivity)");
        replacements.userActivity = userActivity;
      }

      if (startDate || endDate) {
        let startFilterApplied = false;
        let endFilterApplied = false;

        if (startDate) {
          const adjustedStartDate = new Date(startDate);
          if (!isNaN(adjustedStartDate.getTime())) {
            adjustedStartDate.setUTCHours(0, 0, 0, 0);  // Start of the day
            filters.push("sua.activity_timestamp >= :startDate");
            replacements.startDate = adjustedStartDate.toISOString();
            startFilterApplied = true;
          }
        }

        if (endDate) {
          const adjustedEndDate = new Date(endDate);
          if (!isNaN(adjustedEndDate.getTime())) {
            adjustedEndDate.setUTCHours(23, 59, 59, 999);  // End of the day
            filters.push("sua.activity_timestamp <= :endDate");
            replacements.endDate = adjustedEndDate.toISOString();
            endFilterApplied = true;
          }
        }

        // Ensure that both startDate and endDate are valid before adding them to the filters
        if (!startFilterApplied && !endFilterApplied) {
          throw new Error("Invalid startDate or endDate");
        }
      }

      if (module) {
        filters.push("LOWER(sua.module) = LOWER(:module)");
        replacements.module = module;
      }

      if (type) {
        filters.push("LOWER(sua.type) = LOWER(:type)");
        replacements.type = type;
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      // Fetch the total count of records matching the filters
      const totalCountResult = await this.db_services.sequelizeReader.query(
        `SELECT COUNT(*) as count 
          FROM system_user_activity sua
          JOIN system_users su ON sua.uuid = su.id
          ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT,
        }
      );
      const totalCount = (totalCountResult[0] as { count: number }).count;

      // Calculate total pages
      const totalPages = Math.ceil(totalCount / limit);

      // Fetch the filtered activities with pagination
      const filteredActivities = await this.db_services.sequelizeReader.query(
        `SELECT sua.*, su.name 
          FROM system_user_activity sua
          JOIN system_users su ON sua.uuid = su.id
          ${whereClause}
          ORDER BY sua.activity_timestamp DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: { ...replacements, limit, offset },
          type: QueryTypes.SELECT,
        }
      );

      // Send the filtered results with pagination data
      this.sendSuccess(
        res,
        { filteredActivities, page, limit, totalPages },
        "Filtered user activities fetched successfully!",
        200
      );
    } catch (err: unknown) {
      logger.error("Error occurred in filterUserActivities", { error: err });
      this.sendError(res, err, "Internal server error", 500);
    }
  };
  // Get all user name and uuid
  public getAllUserNamesAndUUIDs = async (req: Request, res: Response): Promise<void> => {
    try {
      // Fetch all names and UUIDs
      const users = await this.db_services.sequelizeReader.query(
        `SELECT su.id as uuid, su.name 
           FROM system_users su
           WHERE deleted_at IS NULL
           ORDER BY su.name DESC`,
        {
          type: QueryTypes.SELECT,
        }
      );

      // Send success response
      this.sendSuccess(
        res,
        { users },
        "Fetched all user names and UUIDs successfully!",
        200
      );
    } catch (err: unknown) {
      // Log the error for debugging
      logger.error("Error occurred in getAllUserNamesAndUUIDs", { error: err });
      this.sendError(res, err, "Internal server error", 500);
    }
  };
  // Get all deleted users along with their UUID and name
  public getAllDeletedUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      // SQL query to fetch UUID and name of all deleted users
      const query = `
          SELECT 
            id AS uuid, 
            name 
          FROM 
            system_users 
          WHERE 
            deleted_at IS NOT NULL
          ORDER BY 
            deleted_at DESC;
        `;

      // Execute query using Sequelize
      const deletedUsers: any[] = await this.db_services.sequelizeWriter.query(query, {
        type: QueryTypes.SELECT,
      });

      if (deletedUsers.length === 0) {
        this.sendError(res, {}, "No deleted users found", 404);
        return;
      }

      // Send success response with the retrieved deleted user details
      this.sendSuccess(
        res,
        { deletedUsers },
        "Deleted users retrieved successfully",
        200
      );
    } catch (err: any) {
      // Log the error for debugging
      console.error("Database query error:", err);

      // Send appropriate error response based on the type of error
      if (err.name === "SequelizeDatabaseError") {
        this.sendError(res, {}, "Database error: " + err.message, 500);
      } else {
        this.sendError(res, err, "Server error", 500);
      }
    }
  };

  // Add this method to get admin users with TOTP
  public getAdminUsersWithTOTP = async (req: Request, res: Response): Promise<void> => {
    try {
      // 🔒 Authentication check using userId
      const authUser = (req as any)?.user;
      if (!authUser || !authUser.userId) {
        return this.sendError(res, {}, "Unauthorized - Please login again", 401);
      }

      // Query to fetch all admin users with TOTP configured
      const adminUsersQuery = `
      SELECT DISTINCT 
        su.id,
        su.name,
        su.email,
        sus.secret_key,
        r.level as role_level
      FROM system_users su
      INNER JOIN user_role ur ON su.id = ur.system_user_id
      INNER JOIN roles r ON ur.role_id = r.id
      INNER JOIN system_user_secret sus ON su.id = sus.user_id
      WHERE su.deleted_at IS NULL
        AND r.level = 1  -- Admin role level (adjust if needed)
        AND sus.secret_key IS NOT NULL
      ORDER BY su.name
    `;

      const adminUsers: any[] = await this.db_services.sequelizeWriter.query(adminUsersQuery, {
        type: QueryTypes.SELECT,
      });

      // Remove secret keys from response for security, or keep if needed internally
      const safeAdminUsers = adminUsers.map(admin => ({
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role_level: admin.role_level,
        has_totp: true
      }));

      this.sendSuccess(
        res,
        { adminUsers: safeAdminUsers },
        "Admin users with TOTP fetched successfully",
        200
      );
    } catch (error) {
      console.error("Error fetching admin users with TOTP:", error);
      this.sendError(res, error, "Failed to fetch admin users", 500);
    }
  };

  // Add this method to verify any admin's TOTP
  public verifyAdminTOTP = async (req: Request, res: Response): Promise<void> => {
    try {
      // 🔒 Authentication check using userId
      const authUser = (req as any)?.user;
      if (!authUser || !authUser.userId) {
        return this.sendError(res, {}, "Unauthorized - Please login again", 401);
      }

      const { token, loanPayload } = req.body;

      if (!token) {
        return this.sendError(res, null, "TOTP token is required", 400);
      }

      if (token.length !== 6) {
        return this.sendError(res, null, "TOTP token must be 6 digits", 400);
      }

      // Query to fetch all admin users with their secret keys
      const adminUsersQuery = `
      SELECT DISTINCT 
        su.id,
        su.name,
        su.email,
        sus.secret_key
      FROM system_users su
      INNER JOIN user_role ur ON su.id = ur.system_user_id
      INNER JOIN roles r ON ur.role_id = r.id
      INNER JOIN system_user_secret sus ON su.id = sus.user_id
      WHERE su.deleted_at IS NULL
        AND r.level = 1  -- Admin role level
        AND sus.secret_key IS NOT NULL
    `;

      const adminUsers: any[] = await this.db_services.sequelizeWriter.query(adminUsersQuery, {
        type: QueryTypes.SELECT,
      });

      if (adminUsers.length === 0) {
        return this.sendError(res, null, "No admin users found with TOTP configured", 404);
      }

      // Try to verify against each admin's TOTP secret
      let verifiedAdmin = null;
      let isValidTotp = false;

      for (const admin of adminUsers) {
        try {
          const isVerified = speakeasy.totp.verify({
            secret: admin.secret_key,
            encoding: "base32",
            token,
            window: 1 // Allow 1 step (30 seconds) before/after for time sync issues
          });

          if (isVerified) {
            isValidTotp = true;
            verifiedAdmin = {
              id: admin.id,
              name: admin.name,
              email: admin.email
            };
            break; // Stop checking once valid TOTP is found
          }
        } catch (verifyError) {
          console.error(`TOTP verification failed for admin ${admin.id}:`, verifyError);
          // Continue to next admin
        }
      }

      if (!isValidTotp || !verifiedAdmin) {
        return this.sendError(res, null, "Invalid TOTP code. Please enter a valid admin TOTP.", 400);
      }

      // Log the successful TOTP verification
      await this.db_services.sequelizeWriter.query(
        `INSERT INTO public.system_user_activity 
       (user_activity, activity_timestamp, module, type, system_user_id)
       VALUES (:user_activity, NOW(), :module, :type, :system_user_id)`,
        {
          replacements: {
            user_activity: `Admin TOTP verified for loan creation by admin ${verifiedAdmin.name} (${verifiedAdmin.email})`,
            module: "loan_management",
            type: "totp_verification",
            system_user_id: authUser.userId, // Who performed the action
          },
          type: QueryTypes.INSERT,
        }
      );

      // If loanPayload is provided, you can also log loan-specific details
      if (loanPayload) {
        await this.db_services.sequelizeWriter.query(
          `INSERT INTO public.system_user_activity 
         (user_activity, activity_timestamp, module, type, system_user_id)
         VALUES (:user_activity, NOW(), :module, :type, :system_user_id)`,
          {
            replacements: {
              user_activity: `Loan creation approved via TOTP - Amount: ${loanPayload.amount}, Account: ${loanPayload.account_id}`,
              module: "loan_management",
              type: "loan_creation",
              system_user_id: authUser.userId,
            },
            type: QueryTypes.INSERT,
          }
        );
      }

      this.sendSuccess(
        res,
        {
          verified: true,
          admin: verifiedAdmin,
          message: "TOTP verified successfully"
        },
        "TOTP verification successful",
        200
      );

    } catch (error) {
      console.error("Error in verifyAdminTOTP:", error);
      this.sendError(res, error, "TOTP verification failed", 500);
    }
  };

  // Alternative simplified version - Verify TOTP against any admin (without loan payload)
  public verifyAnyAdminTOTP = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.body;

      if (!token || token.length !== 6) {
        return this.sendError(res, null, "Valid 6-digit TOTP token is required", 400);
      }

      // Query to fetch all admin secret keys
      const adminSecretsQuery = `
      SELECT sus.secret_key, su.id as user_id, su.name, su.email
      FROM system_user_secret sus
      INNER JOIN system_users su ON sus.user_id = su.id
      INNER JOIN user_role ur ON su.id = ur.system_user_id
      INNER JOIN roles r ON ur.role_id = r.id
      WHERE su.deleted_at IS NULL
        AND r.level = 1  -- Admin role level
        AND sus.secret_key IS NOT NULL
    `;

      const adminSecrets: any[] = await this.db_services.sequelizeWriter.query(adminSecretsQuery, {
        type: QueryTypes.SELECT,
      });

      if (adminSecrets.length === 0) {
        return this.sendError(res, null, "No admin TOTP configurations found", 404);
      }

      // Try each admin secret
      let isValid = false;
      let verifiedAdmin = null;

      for (const admin of adminSecrets) {
        const isVerified = speakeasy.totp.verify({
          secret: admin.secret_key,
          encoding: "base32",
          token,
          window: 1
        });

        if (isVerified) {
          isValid = true;
          verifiedAdmin = {
            id: admin.user_id,
            name: admin.name,
            email: admin.email
          };
          break;
        }
      }

      if (!isValid) {
        return this.sendError(res, null, "Invalid TOTP code", 400);
      }

      this.sendSuccess(
        res,
        {
          verified: true,
          admin: verifiedAdmin
        },
        "Admin TOTP verified successfully",
        200
      );

    } catch (error) {
      console.error("Error in verifyAnyAdminTOTP:", error);
      this.sendError(res, error, "TOTP verification failed", 500);
    }
  };
}

