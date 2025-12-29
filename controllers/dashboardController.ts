import { Request, Response } from "express";
import { QueryTypes } from "sequelize";
import db from "../models";

export default class DashboardController {
    
    // ✅ GET TOTAL CLIENTS COUNT
    static async getTotalClients(req: Request, res: Response): Promise<Response> {
        try {
            const totalCountSQL = `
                SELECT COUNT(*) as total_clients
                FROM public.clients;
            `;

            const result = await db.sequelize.query(totalCountSQL, {
                type: QueryTypes.SELECT,
            });

            const totalClients = parseInt((result[0] as any)?.total_clients || 0);

            return res.json({
                success: true,
                data: {
                    total_clients: totalClients
                }
            });

        } catch (err) {
            console.error("Dashboard - Get total clients error:", err);
            return res.status(500).json({
                success: false,
                error: "Internal server error"
            });
        }
    }
    
    // ✅ GET TOTAL AMC ESTIMATES COUNT
    static async getTotalAmcEstimates(req: Request, res: Response): Promise<Response> {
        try {
            const totalCountSQL = `
                SELECT COUNT(*) as total_amc_estimates
                FROM public.amc_estimates;
            `;

            const result = await db.sequelize.query(totalCountSQL, {
                type: QueryTypes.SELECT,
            });

            const totalAmcEstimates = parseInt((result[0] as any)?.total_amc_estimates || 0);

            return res.json({
                success: true,
                data: {
                    total_amc_estimates: totalAmcEstimates
                }
            });

        } catch (err) {
            console.error("Dashboard - Get total AMC estimates error:", err);
            return res.status(500).json({
                success: false,
                error: "Internal server error"
            });
        }
    }
    
    // ✅ GET TOTAL AMC CONTRACTS COUNT
    static async getTotalAmcContracts(req: Request, res: Response): Promise<Response> {
        try {
            const totalCountSQL = `
                SELECT COUNT(*) as total_amc_contracts
                FROM public.amc_contract;
            `;

            const result = await db.sequelize.query(totalCountSQL, {
                type: QueryTypes.SELECT,
            });

            const totalAmcContracts = parseInt((result[0] as any)?.total_amc_contracts || 0);

            return res.json({
                success: true,
                data: {
                    total_amc_contracts: totalAmcContracts
                }
            });

        } catch (err) {
            console.error("Dashboard - Get total AMC contracts error:", err);
            return res.status(500).json({
                success: false,
                error: "Internal server error"
            });
        }
    }

        // ✅ GET TOTAL ESTIMATES COUNT (REGULAR ESTIMATES)
    static async getTotalEstimates(req: Request, res: Response): Promise<Response> {
        try {
            const totalCountSQL = `
                SELECT COUNT(*) as total_estimates
                FROM public.estimates;
            `;

            const result = await db.sequelize.query(totalCountSQL, {
                type: QueryTypes.SELECT,
            });

            const totalEstimates = parseInt((result[0] as any)?.total_estimates || 0);

            return res.json({
                success: true,
                data: {
                    total_estimates: totalEstimates
                }
            });

        } catch (err) {
            console.error("Dashboard - Get total estimates error:", err);
            return res.status(500).json({
                success: false,
                error: "Internal server error"
            });
        }
    }

   // ✅ GET TOTAL BILLING REQUESTS COUNT
static async getTotalBillingRequests(req: Request, res: Response): Promise<Response> {
    try {
        const totalCountSQL = `
            SELECT COUNT(*) as total_billing_requests
            FROM public.billing_request;
        `;

        const result = await db.sequelize.query(totalCountSQL, {
            type: QueryTypes.SELECT,
        });

        const totalBillingRequests = parseInt((result[0] as any)?.total_billing_requests || 0);

        return res.json({
            success: true,
            data: {
                total_billing_requests: totalBillingRequests
            }
        });

    } catch (err) {
        console.error("Dashboard - Get total billing requests error:", err);
        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
}
}



