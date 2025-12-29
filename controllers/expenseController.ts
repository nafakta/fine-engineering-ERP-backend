// src/controllers/expense.controller.ts
import { Request, Response } from 'express';
import { col, fn, literal, Op, Transaction } from 'sequelize';
import * as Yup from "yup";
import multer from 'multer';
import path from 'path';
import fs from "fs";

// Import models AND sequelize instance
import {
    Expense,
    Account,
    ExpenseMedia,
    UserDepartment,
    Department,
    sequelize
} from '../models/index';
import { ExpensePayment } from '../models/ExpensePayment';

interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

const searchFormSchema = Yup.object({
    search_by: Yup.mixed<"transaction" | "expense">()
        .oneOf(["transaction", "expense"])
        .required("search_by is required"),
    start_date: Yup.string()
        .matches(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD")
        .required("start_date is required"),
    end_date: Yup.string()
        .matches(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD")
        .required("end_date is required"),
    page: Yup.number().integer().min(1).default(1),
    limit: Yup.number().integer().min(1).max(100).default(20),
    order: Yup.mixed<"ASC" | "DESC">().oneOf(["ASC", "DESC"]).default("DESC"),
});

// Update the schema - amount_paid can be 0 initially
const paymentCreateSchema = Yup.object({
    expense_id: Yup.string().uuid().required('expense_id is required'),
    account_id: Yup.string().uuid('account_id must be a valid UUID')
        .nullable()
        .transform((value, originalValue) =>
            originalValue === '' ? null : value
        )
        .optional(),
    user_id: Yup.string().uuid().required('user_id is required'),
    department_id: Yup.string().uuid().required('department_id is required'),
    amount_paid: Yup.number()
        .min(0, 'amount_paid cannot be negative') // Allow 0
        .required('amount_paid is required'),
    payment_date: Yup.string()
        .matches(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD')
        .optional(),
    payment_method: Yup.string()
        .oneOf(['account_transfer', 'cash', 'cheque', 'online', 'card'])
        .optional(),
    transaction_reference: Yup.string()
        .nullable()
        .transform((value, originalValue) =>
            originalValue === '' ? null : value
        )
        .optional(),
    status: Yup.string()
        .oneOf(['pending', 'completed', 'failed', 'reversed'])
        .optional(),
    notes: Yup.string()
        .nullable()
        .transform((value, originalValue) =>
            originalValue === '' ? null : value
        )
        .optional(),
});

// Updated expense schema matching new DDL - remove 'department' field
const expenseSchema = Yup.object({
    user_id: Yup.string().uuid("user_id must be a UUID").required("user_id is required"),
    reason: Yup.string().trim().required("reason is required"),
    amount: Yup.number().positive("amount must be > 0").required("amount is required"),
    expense_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, "expense_date must be YYYY-MM-DD")
        .default(() => new Date().toISOString().slice(0, 10)),
    transaction_date: Yup.string()
        .matches(/^\d{4}-\d{2}-\d{2}$/, "transaction_date must be YYYY-MM-DD")
        .nullable()
        .optional(),
    description: Yup.string().nullable().optional(),
    short_description: Yup.string() // ADD THIS
        .max(100, 'short_description must be 100 characters or less')
        .nullable()
        .optional(),
    // Remove 'department' field - only keep department_id
    department_id: Yup.string().uuid("department_id must be a UUID").nullable().optional(),
    status: Yup.string()
        .oneOf(['pending', 'approved', 'rejected', 'paid']) // Added 'paid' to match model
        .default('pending')
        .optional(),
    is_account: Yup.boolean().default(false).optional(),
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});

interface PaymentCreateData {
    expense_id: string;
    account_id?: string | null; // Optional
    user_id: string;
    department_id: string;
    amount_paid: number;
    payment_date?: string;
    payment_method?: 'account_transfer' | 'cash' | 'cheque' | 'online' | 'card';
    transaction_reference?: string | null;
    status?: 'pending' | 'completed' | 'failed' | 'reversed';
    notes?: string | null;
    created_by?: string | null; // Remove if not in DDL
}

const viewIdSchema = Yup.object({
    id: Yup.string().uuid("Invalid expense ID").required(),
});

const listSchema = Yup.object({
    by: Yup.mixed<"transaction" | "expense">().oneOf(["transaction", "expense"]).default("transaction"),
    start_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD").optional(),
    end_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD").optional(),
    user_id: Yup.string().uuid("user_id must be a UUID").optional(),
    page: Yup.number().integer().min(1).default(1),
    limit: Yup.number().integer().min(1).max(100).default(20),
    order: Yup.mixed<"ASC" | "DESC">().oneOf(["ASC", "DESC"]).default("ASC"),
});

const flexibleUpload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
});

const upload = multer({ storage });

