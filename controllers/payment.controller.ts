// src/controllers/payment.controller.ts
import { Request, Response } from 'express';
import { Expense } from '../models/expenses';
import { ExpensePayment } from '../models/ExpensePayment';
import { Account } from '../models/Banks';
import { Department } from '../models/Department';
import { UserDepartment } from '../models/UserDepartment';
import * as Yup from 'yup';
import { Op, Transaction } from 'sequelize';
import { ExpenseMedia, sequelize } from '../models/index';
import { QueryTypes } from "sequelize";

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        system_user_id: string;
        email?: string;
        role?: string;
        secretKey?: string;
    };
}

// Validation schemas
const makePaymentSchema = Yup.object({
    expense_id: Yup.string().uuid().required("Expense ID is required"),
    account_id: Yup.string().uuid().required("Account ID is required"),
    amount_paid: Yup.number()
        .positive("Amount must be positive")
        .required("Amount is required"),
    payment_method: Yup.string()
        .oneOf(['account_transfer', 'cash', 'cheque', 'online', 'card'])
        .default('account_transfer'),
    payment_date: Yup.date().default(() => new Date()),
    transaction_reference: Yup.string().optional(),
    notes: Yup.string().optional(),
    user_id: Yup.string().uuid().optional(),
});

const listPaymentsSchema = Yup.object({
    expense_id: Yup.string().uuid().optional(),
    account_id: Yup.string().uuid().optional(),
    department_id: Yup.string().uuid().optional(),
    user_id: Yup.string().uuid().optional(),
    start_date: Yup.date().optional(),
    end_date: Yup.date().optional(),
    status: Yup.string()
        .oneOf(['pending', 'completed', 'failed', 'reversed'])
        .optional(),
    page: Yup.number().min(1).default(1),
    limit: Yup.number().min(1).max(100).default(20),
    order: Yup.mixed<'ASC' | 'DESC'>().oneOf(['ASC', 'DESC']).default('DESC'),
});

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'compresscrm-bucket-8957';
const AWS_REGION = process.env.AWS_REGION || 'eu-north-1';
const USE_S3 = process.env.AWS_USE_S3 === 'true';

const S3_BASE_URL = process.env.S3_BASE_URL || process.env.AWS_S3_BASE_URL ||
    `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com`;

