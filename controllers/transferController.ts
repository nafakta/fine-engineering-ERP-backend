import { Request, Response } from "express";
import { Op, Transaction } from "sequelize";
import { QueryTypes } from "sequelize";
import db, { sequelize } from "../models"; // exports { sequelize } and default db
const { Account, AccountTransfer } = db;

// UUID v4 validator (optional safety)
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseNum(n: any, fallback: number | null = null) {
    const v = Number(n);
    return Number.isFinite(v) ? v : fallback;
}

type AccountSummary = {
    id: string;
    accountname: string | null;
    bankname: string | null;
    accountnumber: string | null;
    ifsc: string | null;
    branch: string | null;
    balance: number; // maps initialamount
};

function toAccountSummary(acc: any | null): AccountSummary | null {
    if (!acc) return null;
    return {
        id: acc.id,
        accountname: acc.accountname ?? null,
        bankname: acc.bankname ?? null,
        accountnumber: acc.accountnumber ?? null,
        ifsc: acc.ifsc ?? null,
        branch: acc.branch ?? null,
        balance: Number(acc.initialamount ?? 0),
    };
}

/**
 * POST /account-transfers
 * Body: { transfer_from, transfer_to, amount, reason? }
 * Creates a transfer and adjusts balances in a single transaction.
 */
