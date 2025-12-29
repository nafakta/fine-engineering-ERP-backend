// src/controllers/LoanTransactionController.ts
import { Request, Response } from 'express';
import * as Yup from 'yup';
import { Transaction, QueryTypes } from 'sequelize';

import BaseController from './BaseController';
import DBService from '../database/DBService';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';

// NOTE: We are NOT using Sequelize models here (raw queries only)

// Local type – ONLY for request logic, not DB column
type LoanTransactionKind = 'DISBURSEMENT' | 'PAYMENT';

/**
 * Money direction:
 *
 *  - GIVE_LOAN:
 *      DISBURSEMENT  → money goes OUT of your account  → -amount
 *      PAYMENT       → borrower pays you                → +amount
 *
 *  - TAKE_LOAN:
 *      DISBURSEMENT  → money comes INTO your account   → +amount
 *      PAYMENT       → you repay lender                → -amount
 */
function getAccountDelta(
    loanType: 'TAKE_LOAN' | 'GIVE_LOAN',
    kind: LoanTransactionKind,
    amount: number
): number {
    if (loanType === 'GIVE_LOAN') {
        return kind === 'DISBURSEMENT' ? -amount : +amount;
    }
    return kind === 'DISBURSEMENT' ? +amount : -amount;
}

// =========== VALIDATION SCHEMAS ===========
const createLoanTransactionSchema = Yup.object({
    loan_id: Yup.string()
        .uuid('Invalid loan_id')
        .required('loan_id is required'),

    transaction_type: Yup.string()
        .trim()
        .oneOf(['DISBURSEMENT', 'PAYMENT'], 'transaction_type must be DISBURSEMENT or PAYMENT')
        .required('transaction_type is required'),

    amount: Yup.number()
        .typeError('amount must be a number')
        .positive('amount must be positive')
        .required('amount is required'),

    transaction_date: Yup.date()
        .nullable()
        .transform((value, originalValue) =>
            originalValue === '' || originalValue == null ? null : value
        ),

    description: Yup.string().nullable(),

    principal_amount: Yup.number()
        .typeError('principal_amount must be a number')
        .min(0, 'principal_amount cannot be negative')
        .nullable()
        .transform((value, originalValue) =>
            originalValue === '' || originalValue == null ? null : value
        ),
});

const updateLoanTransactionSchema = Yup.object({
    description: Yup.string().nullable(),
    // We only allow editing description (no balance changes)
});

// ======================================
// CONTROLLER
// ======================================

export default class LoanTransactionController extends BaseController {
    private db_services: DBService;

    constructor() {
        super();
        this.db_services = new DBService();
    }