export const createExpense = (req: Request, res: Response) => {
    upload.array("media[]", 5)(req, res, async (err: any) => {
        try {
            if (err) {
                return res.status(400).json({ error: "File upload failed", message: err.message });
            }

            const raw = (req.body ?? {}) as Record<string, any>;

            // Normalize payload for new schema
            const normalized = {
                user_id: raw.user_id,
                reason: raw.reason,
                amount: raw.amount != null ? Number(raw.amount) : undefined,
                expense_date: raw.expense_date ?? new Date().toISOString().slice(0, 10),
                transaction_date: raw.transaction_date ?? null,
                description: raw.description ?? null,
                short_description: raw.short_description ?? null,
                department_id: raw.department_id ?? raw.department ?? null,
                status: raw.status ?? 'pending',
            };

            // Validate
            const data = await expenseSchema.validate(normalized, {
                abortEarly: false,
                stripUnknown: true,
            });

            // Create Expense
            const expense = await Expense.create(data);

            // Handle media uploads if any
            const files = (req.files as Express.Multer.File[]) || [];
            for (const f of files) {
                const relative = `/uploads/${f.filename}`;
                await ExpenseMedia.create({
                    expense_id: expense.id,
                    file_path: relative,
                    file_type: f.mimetype,
                });
            }

            // Return expense with media
            const expenseWithMedia = await Expense.findByPk(expense.id, {
                include: [
                    {
                        model: ExpenseMedia,
                        as: 'media',
                        attributes: ['file_path', 'file_type']
                    }
                ]
            });

            return res.status(201).json(expenseWithMedia);
        } catch (e: any) {
            const details = e?.inner?.length ? e.inner.map((x: any) => ({ path: x.path, message: x.message })) : e.message;
            console.error("Error creating expense:", e);
            return res.status(400).json({ error: "Invalid data", details });
        }
    });
};