export async function createtransferservice(req: Request, res: Response) {
    try {
        const transfer_from = String(req.body.transfer_from || "").trim();
        const transfer_to = String(req.body.transfer_to || "").trim();
        const amount = parseNum(req.body.amount);
        const reason =
            typeof req.body.reason === "string" ? req.body.reason.trim() : null;

        if (!transfer_from || !transfer_to) {
            throw new Error("Both transfer_from and transfer_to are required.");
        }
        if (transfer_from === transfer_to) {
            throw new Error("transfer_from and transfer_to must be different.");
        }
        if (!UUID_RE.test(transfer_from) || !UUID_RE.test(transfer_to)) {
            throw new Error("transfer_from and transfer_to must be valid UUIDs.");
        }
        if (amount == null || amount <= 0) {
            throw new Error("Amount must be a valid number greater than 0.");
        }

        const result = await sequelize.transaction(
            { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
            async (t) => {
                // lock accounts in deterministic order to avoid deadlocks
                const [aId, bId] = [transfer_from, transfer_to].sort();
                const [accA, accB] = await Promise.all([
                    Account.findByPk(aId, { transaction: t, lock: t.LOCK.UPDATE }),
                    Account.findByPk(bId, { transaction: t, lock: t.LOCK.UPDATE }),
                ]);

                const fromAcc = transfer_from === aId ? accA : accB;
                const toAcc = transfer_to === bId ? accB : accA;

                if (!fromAcc) throw new Error("Source account not found.");
                if (!toAcc) throw new Error("Destination account not found.");

                const fromBalance = Number(fromAcc.initialamount ?? 0);
                if (fromBalance < amount) {
                    throw new Error("Insufficient funds in source account.");
                }

                // adjust balances atomically
                await fromAcc.decrement("initialamount", { by: amount, transaction: t });
                await toAcc.increment("initialamount", { by: amount, transaction: t });

                // create transfer row
                const tr = await AccountTransfer.create(
                    { transfer_from, transfer_to, amount, reason },
                    { transaction: t }
                );

                await Promise.all([fromAcc.reload({ transaction: t }), toAcc.reload({ transaction: t })]);

                return {
                    transfer: tr,
                    fromAccount: { id: fromAcc.id, balance: Number(fromAcc.initialamount ?? 0) },
                    toAccount: { id: toAcc.id, balance: Number(toAcc.initialamount ?? 0) },
                };
            }
        );

        res.status(200).json({ success: true, data: result });
    } catch (err: any) {
        console.error("createTransfer error:", err);
        res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}

/**
 * GET /account-transfers
 * Query: page, pageSize, transfer_from, transfer_to, start_date, end_date, min_amount, max_amount, q, sortBy, sortOrder
 */
export async function listTransfers(req: Request, res: Response) {
    try {
        const page = Math.max(parseInt(String(req.query.page || 1), 10), 1);
        const pageSize = Math.min(
            Math.max(parseInt(String(req.query.pageSize || 10), 10), 1),
            100
        );

        const where: any = {};

        if (req.query.transfer_from && UUID_RE.test(String(req.query.transfer_from))) {
            where.transfer_from = String(req.query.transfer_from);
        }
        if (req.query.transfer_to && UUID_RE.test(String(req.query.transfer_to))) {
            where.transfer_to = String(req.query.transfer_to);
        }

        // date range (inclusive)
        const start = req.query.start_date ? new Date(String(req.query.start_date)) : null;
        const end = req.query.end_date ? new Date(String(req.query.end_date)) : null;
        if (start || end) {
            where.transfer_date = {};
            if (start) where.transfer_date[Op.gte] = start;
            if (end) where.transfer_date[Op.lte] = end;
        }

        // amount range
        const minAmt = parseNum(req.query.min_amount);
        const maxAmt = parseNum(req.query.max_amount);
        if (minAmt != null || maxAmt != null) {
            where.amount = {};
            if (minAmt != null) where.amount[Op.gte] = minAmt;
            if (maxAmt != null) where.amount[Op.lte] = maxAmt;
        }

        // reason search
        const q = String(req.query.q || "").trim();
        if (q) {
            where.reason = { [Op.iLike]: `%${q}%` };
        }

        const sortBy = String(req.query.sortBy || "transfer_date");
        const sortOrder = String(req.query.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

        const { rows, count } = await AccountTransfer.findAndCountAll({
            where,
            order: [[sortBy, sortOrder]],
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        res.json({
            success: true,
            data: rows,
            meta: {
                page,
                pageSize,
                total: count,
                totalPages: Math.ceil(count / pageSize),
            },
        });
    } catch (err: any) {
        console.error("listTransfers error:", err);
        res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}

/**
 * GET /account-transfers/:id
 */
export async function getTransfer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        if (!UUID_RE.test(id)) throw new Error("Invalid id");

        const tr = await AccountTransfer.findByPk(id);
        if (!tr) return res.status(404).json({ success: false, error: "Not found" });

        res.json({ success: true, data: tr });
    } catch (err: any) {
        console.error("getTransfer error:", err);
        res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}

/**
 * PATCH /account-transfers/:id
 * Body: { reason?, transfer_date? }
 * NOTE: we do NOT allow updating transfer_from/transfer_to/amount to maintain ledger integrity.
 */
export async function updateTransfer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        if (!UUID_RE.test(id)) throw new Error("Invalid id");

        const tr = await AccountTransfer.findByPk(id);
        if (!tr) return res.status(404).json({ success: false, error: "Not found" });

        const updates: any = {};
        if (typeof req.body.reason === "string") {
            updates.reason = req.body.reason.trim();
        }
        if (req.body.transfer_date) {
            const d = new Date(String(req.body.transfer_date));
            if (!isNaN(d.getTime())) updates.transfer_date = d;
        }

        // ignore immutable fields if someone sends them
        delete updates.transfer_from;
        delete updates.transfer_to;
        delete updates.amount;

        await tr.update(updates);

        res.json({ success: true, data: tr });
    } catch (err: any) {
        console.error("updateTransfer error:", err);
        res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}

/**
 * DELETE /account-transfers/:id
 * Query: ?revert=true to restore balances, then delete the row.
 * Default (revert not set): deletes without balance change (not recommended).
 */
export async function deleteTransfer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const revert = String(req.query.revert || "").toLowerCase() === "true";

        if (!UUID_RE.test(id)) throw new Error("Invalid id");

        const payload = await sequelize.transaction(
            { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
            async (t) => {
                const tr = await AccountTransfer.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
                if (!tr) return null;

                if (revert) {
                    // Lock accounts deterministically
                    const transfer_from = tr.transfer_from;
                    const transfer_to = tr.transfer_to;
                    const amount = Number(tr.amount);

                    const [aId, bId] = [transfer_from, transfer_to].sort();
                    const [accA, accB] = await Promise.all([
                        Account.findByPk(aId, { transaction: t, lock: t.LOCK.UPDATE }),
                        Account.findByPk(bId, { transaction: t, lock: t.LOCK.UPDATE }),
                    ]);

                    const fromAcc = transfer_from === aId ? accA : accB;
                    const toAcc = transfer_to === bId ? accB : accA;

                    if (!fromAcc || !toAcc) {
                        throw new Error("Related accounts not found for reversal.");
                    }

                    // Ensure the destination still has funds to reverse (basic guard)
                    const toBalance = Number(toAcc.initialamount ?? 0);
                    if (toBalance < amount) {
                        throw new Error("Cannot revert: destination account has insufficient balance.");
                    }

                    // Reverse balances
                    await toAcc.decrement("initialamount", { by: amount, transaction: t });
                    await fromAcc.increment("initialamount", { by: amount, transaction: t });
                }

                await tr.destroy({ transaction: t });
                return tr;
            }
        );

        if (!payload) return res.status(404).json({ success: false, error: "Not found" });

        res.json({ success: true, data: { id, reverted: revert } });
    } catch (err: any) {
        console.error("deleteTransfer error:", err);
        res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}
export async function latestTransfer(req: Request, res: Response) {
    try {
        const rows = await sequelize.query(
            `
      SELECT
        tr.id                         AS transfer_id,
        tr.transfer_from,
        tr.transfer_to,
        tr.amount,
        tr.reason,
        tr.transfer_date,

        -- FROM account (sender)
        af.id                         AS from_id,
        af.accountname                AS from_accountname,
        af.bankname                   AS from_bankname,
        af.accountnumber              AS from_accountnumber,
        af.ifsc                       AS from_ifsc,
        af.branch                     AS from_branch,
        af.initialamount              AS from_balance,

        -- TO account (receiver)
        at.id                         AS to_id,
        at.accountname                AS to_accountname,
        at.bankname                   AS to_bankname,
        at.accountnumber              AS to_accountnumber,
        at.ifsc                       AS to_ifsc,
        at.branch                     AS to_branch,
        at.initialamount              AS to_balance

      FROM public.account_transfers tr
      JOIN public.accounts af ON af.id = tr.transfer_from
      JOIN public.accounts at ON at.id = tr.transfer_to
      ORDER BY tr.transfer_date DESC, tr.id DESC
      LIMIT 1
      `,
            { type: QueryTypes.SELECT }
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, error: "No transfers found" });
        }

        const r: any = rows[0];

        // Shape a clean payload
        const payload = {
            id: r.transfer_id,
            amount: Number(r.amount),
            reason: r.reason ?? null,
            transfer_date: r.transfer_date,

            from: {
                id: r.from_id,
                accountname: r.from_accountname,
                bankname: r.from_bankname,
                accountnumber: r.from_accountnumber,
                ifsc: r.from_ifsc,
                branch: r.from_branch,
                balance: Number(r.from_balance ?? 0),
            },

            to: {
                id: r.to_id,
                accountname: r.to_accountname,
                bankname: r.to_bankname,
                accountnumber: r.to_accountnumber,
                ifsc: r.to_ifsc,
                branch: r.to_branch,
                balance: Number(r.to_balance ?? 0),
            },
        };

        return res.json({ success: true, data: payload });
    } catch (err: any) {
        console.error("latestTransferFull error:", err);
        return res.status(400).json({ success: false, error: err?.message || "Bad Request" });
    }
}