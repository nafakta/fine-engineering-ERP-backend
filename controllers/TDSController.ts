import { Request, Response } from "express";
import db from "../models";
import { QueryTypes, Sequelize, Transaction } from "sequelize";

type PaidStatus = "Paid" | "UnPaid" | "Partially Paid";

type TDSRow = {
    id: string;
    invoice_id: string;
    date: string | null;
    invoice_no: string;
    client_id: string;
    company_name: string | null;

    base_amount: number;     // <-- from table
    tds_percent: number;
    tds_amount: number;
    total_amount: number;

    paid_amount: number;
    remaining_amount: number;
    paid_status: PaidStatus;
    tds_paid: boolean;       // <-- from table

    created_by: string | null;
    created_by_name: string | null;
    created_by_email: string | null;
    created_at: string;
    updated_at: string;
};

export class TDSController {
    /**
     * Public API
     * GET /tds
     * Query:
     *   q           -> search (company/client/invoice_no)
     *   status      -> Paid | UnPaid | Partially Paid
     *   start_date  -> filter by invoice tax_date >=
     *   end_date    -> filter by invoice tax_date <=
     *   page, limit
     */
    public listTDS = async (req: Request, res: Response) => {
        try {
            // ---- pagination
            const page: number = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
            const limit: number = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 200);
            const offset: number = (page - 1) * limit;

            // ---- filters
            const q: string = typeof req.query.q === "string" ? req.query.q.trim() : "";
            const statusParam: PaidStatus | undefined =
                typeof req.query.status === "string" ? (req.query.status.trim() as PaidStatus) : undefined;
            const startDate: string = typeof req.query.start_date === "string" ? req.query.start_date.trim() : "";
            const endDate: string = typeof req.query.end_date === "string" ? req.query.end_date.trim() : "";

            const filters: string[] = [];
            const params: any[] = [];
            let i = 1;

            if (q) {
                filters.push(`
          (
            COALESCE(tr.company_name, '') ILIKE $${i}
            OR COALESCE(c.client, '') ILIKE $${i}
            OR COALESCE(c.company, '') ILIKE $${i}
            OR COALESCE(tr.gst_no, '') ILIKE $${i}
            OR i.invoice_no ILIKE $${i}
          )
        `);
                params.push(`%${q}%`);
                i++;
            }

            if (statusParam && ["Paid", "UnPaid", "Partially Paid"].includes(statusParam)) {
                filters.push(`tr.paid_status = $${i}`);
                params.push(statusParam);
                i++;
            }

            if (startDate) {
                filters.push(`i.tax_date >= $${i}`);
                params.push(startDate);
                i++;
            }

            if (endDate) {
                filters.push(`i.tax_date <= $${i}`);
                params.push(endDate);
                i++;
            }

            const whereSQL: string = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

            // ---- core select
            // Uses physical column tr.tds_paid; safety net via COALESCE (paid_amount >= tds_amount)
            const baseSelect = `
        SELECT
          tr.id,
          tr.invoice_id,
          i.tax_date::date                                       AS date,
          i.invoice_no,
          tr.client_id,
          tr.company_name,

          tr.base_amount::numeric                                AS base_amount,
          tr.tds_percent::numeric                                 AS tds_percent,
          tr.tds_amount::numeric                                  AS tds_amount,
          tr.total_amount::numeric                                AS total_amount,
          tr.gst_no,        
          tr.paid_amount::numeric                                 AS paid_amount,
          tr.remaining_amount::numeric                            AS remaining_amount,
          tr.paid_status,
          COALESCE(tr.tds_paid, (tr.paid_amount >= tr.tds_amount)) AS tds_paid,

          tr.created_by,
          su.name                                                AS created_by_name,
          su.email                                               AS created_by_email,
          tr.created_at,
          tr.updated_at
        FROM public.tds_records tr
        JOIN public.invoices i ON i.id = tr.invoice_id
        JOIN public.clients  c ON c.id = tr.client_id
        LEFT JOIN public.system_users su ON su.id = tr.created_by
        ${whereSQL}
      `;

            // ---- typed sequelize
            const sequelize = db.sequelize as unknown as Sequelize;

            // ---- count
            const countQuery = `
        SELECT COUNT(*)::int AS total_count
        FROM (${baseSelect}) AS t
      `;
            const countRows = await sequelize.query(countQuery, {
                bind: params,
                type: QueryTypes.SELECT,
            });
            const totalCount = (countRows as Array<{ total_count: number }>)[0]?.total_count ?? 0;
            const totalPages = Math.ceil(totalCount / limit);

            // ---- page data
            const dataQuery = `
        ${baseSelect}
        ORDER BY date DESC NULLS LAST, invoice_no DESC
        LIMIT $${i} OFFSET $${i + 1}
      `;
            const dataParams = [...params, limit, offset];

            const rowsAny = await sequelize.query(dataQuery, {
                bind: dataParams,
                type: QueryTypes.SELECT,
            });
            const rows = rowsAny as TDSRow[];

            // ---- per-page totals (mirrors GST logic)
            const num = (v: any) => Number(v || 0);
            const total_tds = rows.reduce((s, r) => s + num(r.tds_amount), 0);
            const paid_tds = rows.filter(r => r.paid_status === "Paid").reduce((s, r) => s + num(r.tds_amount), 0);
            const unpaid_tds = rows.filter(r => r.paid_status === "UnPaid").reduce((s, r) => s + num(r.tds_amount), 0);

            return res.status(200).json({
                success: true,
                meta: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                    filters: {
                        q: q || null,
                        status: statusParam || null,
                        start_date: startDate || null,
                        end_date: endDate || null,
                    },
                },
                totals: {
                    total_tds,
                    paid_tds,
                    unpaid_tds,
                },
                data: rows,
            });
        } catch (err: any) {
            console.error("listTDS error:", err);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch TDS data",
                error: err?.message || String(err),
            });
        }
    };

    public payTDS = async (req: Request, res: Response) => {
        const sequelize = db.sequelize as unknown as Sequelize;

        const { tds_record_id, amount } = req.body as {
            tds_record_id?: string;
            amount?: number;
            // Optional to persist later if you add columns:
            paid_on?: string;
            txn_ref?: string;
            notes?: string;
        };

        if (!tds_record_id || amount == null) {
            return res.status(400).json({
                success: false,
                message: "tds_record_id and amount are required",
            });
        }

        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt <= 0) {
            return res.status(400).json({
                success: false,
                message: "Amount must be a positive number",
            });
        }

        try {
            const out = await sequelize.transaction(
                { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
                async (t): Promise<{
                    updated: any;
                    applied_amount: number;
                    new_status: PaidStatus;
                }> => {
                    // 1) Lock TDS record
                    const [tdsRow] = (await sequelize.query(
                        `
          SELECT
            id,
            tds_amount::numeric        AS tds_amount,
            paid_amount::numeric       AS paid_amount,
            remaining_amount::numeric  AS remaining_amount,
            paid_status,
            tds_paid
          FROM public.tds_records
          WHERE id = $1
          FOR UPDATE
        `,
                        { bind: [tds_record_id], type: QueryTypes.SELECT, transaction: t }
                    )) as Array<{
                        id: string;
                        tds_amount: string | number;
                        paid_amount: string | number;
                        remaining_amount: string | number;
                        paid_status: PaidStatus;
                        tds_paid: boolean;
                    }>;

                    if (!tdsRow) {
                        throw Object.assign(new Error("TDS record not found"), { http: 404 });
                    }

                    const tds_amount = Number(tdsRow.tds_amount || 0);
                    const paid_amount_before = Number(tdsRow.paid_amount || 0);
                    const remaining_before = Math.max(0, tds_amount - paid_amount_before);

                    if (tdsRow.paid_status === "Paid" || remaining_before <= 0) {
                        throw Object.assign(new Error("TDS already paid"), { http: 409 });
                    }

                    // 2) Apply payment (cap at remaining)
                    const applyNow = Math.min(amt, remaining_before);

                    const new_paid = paid_amount_before + applyNow;
                    const remaining_after = Math.max(0, tds_amount - new_paid);

                    let new_status: PaidStatus = "UnPaid";
                    if (new_paid >= tds_amount) new_status = "Paid";
                    else if (new_paid > 0) new_status = "Partially Paid";

                    const tds_paid = new_paid >= tds_amount;

                    // 3) Update TDS record (no account/bank changes)
                    const [updated] = (await sequelize.query(
                        `
          UPDATE public.tds_records
          SET paid_amount = $1,
              remaining_amount = $2,
              paid_status = $3,
              tds_paid = $4,
              updated_at = now()
          WHERE id = $5
          RETURNING *
        `,
                        {
                            bind: [new_paid, remaining_after, new_status, tds_paid, tds_record_id],
                            type: QueryTypes.UPDATE,
                            transaction: t,
                        }
                    )) as any[];

                    return { updated, applied_amount: applyNow, new_status };
                }
            );

            return res.status(200).json({
                success: true,
                message:
                    out.new_status === "Paid"
                        ? "TDS fully paid"
                        : out.new_status === "Partially Paid"
                            ? "TDS partially paid"
                            : "Payment recorded",
                applied_amount: out.applied_amount,
                data: out.updated,
            });
        } catch (err: any) {
            const http = err?.http || 500;
            console.error("payTDS error:", err);
            return res.status(http).json({
                success: false,
                message: err?.message || "Failed to process TDS payment",
            });
        }
    };

    public searchTDS = async (req: Request, res: Response) => {
        try {
            const sequelize = db.sequelize as unknown as Sequelize;

            // pagination
            const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 200);
            const offset = (page - 1) * limit;

            // filters
            const client = typeof req.query.client === "string" ? req.query.client.trim() : "";
            const startDate = typeof req.query.start_date === "string" ? req.query.start_date.trim() : "";
            const endDate = typeof req.query.end_date === "string" ? req.query.end_date.trim() : "";

            const where: string[] = [];
            const bind: any[] = [];
            let i = 1;

            if (client) {
                // match either client name or company name
                where.push(`(COALESCE(c.client, '') ILIKE $${i} OR COALESCE(c.company, '') ILIKE $${i})`);
                bind.push(`%${client}%`);
                i++;
            }

            if (startDate) {
                where.push(`i.tax_date >= $${i}`);
                bind.push(startDate);
                i++;
            }

            if (endDate) {
                where.push(`i.tax_date <= $${i}`);
                bind.push(endDate);
                i++;
            }

            const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

            // Base SELECT – only requested columns + helpful ids
            // NOTE: Adjust c.state / c.phone to your actual column names if different.
            const baseSelect = `
            SELECT
                i.tax_date::date                                   AS date,
                COALESCE(tr.company_name, c.company)              AS company_name,
                c.client                                           AS client_name,
                c.state                                            AS state,
                NULLIF(TRIM(COALESCE(c.mobile, '')), NULL)         AS mobile_primary,
                NULLIF(TRIM(COALESCE(c.contact_person_number, '')), NULL) AS mobile_contact,
                COALESCE(
                NULLIF(TRIM(COALESCE(c.mobile, '')), NULL),
                NULLIF(TRIM(COALESCE(c.contact_person_number, '')), NULL)
                )                                                  AS mobile_number,   -- ✅ what the UI should read
                tr.total_amount::numeric                           AS amount,
                tr.tds_amount::numeric                             AS tds_amount,
                i.invoice_no                                       AS invoice_no,
                tr.id                                              AS tds_record_id
            FROM public.tds_records tr
            JOIN public.invoices i ON i.id = tr.invoice_id
            JOIN public.clients  c ON c.id = tr.client_id
            ${whereSQL}
            `;

            // count
            const countSQL = `SELECT COUNT(*)::int AS total_count FROM (${baseSelect}) x`;
            const [{ total_count }] = (await sequelize.query(countSQL, {
                bind,
                type: QueryTypes.SELECT,
            })) as Array<{ total_count: number }>;

            const totalCount = total_count ?? 0;
            const totalPages = Math.ceil(totalCount / limit);

            // page data
            const dataSQL = `
      ${baseSelect}
      ORDER BY date DESC NULLS LAST, invoice_no DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;
            const rows = (await sequelize.query(dataSQL, {
                bind: [...bind, limit, offset],
                type: QueryTypes.SELECT,
            })) as Array<{
                date: string | null;
                company_name: string | null;
                client_name: string | null;
                state: string | null;
                mobile: string | null;
                amount: string | number | null;
                tds_amount: string | number | null;
                invoice_no: string | null;
                tds_record_id: string;
            }>;

            return res.status(200).json({
                success: true,
                meta: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                    filters: {
                        client: client || null,
                        start_date: startDate || null,
                        end_date: endDate || null,
                    },
                },
                data: rows,
            });
        } catch (err: any) {
            console.error("searchTDS error:", err);
            return res.status(500).json({
                success: false,
                message: "Failed to search TDS records",
                error: err?.message || String(err),
            });
        }
    };
}

export default new TDSController();
