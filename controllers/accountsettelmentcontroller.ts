import { Request, Response } from 'express';
import { initSettlementModel } from '../models/accountsettelment';
import { sequelizeWriter } from '../database/DBService';
import { QueryTypes } from "sequelize";
import { Account } from "../models/Banks"
import { Op, WhereOptions, col, fn, where, literal } from "sequelize";

const Settlement = initSettlementModel(sequelizeWriter);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parsePaging = (req: Request) => {
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 10), 1), 100);
    const offset = (page - 1) * pageSize;
    return { page, pageSize, offset };
};

const buildDateRange = (date_from?: string, date_to?: string): WhereOptions | undefined => {
    if (!date_from && !date_to) return undefined;
    const range: any = {};
    if (date_from) range[Op.gte] = new Date(date_from);
    if (date_to) range[Op.lte] = new Date(date_to);
    return { created_at: range };
};

const buildCommonWhere = (q?: string, account_id?: string): WhereOptions => {
    const andParts: WhereOptions[] = [];

    if (account_id) andParts.push({ account_id });

    if (q && q.trim()) {
        const term = `%${q.trim()}%`;
        andParts.push({
            [Op.or]: [
                { description: { [Op.iLike]: term } },
                { reason: { [Op.iLike]: term } },
            ],
        });
    }

    return andParts.length ? { [Op.and]: andParts } : {};
};

const respondPagination = (res: Response, rows: any[], count: number, page: number, pageSize: number) => {
    return res.json({
        success: true,
        data: rows,
        pagination: {
            page,
            pageSize,
            totalRows: count,
            totalPages: Math.ceil(count / pageSize),
        },
    });
};

export const createSettlement = async (req: Request, res: Response) => {
    try {
        const { account_id, transaction_type, amount, description, reason, created_by } = req.body;

        if (!account_id || !transaction_type || amount === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: account_id, transaction_type, amount',
            });
        }

        const settlement = await Settlement.create({
            account_id,
            transaction_type,
            amount: parseFloat(amount.toString()),
            description: description ?? null,
            reason: reason ?? null,
            created_by: created_by ?? null,
        });

        return res.status(201).json({ success: true, data: settlement });
    } catch (error: any) {
        console.error('Error creating settlement:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create settlement',
            error: process.env.NODE_ENV === 'development'
                ? { name: error.name, message: error.message, stack: error.stack }
                : undefined,
        });
    }
};

// ---------- LIST: CREDITS ----------
export const listCreditSettlements = async (req: Request, res: Response) => {
    try {
        const { q, account_id, date_from, date_to } = req.query as Record<string, string | undefined>;
        const { page, pageSize, offset } = parsePaging(req);

        const whereBase = buildCommonWhere(q, account_id);
        const dateWhere = buildDateRange(date_from, date_to);

        const whereCombined: WhereOptions = {
            transaction_type: "credit",
            ...(Object.keys(whereBase).length ? whereBase : {}),
            ...(dateWhere ?? {}),
        };

        const { rows, count } = await Settlement.findAndCountAll({
            where: whereCombined,
            order: [["created_at", "DESC"]],
            limit: pageSize,
            offset,
            include: [
                {
                    model: Account,
                    as: 'from_account',  // Reference the association 'from_account'
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                },
                {
                    model: Account,
                    as: 'to_account',  // Reference the association 'to_account'
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                }
            ]
        });

        return respondPagination(res, rows, count, page, pageSize);
    } catch (err: any) {
        console.error("listCreditSettlements error:", err);
        return res.status(500).json({ success: false, message: "Failed to fetch credit settlements" });
    }
};

// ---------- LIST: DEBITS ----------
export const listDebitSettlements = async (req: Request, res: Response) => {
    try {
        const { q, account_id, date_from, date_to } = req.query as Record<string, string | undefined>;
        const { page, pageSize, offset } = parsePaging(req);

        const whereBase = buildCommonWhere(q, account_id);
        const dateWhere = buildDateRange(date_from, date_to);

        const whereCombined: WhereOptions = {
            transaction_type: "debit",
            ...(Object.keys(whereBase).length ? whereBase : {}),
            ...(dateWhere ?? {}),
        };

        const { rows, count } = await Settlement.findAndCountAll({
            where: whereCombined,
            order: [["created_at", "DESC"]],
            limit: pageSize,
            offset,
            include: [
                {
                    model: Account,
                    as: 'from_account',  // Reference the association 'from_account'
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                },
                {
                    model: Account,
                    as: 'to_account',  // Reference the association 'to_account'
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                }
            ]
        });

        return respondPagination(res, rows, count, page, pageSize);
    } catch (err: any) {
        console.error("listDebitSettlements error:", err);
        return res.status(500).json({ success: false, message: "Failed to fetch debit settlements" });
    }
};

// ---------- LATEST: CREDIT ----------
export const latestCreditSettlement = async (req: Request, res: Response) => {
    try {
        const { q, account_id, date_from, date_to } = req.query as Record<string, string | undefined>;

        const whereBase = buildCommonWhere(q, account_id);
        const dateWhere = buildDateRange(date_from, date_to);

        const whereCombined: WhereOptions = {
            transaction_type: "credit",
            ...(Object.keys(whereBase).length ? whereBase : {}),
            ...(dateWhere ?? {}),
        };

        const row = await Settlement.findOne({
            where: whereCombined,
            order: [["created_at", "DESC"]],
            include: [
                {
                    model: Account,
                    as: 'from_account',
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                },
                {
                    model: Account,
                    as: 'to_account',
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                }
            ]
        });

        return res.json({ success: true, data: row ?? null });
    } catch (err: any) {
        console.error("latestCreditSettlement error:", err);
        return res.status(500).json({ success: false, message: "Failed to fetch latest credit settlement" });
    }
};


// ---------- LATEST: DEBIT ----------
export const latestDebitSettlement = async (req: Request, res: Response) => {
    try {
        const { q, account_id, date_from, date_to } = req.query as Record<string, string | undefined>;

        const whereBase = buildCommonWhere(q, account_id);
        const dateWhere = buildDateRange(date_from, date_to);

        const whereCombined: WhereOptions = {
            transaction_type: "debit",
            ...(Object.keys(whereBase).length ? whereBase : {}),
            ...(dateWhere ?? {}),
        };

        const row = await Settlement.findOne({
            where: whereCombined,
            order: [["created_at", "DESC"]],
            include: [
                {
                    model: Account,
                    as: 'from_account',
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                },
                {
                    model: Account,
                    as: 'to_account',
                    attributes: ["bankname", "accountnumber", "ifsc", "branch"],
                }
            ]
        });

        return res.json({ success: true, data: row ?? null });
    } catch (err: any) {
        console.error("latestDebitSettlement error:", err);
        return res.status(500).json({ success: false, message: "Failed to fetch latest debit settlement" });
    }
};