export const makePayment = async (req: AuthenticatedRequest, res: Response) => {
    let transaction: Transaction | null = null;

    try {
        console.log("🔐 makePayment - User from request:", req.user);
        console.log("🔐 makePayment - Request body:", req.body);

        const validatedData = await makePaymentSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });

        // Get user ID from authenticated request
        const authUserId = req.user?.userId || req.user?.system_user_id || validatedData.user_id;
        console.log("🔐 makePayment - Auth User ID:", authUserId);

        if (!authUserId) {
            return res.status(401).json({
                success: false,
                error: "User authentication required",
                details: "No user ID found in request"
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // 1. Get expense
        const expense = await Expense.findByPk(validatedData.expense_id, {
            transaction,
        });

        if (!expense) {
            throw new Error("Expense not found");
        }

        console.log("📋 Expense found:", {
            id: expense.id,
            reason: expense.reason,
            amount: expense.amount,
            department_id: expense.department_id,
            status: expense.status
        });

        // 2. Get or determine department for this payment
        console.log("🔍 Looking for user department...");
        const userDepartment = await UserDepartment.findOne({
            where: { user_id: authUserId },
            transaction,
        });

        let departmentIdToUse: string;

        if (!userDepartment) {
            // User doesn't have a department, use expense's department
            const expenseDepartmentId = expense.department_id;

            if (!expenseDepartmentId) {
                throw new Error("Expense does not have an assigned department");
            }

            console.log("⚠️ User not assigned to any department. Using expense department:", expenseDepartmentId);

            // Verify the department exists
            const departmentExists = await Department.findByPk(expenseDepartmentId, { transaction });
            if (!departmentExists) {
                throw new Error(`Department ${expenseDepartmentId} does not exist`);
            }

            departmentIdToUse = expenseDepartmentId;

            // Optionally create a UserDepartment entry for future payments
            try {
                await UserDepartment.create({
                    user_id: authUserId,
                    department_id: expenseDepartmentId,
                    created_at: new Date(),
                    updated_at: new Date()
                }, { transaction });
                console.log("✅ Created user department entry");
            } catch (createErr) {
                console.log("⚠️ Could not create user department entry, continuing anyway...");
            }
        } else {
            // User has a department
            departmentIdToUse = userDepartment.department_id;
            console.log("🏢 User department found:", departmentIdToUse);
        }

        // 3. Get account
        const account = await Account.findByPk(validatedData.account_id, {
            transaction,
        });

        if (!account) {
            throw new Error("Account not found");
        }

        // 4. Check if expense is already paid or partially paid
        const existingPayments = await ExpensePayment.findAll({
            where: {
                expense_id: validatedData.expense_id,
                status: { [Op.ne]: 'reversed' }
            },
            transaction,
        });

        const totalPaid = existingPayments.reduce((sum, payment) => {
            return sum + Number(payment.amount_paid);
        }, 0);

        const remainingBalance = Number(expense.amount) - totalPaid;
        console.log(`💰 Expense ${expense.id}: Amount=${expense.amount}, Paid=${totalPaid}, Remaining=${remainingBalance}`);

        if (validatedData.amount_paid > remainingBalance) {
            throw new Error(
                `Payment amount (${validatedData.amount_paid}) exceeds remaining balance (${remainingBalance})`
            );
        }

        if (validatedData.amount_paid <= 0) {
            throw new Error("Payment amount must be greater than 0");
        }

        // 5. Check account balance
        const accountBalance = Number(account.initialamount || 0);
        console.log(`💰 Account ${account.id}: Balance=${accountBalance}, Payment=${validatedData.amount_paid}`);

        if (accountBalance < validatedData.amount_paid) {
            throw new Error(`Insufficient account balance. Available: ${accountBalance}, Required: ${validatedData.amount_paid}`);
        }

        // 6. Calculate new totals
        const newTotalPaid = totalPaid + validatedData.amount_paid;
        const newRemainingBalance = remainingBalance - validatedData.amount_paid;
        const isFullyPaid = newRemainingBalance === 0;

        // 7. Determine new expense status based on clear rules
        let newExpenseStatus = expense.status;

        if (isFullyPaid) {
            // Expense is now fully paid
            newExpenseStatus = 'paid';
            console.log(`✅ Expense ${expense.id} is now fully paid. Status changed to 'paid'`);
        } else if (newTotalPaid > 0 && expense.status === 'pending') {
            // First payment made on a pending expense
            newExpenseStatus = 'approved';
            console.log(`✅ Expense ${expense.id} received first payment. Status changed from 'pending' to 'approved'`);
        } else if (newTotalPaid > 0 && expense.status === 'approved') {
            // Additional payment on an already approved expense
            // Status remains 'approved' (you could consider adding 'partially_paid' status)
            newExpenseStatus = 'approved';
            console.log(`✅ Expense ${expense.id} received additional payment. Status remains 'approved'`);
        } else if (expense.status === 'rejected') {
            // Cannot make payments on rejected expenses
            throw new Error("Cannot make payment for a rejected expense");
        }
        // Note: If expense is already 'paid', it shouldn't reach here due to remainingBalance check

        // Determine payment status
        const paymentStatus = isFullyPaid ? 'completed' : 'pending';

        console.log(`💳 Payment Summary:`, {
            Amount: validatedData.amount_paid,
            TotalPaid: newTotalPaid,
            Remaining: newRemainingBalance,
            ExpenseStatus: newExpenseStatus,
            PaymentStatus: paymentStatus,
            IsFullyPaid: isFullyPaid
        });

        // 8. Create payment record
        const payment = await ExpensePayment.create(
            {
                expense_id: validatedData.expense_id,
                account_id: validatedData.account_id,
                user_id: authUserId,
                department_id: departmentIdToUse,
                amount_paid: validatedData.amount_paid,
                total_expense: expense.amount,
                remaining_expense: newRemainingBalance,
                payment_method: validatedData.payment_method,
                payment_date: validatedData.payment_date,
                transaction_reference: validatedData.transaction_reference,
                notes: validatedData.notes,
                status: paymentStatus,
                created_by: authUserId,
            },
            { transaction }
        );

        // 9. Deduct from account
        const newAccountBalance = accountBalance - validatedData.amount_paid;
        await Account.update(
            {
                initialamount: newAccountBalance,
            },
            {
                where: { id: validatedData.account_id },
                transaction,
            }
        );

        // 10. Update expense status if it changed
        if (newExpenseStatus !== expense.status) {
            await Expense.update(
                {
                    status: newExpenseStatus,
                    updated_at: new Date()
                },
                {
                    where: { id: validatedData.expense_id },
                    transaction,
                }
            );
            console.log(`📝 Updated expense ${expense.id} status from '${expense.status}' to '${newExpenseStatus}'`);
        }

        // 11. Update expense description with payment info
        const paymentNote = `[Payment made: ${new Date().toLocaleDateString()} - ₹${validatedData.amount_paid} via ${validatedData.payment_method}]`;
        const newDescription = expense.description
            ? `${expense.description}\n${paymentNote}`
            : paymentNote;

        await Expense.update(
            {
                description: newDescription,
                updated_at: new Date()
            },
            {
                where: { id: validatedData.expense_id },
                transaction,
            }
        );

        // 12. If expense is now fully paid, update all related payments to 'completed'
        if (isFullyPaid) {
            await ExpensePayment.update(
                {
                    status: 'completed'
                },
                {
                    where: {
                        expense_id: validatedData.expense_id,
                        status: 'pending'
                    },
                    transaction,
                }
            );
            console.log(`✅ All pending payments for expense ${expense.id} updated to 'completed'`);
        }

        // Commit transaction
        await transaction.commit();

        console.log("🎉 Payment successful:", {
            paymentId: payment.id,
            expenseId: expense.id,
            amount: validatedData.amount_paid,
            newAccountBalance,
            expenseStatus: newExpenseStatus,
            fullyPaid: isFullyPaid
        });

        return res.status(201).json({
            success: true,
            message: "Payment successful",
            data: {
                payment: {
                    id: payment.id,
                    amount_paid: payment.amount_paid,
                    status: payment.status,
                    payment_method: payment.payment_method,
                    payment_date: payment.payment_date,
                    remaining_expense: payment.remaining_expense
                },
                expense: {
                    id: expense.id,
                    reason: expense.reason,
                    amount: expense.amount,
                    old_status: expense.status,
                    new_status: newExpenseStatus,
                    total_paid: newTotalPaid,
                    remaining: newRemainingBalance,
                    is_fully_paid: isFullyPaid
                },
                account: {
                    id: account.id,
                    accountname: account.accountname,
                    bankname: account.bankname,
                    old_balance: accountBalance,
                    new_balance: newAccountBalance,
                }
            },
        });

    } catch (err: any) {
        console.error("❌ Payment error:", err);

        // Rollback transaction if it was started
        if (transaction) {
            try {
                await transaction.rollback();
                console.log("🔄 Transaction rolled back");
            } catch (rollbackErr) {
                console.error("Error rolling back transaction:", rollbackErr);
            }
        }

        if (err.name === 'ValidationError') {
            const details = err.inner?.map((e: any) => ({
                field: e.path,
                message: e.message,
            }));
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                details
            });
        }

        return res.status(400).json({
            success: false,
            error: "Payment failed",
            details: err.message,
        });
    }
};