export const getExpenses = async (req: Request, res: Response) => {
    try {
        // Parse query parameters for ordering
        const {
            order_by = 'expense_date',
            order_direction = 'DESC',
            status,
            is_account
        } = req.query as {
            order_by?: string;
            order_direction?: 'ASC' | 'DESC';
            status?: string;
            is_account?: string;
        };

        // Validate allowed order fields
        const allowedOrderFields = [
            'expense_date',
            'transaction_date',
            'created_at',
            'updated_at',
            'amount',
            'status'
        ];

        const orderField = allowedOrderFields.includes(order_by)
            ? order_by
            : 'expense_date';

        // Build where clause
        const where: any = {};
        if (status) where.status = status;
        if (is_account !== undefined) where.is_account = is_account === 'true';

        // Get current user ID from request (assuming it's available from authentication middleware)
        const userId = (req as AuthenticatedRequest).user?.userId;

        // If user ID is available, filter by user's department
        if (userId) {
            // Get user's department from UserDepartment model
            const userDepartment = await UserDepartment.findOne({
                where: { user_id: userId },
                include: [
                    {
                        model: Department,
                        as: 'department',
                        attributes: ['id']
                    }
                ]
            });

            if (userDepartment?.department?.id) {
                // Filter expenses by the user's department ID
                where.department_id = userDepartment.department.id;
            } else {
                // If user has no department assigned, only show expenses created by this user
                where.user_id = userId;
            }
        }

        const expenses = await Expense.findAll({
            where,
            include: [
                {
                    model: ExpenseMedia,
                    as: 'media',
                    attributes: ['file_path', 'file_type']
                },
                {
                    model: ExpensePayment,
                    as: 'payments',
                    attributes: ['amount_paid', 'status', 'payment_date'],
                    required: false
                },
                // Include department details
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name'],
                    required: false
                }
            ],
            attributes: [
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'short_description',
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ],
            order: [
                [orderField, order_direction]
            ]
        });

        const data = expenses.map((expense: any) => {
            const expenseData = expense.toJSON();

            // Calculate payment summary
            const payments = expenseData.payments || [];
            const totalPaid = payments.reduce((sum: number, payment: any) =>
                sum + Number(payment.amount_paid || 0), 0);
            const totalExpense = Number(expenseData.amount || 0);
            const remainingAmount = Math.max(0, totalExpense - totalPaid);

            // Get latest payment date
            const latestPayment = payments.length > 0
                ? payments.reduce((latest: any, payment: any) =>
                    (!latest || new Date(payment.payment_date) > new Date(latest.payment_date))
                        ? payment
                        : latest, null)
                : null;

            // Determine payment status
            let paymentStatus = 'unpaid';
            if (totalPaid >= totalExpense && totalExpense > 0) {
                paymentStatus = 'paid';
            } else if (totalPaid > 0) {
                paymentStatus = 'partial';
            }

            const mediaWithUrls = expenseData.media?.map((m: any) => ({
                ...m,
                url: `${req.protocol}://${req.get('host')}${m.file_path}`
            })) || [];

            return {
                ...expenseData,
                media: mediaWithUrls,
                payment_summary: {
                    total_paid: totalPaid,
                    remaining_amount: remainingAmount,
                    payment_status: paymentStatus,
                    last_payment_date: latestPayment?.payment_date || null,
                    payment_count: payments.length,
                    is_fully_paid: remainingAmount === 0
                }
            };
        });

        return res.json({
            data,
            meta: {
                order_by: orderField,
                order_direction,
                total_count: data.length,
                status_filter: status || 'all',
                is_account_filter: is_account || 'all',
                filtered_by_department: !!userId // Indicate if filtered by user's department
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to fetch expenses' });
    }
};

export const getExpenseById = async (req: Request, res: Response) => {
    try {
        const { id } = await viewIdSchema.validate(req.params);

        const expense = await Expense.findByPk(id, {
            include: [
                {
                    model: ExpenseMedia,
                    as: 'media',
                    attributes: ['file_path', 'file_type']
                },
                {
                    model: ExpensePayment,
                    as: 'payments',
                    attributes: ['amount_paid', 'status', 'payment_date', 'payment_method', 'transaction_reference'],
                    required: false,
                    order: [['payment_date', 'DESC']]
                }
            ],
            attributes: [
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'short_description',
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ]
        });

        if (!expense) return res.status(404).json({ error: 'Not found' });

        const expenseData = expense.toJSON();

        // Calculate payment summary
        const payments = expenseData.payments || [];
        const totalPaid = payments.reduce((sum: number, payment: any) =>
            sum + Number(payment.amount_paid || 0), 0);
        const totalExpense = Number(expenseData.amount || 0);
        const remainingAmount = Math.max(0, totalExpense - totalPaid);

        // Get latest payment date
        const latestPayment = payments.length > 0 ? payments[0] : null;

        // Determine payment status
        let paymentStatus = 'unpaid';
        if (totalPaid >= totalExpense && totalExpense > 0) {
            paymentStatus = 'paid';
        } else if (totalPaid > 0) {
            paymentStatus = 'partial';
        }

        // Adjust display status if needed
        let displayStatus = expenseData.status;
        if (remainingAmount === 0 && expenseData.status !== 'paid') {
            displayStatus = 'paid';
        }

        const mediaWithUrls = expenseData.media?.map((m: any) => ({
            ...m,
            url: `${req.protocol}://${req.get('host')}${m.file_path}`
        })) || [];

        return res.json({
            ...expenseData,
            status: displayStatus,
            media: mediaWithUrls,
            payment_summary: {
                total_paid: totalPaid,
                remaining_amount: remainingAmount,
                payment_status: paymentStatus,
                last_payment_date: latestPayment?.payment_date || null,
                payment_count: payments.length,
                is_fully_paid: remainingAmount === 0
            },
            payments: payments
        });
    } catch (err) {
        console.error(err);

        if (err instanceof Error && 'name' in err && err.name === 'ValidationError') {
            return res.status(400).json({ error: 'Invalid expense ID' });
        }

        return res.status(500).json({ error: 'Failed to fetch expense' });
    }
};

export const searchExpenses = async (req: Request, res: Response) => {
    try {
        const {
            by = "transaction",
            start_date,
            end_date,
            user_id,
            page,
            limit,
            order = "DESC",
            status,
            is_account,
        } = req.query as Record<string, string>;

        const dateField = by === "expense" ? "expense_date" : "transaction_date";
        const where: any = {};

        if (user_id) where.user_id = user_id;
        if (status) where.status = status;
        if (is_account !== undefined) {
            where.is_account = is_account === 'true';
        }

        // Get current user ID from request
        const currentUserId = (req as AuthenticatedRequest).user?.userId;

        // If user ID is available, filter by user's department
        if (currentUserId) {
            // Get user's department from UserDepartment model
            const userDepartment = await UserDepartment.findOne({
                where: { user_id: currentUserId },
                include: [
                    {
                        model: Department,
                        as: 'department',
                        attributes: ['id']
                    }
                ]
            });

            if (userDepartment?.department?.id) {
                // Filter expenses by the user's department ID
                where.department_id = userDepartment.department.id;
            } else {
                // If user has no department assigned, only show expenses created by this user
                where.user_id = currentUserId;
            }
        }

        // date range
        if (start_date && end_date) {
            where[dateField] = { [Op.between]: [start_date, end_date] };
        } else if (start_date) {
            where[dateField] = { [Op.gte]: start_date };
        } else if (end_date) {
            where[dateField] = { [Op.lte]: end_date };
        }

        // optional pagination
        const pageNum = Number(page) || 1;
        const pageSize = Number(limit) || 0;

        // Fix the order direction bug
        const orderDirection = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

        if (pageSize > 0) {
            const { rows, count } = await Expense.findAndCountAll({
                where,
                include: [
                    {
                        model: ExpenseMedia,
                        as: 'media',
                        attributes: ['file_path', 'file_type']
                    },
                    {
                        model: ExpensePayment,
                        as: 'payments',
                        attributes: ['amount_paid', 'status'],
                        required: false
                    },
                    // Include department details
                    {
                        model: Department,
                        as: 'department',
                        attributes: ['id', 'department_name'],
                        required: false
                    }
                ],
                attributes: [
                    'id',
                    'user_id',
                    'reason',
                    'amount',
                    'expense_date',
                    'transaction_date',
                    'description',
                    'short_description',
                    'department_id',
                    'status',
                    'is_account',
                    'created_at',
                    'updated_at',
                ],
                order: [[dateField, orderDirection]],
                limit: pageSize,
                offset: (pageNum - 1) * pageSize,
            });

            const expensesWithUrls = rows.map((expense: any) => {
                const expenseData = expense.toJSON();

                // Calculate payment summary
                const payments = expenseData.payments || [];
                const totalPaid = payments.reduce((sum: number, payment: any) =>
                    sum + Number(payment.amount_paid || 0), 0);
                const totalExpense = Number(expenseData.amount);
                const remainingAmount = totalExpense - totalPaid;

                // Adjust status if fully paid
                let displayStatus = expenseData.status;
                if (remainingAmount === 0 && expenseData.status !== 'paid') {
                    displayStatus = 'paid';
                }

                const mediaWithUrls = expenseData.media?.map((m: any) => ({
                    ...m,
                    url: `${req.protocol}://${req.get('host')}${m.file_path}`
                })) || [];

                return {
                    ...expenseData,
                    status: displayStatus,
                    media: mediaWithUrls,
                    payment_summary: {
                        total_paid: totalPaid,
                        remaining_amount: remainingAmount,
                        is_fully_paid: remainingAmount === 0
                    }
                };
            });

            return res.json({
                data: {
                    expenses: expensesWithUrls,
                    total: count,
                    page: pageNum,
                    totalPages: Math.ceil(count / pageSize),
                    filters: {
                        date_field: dateField,
                        start_date,
                        end_date,
                        status,
                        is_account,
                        filtered_by_department: !!currentUserId
                    }
                },
            });
        }

        // no pagination
        const expenses = await Expense.findAll({
            where,
            include: [
                {
                    model: ExpenseMedia,
                    as: 'media',
                    attributes: ['file_path', 'file_type']
                },
                {
                    model: ExpensePayment,
                    as: 'payments',
                    attributes: ['amount_paid', 'status'],
                    required: false
                },
                // Include department details
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name'],
                    required: false
                }
            ],
            attributes: [
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ],
            order: [[dateField, orderDirection]],
        });

        const expensesWithUrls = expenses.map((expense: any) => {
            const expenseData = expense.toJSON();

            // Calculate payment summary
            const payments = expenseData.payments || [];
            const totalPaid = payments.reduce((sum: number, payment: any) =>
                sum + Number(payment.amount_paid || 0), 0);
            const totalExpense = Number(expenseData.amount);
            const remainingAmount = totalExpense - totalPaid;

            // Adjust status if fully paid
            let displayStatus = expenseData.status;
            if (remainingAmount === 0 && expenseData.status !== 'paid') {
                displayStatus = 'paid';
            }

            const mediaWithUrls = expenseData.media?.map((m: any) => ({
                ...m,
                url: `${req.protocol}://${req.get('host')}${m.file_path}`
            })) || [];

            return {
                ...expenseData,
                status: displayStatus,
                media: mediaWithUrls,
                payment_summary: {
                    total_paid: totalPaid,
                    remaining_amount: remainingAmount,
                    is_fully_paid: remainingAmount === 0
                }
            };
        });

        return res.json({
            data: {
                expenses: expensesWithUrls,
                filters: {
                    date_field: dateField,
                    start_date,
                    end_date,
                    status,
                    is_account,
                    filtered_by_department: !!currentUserId
                }
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to fetch expenses" });
    }
};


export const updateExpense = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const existingExpense = await Expense.findByPk(id);
        if (!existingExpense) {
            return res.status(404).json({ error: "Not found" });
        }

        const raw = req.body ?? {};

        // 1) BASIC FIELDS UPDATE
        const updateData: any = {};
        if (raw.reason !== undefined) updateData.reason = raw.reason;
        if (raw.amount !== undefined) updateData.amount = Number(raw.amount);
        if (raw.expense_date !== undefined) updateData.expense_date = raw.expense_date;
        if (raw.transaction_date !== undefined) updateData.transaction_date = raw.transaction_date;
        if (raw.description !== undefined) updateData.description = raw.description;
        if (raw.short_description !== undefined) updateData.short_description = raw.short_description;
        if (raw.department_id !== undefined) updateData.department_id = raw.department_id;
        if (raw.status !== undefined) updateData.status = raw.status;

        await Expense.update(updateData, { where: { id } });

        // 2) COLLECT ALL media_delete FIELDS
        const deleteMarkers: string[] = [];

        Object.entries(raw).forEach(([key, value]) => {
            if (
                key === "media_delete" ||
                key === "media_delete[]" ||
                key.startsWith("media_delete[")
            ) {
                if (Array.isArray(value)) {
                    value.forEach((v) => {
                        if (v != null && String(v).trim() !== "") {
                            deleteMarkers.push(String(v));
                        }
                    });
                } else if (value != null && String(value).trim() !== "") {
                    deleteMarkers.push(String(value));
                }
            }
        });

        // Handle media deletion
        if (deleteMarkers.length) {
            const normalizeMediaPath = (val: string): string => {
                if (!val) return val;
                const str = String(val);

                if (/^https?:\/\//i.test(str)) {
                    try {
                        const u = new URL(str);
                        return u.pathname;
                    } catch {
                        // fallthrough
                    }
                }

                const idx = str.indexOf("/uploads/");
                if (idx !== -1) {
                    return str.substring(idx);
                }

                const base = path.basename(str);
                return `/uploads/${base}`;
            };

            for (const rawPath of deleteMarkers) {
                const normalizedPath = normalizeMediaPath(rawPath);

                const mediaRecord = await ExpenseMedia.findOne({
                    where: { expense_id: id, file_path: normalizedPath },
                });

                if (mediaRecord) {
                    await mediaRecord.destroy();

                    // Delete physical file
                    const absolutePath = path.join(
                        process.cwd(),
                        normalizedPath.replace(/^\/+/, "")
                    );

                    fs.unlink(absolutePath, (err: NodeJS.ErrnoException | null) => {
                        if (err) {
                            console.warn(
                                "Failed to remove file from disk:",
                                absolutePath,
                                err.message
                            );
                        }
                    });
                }
            }
        }

        // 3) HANDLE NEW UPLOADS
        const files = (req.files as Express.Multer.File[]) || [];

        for (const f of files) {
            const relative = `/uploads/${f.filename}`;

            await ExpenseMedia.create({
                expense_id: id,
                file_path: relative,
                file_type: f.mimetype,
            });
        }

        // 4) RETURN UPDATED EXPENSE
        const updatedExpense = await Expense.findByPk(id, {
            include: [
                {
                    model: ExpenseMedia,
                    as: "media",
                    attributes: ["file_path", "file_type"],
                },
            ],
        });

        return res.json({ success: true, data: updatedExpense });
    } catch (err: any) {
        console.error("Error updating expense:", err);

        if (err.name === "SequelizeValidationError") {
            const details = err.errors.map((e: any) => ({
                field: e.path,
                message: e.message,
            }));
            return res.status(400).json({ error: "Invalid update", details });
        }

        return res
            .status(400)
            .json({ error: "Invalid update", details: err.message });
    }
};

// Delete
export const deleteExpense = async (req: Request, res: Response) => {
    try {
        const { id } = await viewIdSchema.validate(req.params);

        const count = await Expense.destroy({ where: { id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(204).send();
    } catch (err: any) {
        console.error(err);
        if (err.name === 'ValidationError') {
            return res.status(400).json({ error: 'Invalid expense ID' });
        }
        return res.status(500).json({ error: 'Failed to delete expense' });
    }
};

export const viewExpense = async (req: Request, res: Response) => {
    try {
        const { id } = await viewIdSchema.validate(req.params, { abortEarly: false });

        const expense = await Expense.findByPk(id, {
            include: [
                { model: ExpenseMedia, as: "media", attributes: ["file_path", "file_type"] },
            ],
            attributes: [ // Add attributes array with short_description
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'short_description', // ADD THIS
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ]
        });

        if (!expense) return res.status(404).json({ error: "Not found" });

        const expenseData = expense.toJSON();
        const mediaWithUrls = expenseData.media?.map((m: any) => ({
            ...m,
            url: `${req.protocol}://${req.get('host')}${m.file_path}`,
        })) ?? [];

        const dto = {
            ...expenseData,
            media: mediaWithUrls,
        };

        return res.json({ data: dto });
    } catch (err: any) {
        const details = err?.inner?.length ? err.inner.map((e: any) => e.message) : err.message;
        return res.status(400).json({ error: "Invalid request", details });
    }
};

/**
 * List view with filters + pagination + absolute media URLs
 */
export const viewExpenses = async (req: Request, res: Response) => {
    try {
        const q = await listSchema.validate(req.query, { abortEarly: false, stripUnknown: true });

        const dateField = q.by === "expense" ? "expense_date" : "transaction_date";
        const where: any = {};

        if (q.user_id) where.user_id = q.user_id;

        if (q.start_date && q.end_date) where[dateField] = { [Op.between]: [q.start_date, q.end_date] };
        else if (q.start_date) where[dateField] = { [Op.gte]: q.start_date };
        else if (q.end_date) where[dateField] = { [Op.lte]: q.end_date };

        // Get current user ID from request
        const currentUserId = (req as AuthenticatedRequest).user?.userId;

        // If user ID is available, filter by user's department
        if (currentUserId) {
            // Get user's department from UserDepartment model
            const userDepartment = await UserDepartment.findOne({
                where: { user_id: currentUserId },
                include: [
                    {
                        model: Department,
                        as: 'department',
                        attributes: ['id']
                    }
                ]
            });

            if (userDepartment?.department?.id) {
                // Filter expenses by the user's department ID
                where.department_id = userDepartment.department.id;
            } else {
                // If user has no department assigned, only show expenses created by this user
                where.user_id = currentUserId;
            }
        }

        // First, find all expenses with pagination
        const { rows, count } = await Expense.findAndCountAll({
            where,
            include: [
                {
                    model: ExpenseMedia,
                    as: "media",
                    attributes: ["file_path", "file_type"]
                },
                // Include payments to calculate summary
                {
                    model: ExpensePayment,
                    as: "payments",
                    attributes: ["amount_paid", "status", "payment_date"],
                    required: false
                },
                // Include department details
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name'],
                    required: false
                }
            ],
            attributes: [
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'short_description',
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ],
            order: [[dateField, q.order]],
            limit: q.limit,
            offset: (q.page - 1) * q.limit,
            distinct: true, // Important for count with includes
        });

        // Transform data to include payment summary
        const data = rows.map((expense: any) => {
            const expenseData = expense.toJSON();
            const mediaWithUrls = expenseData.media?.map((m: any) => ({
                ...m,
                url: `${req.protocol}://${req.get('host')}${m.file_path}`,
            })) ?? [];

            // Calculate payment summary
            const payments = expenseData.payments || [];
            const totalPaid = payments.reduce((sum: number, payment: any) =>
                sum + Number(payment.amount_paid || 0), 0);
            const totalExpense = Number(expenseData.amount || 0);
            const remainingAmount = Math.max(0, totalExpense - totalPaid);

            // Get latest payment date
            const latestPayment = payments.length > 0
                ? payments.reduce((latest: any, payment: any) =>
                    (!latest || new Date(payment.payment_date) > new Date(latest.payment_date))
                        ? payment
                        : latest, null)
                : null;

            // Determine payment status
            let paymentStatus = 'unpaid';
            if (totalPaid >= totalExpense && totalExpense > 0) {
                paymentStatus = 'paid';
            } else if (totalPaid > 0) {
                paymentStatus = 'partial';
            }

            return {
                ...expenseData,
                media: mediaWithUrls,
                payment_summary: {
                    total_paid: totalPaid,
                    remaining_amount: remainingAmount,
                    payment_status: paymentStatus,
                    last_payment_date: latestPayment?.payment_date || null,
                    payment_count: payments.length,
                    is_fully_paid: remainingAmount === 0
                }
            };
        });

        return res.json({
            data,
            page: q.page,
            limit: q.limit,
            total: count,
            totalPages: Math.ceil(count / q.limit),
            orderBy: dateField,
            order: q.order,
            filtered_by_department: !!currentUserId
        });
    } catch (err: any) {
        console.error("Error in viewExpenses:", err);
        const details = err?.inner?.length ? err.inner.map((e: any) => e.message) : err.message;
        return res.status(400).json({ error: "Invalid request", details });
    }
};

export const searchExpensesByForm = async (req: Request, res: Response) => {
    try {
        const q = await searchFormSchema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
        });

        const isExpense = q.search_by === "expense";

        // Get current user ID from request
        const currentUserId = (req as AuthenticatedRequest).user?.userId;

        // Build where clause with department filter
        let whereClause = literal(
            `${isExpense ? "expense_date" : "COALESCE(transaction_date, expense_date)"} BETWEEN '${q.start_date}' AND '${q.end_date}'`
        );

        // Add department filter if user is authenticated
        if (currentUserId) {
            // Get user's department from UserDepartment model
            const userDepartment = await UserDepartment.findOne({
                where: { user_id: currentUserId },
                include: [
                    {
                        model: Department,
                        as: 'department',
                        attributes: ['id']
                    }
                ]
            });

            if (userDepartment?.department?.id) {
                // Add department filter to where clause
                whereClause = literal(`(
                    ${isExpense ? "expense_date" : "COALESCE(transaction_date, expense_date)"} BETWEEN '${q.start_date}' AND '${q.end_date}'
                    AND department_id = '${userDepartment.department.id}'
                )`);
            } else {
                // If user has no department, filter by user_id
                whereClause = literal(`(
                    ${isExpense ? "expense_date" : "COALESCE(transaction_date, expense_date)"} BETWEEN '${q.start_date}' AND '${q.end_date}'
                    AND user_id = '${currentUserId}'
                )`);
            }
        }

        const { rows, count } = await Expense.findAndCountAll({
            where: {
                [Op.and]: whereClause,
            },
            include: [
                {
                    model: ExpenseMedia,
                    as: "media",
                    attributes: ["file_path", "file_type"]
                },
                // Include department details
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name'],
                    required: false
                }
            ],
            attributes: [
                'id',
                'user_id',
                'reason',
                'amount',
                'expense_date',
                'transaction_date',
                'description',
                'short_description',
                'department_id',
                'status',
                'is_account',
                'created_at',
                'updated_at',
            ],
            order: [
                [
                    literal(
                        isExpense
                            ? "expense_date"
                            : "COALESCE(transaction_date, expense_date)"
                    ),
                    q.order,
                ],
            ],
            limit: q.limit,
            offset: (q.page - 1) * q.limit,
        });

        const data = rows.map((expense: any) => {
            const expenseData = expense.toJSON();
            const mediaWithUrls = expenseData.media?.map((m: any) => ({
                ...m,
                url: `${req.protocol}://${req.get('host')}${m.file_path}`,
            })) ?? [];

            return {
                ...expenseData,
                media: mediaWithUrls,
            };
        });

        return res.json({
            data,
            page: q.page,
            limit: q.limit,
            total: count,
            totalPages: Math.ceil(count / q.limit),
            filtered_by_department: !!currentUserId
        });
    } catch (err: any) {
        const details = err?.inner?.length ? err.inner.map((e: any) => e.message) : err.message;
        return res.status(400).json({ error: "Invalid request", details });
    }
};

export const createExpensePaymentEntry = async (
    req: AuthenticatedRequest,
    res: Response
) => {
    let transaction: Transaction | null = null;

    try {
        /* ===========================
           1. Auth & Input Validation
        ============================ */
        if (!req.user?.userId) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

        // Validate the full payment payload
        const validatedData = await paymentCreateSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        }) as PaymentCreateData;

        /* ===========================
           2. Load Expense (source of truth)
        ============================ */
        const expense = await Expense.findByPk(validatedData.expense_id);

        if (!expense) {
            return res.status(404).json({
                success: false,
                error: "Expense not found"
            });
        }

        // Check if expense has required data
        if (!expense.department_id && !validatedData.department_id) {
            return res.status(400).json({
                success: false,
                error: "Department ID is required. Either expense must have a department or you must provide department_id in request"
            });
        }

        // Check if expense is already linked to a payment
        const existingPayment = await ExpensePayment.findOne({
            where: { expense_id: validatedData.expense_id }
        });

        if (existingPayment) {
            return res.status(409).json({
                success: false,
                error: "Payment already exists for this expense"
            });
        }

        /* ===========================
           3. Validate payment amount doesn't exceed expense amount
        ============================ */
        if (validatedData.amount_paid > Number(expense.amount)) {
            return res.status(400).json({
                success: false,
                error: "Payment amount cannot exceed expense amount",
                details: {
                    expense_amount: expense.amount,
                    payment_amount: validatedData.amount_paid
                }
            });
        }

        /* ===========================
           4. Calculate remaining balance
        ============================ */
        const totalExpense = Number(expense.amount);
        const amountPaid = validatedData.amount_paid || 0; // Default to 0
        const remainingExpense = totalExpense - amountPaid;

        // Determine status based on payment
        let status: 'pending' | 'completed' | 'failed' | 'reversed' = 'pending';
        if (amountPaid >= totalExpense) {
            status = 'completed';
        }

        // Use provided status if valid, otherwise use calculated one
        if (validatedData.status && ['pending', 'completed', 'failed', 'reversed'].includes(validatedData.status)) {
            status = validatedData.status;
        }

        // Handle account_id - if it's provided, validate it exists
        let accountIdToUse: string | null = validatedData.account_id ?? null;

        if (accountIdToUse) {
            const account = await Account.findByPk(accountIdToUse);
            if (!account) {
                return res.status(400).json({
                    success: false,
                    error: "Account not found"
                });
            }
        }

        /* ===========================
           5. Create payment entry with ACTUAL PAYMENT DATA
        ============================ */
        transaction = await sequelize.transaction();

        const payment = await ExpensePayment.create(
            {
                expense_id: validatedData.expense_id,
                account_id: accountIdToUse ?? null,
                user_id: validatedData.user_id,
                department_id: validatedData.department_id,
                total_expense: totalExpense,
                amount_paid: amountPaid, // Can be 0 initially
                remaining_expense: remainingExpense,
                payment_method: validatedData.payment_method ?? "account_transfer",
                payment_date: validatedData.payment_date ? new Date(validatedData.payment_date) : new Date(),
                transaction_reference: validatedData.transaction_reference ?? null,
                status: status,
                notes: validatedData.notes ?? null,
                created_by: req.user.userId,
            },
            { transaction }
        );

        /* ===========================
           6. Update expense status
        ============================ */
        // Always mark expense as is_account = true when payment record is created
        await expense.update(
            {
                is_account: true,
                // Only update status to 'approved' if payment is fully completed
                status: status === 'completed' ? 'approved' : expense.status
            },
            { transaction }
        );

        await transaction.commit();

        /* ===========================
           7. Response
        ============================ */
        return res.status(201).json({
            success: true,
            message: "Expense payment record created successfully",
            data: {
                id: payment.id,
                expense_id: payment.expense_id,
                account_id: payment.account_id,
                user_id: payment.user_id,
                department_id: payment.department_id,
                total_expense: payment.total_expense,
                amount_paid: payment.amount_paid,
                remaining_expense: payment.remaining_expense,
                payment_method: payment.payment_method,
                payment_date: payment.payment_date,
                transaction_reference: payment.transaction_reference,
                status: payment.status,
                notes: payment.notes,
                created_at: payment.created_at,
            },
        });

    } catch (err: any) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
        }

        console.error("createExpensePaymentEntry error:", err);

        // Handle validation errors
        if (err.name === 'ValidationError' && err.inner) {
            const details = err.inner.map((x: any) => ({
                field: x.path,
                message: x.message
            }));
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                details
            });
        }

        return res.status(500).json({
            success: false,
            error: "Failed to create payment entry",
            details: err.message ? [err.message] : ['Internal server error']
        });
    }
};

