// src/controllers/vendorPaymentClearance.controller.ts
import { Request, Response } from 'express';
import { sequelize } from '../models/index';
import { VendorPaymentClearance } from '../models/VendorPaymentClearance';
import { Account } from '../models/Banks';
import { VendorBillPayment } from '../models/VendorBillPayment';
import { Vendor } from '../models/vendor';
import { OrderBill } from '../models/OrderBill';
import { Op, QueryTypes } from 'sequelize';

// Define the authenticated request interface
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

export class VendorPaymentClearanceController {
    /**
     * GET /api/vendor-payment-clearances
     * Get all payment clearances with optional filters
     */
    async getPaymentClearances(req: AuthenticatedRequest, res: Response) {
        try {
            const {
                vendor_id,
                bill_id,
                payment_status,
                clearance_status,
                start_date,
                end_date,
                page = 1,
                limit = 10,
                search
            } = req.query;

            const offset = (Number(page) - 1) * Number(limit);

            // Build where conditions
            const whereConditions: any = {};

            if (vendor_id) whereConditions.vendor_id = vendor_id;
            if (bill_id) whereConditions.bill_id = bill_id;
            if (payment_status) whereConditions.payment_status = payment_status;
            if (clearance_status) whereConditions.clearance_status = clearance_status;

            // Date range filter
            if (start_date || end_date) {
                whereConditions.payment_date = {};
                if (start_date) whereConditions.payment_date[Op.gte] = start_date;
                if (end_date) whereConditions.payment_date[Op.lte] = end_date;
            }

            // Search functionality
            if (search) {
                whereConditions[Op.or] = [
                    { transaction_reference: { [Op.iLike]: `%${search}%` } },
                    { cheque_number: { [Op.iLike]: `%${search}%` } },
                    { notes: { [Op.iLike]: `%${search}%` } },
                    { clearance_notes: { [Op.iLike]: `%${search}%` } }
                ];
            }

            const { count, rows } = await VendorPaymentClearance.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: Vendor,
                        as: 'vendor',
                        attributes: ['id', 'company', 'vendor', 'mobile', 'email_id', 'gstin']
                    },
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber', 'ifsc']
                    },
                    {
                        model: VendorBillPayment,
                        as: 'vendorBillPayment',
                        attributes: ['id', 'pay_number', 'payment_date', 'bill_amount'],
                        required: false
                    }
                ],
                order: [['created_at', 'DESC']],
                limit: Number(limit),
                offset: offset,
                distinct: true
            });

            res.status(200).json({
                success: true,
                data: rows,
                pagination: {
                    total: count,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(count / Number(limit))
                }
            });
        } catch (error) {
            console.error('Error fetching payment clearances:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch payment clearances',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async createPaymentClearance(req: AuthenticatedRequest, res: Response) {
        const transaction = await sequelize.transaction();

        try {
            const {
                id, // ✅ MUST include ID of existing record to update
                account_id,
                payment_date,
                payment_mode,
                total_amount,
                paid_amount,
                vendor_bill_payment_id,
                // ... other fields
            } = req.body;

            // ✅ CRITICAL: Check if ID is provided
            if (!id) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Payment clearance ID is required to update existing record'
                });
            }

            // ✅ Check if the record exists
            const existingRecord = await VendorPaymentClearance.findByPk(id, { transaction });

            if (!existingRecord) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: `Payment clearance record with ID ${id} not found. Cannot update non-existent record.`
                });
            }

            // ✅ Get user ID
            const userId = req.user?.userId;

            // ✅ Validate required fields
            if (!account_id || !payment_date || !payment_mode || total_amount === undefined) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: account_id, payment_date, payment_mode, total_amount'
                });
            }

            // ✅ Validate amounts
            const parsedTotalAmount = parseFloat(String(total_amount));
            if (isNaN(parsedTotalAmount) || parsedTotalAmount <= 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'total_amount must be a valid positive number'
                });
            }

            const parsedPaidAmount = parseFloat(String(paid_amount || 0));
            if (isNaN(parsedPaidAmount) || parsedPaidAmount < 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'paid_amount must be a valid non-negative number'
                });
            }

            if (parsedPaidAmount > parsedTotalAmount) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'paid_amount cannot exceed total_amount'
                });
            }

            // ✅ Calculate values according to check constraint formula
            const previousPaidAmount = existingRecord.previous_paid_amount || 0;
            const currentPaidAmount = existingRecord.paid_amount || 0;

            // According to check constraint: remaining_amount = (total_amount - COALESCE(previous_paid_amount, 0) - COALESCE(paid_amount, 0))
            const finalRemainingAmount = parsedTotalAmount - previousPaidAmount - parsedPaidAmount;

            // Ensure remaining amount is not negative
            if (finalRemainingAmount < 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Invalid amount calculation. With total amount ${parsedTotalAmount}, previous paid ${previousPaidAmount}, paid amount ${parsedPaidAmount} would result in negative remaining amount`
                });
            }

            const finalIsFullyPaid = finalRemainingAmount <= 0;
            const finalPaymentStatus = finalIsFullyPaid ? 'FULL' : (parsedPaidAmount > 0 ? 'PARTIAL' : 'PENDING');

            // ✅ Bank account balance check
            if (account_id && parsedPaidAmount > 0) {
                const account = await Account.findByPk(account_id, { transaction });
                if (!account) {
                    await transaction.rollback();
                    return res.status(404).json({
                        success: false,
                        message: 'Bank account not found'
                    });
                }

                const currentBalance = parseFloat(String(account.initialamount || 0));

                // Only check for new amount being added (difference between new and old paid amount)
                const difference = parsedPaidAmount - currentPaidAmount;

                if (difference > 0 && currentBalance < difference) {
                    await transaction.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Insufficient balance in bank account',
                        currentBalance,
                        requiredAdditional: difference
                    });
                }

                // Update bank account balance based on the difference
                if (difference !== 0) {
                    await Account.update(
                        {
                            initialamount: currentBalance - difference,
                            updated_at: new Date()
                        },
                        {
                            where: { id: account_id },
                            transaction
                        }
                    );
                }
            }

            // ✅ PREPARE UPDATE DATA according to check constraints
            const updateData: any = {
                account_id,
                payment_date,
                payment_mode,
                total_amount: parsedTotalAmount,
                paid_amount: parsedPaidAmount,
                // Keep previous_paid_amount as is (don't update it)
                previous_paid_amount: previousPaidAmount,
                remaining_amount: finalRemainingAmount,
                balance_amount: finalRemainingAmount, // According to chk_balance_amount: balance_amount = remaining_amount
                payment_status: finalPaymentStatus,
                is_fully_paid: finalIsFullyPaid,
                updated_by: userId,
                updated_at: new Date()
            };

            // Set payment_stage based on payment status
            if (finalPaymentStatus === 'FULL') {
                updateData.payment_stage = 'FINAL';
            } else if (finalPaymentStatus === 'PARTIAL') {
                // Determine payment stage based on previous payments
                if (previousPaidAmount === 0 && parsedPaidAmount > 0) {
                    updateData.payment_stage = 'FIRST';
                } else if (parsedPaidAmount > 0) {
                    updateData.payment_stage = 'INTERIM';
                }
            }

            // ✅ Only update optional fields if provided
            if (req.body.transaction_reference !== undefined) updateData.transaction_reference = req.body.transaction_reference;
            if (req.body.bank_name !== undefined) updateData.bank_name = req.body.bank_name;
            if (req.body.cheque_number !== undefined) updateData.cheque_number = req.body.cheque_number;
            if (req.body.cleared_amount !== undefined) updateData.cleared_amount = req.body.cleared_amount;
            if (req.body.cleared_date !== undefined) updateData.cleared_date = req.body.cleared_date;
            if (req.body.clearance_notes !== undefined) updateData.clearance_notes = req.body.clearance_notes;
            if (req.body.clearance_status !== undefined) updateData.clearance_status = req.body.clearance_status;
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;
            if (req.body.paid_by !== undefined) updateData.paid_by = req.body.paid_by;
            if (req.body.vendor_bill_payment_id !== undefined) updateData.vendor_bill_payment_id = req.body.vendor_bill_payment_id;
            if (req.body.payment_in !== undefined) updateData.payment_in = req.body.payment_in;
            if (req.body.place_of_supply !== undefined) updateData.place_of_supply = req.body.place_of_supply;

            // ✅ PERFORM THE UPDATE
            await VendorPaymentClearance.update(updateData, {
                where: { id },
                transaction
            });

            // ✅ UPDATE VENDOR BILL PAYMENT STATUS BASED ON PAYMENT STATUS
            // Get the vendor_bill_payment_id from existing record if not provided in request
            const billPaymentId = vendor_bill_payment_id || existingRecord.vendor_bill_payment_id;

            if (billPaymentId) {
                const vendorBillPayment = await VendorBillPayment.findByPk(billPaymentId, { transaction });

                if (vendorBillPayment) {
                    // Get the current bill amount
                    const billAmount = parseFloat(String(vendorBillPayment.bill_amount || 0));

                    // Calculate the total paid amount (including previous payments from other clearance records)
                    // We need to get all clearance records for this bill to calculate total paid
                    const allClearancesForBill = await VendorPaymentClearance.findAll({
                        where: {
                            bill_id: existingRecord.bill_id,
                            vendor_id: existingRecord.vendor_id
                        },
                        transaction
                    });

                    // Sum all paid amounts from all clearance records for this bill
                    let totalPaidForBill = 0;
                    allClearancesForBill.forEach(clearance => {
                        totalPaidForBill += parseFloat(String(clearance.paid_amount || 0));
                    });

                    // Calculate remaining amount for the bill
                    const remainingForBill = billAmount - totalPaidForBill;

                    // Determine status based on payment
                    let newStatus = vendorBillPayment.status;
                    let newIsPaid = vendorBillPayment.is_paid;

                    // ✅ SPECIFIC LOGIC: If payment_status is FULL, set status to "Paid"
                    if (finalPaymentStatus === 'FULL') {
                        newStatus = 'Paid';
                        newIsPaid = true;
                    } else if (totalPaidForBill >= billAmount) {
                        newStatus = 'Paid';
                        newIsPaid = true;
                    } else if (totalPaidForBill > 0) {
                        newStatus = 'Partial';
                        newIsPaid = false;
                    } else {
                        newStatus = 'Pending';
                        newIsPaid = false;
                    }

                    // Update VendorBillPayment
                    await VendorBillPayment.update(
                        {
                            status: newStatus,
                            is_paid: newIsPaid,
                            paid_amount: totalPaidForBill,
                            remaining_amount: remainingForBill > 0 ? remainingForBill : 0,
                            updated_at: new Date()
                        },
                        {
                            where: { id: billPaymentId },
                            transaction
                        }
                    );
                }
            } else {
                // If no vendor_bill_payment_id is associated, try to find it by bill_id and vendor_id
                const vendorBillPayment = await VendorBillPayment.findOne({
                    where: {
                        bill_id: existingRecord.bill_id,
                        vendor_id: existingRecord.vendor_id
                    },
                    transaction
                });

                if (vendorBillPayment && finalPaymentStatus === 'FULL') {
                    // ✅ If payment is FULL, update the VendorBillPayment to "Paid"
                    await VendorBillPayment.update(
                        {
                            status: 'Paid',
                            is_paid: true,
                            paid_amount: parsedPaidAmount,
                            remaining_amount: 0,
                            updated_at: new Date()
                        },
                        {
                            where: { id: vendorBillPayment.id },
                            transaction
                        }
                    );
                }
            }

            await transaction.commit();

            // ✅ Fetch updated record with associations
            const updatedRecord = await VendorPaymentClearance.findByPk(id, {
                include: [
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber', 'initialamount']
                    },
                    {
                        model: VendorBillPayment,
                        as: 'vendorBillPayment',
                        attributes: ['id', 'pay_number', 'payment_date', 'bill_amount', 'status', 'is_paid', 'paid_amount', 'remaining_amount']
                    }
                ]
            });

            res.status(200).json({
                success: true,
                message: 'Payment clearance updated successfully',
                data: updatedRecord
            });

        } catch (error) {
            await transaction.rollback();
            console.error('Error updating payment clearance:', error);

            let errorMessage = 'Failed to update payment clearance';
            if (error instanceof Error) {
                // Provide more specific error messages for check constraint violations
                if (error.message.includes('chk_amount_consistency')) {
                    errorMessage = 'Amount calculation error: remaining_amount must equal (total_amount - previous_paid_amount - paid_amount)';
                } else if (error.message.includes('chk_balance_amount')) {
                    errorMessage = 'Balance amount error: balance_amount must equal remaining_amount';
                } else if (error.message.includes('chk_fully_paid')) {
                    errorMessage = 'Fully paid check error: is_fully_paid must be true when remaining_amount = 0, false when remaining_amount > 0';
                } else if (error.message.includes('chk_paid_amount_limit')) {
                    errorMessage = 'Paid amount cannot exceed total amount';
                } else if (error.name === 'SequelizeValidationError') {
                    errorMessage = 'Validation error: ' + error.message;
                }
            }

            res.status(500).json({
                success: false,
                message: errorMessage,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async getPaymentClearanceById(req: AuthenticatedRequest, res: Response) {
        try {
            const { id } = req.params;

            const paymentClearance = await VendorPaymentClearance.findByPk(id, {
                include: [
                    {
                        model: Vendor,
                        as: 'vendor',
                        attributes: ['id', 'company', 'vendor', 'mobile', 'email_id', 'address', 'gstin', 'city', 'state']
                    },
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber', 'ifsc', 'branch', 'initialamount']
                    },
                    {
                        model: VendorBillPayment,
                        as: 'vendorBillPayment',
                        attributes: ['id', 'pay_number', 'payment_date', 'bill_amount', 'status']
                    },
                    {
                        model: sequelize.models.OrderBill,
                        as: 'bill',
                        attributes: ['id', 'bill_number', 'bill_date', 'total_amount', 'po_id'] // ✅ Removed tax_amount
                    }
                ]
            });

            if (!paymentClearance) {
                return res.status(404).json({
                    success: false,
                    message: 'Payment clearance not found'
                });
            }

            res.status(200).json({
                success: true,
                data: paymentClearance
            });
        } catch (error) {
            console.error('Error fetching payment clearance:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch payment clearance',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * PUT /api/vendor-payment-clearances/:id
     * Update payment clearance
     */
    async updatePaymentClearance(req: AuthenticatedRequest, res: Response) {
        const transaction = await sequelize.transaction();

        try {
            const { id } = req.params;
            const updateData = req.body;
            const userId = req.user?.userId;

            // Find existing payment clearance
            const existingClearance = await VendorPaymentClearance.findByPk(id, { transaction });

            if (!existingClearance) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Payment clearance not found'
                });
            }

            // Validate that required fields are not being set to null
            if (updateData.vendor_id === null || updateData.bill_id === null || updateData.purchase_order_id === null) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'vendor_id, bill_id, and purchase_order_id cannot be null'
                });
            }

            // Handle amount updates and bank account balance
            if (updateData.account_id && updateData.paid_amount !== undefined) {
                const oldPaidAmount = existingClearance.paid_amount || 0;
                const newPaidAmount = parseFloat(String(updateData.paid_amount || 0));

                // If paid amount is changing, adjust bank account balance
                if (newPaidAmount !== oldPaidAmount) {
                    const account = await Account.findByPk(updateData.account_id || existingClearance.account_id, { transaction });

                    if (account) {
                        const difference = newPaidAmount - oldPaidAmount;

                        // Check if sufficient funds for increase
                        if (difference > 0) {
                            const currentBalance = account.initialamount || 0;
                            if (currentBalance < difference) {
                                await transaction.rollback();
                                return res.status(400).json({
                                    success: false,
                                    message: 'Insufficient balance in bank account for payment increase',
                                    currentBalance,
                                    requiredAdditional: difference
                                });
                            }
                        }

                        // Update bank account balance
                        await Account.update(
                            {
                                initialamount: sequelize.literal(`initialamount - ${difference}`),
                                updated_at: new Date()
                            },
                            {
                                where: { id: account.id },
                                transaction
                            }
                        );
                    }
                }
            }

            // Update the record
            updateData.updated_by = userId;
            updateData.updated_at = new Date();

            await VendorPaymentClearance.update(updateData, {
                where: { id },
                transaction
            });

            await transaction.commit();

            // Fetch updated record
            const updatedClearance = await VendorPaymentClearance.findByPk(id, {
                include: [
                    {
                        model: Vendor,
                        as: 'vendor',
                        attributes: ['id', 'company', 'vendor', 'gstin']
                    },
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber', 'initialamount']
                    }
                ]
            });

            res.status(200).json({
                success: true,
                message: 'Payment clearance updated successfully',
                data: updatedClearance
            });

        } catch (error) {
            await transaction.rollback();
            console.error('Error updating payment clearance:', error);

            res.status(500).json({
                success: false,
                message: 'Failed to update payment clearance',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * DELETE /api/vendor-payment-clearances/:id
     * Delete payment clearance and refund amount if paid
     */
    async deletePaymentClearance(req: AuthenticatedRequest, res: Response) {
        const transaction = await sequelize.transaction();

        try {
            const { id } = req.params;

            const paymentClearance = await VendorPaymentClearance.findByPk(id, { transaction });

            if (!paymentClearance) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Payment clearance not found'
                });
            }

            // Refund amount to bank account if paid
            if (paymentClearance.account_id && paymentClearance.paid_amount) {
                const paidAmount = parseFloat(String(paymentClearance.paid_amount));

                if (paidAmount > 0) {
                    await Account.update(
                        {
                            initialamount: sequelize.literal(`initialamount + ${paidAmount}`),
                            updated_at: new Date()
                        },
                        {
                            where: { id: paymentClearance.account_id },
                            transaction
                        }
                    );
                }
            }

            // Delete the record
            await VendorPaymentClearance.destroy({
                where: { id },
                transaction
            });

            await transaction.commit();

            res.status(200).json({
                success: true,
                message: 'Payment clearance deleted successfully'
            });

        } catch (error) {
            await transaction.rollback();
            console.error('Error deleting payment clearance:', error);

            res.status(500).json({
                success: false,
                message: 'Failed to delete payment clearance',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/vendor-payment-clearances/bill/:bill_id
     * Get all payment clearances for a specific bill
     */
    async getPaymentClearancesByBill(req: AuthenticatedRequest, res: Response) {
        try {
            const { bill_id } = req.params;
            const { clearance_status } = req.query;

            const whereConditions: any = { bill_id };

            if (clearance_status) {
                whereConditions.clearance_status = clearance_status;
            }

            const clearances = await VendorPaymentClearance.findAll({
                where: whereConditions,
                include: [
                    {
                        model: Vendor,
                        as: 'vendor',
                        attributes: ['id', 'company', 'vendor', 'gstin']
                    },
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber']
                    }
                ],
                order: [['payment_date', 'ASC'], ['created_at', 'ASC']]
            });

            // Calculate totals
            const totals = {
                total_bill_amount: 0,
                total_paid: 0,
                total_remaining: 0,
                total_pending: clearances.filter(c => c.clearance_status === 'PENDING').length,
                total_cleared: clearances.filter(c => c.clearance_status === 'CLEARED').length,
                total_bounced: clearances.filter(c => c.clearance_status === 'BOUNCED').length
            };

            clearances.forEach(clearance => {
                totals.total_paid += parseFloat(String(clearance.paid_amount || 0));
            });

            // Get bill total from order_bills
            const bill = await sequelize.query<{ total_amount: string }>(
                `SELECT total_amount FROM public.order_bills WHERE id = :bill_id`,
                {
                    type: QueryTypes.SELECT,
                    replacements: { bill_id },
                    plain: true
                }
            );

            if (bill) {
                totals.total_bill_amount = parseFloat(bill.total_amount || '0');
                totals.total_remaining = totals.total_bill_amount - totals.total_paid;
            }

            res.status(200).json({
                success: true,
                data: clearances,
                totals
            });
        } catch (error) {
            console.error('Error fetching bill payment clearances:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch bill payment clearances',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/vendor-payment-clearances/vendor/:vendor_id
     * Get all payment clearances for a specific vendor
     */
    async getPaymentClearancesByVendor(req: AuthenticatedRequest, res: Response) {
        try {
            const { vendor_id } = req.params;
            const {
                start_date,
                end_date,
                page = 1,
                limit = 20
            } = req.query;

            const offset = (Number(page) - 1) * Number(limit);
            const whereConditions: any = { vendor_id };

            // Date range filter
            if (start_date || end_date) {
                whereConditions.payment_date = {};
                if (start_date) whereConditions.payment_date[Op.gte] = start_date;
                if (end_date) whereConditions.payment_date[Op.lte] = end_date;
            }

            const { count, rows } = await VendorPaymentClearance.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: Account,
                        as: 'account',
                        attributes: ['id', 'accountname', 'bankname', 'accountnumber']
                    },
                    {
                        model: sequelize.models.OrderBill,
                        as: 'bill', // ✅ CHANGE THIS FROM 'bill' TO 'bill' (it's already correct here)
                        attributes: ['id', 'bill_number', 'bill_date', 'total_amount']
                    }
                ],
                order: [['payment_date', 'DESC']],
                limit: Number(limit),
                offset: offset,
                distinct: true
            });

            // Calculate vendor totals
            const totals = {
                total_payments: count,
                total_amount: 0,
                total_paid: 0,
                total_cleared: 0,
                total_pending: 0
            };

            rows.forEach(clearance => {
                totals.total_amount += parseFloat(String(clearance.total_amount || 0));
                totals.total_paid += parseFloat(String(clearance.paid_amount || 0));

                if (clearance.clearance_status === 'CLEARED') totals.total_cleared++;
                if (clearance.clearance_status === 'PENDING') totals.total_pending++;
            });

            res.status(200).json({
                success: true,
                data: rows,
                totals,
                pagination: {
                    total: count,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(count / Number(limit))
                }
            });
        } catch (error) {
            console.error('Error fetching vendor payment clearances:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch vendor payment clearances',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/vendor-payment-clearances/:id/clear
     * Mark payment as cleared
     */
    async markAsCleared(req: AuthenticatedRequest, res: Response) {
        const transaction = await sequelize.transaction();

        try {
            const { id } = req.params;
            const { cleared_amount, cleared_date = new Date(), clearance_notes } = req.body;
            const userId = req.user?.userId;

            const paymentClearance = await VendorPaymentClearance.findByPk(id, { transaction });

            if (!paymentClearance) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Payment clearance not found'
                });
            }

            // Update to cleared status
            const updateData: any = {
                clearance_status: 'CLEARED',
                cleared_date: cleared_date || new Date(),
                cleared_amount: cleared_amount || paymentClearance.paid_amount,
                clearance_notes,
                updated_by: userId,
                updated_at: new Date()
            };

            // If cleared amount is specified and different from paid amount
            if (cleared_amount && paymentClearance.paid_amount !== cleared_amount) {
                updateData.paid_amount = cleared_amount;

                // Recalculate remaining amount if total_amount exists
                if (paymentClearance.total_amount) {
                    const previousPaidAmount = paymentClearance.previous_paid_amount || 0;
                    const totalAmount = parseFloat(String(paymentClearance.total_amount));
                    const newRemaining = totalAmount - previousPaidAmount - cleared_amount;

                    updateData.remaining_amount = Math.max(0, newRemaining);
                    updateData.balance_amount = updateData.remaining_amount;
                    updateData.is_fully_paid = newRemaining <= 0;
                    updateData.payment_status = newRemaining <= 0 ? 'FULL' : 'PARTIAL';
                }
            }

            await VendorPaymentClearance.update(updateData, {
                where: { id },
                transaction
            });

            await transaction.commit();

            const updatedClearance = await VendorPaymentClearance.findByPk(id, {
                include: [
                    {
                        model: Vendor,
                        as: 'vendor',
                        attributes: ['id', 'company', 'vendor']
                    }
                ]
            });

            res.status(200).json({
                success: true,
                message: 'Payment marked as cleared',
                data: updatedClearance
            });

        } catch (error) {
            await transaction.rollback();
            console.error('Error marking payment as cleared:', error);

            res.status(500).json({
                success: false,
                message: 'Failed to mark payment as cleared',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * POST /api/vendor-payment-clearances/:id/bounce
     * Mark payment as bounced
     */
    async markAsBounced(req: AuthenticatedRequest, res: Response) {
        const transaction = await sequelize.transaction();

        try {
            const { id } = req.params;
            const { bounce_reason, bounce_date = new Date() } = req.body;
            const userId = req.user?.userId;

            const paymentClearance = await VendorPaymentClearance.findByPk(id, { transaction });

            if (!paymentClearance) {
                await transaction.rollback();
                return res.status(404).json({
                    success: false,
                    message: 'Payment clearance not found'
                });
            }

            // Refund amount to bank account if it was deducted
            if (paymentClearance.account_id && paymentClearance.paid_amount) {
                const paidAmount = parseFloat(String(paymentClearance.paid_amount));

                if (paidAmount > 0) {
                    await Account.update(
                        {
                            initialamount: sequelize.literal(`initialamount + ${paidAmount}`),
                            updated_at: new Date()
                        },
                        {
                            where: { id: paymentClearance.account_id },
                            transaction
                        }
                    );
                }
            }

            // Update to bounced status
            await VendorPaymentClearance.update({
                clearance_status: 'BOUNCED',
                cleared_date: bounce_date,
                clearance_notes: bounce_reason,
                paid_amount: null, // Reset paid amount since payment bounced
                cleared_amount: null,
                payment_status: 'CANCELLED',
                is_fully_paid: false,
                updated_by: userId,
                updated_at: new Date()
            }, {
                where: { id },
                transaction
            });

            await transaction.commit();

            res.status(200).json({
                success: true,
                message: 'Payment marked as bounced and amount refunded'
            });

        } catch (error) {
            await transaction.rollback();
            console.error('Error marking payment as bounced:', error);

            res.status(500).json({
                success: false,
                message: 'Failed to mark payment as bounced',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * GET /api/vendor-payment-clearances/stats/summary
     * Get payment clearance statistics
     */
    async getPaymentStats(req: AuthenticatedRequest, res: Response) {
        try {
            const { start_date, end_date, vendor_id } = req.query;

            const whereConditions: any = {};

            // Date range filter
            if (start_date || end_date) {
                whereConditions.payment_date = {};
                if (start_date) whereConditions.payment_date[Op.gte] = start_date;
                if (end_date) whereConditions.payment_date[Op.lte] = end_date;
            }

            if (vendor_id) whereConditions.vendor_id = vendor_id;

            const stats = await VendorPaymentClearance.findAll({
                where: whereConditions,
                attributes: [
                    'clearance_status',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                    [sequelize.fn('SUM', sequelize.col('total_amount')), 'total_amount_sum'],
                    [sequelize.fn('SUM', sequelize.col('paid_amount')), 'paid_amount_sum'],
                    [sequelize.fn('SUM', sequelize.col('remaining_amount')), 'remaining_amount_sum']
                ],
                group: ['clearance_status'],
                raw: true
            });

            // Calculate overall totals
            const overallStats = {
                total_count: 0,
                total_amount: 0,
                total_paid: 0,
                total_remaining: 0,
                pending_count: 0,
                cleared_count: 0,
                bounced_count: 0
            };

            stats.forEach((stat: any) => {
                overallStats.total_count += parseInt(stat.count || '0');
                overallStats.total_amount += parseFloat(stat.total_amount_sum || '0');
                overallStats.total_paid += parseFloat(stat.paid_amount_sum || '0');
                overallStats.total_remaining += parseFloat(stat.remaining_amount_sum || '0');

                if (stat.clearance_status === 'PENDING') overallStats.pending_count = parseInt(stat.count || '0');
                if (stat.clearance_status === 'CLEARED') overallStats.cleared_count = parseInt(stat.count || '0');
                if (stat.clearance_status === 'BOUNCED') overallStats.bounced_count = parseInt(stat.count || '0');
            });

            res.status(200).json({
                success: true,
                data: {
                    by_status: stats,
                    overall: overallStats
                }
            });
        } catch (error) {
            console.error('Error fetching payment stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch payment statistics',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}

// Export singleton instance
export const vendorPaymentClearanceController = new VendorPaymentClearanceController();