export const getPayments = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const extendedSchema = listPaymentsSchema.shape({
            is_account: Yup.boolean().optional(),
        });

        const validatedQuery = await extendedSchema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
        });

        const where: any = {};
        const include: any = [
            {
                model: Expense,
                as: "expense",
                attributes: ["id", "reason", "amount", "expense_date", "status", "is_account"],
                required: false,
                include: [
                    {
                        model: ExpenseMedia,
                        as: 'media',
                        attributes: ['id', 'file_path', 'file_type', 'created_at'],
                        required: false
                    }
                ]
            },
            {
                model: Account,
                as: "account",
                attributes: ["id", "accountname", "bankname", "accountnumber"],
                required: false,
            },
            {
                model: Department,
                as: "department",
                attributes: ["id", "department_name"],
                required: false,
            },
        ];
        // Add filter conditions
        if (validatedQuery.expense_id) where.expense_id = validatedQuery.expense_id;
        if (validatedQuery.account_id) where.account_id = validatedQuery.account_id;
        if (validatedQuery.department_id) where.department_id = validatedQuery.department_id;
        if (validatedQuery.user_id) where.user_id = validatedQuery.user_id;
        if (validatedQuery.status) where.status = validatedQuery.status;

        // Add is_account filter to expense include
        if (validatedQuery.is_account !== undefined) {
            include[0].where = {
                is_account: validatedQuery.is_account
            };
        }

        if (validatedQuery.start_date || validatedQuery.end_date) {
            where.payment_date = {};
            if (validatedQuery.start_date) where.payment_date[Op.gte] = validatedQuery.start_date;
            if (validatedQuery.end_date) where.payment_date[Op.lte] = validatedQuery.end_date;
        }

        const { rows, count } = await ExpensePayment.findAndCountAll({
            where,
            include,
            order: [["created_at", validatedQuery.order]],
            limit: validatedQuery.limit,
            offset: (validatedQuery.page - 1) * validatedQuery.limit,
        });

        const paymentsWithSummary = await Promise.all(
            rows.map(async (payment: any) => {
                const allPaymentsForExpense = await ExpensePayment.findAll({
                    where: {
                        expense_id: payment.expense_id,
                        status: { [Op.ne]: "reversed" },
                    },
                });

                const totalPaid = allPaymentsForExpense.reduce(
                    (sum, p) => sum + Number(p.amount_paid),
                    0
                );

                return {
                    ...payment.toJSON(),
                    expense_summary: {
                        total_amount: Number(payment.expense?.amount || 0),
                        total_paid: totalPaid,
                        remaining: Number(payment.expense?.amount || 0) - totalPaid,
                        is_fully_paid: totalPaid >= Number(payment.expense?.amount || 0),
                        is_account: payment.expense?.is_account || false,
                    },
                };
            })
        );

        return res.json({
            success: true,
            data: paymentsWithSummary,
            meta: {
                total: count,
                page: validatedQuery.page,
                limit: validatedQuery.limit,
                totalPages: Math.ceil(count / validatedQuery.limit),
            },
        });
    } catch (err: any) {
        console.error("Error fetching payments:", err);
        return res.status(400).json({
            success: false,
            error: "Failed to fetch payments",
            details: err.message,
        });
    }
};