// GET /expenses/:id/payments
export const getPaymentsForExpense = async (req: Request, res: Response) => {
    try {
        const expenseId = req.params.id;
        if (!expenseId) return res.status(400).json({ error: 'expense id is required' });

        const expense = await Expense.findByPk(expenseId);
        if (!expense) return res.status(404).json({ error: 'Expense not found' });

        const payments = await ExpensePayment.findAll({
            where: { expense_id: expenseId },
            order: [['payment_date', 'DESC']],
            include: [
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name']
                }
            ]
        });

        return res.json({
            success: true,
            data: payments,
            count: payments.length
        });
    } catch (err: any) {
        console.error('getPaymentsForExpense error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Failed to fetch payments'
        });
    }
};


export const updatePaymentWithAmount = async (req: Request, res: Response) => {
    let transaction: Transaction | null = null;

    try {
        const { id } = req.params; // Payment ID
        const payload = req.body;

        // Validation schema for payment update
        const paymentUpdateSchema = Yup.object({
            amount_paid: Yup.number()
                .moreThan(0, 'amount_paid must be > 0')
                .required('amount_paid is required for payment'),
            payment_date: Yup.string()
                .matches(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD')
                .optional(),
            payment_method: Yup.string()
                .oneOf(['account_transfer', 'cash', 'cheque', 'online', 'card'])
                .optional(),
            transaction_reference: Yup.string().nullable().optional(),
            notes: Yup.string().nullable().optional(),
        });

        const data = await paymentUpdateSchema.validate(payload, {
            abortEarly: false,
            stripUnknown: true
        });

        transaction = await sequelize.transaction();

        // Find the payment record
        const payment = await ExpensePayment.findByPk(id, { transaction });
        if (!payment) {
            return res.status(404).json({
                success: false,
                error: 'Payment record not found'
            });
        }

        // Calculate new amount paid (adding to existing amount)
        const newAmountPaid = Number(payment.amount_paid) + Number(data.amount_paid);

        // Check if payment exceeds total expense
        if (newAmountPaid > Number(payment.total_expense)) {
            return res.status(400).json({
                success: false,
                error: 'Payment exceeds total expense',
                details: [`Total expense: ${payment.total_expense}, Current paid: ${payment.amount_paid}, New payment: ${data.amount_paid}`]
            });
        }

        // Calculate remaining expense
        const newRemainingExpense = Number(payment.total_expense) - newAmountPaid;

        // Determine status
        let newStatus = payment.status;
        if (newRemainingExpense === 0) {
            newStatus = 'completed';
        } else if (newAmountPaid > 0) {
            newStatus = 'pending';
        }

        // Update payment record
        const updateData: any = {
            amount_paid: newAmountPaid,
            remaining_expense: newRemainingExpense,
            status: newStatus,
            payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
        };

        // Optional fields
        if (data.payment_method) updateData.payment_method = data.payment_method;
        if (data.transaction_reference !== undefined) updateData.transaction_reference = data.transaction_reference;

        // Append to notes
        if (data.notes) {
            const existingNotes = payment.notes || '';
            updateData.notes = existingNotes
                ? `${existingNotes}\n[${new Date().toISOString()}] ${data.notes}`
                : data.notes;
        }

        await payment.update(updateData, { transaction });

        // Update expense status based on payment completion
        if (newStatus === 'completed') {
            // Find the related expense
            const expense = await Expense.findByPk(payment.expense_id, { transaction });
            if (expense) {
                // Only update expense status to 'approved' when payment is completed
                await expense.update({
                    status: 'approved'
                }, { transaction });
                console.log(`Expense ${expense.id} status updated to 'approved'`);
            }
        }

        await transaction.commit();

        return res.json({
            success: true,
            data: {
                id: payment.id,
                expense_id: payment.expense_id,
                total_expense: payment.total_expense,
                amount_paid: newAmountPaid,
                remaining_expense: newRemainingExpense,
                status: newStatus,
                updated_at: payment.updated_at
            },
            message: 'Payment updated successfully'
        });

    } catch (err: any) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
        }

        console.error('updatePaymentWithAmount error:', err);

        if (err.name === 'ValidationError' && err.inner) {
            const details = err.inner.map((x: any) => x.message);
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Failed to update payment',
            details: [err.message]
        });
    }
};