    // 1️⃣ CREATE (POST /loan-transactions)
    public createLoanTransaction = async (req: Request, res: Response): Promise<void> => {
        let trx: Transaction | undefined;

        try {
            const payload = await createLoanTransactionSchema.validate(req.body, {
                abortEarly: false,
                stripUnknown: true,
            });

            const {
                loan_id,
                transaction_type,
                amount,
                transaction_date,
                description,
                principal_amount,
            } = payload;

            const amountNum = Number(amount);
            if (Number.isNaN(amountNum) || amountNum <= 0) {
                return this.sendError(res, {}, 'Invalid amount', 400);
            }

            const kind = (transaction_type as string).toUpperCase() as LoanTransactionKind;

            // 1️⃣ Start DB transaction
            trx = await this.db_services.sequelizeWriter.transaction();

            // 2️⃣ Load loan (FOR UPDATE to lock row)
            const loanRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT *
         FROM loans
         WHERE id = :loan_id
         LIMIT 1
         FOR UPDATE`,
                {
                    replacements: { loan_id },
                    type: QueryTypes.SELECT,
                    transaction: trx,
                }
            );

            if (!loanRows.length) {
                await trx.rollback();
                return this.sendError(res, {}, 'Loan not found', 404);
            }

            const loan = loanRows[0];

            if (loan.status !== 'ACTIVE') {
                await trx.rollback();
                return this.sendError(
                    res,
                    {},
                    `Loan is not ACTIVE (current status: ${loan.status})`,
                    400
                );
            }

            // 3️⃣ Load linked account (also FOR UPDATE)
            const accountRows: any[] = await this.db_services.sequelizeWriter.query(
                `SELECT *
         FROM accounts
         WHERE id = :account_id
         LIMIT 1
         FOR UPDATE`,
                {
                    replacements: { account_id: loan.account_id },
                    type: QueryTypes.SELECT,
                    transaction: trx,
                }
            );

            if (!accountRows.length) {
                await trx.rollback();
                return this.sendError(res, {}, 'Linked account not found', 404);
            }

            const account = accountRows[0];

            // 4️⃣ Decide principal portion
            const principalPart =
                typeof principal_amount === 'number' ? principal_amount : amountNum;

            if (principalPart < 0) {
                await trx.rollback();
                return this.sendError(res, {}, 'principal_amount cannot be negative', 400);
            }

            const currentRemaining = Number(loan.remaining_balance) || 0;
            const currentPrincipalPaid = Number(loan.total_principal_paid) || 0;

            let newRemaining = currentRemaining;
            let newPrincipalPaid = currentPrincipalPaid;

            if (kind === 'DISBURSEMENT') {
                newRemaining = currentRemaining + principalPart;
            } else if (kind === 'PAYMENT') {
                if (principalPart > currentRemaining) {
                    await trx.rollback();
                    return this.sendError(
                        res,
                        {},
                        'principal_amount cannot be greater than remaining balance',
                        400
                    );
                }
                newRemaining = currentRemaining - principalPart;
                newPrincipalPaid = currentPrincipalPaid + principalPart;
            }

            // 5️⃣ Compute account delta & new balance
            const accountDelta = getAccountDelta(
                loan.loan_type as 'TAKE_LOAN' | 'GIVE_LOAN',
                kind,
                amountNum
            );

            const currentAccountBalance = Number(account.initialamount) || 0;
            const newAccountBalance = currentAccountBalance + accountDelta;

            // 6️⃣ Update loan
            const newStatus =
                newRemaining === 0 && loan.status === 'ACTIVE' ? 'SETTLED' : loan.status;

            await this.db_services.sequelizeWriter.query(
                `UPDATE loans
         SET remaining_balance = :remaining_balance,
             total_principal_paid = :total_principal_paid,
             status = :status,
             updated_at = NOW()
         WHERE id = :loan_id`,
                {
                    replacements: {
                        remaining_balance: newRemaining,
                        total_principal_paid: newPrincipalPaid,
                        status: newStatus,
                        loan_id,
                    },
                    type: QueryTypes.UPDATE,
                    transaction: trx,
                }
            );

            // 7️⃣ Update account
            await this.db_services.sequelizeWriter.query(
                `UPDATE accounts
         SET initialamount = :initialamount
         WHERE id = :account_id`,
                {
                    replacements: {
                        initialamount: newAccountBalance,
                        account_id: loan.account_id,
                    },
                    type: QueryTypes.UPDATE,
                    transaction: trx,
                }
            );

            // 8️⃣ Insert loan_transactions row
            const created_by =
                (req as any).user?.id ||
                (req.headers['x-user-id'] as string | undefined) ||
                null;

            const txRows: any[] = await this.db_services.sequelizeWriter.query(
                `INSERT INTO loan_transactions
           (loan_id, amount, transaction_date, principal_amount, remaining_balance,
            description, created_at, created_by, account_id)
         VALUES
           (:loan_id, :amount, :transaction_date, :principal_amount, :remaining_balance,
            :description, NOW(), :created_by, :account_id)
         RETURNING *`,
                {
                    replacements: {
                        loan_id,
                        amount: amountNum,
                        transaction_date: transaction_date
                            ? new Date(transaction_date)
                            : new Date(),
                        principal_amount: principalPart,
                        remaining_balance: newRemaining,
                        description: description || null,
                        created_by,
                        account_id: loan.account_id,
                    },
                    type: QueryTypes.SELECT,
                    transaction: trx,
                }
            );

            const loanTx = txRows[0];

            await trx.commit();

            return this.sendSuccess(
                res,
                {
                    loan: {
                        ...loan,
                        remaining_balance: newRemaining,
                        total_principal_paid: newPrincipalPaid,
                        status: newStatus,
                    },
                    account: {
                        ...account,
                        initialamount: newAccountBalance,
                    },
                    transaction: loanTx,
                },
                'Loan transaction recorded successfully'
            );
        } catch (err: any) {
            if (trx) await trx.rollback();

            if (err instanceof Yup.ValidationError) {
                const errors = err.inner.map((e) => ({
                    field: e.path,
                    message: e.message,
                }));
                return this.sendError(res, { errors }, 'Validation error', 400);
            }

            console.error('createLoanTransaction error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

    // 2️⃣ LIST (GET /loan-transactions)
    public listLoanTransactions = async (req: Request, res: Response): Promise<void> => {
        try {
            const {
                loan_id,
                from_date,
                to_date,
                min_amount,
                max_amount,
                page = 1,
                pageSize = 20,
            } = req.query;

            let where = 'WHERE 1=1';
            const replacements: any = {};

            if (loan_id) {
                where += ' AND lt.loan_id = :loan_id';
                replacements.loan_id = loan_id;
            }

            if (from_date) {
                where += ' AND lt.transaction_date >= :from_date';
                replacements.from_date = from_date;
            }

            if (to_date) {
                where += ' AND lt.transaction_date <= :to_date';
                replacements.to_date = to_date;
            }

            if (min_amount) {
                where += ' AND lt.amount >= :min_amount';
                replacements.min_amount = min_amount;
            }

            if (max_amount) {
                where += ' AND lt.amount <= :max_amount';
                replacements.max_amount = max_amount;
            }

            const limit = Number(pageSize) || 20;
            const offset = (Number(page) - 1) * limit;

            replacements.limit = limit;
            replacements.offset = offset;

            // Join loans to fetch loan_type (left join to be safe)
            const rows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT lt.*,
                    l.loan_type AS loan_type
             FROM loan_transactions lt
             LEFT JOIN loans l ON lt.loan_id = l.id
             ${where}
             ORDER BY lt.transaction_date DESC, lt.created_at DESC
             LIMIT :limit OFFSET :offset`,
                {
                    replacements,
                    type: QueryTypes.SELECT,
                }
            );

            const countRows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT COUNT(*)::int AS count
             FROM loan_transactions lt
             ${where}`,
                {
                    replacements,
                    type: QueryTypes.SELECT,
                }
            );

            const total = countRows[0]?.count || 0;

            return this.sendSuccess(
                res,
                {
                    rows,
                    pagination: {
                        total,
                        page: Number(page),
                        pageSize: limit,
                        totalPages: Math.ceil(total / limit),
                    },
                },
                'Loan transactions fetched successfully'
            );
        } catch (err) {
            console.error('listLoanTransactions error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

    // 3️⃣ GET BY ID (GET /loan-transactions/:id)
    public getLoanTransactionById = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const rows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT lt.*,
                    l.loan_type AS loan_type
             FROM loan_transactions lt
             LEFT JOIN loans l ON lt.loan_id = l.id
             WHERE lt.id = :id
             LIMIT 1`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) {
                return this.sendError(res, {}, 'Transaction not found', 404);
            }