export const getPaymentById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;

        const payment = await ExpensePayment.findByPk(id, {
            include: [
                {
                    model: Expense,
                    as: "expense",
                    attributes: ["id", "reason", "amount", "expense_date", "status", "description"],
                    include: [
                        {
                            model: ExpenseMedia,
                            as: 'media',
                            attributes: ['id', 'file_path', 'file_type', 'created_at'],
                            required: false
                        }
                    ]
                },
                {
                    model: Account,
                    as: "account",
                    attributes: ["id", "accountname", "bankname", "accountnumber", "initialamount"],
                },
                {
                    model: Department,
                    as: "department",
                    attributes: ["id", "department_name"],
                },
            ],
        });

        if (!payment) return res.status(404).json({
            success: false,
            error: "Payment not found"
        });

        // ✅ Use the SAME pattern as your expense controller
        const expenseData = payment.expense as any;
        if (expenseData && expenseData.media) {
            expenseData.media = expenseData.media.map((mediaFile: any) => ({
                ...mediaFile.toJSON(),
                url: `${req.protocol}://${req.get('host')}${mediaFile.file_path}`
            }));
        }

        // ... rest of your function stays the same ...
    } catch (err: any) {
        console.error("Error fetching payment:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch payment"
        });
    }
};

export const getExpensePayments = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { expense_id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        console.log("🔍 Getting expense payments for:", expense_id);

        // 1. Get expense with media
        const expense = await Expense.findByPk(expense_id, {
            attributes: ["id", "reason", "amount", "department_id", "status", "is_account", "description", "expense_date"],
            include: [
                {
                    model: ExpenseMedia,
                    as: 'media',
                    attributes: ['id', 'file_path', 'file_type', 'created_at'],
                    required: false
                }
            ]
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: "Expense not found"
            });
        }

        const data = expense.toJSON();

        // ✅ Use the SAME pattern as your expense controller
        if (data.media && data.media.length > 0) {
            data.media = data.media.map((mediaFile: any) => ({
                ...mediaFile,
                url: `${req.protocol}://${req.get('host')}${mediaFile.file_path}`
            }));
        }

        // ... rest of your function stays the same ...
    } catch (err: any) {
        console.error("❌ Error in getExpensePayments:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch expense payments",
            details: err.message,
        });
    }
};

