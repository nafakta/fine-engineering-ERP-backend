import { Request, Response } from "express";
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import BaseController from "./BaseController";
import logger from "../utils/logger";
import DBServices from "../database/DBService";
import { Client } from "../models/Client";
import * as Yup from "yup";
import { createClientSchema, updateClientSchema, deleteClientSchema } from "./Validations";
import { Op } from "sequelize";

// Extend the Request interface locally
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

export default class ClientController extends BaseController {
    db_services: DBServices = new DBServices();

    constructor() {
        super();
        logger.info("ClientController instantiated");
    }

    // Improved UUID validation function
    private isValidUUID(id: string): boolean {
        if (!id || typeof id !== "string") return false;
        return uuidValidate(id);
    }

    // Create Client
    public createClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            await createClientSchema.validate(req.body, { abortEarly: false });

            const {
                department,
                company,
                client,
                mobile,
                email_id,
                city,
                state,
                pin_code,
                gstn,
                address,
                shipping_city,
                shipping_state,
                shipping_pincode,
                shipping_address,
                contact_person,
                designation,
                client_designation,
                contact_person_number,
                updated_by,
            } = req.body;

            // Capture created_by from the authenticated user
            const created_by = req.user?.userId;

            if (!created_by) {
                this.sendError(res, {}, "User authentication required", 401);
                return;
            }

            // Validate or generate updated_by UUID
            let validUpdatedBy: string;
            if (updated_by && this.isValidUUID(updated_by)) {
                validUpdatedBy = updated_by;
            } else {
                validUpdatedBy = uuidv4();
                logger.warn("Generated new UUID for updated_by field", {
                    provided: updated_by,
                    generated: validUpdatedBy,
                });
            }

            const newClient = await Client.create({
                department,
                company,
                client,
                mobile,
                email_id,
                city,
                state,
                pin_code,
                gstn,
                address,
                shipping_city,
                shipping_state,
                shipping_pincode,
                shipping_address,
                contact_person,
                designation,
                client_designation,
                contact_person_number,
                updated_by: validUpdatedBy,
                created_by: created_by,
            });