// Helper function for media URLs
function absolutize(req: Request, file_path?: string | null) {
    if (!file_path) return null;
    const base = `${req.protocol}://${req.get("host")}`;
    const clean = file_path.startsWith("/") ? file_path : `/${file_path}`;
    return `${base}${clean}`;
}

// Add this to your expense.controller.ts, preferably after the payment-related functions
// but before the model definitions

export const getUserById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "User ID is required"
            });
        }

        // Get user's department details
        const userDepartment = await UserDepartment.findOne({
            where: { user_id: id },
            include: [
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name']
                }
            ]
        });

        if (!userDepartment) {
            return res.status(404).json({
                success: false,
                error: "User department not found"
            });
        }

        return res.json({
            success: true,
            data: {
                user_id: userDepartment.user_id,
                department_id: userDepartment.department?.id || null,
                department_name: userDepartment.department?.department_name || null,
                created_at: userDepartment.created_at,
                updated_at: userDepartment.updated_at
            }
        });
    } catch (err: any) {
        console.error('Error fetching user:', err);

        return res.status(500).json({
            success: false,
            error: "Failed to fetch user details",
            details: err.message
        });
    }
};

export const getCurrentUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user?.userId) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized - User not authenticated"
            });
        }

        const userId = req.user.userId;

        // Get user's department details
        const userDepartment = await UserDepartment.findOne({
            where: { user_id: userId },
            include: [
                {
                    model: Department,
                    as: 'department',
                    attributes: ['id', 'department_name']
                }
            ]
        });

        return res.json({
            success: true,
            data: {
                user_id: userId,
                department_id: userDepartment?.department?.id || null,
                department_name: userDepartment?.department?.department_name || null,
                has_department: !!userDepartment?.department
            }
        });
    } catch (err: any) {
        console.error('Error fetching current user:', err);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch user details",
            details: err.message
        });
    }
};