// Change the function name to be more specific
export const getExpensePaymentsWithMedia = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { expense_id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        console.log("🔍 Getting expense and payments WITH MEDIA for:", expense_id);

        // 1. FIRST: Get the expense WITH its media files
        const expense = await Expense.findByPk(expense_id, {
            attributes: ["id", "reason", "amount", "department_id", "status", "is_account", "description", "short_description", "expense_date"],
            include: [
                {
                    model: ExpenseMedia,
                    as: 'media',
                    attributes: ['id', 'file_path', 'file_type', 'created_at'],
                    required: false
                }
            ]
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: "Expense not found"
            });
        }

        // Convert expense to JSON to access media
        const expenseData = expense.toJSON() as any;
        console.log("✅ Expense found. Media count:", expenseData.media?.length || 0);

        // 2. SECOND: Get payments for this expense
        const { rows, count } = await ExpensePayment.findAndCountAll({
            where: { expense_id },
            include: [
                {
                    model: Account,
                    as: "account",
                    attributes: ["id", "accountname", "bankname"],
                },
                {
                    model: Department,
                    as: "department",
                    attributes: ["id", "department_name"],
                },
            ],
            order: [["created_at", "DESC"]],
            limit: Number(limit),
            offset: (Number(page) - 1) * Number(limit),
        });

        const validPayments = rows.filter((p: any) => p.status !== "reversed");
        const totalPaid = validPayments.reduce(
            (sum: number, p: any) => sum + Number(p.amount_paid),
            0
        );

        const remaining = Number(expense.amount) - totalPaid;

        // 3. RETURN BOTH expense (with media) AND payments
        return res.json({
            success: true,
            data: {
                expense: {
                    id: expenseData.id,
                    reason: expenseData.reason,
                    amount: expenseData.amount,
                    expense_date: expenseData.expense_date,
                    department_id: expenseData.department_id,
                    status: expenseData.status,
                    description: expenseData.description,
                    is_account: expenseData.is_account,
                    media: expenseData.media || [], // THIS IS WHERE MEDIA FILES GO
                    total_paid: totalPaid,
                    remaining,
                    is_fully_paid: remaining === 0,
                },
                payments: rows, // Array of payment records
            },
            meta: {
                totalPayments: count,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(count / Number(limit)),
            },
        });

    } catch (err: any) {
        console.error("❌ Error in getExpensePaymentsWithMedia:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch expense payments",
            details: err.message,
        });
    }
};

interface ExpenseDetailsResponse {
    success: boolean;
    data?: {
        expense: {
            id: string;
            reason: string;
            amount: number;
            expense_date: Date;
            description: string;
            department_id: string;
            status: string;
            is_account: boolean;
            created_at: Date;
            media: any[];
            payments: any[];
            total_paid: number;
            remaining: number;
            is_fully_paid: boolean;
        };
    };
    error?: string;
}