            this.sendSuccess(res, newClient, "Client created successfully", 201);
        } catch (error: unknown) {
            if (error instanceof Yup.ValidationError) {
                this.sendError(res, { validationErrors: error.errors }, error.errors.join(", "), 400);
            } else {
                logger.error("Error creating client", { error });
                this.sendError(
                    res,
                    { error: error instanceof Error ? error.message : "Unknown error" },
                    "Internal server error",
                    500
                );
            }
        }
    };

    // Get All Clients with pagination + extended search
    public getClients = async (req: Request, res: Response): Promise<void> => {
        const { page = 1, limit = 10, search } = req.query;

        try {
            const whereClause: any = {};
            if (search && typeof search === "string") {
                const term = `%${search}%`;
                // Extended search to include contact_person, designation, and client_designation
                whereClause[Op.or] = [
                    { company: { [Op.iLike]: term } },
                    { client: { [Op.iLike]: term } },
                    { email_id: { [Op.iLike]: term } },
                    { mobile: { [Op.iLike]: term } },
                    { contact_person: { [Op.iLike]: term } },
                    { designation: { [Op.iLike]: term } },
                    { client_designation: { [Op.iLike]: term } },  // new field
                    { contact_person_number: { [Op.iLike]: term } }, // new field
                ];
            }

            const clients = await Client.findAndCountAll({
                where: whereClause,
                limit: Number(limit),
                offset: (Number(page) - 1) * Number(limit),
                order: [["created_on", "DESC"]],
            });

            this.sendSuccess(
                res,
                {
                    clients: clients.rows,
                    totalCount: clients.count,
                    totalPages: Math.ceil(clients.count / Number(limit)),
                    currentPage: Number(page),
                    hasNext: Number(page) < Math.ceil(clients.count / Number(limit)),
                    hasPrev: Number(page) > 1,
                },
                "Clients fetched successfully",
                200
            );
        } catch (error: unknown) {
            logger.error("Error fetching clients", { error });
            this.sendError(
                res,
                { error: error instanceof Error ? error.message : "Unknown error" },
                "Failed to fetch clients",
                500
            );
        }
    };

    // Get Client by ID
    public getClientById = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params;

        try {
            if (!this.isValidUUID(id)) {
                this.sendError(res, { id }, "Invalid client ID format. Expected UUID.", 400);
                return;
            }

            const client = await Client.findByPk(id);

            if (!client) {
                this.sendError(res, { id }, "Client not found", 404);
                return;
            }

            this.sendSuccess(res, client, "Client fetched successfully", 200);
        } catch (error: unknown) {
            logger.error("Error fetching client", { error, clientId: id });
            this.sendError(
                res,
                { error: error instanceof Error ? error.message : "Unknown error", clientId: id },
                "Failed to fetch client",
                500
            );
        }
    };

    // Update Client
    public updateClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const uuidRe =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        const headerId =
            (req.headers["x-client-id"] as string) ||
            (req.headers["client-id"] as string) ||
            (req.headers["x-clientid"] as string);

        const rawId: string | undefined =
            (req.params as any)?.id ||
            (req.body as any)?.id ||
            (req.body as any)?.client_id ||
            (req.body as any)?.uuid ||
            (req.body as any)?.client_uuid ||
            headerId;

        if (!rawId || !uuidRe.test(String(rawId))) {
            return this.sendError(
                res,
                { received: { id: (req.body as any)?.id, client_id: (req.body as any)?.client_id, uuid: (req.body as any)?.uuid, client_uuid: (req.body as any)?.client_uuid, headerId }, typeof: typeof rawId },
                "Invalid client ID format. Expected UUID.",
                400
            );
        }

        try {
            await updateClientSchema.validate(req.body, { abortEarly: false });

            const client = await Client.findByPk(rawId);
            if (!client) {
                this.sendError(res, { id: rawId }, "Client not found", 404);
                return;
            }

            const authUserId = req.user?.userId || null;
            const immutableKeys = new Set([
                "id",
                "created_by",
                "created_at",
                "created_on",
                "deleted_at",
                "updated_at",
            ]);

            const payload: Record<string, any> = { ...req.body };
            Object.keys(payload).forEach((k) => {
                if (immutableKeys.has(k)) delete payload[k];
            });

            const orig = client.toJSON() as any;
            payload.created_by = orig.created_by;
            if (authUserId && uuidRe.test(authUserId)) {
                payload.updated_by = authUserId;
            }

            await client.update(payload);

            const fresh = await Client.findByPk(rawId);

            this.sendSuccess(
                res,
                fresh ?? client,
                "Client updated successfully",
                200
            );
        } catch (error: unknown) {
            if (error instanceof Yup.ValidationError) {
                this.sendError(
                    res,
                    { validationErrors: error.errors },
                    error.errors.join(", "),
                    400
                );
            } else if (error instanceof Error) {
                logger.error("Error updating client", { error: error.message, clientId: rawId });
                this.sendError(
                    res,
                    { error: error.message, clientId: rawId },
                    "Failed to update client",
                    500
                );
            } else {
                logger.error("Unknown error updating client", { error, clientId: rawId });
                this.sendError(
                    res,
                    { error: String(error), clientId: rawId },
                    "Failed to update client",
                    500
                );
            }
        }
    };

    public deleteClient = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.body;

        try {
            if (!id) {
                this.sendError(res, { id: "missing" }, "Client ID is required", 400);
                return;
            }

            const uuidRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(id)) {
                this.sendError(
                    res,
                    { id, receivedType: typeof id },
                    "Invalid client ID format. Expected UUID.",
                    400
                );
                return;
            }

            const client = await Client.findByPk(id);
            if (!client) {
                this.sendError(res, { id }, "Client not found", 404);
                return;
            }

            logger.info("Attempting to delete client", { clientId: id, clientName: (client as any).client });
            await client.destroy();
            this.sendSuccess(res, { id }, "Client deleted successfully", 200);
        } catch (error: unknown) {
            logger.error("Error deleting client", { error, clientId: id });
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            this.sendError(res, { error: errorMessage, clientId: id }, "Failed to delete client", 500);
        }
    };

    public getClientByName = async (req: Request, res: Response): Promise<void> => {
        // Accept q (general query) or specific params for backward compatibility
        const { q, name, client, company, mobile, gstn, gstin } = req.query;

        const pageNum = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
        const offset = (pageNum - 1) * limitNum;

        const rawQ = (q ?? name ?? client ?? company ?? mobile ?? gstn ?? gstin ?? "").toString().trim();

        const andClauses: any[] = [];

        // Helper to push iLike clause if value present
        const pushILike = (field: string, val?: string) => {
            if (!val) return;
            const v = val.toString().trim();
            if (v.length === 0) return;
            andClauses.push({ [field]: { [Op.iLike]: `%${v}%` } });
        };

        // If 'q' provided (or general rawQ), run a broad OR across the common columns (company, client, contact_person, mobile, gstn/gstin)
        if (q || rawQ) {
            const term = `%${rawQ}%`;
            const normalized = rawQ.replace(/[^0-9a-zA-Z]/g, "").toUpperCase(); // for GST normalization
            const rawAttrs = (Client as any).rawAttributes || {};

            const orClauses: any[] = [
                { company: { [Op.iLike]: term } },
                { client: { [Op.iLike]: term } },
                { contact_person: { [Op.iLike]: term } },
                { mobile: { [Op.iLike]: term } },
            ];

            // GST columns: try normalized and raw variants, include gstin only if model has that attribute
            if (rawAttrs.hasOwnProperty("gstn")) {
                orClauses.push({ gstn: { [Op.iLike]: `%${normalized}%` } });
                orClauses.push({ gstn: { [Op.iLike]: term } });
            }
            if (rawAttrs.hasOwnProperty("gstin")) {
                orClauses.push({ gstin: { [Op.iLike]: `%${normalized}%` } });
                orClauses.push({ gstin: { [Op.iLike]: term } });
            }

            // push one OR group for the general query
            andClauses.push({ [Op.or]: orClauses });
        } else {
            // If no q, allow the previous specific param behavior (unchanged logic)
            if (name) {
                const term = `%${String(name).trim()}%`;
                andClauses.push({
                    [Op.or]: [
                        { client: { [Op.iLike]: term } },
                        { company: { [Op.iLike]: term } },
                        { contact_person: { [Op.iLike]: term } },
                    ],
                });
            }

            if (client) {
                andClauses.push({ client: { [Op.iLike]: `%${String(client).trim()}%` } });
            }

            if (company) {
                andClauses.push({ company: { [Op.iLike]: `%${String(company).trim()}%` } });
            }

            if (mobile) {
                const m = String(mobile).trim();
                if (m.length > 0) andClauses.push({ mobile: { [Op.iLike]: `%${m}%` } });
            }

            const gstQuery = (gstn || gstin) ? String(gstn || gstin).trim() : "";
            if (gstQuery.length > 0) {
                const normalizedGst = gstQuery.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
                const gstOrClauses: any[] = [];
                const rawAttrs = (Client as any).rawAttributes || {};
                if (rawAttrs.hasOwnProperty("gstn")) {
                    gstOrClauses.push({ gstn: { [Op.iLike]: `%${normalizedGst}%` } });
                    gstOrClauses.push({ gstn: { [Op.iLike]: `%${gstQuery}%` } });
                }
                if (rawAttrs.hasOwnProperty("gstin")) {
                    gstOrClauses.push({ gstin: { [Op.iLike]: `%${normalizedGst}%` } });
                    gstOrClauses.push({ gstin: { [Op.iLike]: `%${gstQuery}%` } });
                }
                // also allow match against company/client for short codes
                gstOrClauses.push({ company: { [Op.iLike]: `%${gstQuery}%` } });
                gstOrClauses.push({ client: { [Op.iLike]: `%${gstQuery}%` } });

                if (gstOrClauses.length > 0) andClauses.push({ [Op.or]: gstOrClauses });
            }
        }

        if (andClauses.length === 0) {
            // Keep the same error message/payload style as before
            this.sendError(res, { q, name, client, company, mobile, gstn, gstin }, "Client or company name is required", 400);
            return;
        }

        const where = andClauses.length === 1 ? andClauses[0] : { [Op.and]: andClauses };

        try {
            const { rows, count } = await Client.findAndCountAll({
                where,
                order: [["created_on", "DESC"]],
                limit: limitNum,
                offset,
            });

            if (!rows.length) {
                this.sendError(res, { q, name, client, company, mobile, gstn, gstin }, "No clients found with this search", 404);
                return;
            }

            this.sendSuccess(
                res,
                {
                    clients: rows,
                    total: count,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.max(1, Math.ceil(count / limitNum)),
                },
                "Clients fetched successfully",
                200
            );
        } catch (error: any) {
            // keep payload informative (same style as your other handlers)
            this.sendError(res, { error: error?.message, q, name, client, company, mobile, gstn, gstin }, "Failed to fetch clients", 500);
        }
    };

    // Get Clients by Vendor (Search by vendor name, date range)
    public getClientsByVendor = async (req: Request, res: Response): Promise<void> => {
        try {
            const { vendorName, startDate, endDate } = req.query;

            if (!vendorName || typeof vendorName !== "string" || vendorName.trim().length === 0) {
                this.sendError(res, { vendorName }, "Vendor name is required", 400);
                return;
            }

            let start: Date | undefined = undefined;
            let end: Date | undefined = undefined;

            if (startDate) {
                start = new Date(startDate as string);
                if (isNaN(start.getTime())) {
                    this.sendError(res, { startDate }, "Invalid start date", 400);
                    return;
                }
            }

            if (endDate) {
                end = new Date(endDate as string);
                if (isNaN(end.getTime())) {
                    this.sendError(res, { endDate }, "Invalid end date", 400);
                    return;
                }
            }

            const whereClause: any = {
                client: { [Op.iLike]: `%${vendorName as string}%` },
            };

            if (start && end) {
                whereClause.created_on = { [Op.between]: [start, end] };
            } else if (start) {
                whereClause.created_on = { [Op.gte]: start };
            } else if (end) {
                whereClause.created_on = { [Op.lte]: end };
            }

            const clients = await Client.findAll({
                where: whereClause,
                order: [["created_on", "DESC"]],
            });

            if (!clients.length) {
                this.sendError(res, { vendorName, startDate, endDate }, "No clients found matching the criteria", 404);
                return;
            }

            this.sendSuccess(res, clients, "Clients fetched successfully", 200);
        } catch (error: unknown) {
            logger.error("Error fetching clients by vendor", { error, query: req.query });
            this.sendError(
                res,
                { error: error instanceof Error ? error.message : "Unknown error" },
                "Failed to fetch clients",
                500
            );
        }
    };
}
