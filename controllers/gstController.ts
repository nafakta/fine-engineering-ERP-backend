// src/controllers/GSTController.ts
import { Request, Response } from "express";
import db from "../models";
import { QueryTypes, Sequelize, Transaction } from "sequelize";

type PaidStatus = "Paid" | "UnPaid" | "Partially Paid";

type GSTRow = {
    id: string;
    invoice_id: string;
    invoice_date: string | null; // Changed from 'date' to 'invoice_date'
    invoice_no: string;
    client_id: string;
    company_name: string | null;
    gst_no: string | null;
    amount: number;
    gst_percent: number;
    gst_amount: number;
    total_amount: number;
    paid_amount: number;
    remaining_amount: number;
    paid_status: PaidStatus;
    gst_payed: boolean;
    created_by: string | null;
    created_by_name: string | null;
    created_by_email: string | null;
    created_at: string;
    updated_at: string;
};

export class GSTController {
    /**
     * Public API
     * GET /gst
     * Query:
     *   q           -> search (company/client/invoice_no/gst_no)
     *   status      -> Paid | UnPaid | Partially Paid
     *   start_date  -> filter by invoice tax_date >=
     *   end_date    -> filter by invoice tax_date <=
     *   page, limit
     */
    public listGST = async (req: Request, res: Response) => {
        try {
            // ---- pagination
            const page: number = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
            const limit: number = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 200);
            const offset: number = (page - 1) * limit;

            // ---- filters
            const q: string = typeof req.query.q === "string" ? req.query.q.trim() : "";
            const statusParam: PaidStatus | undefined =
                typeof req.query.status === "string"
                    ? (req.query.status.trim() as PaidStatus)
                    : undefined;
            const startDate: string = typeof req.query.start_date === "string" ? req.query.start_date.trim() : "";
            const endDate: string = typeof req.query.end_date === "string" ? req.query.end_date.trim() : "";

            const filters: string[] = [];
            const params: any[] = [];
            let i = 1;

            if (q) {
                filters.push(`
          (
            COALESCE(gr.company_name, '') ILIKE $${i}
            OR COALESCE(c.client, '') ILIKE $${i}
            OR COALESCE(c.company, '') ILIKE $${i}
            OR COALESCE(c.gstn, '') ILIKE $${i}
            OR i.invoice_no ILIKE $${i}
          )
        `);
                params.push(`%${q}%`);
                i++;
            }

            if (statusParam && ["Paid", "UnPaid", "Partially Paid"].includes(statusParam)) {
                filters.push(`gr.paid_status = $${i}`);
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

            // ---- core select with 18% GST as string and invoice_date
            const baseSelect = `
        SELECT
          gr.id,
          gr.invoice_id,
          i.tax_date::date                                       AS invoice_date,
          i.invoice_no,
          gr.client_id,
          gr.company_name,
          gr.gst_no,
          gr.amount::numeric                                     AS amount,
          '18%'::text                                            AS gst_percent, -- Show as "18%" string instead of number
          (gr.amount * 0.18)::numeric                            AS gst_amount,
          (gr.amount * 1.18)::numeric                            AS total_amount,
          gr.paid_amount::numeric                                AS paid_amount,
          gr.remaining_amount::numeric                           AS remaining_amount,
          gr.paid_status,
          COALESCE(gr.gst_payed, (gr.paid_amount >= (gr.amount * 0.18))) AS gst_payed,
          gr.created_by,
          su.name                                                AS created_by_name,
          su.email                                               AS created_by_email,
          gr.created_at,
          gr.updated_at
        FROM public.gst_records gr
        JOIN public.invoices i ON i.id = gr.invoice_id
        JOIN public.clients  c ON c.id = gr.client_id
        LEFT JOIN public.system_users su ON su.id = gr.created_by
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
        ORDER BY invoice_date DESC NULLS LAST, invoice_no DESC
        LIMIT $${i} OFFSET $${i + 1}
      `;
            const dataParams = [...params, limit, offset];

            const rowsAny = await sequelize.query(dataQuery, {
                bind: dataParams,
                type: QueryTypes.SELECT,
            });
            const rows = rowsAny as GSTRow[];

            // ---- per-page totals
            const num = (v: any) => Number(v || 0);
            const total_gst = rows.reduce((s, r) => s + num(r.gst_amount), 0);
            const paid_gst = rows.filter(r => r.paid_status === "Paid").reduce((s, r) => s + num(r.gst_amount), 0);
            const unpaid_gst = rows.filter(r => r.paid_status === "UnPaid").reduce((s, r) => s + num(r.gst_amount), 0);

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
                    total_gst,
                    paid_gst,
                    unpaid_gst,
                },
                data: rows,
            });
        } catch (err: any) {
            console.error("listGST error:", err);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch GST data",
                error: err?.message || String(err),
            });
        }
    };

    public payGST = async (req: Request, res: Response) => {
        const sequelize = db.sequelize as unknown as Sequelize;

        const { gst_record_id, amount } = req.body as {
            gst_record_id?: string;
            amount?: number;
            paid_on?: string;
            txn_ref?: string;
            notes?: string;
        };

        if (!gst_record_id || amount == null) {
            return res.status(400).json({
                success: false,
                message: "gst_record_id and amount are required",
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
                {
                    isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
                },
                async (t): Promise<{
                    updated: any;
                    applied_amount: number;
                    new_status: PaidStatus;
                }> => {
                    // 1) Lock GST record - updated for 18% GST calculation
                    const [gstRow] = (await sequelize.query(
                        `
          SELECT
            id,
            amount::numeric        AS amount,
            (amount * 0.18)::numeric AS gst_amount, -- Calculate 18% GST
            paid_amount::numeric     AS paid_amount,
            remaining_amount::numeric AS remaining_amount,
            paid_status,
            gst_payed
          FROM public.gst_records
          WHERE id = $1
          FOR UPDATE
        `,
                        { bind: [gst_record_id], type: QueryTypes.SELECT, transaction: t }
                    )) as Array<{
                        id: string;
                        amount: string | number;
                        gst_amount: string | number;
                        paid_amount: string | number;
                        remaining_amount: string | number;
                        paid_status: PaidStatus;
                        gst_payed: boolean;
                    }>;

                    if (!gstRow) {
                        throw Object.assign(new Error("GST record not found"), { http: 404 });
                    }

                    const gst_amount = Number(gstRow.gst_amount || 0);
                    const paid_amount_before = Number(gstRow.paid_amount || 0);
                    const remaining_before = Math.max(0, gst_amount - paid_amount_before);

                    if (gstRow.paid_status === "Paid" || remaining_before <= 0) {
                        throw Object.assign(new Error("GST already paid"), { http: 409 });
                    }

                    // 2) Apply payment (cap at remaining)
                    const applyNow = Math.min(amt, remaining_before);

                    const new_paid = paid_amount_before + applyNow;
                    const remaining_after = Math.max(0, gst_amount - new_paid);

                    let new_status: PaidStatus = "UnPaid";
                    if (new_paid >= gst_amount) new_status = "Paid";
                    else if (new_paid > 0) new_status = "Partially Paid";

                    const gst_payed = new_paid >= gst_amount;

                    // 3) Update GST record
                    const [updated] = (await sequelize.query(
                        `
          UPDATE public.gst_records
          SET paid_amount = $1,
              remaining_amount = $2,
              paid_status = $3,
              gst_payed = $4,
              updated_at = now()
          WHERE id = $5
          RETURNING *
        `,
                        {
                            bind: [new_paid, remaining_after, new_status, gst_payed, gst_record_id],
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
                        ? "GST fully paid"
                        : out.new_status === "Partially Paid"
                            ? "GST partially paid"
                            : "Payment recorded",
                applied_amount: out.applied_amount,
                data: out.updated,
            });
        } catch (err: any) {
            const http = err?.http || 500;
            console.error("payGST error:", err);
            return res.status(http).json({
                success: false,
                message: err?.message || "Failed to process GST payment",
            });
        }
    };
}

export default new GSTController();