// In getExpenseDetailsWithMedia function, replace the S3 URL generation:
export const getExpenseDetailsWithMedia = async (req: AuthenticatedRequest, res: Response): Promise<Response> => {
    try {
        const { expense_id } = req.params;

        const expense = await Expense.findByPk(expense_id, {
            attributes: [
                "id",
                "reason",
                "amount",
                "expense_date",
                "description",
                "short_description",
                "department_id",
                "status",
                "is_account",
                "created_at",
            ],
            include: [
                {
                    model: ExpenseMedia,
                    as: "media",
                    attributes: ["id", "file_path", "file_type", "created_at"],
                    required: false,
                },
                {
                    model: ExpensePayment,
                    as: "payments",
                    where: { status: { [Op.ne]: "reversed" } },
                    required: false,
                    include: [
                        {
                            model: Account,
                            as: "account",
                            attributes: ["id", "accountname", "bankname"],
                        },
                        {
                            model: Department,
                            as: "department",
                            attributes: ["id", "department_name"],
                        },
                    ],
                },
            ],
            order: [[{ model: ExpensePayment, as: "payments" }, "created_at", "DESC"]],
        });

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: "Expense not found",
            });
        }

        const data = expense.toJSON();

        // ✅ Use the SAME pattern as your expense controller
        if (data.media && data.media.length > 0) {
            data.media = data.media.map((mediaFile: any) => ({
                ...mediaFile,
                // EXACTLY like your expense controller
                url: `${req.protocol}://${req.get('host')}${mediaFile.file_path}`
            }));
        }

        const totalPaid =
            data.payments?.reduce(
                (sum, p) => sum + Number(p.amount_paid),
                0
            ) || 0;

        const remaining = Number(data.amount) - totalPaid;

        return res.json({
            success: true,
            data: {
                expense: {
                    ...data,
                    total_paid: totalPaid,
                    remaining,
                    is_fully_paid: remaining === 0,
                },
            },
        });
    } catch (err) {
        console.error("❌ getExpenseDetailsWithMedia:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch expense details",
        });
    }
};

/**
 * Reverse a payment (refund) with department check
 */
export const reversePayment = async (req: AuthenticatedRequest, res: Response) => {
    let transaction: Transaction | null = null;

    try {
        const { id } = req.params;
        const { notes } = req.body;
        const authUserId = req.user?.userId || req.user?.system_user_id;

        if (!authUserId) {
            return res.status(401).json({
                success: false,
                error: "User authentication required"
            });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // 1. Get payment
        const payment = await ExpensePayment.findByPk(id, {
            include: [
                { model: Expense, as: 'expense' },
                { model: Account, as: 'account' },
            ],
            transaction,
        });

        if (!payment) {
            throw new Error("Payment not found");
        }

        if (payment.status === 'reversed') {
            throw new Error("Payment already reversed");
        }

        // 2. Check user authorization (same department)
        const userDepartment = await UserDepartment.findOne({
            where: { user_id: authUserId },
            transaction,
        });

        if (!userDepartment || userDepartment.department_id !== payment.department_id) {
            throw new Error("Unauthorized to reverse this payment");
        }

        // 3. Refund to account
        const account = payment.account as any;
        const newAccountBalance = Number(account.initialamount || 0) + Number(payment.amount_paid);

        await Account.update(
            {
                initialamount: newAccountBalance,
            },
            {
                where: { id: account.id },
                transaction,
            }
        );

        // 4. Update payment record
        const newRemainingExpense = Number(payment.remaining_expense) + Number(payment.amount_paid);

        await payment.update(
            {
                status: 'reversed',
                remaining_expense: newRemainingExpense,
                notes: notes || `Reversed on ${new Date().toISOString()}`,
            },
            { transaction }
        );

        // 5. Check if expense was fully paid and update status back
        const allPayments = await ExpensePayment.findAll({
            where: {
                expense_id: payment.expense_id,
                status: { [Op.ne]: 'reversed' }
            },
            transaction,
        });

        const totalPaid = allPayments.reduce((sum, p) =>
            sum + Number(p.amount_paid), 0
        );

        const expense = payment.expense as any;
        const remaining = Number(expense.amount || 0) - totalPaid;

        // If expense was marked as 'paid' and now has remaining balance, update status
        if (expense.status === 'paid' && remaining > 0) {
            await Expense.update(
                {
                    status: 'approved',
                    description: expense.description
                        ? `${expense.description}\n[Payment partially reversed on ${new Date().toISOString()}]`
                        : `Payment partially reversed on ${new Date().toISOString()}`,
                },
                {
                    where: { id: payment.expense_id },
                    transaction,
                }
            );
        }

        // Commit transaction
        await transaction.commit();

        return res.json({
            success: true,
            message: "Payment reversed successfully",
            data: {
                payment,
                account: {
                    id: account.id,
                    new_balance: newAccountBalance,
                },
                expense: {
                    id: expense.id,
                    status: expense.status,
                    remaining_balance: remaining,
                },
            },
        });
    } catch (err: any) {
        console.error("Error reversing payment:", err);

        // Rollback transaction if it was started
        if (transaction) {
            await transaction.rollback();
        }

        return res.status(400).json({
            success: false,
            error: "Failed to reverse payment",
            details: err.message,
        });
    }
};

/**
 * Check if expense is fully paid
 */
export const checkExpensePaymentStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { expense_id } = req.params;

        const expense = await Expense.findByPk(expense_id, {
            attributes: ["id", "reason", "amount", "department_id", "status"],
        });

        if (!expense) return res.status(404).json({
            success: false,
            error: "Expense not found"
        });

        const payments = await ExpensePayment.findAll({
            where: { expense_id, status: { [Op.ne]: "reversed" } },
            include: [
                {
                    model: Account,
                    as: "account",
                    attributes: ["id", "accountname", "bankname"],
                },
            ],
            order: [["payment_date", "DESC"]],
        });

        const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
        const remaining = Number(expense.amount) - totalPaid;

        return res.json({
            success: true,
            data: {
                expense: {
                    ...expense.toJSON(),
                    total_paid: totalPaid,
                    remaining,
                    is_fully_paid: remaining === 0,
                },
                payments,
                payment_summary: {
                    total_payments: payments.length,
                    total_paid: totalPaid,
                    percentage_paid: Number(expense.amount) > 0 ? (totalPaid / Number(expense.amount)) * 100 : 0,
                },
            },
        });
    } catch (err: any) {
        console.error("Error checking expense payment status:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to check expense payment status"
        });
    }
};