            return this.sendSuccess(
                res,
                rows[0],
                'Loan transaction fetched successfully'
            );
        } catch (err) {
            console.error('getLoanTransactionById error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

    // 4️⃣ GET BY LOAN (GET /loan-transactions/loan/:loan_id)
    public getLoanTransactionsByLoan = async (
        req: Request,
        res: Response
    ): Promise<void> => {
        try {
            const { loan_id } = req.params;

            const rows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT lt.*,
                    l.loan_type AS loan_type
             FROM loan_transactions lt
             LEFT JOIN loans l ON lt.loan_id = l.id
             WHERE lt.loan_id = :loan_id
             ORDER BY lt.transaction_date ASC, lt.created_at ASC`,
                {
                    replacements: { loan_id },
                    type: QueryTypes.SELECT,
                }
            );

            return this.sendSuccess(
                res,
                rows,
                'Loan transactions for this loan fetched successfully'
            );
        } catch (err) {
            console.error('getLoanTransactionsByLoan error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

    // 5️⃣ UPDATE (PATCH /loan-transactions/:id) – description only
    public updateLoanTransaction = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const payload = await updateLoanTransactionSchema.validate(req.body, {
                abortEarly: false,
                stripUnknown: true,
            });

            // Ensure it exists first
            const rows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT *
         FROM loan_transactions
         WHERE id = :id
         LIMIT 1`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) {
                return this.sendError(res, {}, 'Transaction not found', 404);
            }

            const description =
                Object.prototype.hasOwnProperty.call(payload, 'description')
                    ? payload.description ?? null
                    : rows[0].description;

            const updatedRows: any[] = await this.db_services.sequelizeWriter.query(
                `UPDATE loan_transactions
         SET description = :description
         WHERE id = :id
         RETURNING *`,
                {
                    replacements: { id, description },
                    type: QueryTypes.SELECT,
                }
            );

            return this.sendSuccess(
                res,
                updatedRows[0],
                'Loan transaction updated successfully'
            );
        } catch (err: any) {
            if (err instanceof Yup.ValidationError) {
                const errors = err.inner.map((e) => ({
                    field: e.path,
                    message: e.message,
                }));
                return this.sendError(res, { errors }, 'Validation error', 400);
            }

            console.error('updateLoanTransaction error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

    // 6️⃣ DELETE (DELETE /loan-transactions/:id)
    // Note: this does NOT auto-adjust loan/account balances.
    public deleteLoanTransaction = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const rows: any[] = await this.db_services.sequelizeReader.query(
                `SELECT id
         FROM loan_transactions
         WHERE id = :id
         LIMIT 1`,
                {
                    replacements: { id },
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) {
                return this.sendError(res, {}, 'Transaction not found', 404);
            }

            await this.db_services.sequelizeWriter.query(
                `DELETE FROM loan_transactions
         WHERE id = :id`,
                {
                    replacements: { id },
                    type: QueryTypes.DELETE,
                }
            );

            return this.sendSuccess(
                res,
                {},
                'Loan transaction deleted successfully'
            );
        } catch (err) {
            console.error('deleteLoanTransaction error:', err);
            return this.sendError(res, {}, 'Internal server error', 500);
        }
    };

}