export const getDepartmentPaymentSummary = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { start_date, end_date, is_account } = req.query;

        // Always filter by is_account = true for account expenses only
        const isAccountFilter = `AND e.is_account = true`;

        const dateFilterSql =
            start_date || end_date
                ? `
          AND ep.payment_date >= COALESCE(:start_date, ep.payment_date)
          AND ep.payment_date <= COALESCE(:end_date, ep.payment_date)
        `
                : "";

        const rows = await sequelize.query(
            `
      WITH pay AS (
        SELECT
          ep.expense_id,
          ep.department_id,
          SUM(COALESCE(ep.amount_paid,0)) AS paid
        FROM expense_payment ep
        WHERE ep.status != 'reversed'
          ${dateFilterSql}
        GROUP BY ep.expense_id, ep.department_id
      ),
      exp AS (
        SELECT
          e.id AS expense_id,
          e.department_id,
          e.is_account,
          COALESCE(d.department_name, 'Unknown Department') AS department_name,
          COALESCE(e.amount,0) AS amount,
          COALESCE(p.paid,0) AS paid
        FROM expenses e
        LEFT JOIN pay p ON p.expense_id = e.id
        LEFT JOIN department d ON d.id = e.department_id
        WHERE e.is_account = true ${isAccountFilter}  -- FILTER: Only account expenses
      )
      SELECT
        department_id,
        department_name,
        SUM(amount) AS total_expenses,
        SUM(paid) AS total_paid,
        GREATEST(SUM(amount) - SUM(paid), 0) AS remaining_amount,
        COUNT(*) AS expense_count,
        SUM(CASE WHEN paid >= amount AND amount > 0 THEN 1 ELSE 0 END) AS paid_expense_count,
        SUM(CASE WHEN paid < amount AND amount > 0 THEN 1 ELSE 0 END) AS pending_expense_count,
        SUM(CASE WHEN is_account = true THEN 1 ELSE 0 END) AS account_expense_count
      FROM exp
      GROUP BY department_id, department_name
      ORDER BY department_name ASC
      `,
            {
                type: QueryTypes.SELECT,
                replacements: {
                    start_date: start_date || null,
                    end_date: end_date || null,
                },
            }
        );

        const data = (rows as any[]).map((r) => ({
            department: {
                id: r.department_id,
                department_name: r.department_name,
            },
            total_expenses: Number(r.total_expenses || 0),
            total_paid: Number(r.total_paid || 0),
            remaining_amount: Number(r.remaining_amount || 0),
            expense_count: Number(r.expense_count || 0),
            paid_expense_count: Number(r.paid_expense_count || 0),
            pending_expense_count: Number(r.pending_expense_count || 0),
            account_expense_count: Number(r.account_expense_count || 0),
        }));

        const summary = data.reduce(
            (acc, d) => {
                acc.total_departments += 1;
                acc.total_expenses += d.total_expenses;
                acc.total_paid += d.total_paid;
                acc.total_remaining += d.remaining_amount;
                acc.paid_expense_count += d.paid_expense_count;
                acc.pending_expense_count += d.pending_expense_count;
                acc.account_expense_count += d.account_expense_count;
                return acc;
            },
            {
                total_departments: 0,
                grand_total: 0,
                total_expenses: 0,
                total_paid: 0,
                total_remaining: 0,
                paid_expense_count: 0,
                pending_expense_count: 0,
                account_expense_count: 0,
            }
        );

        summary.grand_total = summary.total_paid;

        return res.json({
            success: true,
            data,
            summary
        });
    } catch (err: any) {
        console.error("Error fetching department summary:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch department payment summary",
            details: err.message,
        });
    }
};

async function getDepartmentBreakdown() {
    const breakdown = await sequelize.query(
        `
        SELECT 
            d.id as department_id,
            d.department_name,
            COUNT(e.id) as total_expenses_count,
            COUNT(CASE WHEN e.is_account = true THEN 1 END) as account_expenses_count,
            SUM(CASE WHEN e.is_account = true THEN COALESCE(e.amount, 0) ELSE 0 END) as account_expenses_total
        FROM department d
        LEFT JOIN expenses e ON e.department_id = d.id
        GROUP BY d.id, d.department_name
        ORDER BY d.department_name
        `,
        {
            type: QueryTypes.SELECT,
        }
    );

    return breakdown;
}

export const getPaymentsWithDepartmentFilter = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const department_id = String(req.query.department_id || "").trim();
        const limit = Math.min(Number(req.query.limit || 100), 500);

        if (!department_id) {
            return res.status(400).json({
                success: false,
                error: "department_id is required"
            });
        }

        const rows = await sequelize.query(
            `
      WITH pay AS (
        SELECT
          ep.expense_id,
          SUM(COALESCE(ep.amount_paid, 0)) AS paid
        FROM expense_payment ep
        WHERE ep.status != 'reversed'
          AND ep.department_id = :department_id
        GROUP BY ep.expense_id
      )
      SELECT
        e.*,
        COALESCE(p.paid, 0) AS total_paid,
        GREATEST(COALESCE(e.amount, 0) - COALESCE(p.paid, 0), 0) AS remaining,
        CASE
          WHEN COALESCE(p.paid, 0) >= COALESCE(e.amount, 0)
               AND COALESCE(e.amount, 0) > 0
          THEN true
          ELSE false
        END AS is_fully_paid
      FROM expenses e
      LEFT JOIN pay p ON p.expense_id = e.id
      WHERE e.department_id = :department_id
        AND e.is_account = true  -- Keep this filter
      ORDER BY e.created_at DESC
      LIMIT :limit
      `,
            {
                type: QueryTypes.SELECT,
                replacements: { department_id, limit },
            }
        );

        return res.json({
            success: true,  // Changed from false to true
            data: rows,
            count: rows.length,
            message: rows.length === 0 ? "No account expenses found for this department" : "Account expenses retrieved successfully"
        });
    } catch (err: any) {
        console.error("Error fetching account expenses:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch account expenses",
            details: err.message,
        });
    }
};