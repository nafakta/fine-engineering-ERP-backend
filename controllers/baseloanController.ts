// src/controllers/baseController.ts
import { Request, Response } from 'express';
import { db } from '../database/DBService';
import { Loan, LoanWithRelations, LoanAccountRelation, AccountRelation } from '../models/loan';




interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
    };
}

export class BaseLoanController {

    protected async createLoan(req: AuthenticatedRequest, res: Response, loanType: 'TAKE_LOAN' | 'GIVE_LOAN') {
        try {
            const {
                loan_account_id,
                account_id,
                amount,
                start_date,
                end_date,
                description
            } = req.body;

            // Validate required fields
            if (!loan_account_id || !account_id || !amount || !start_date) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: loan_account_id, account_id, amount, start_date'
                });
            }

            // Validate amount
            if (amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount must be greater than 0'
                });
            }

            // Start transaction to ensure both operations succeed or fail together
            await db.queryWithType('START TRANSACTION', {}, 'WRITE');

            try {
                // 1. First, get the current account balance
                const getAccountSql = `
                SELECT id, initialamount 
                FROM accounts 
                WHERE id = :account_id
            `;

                const accountResult = await db.queryWithType<any[]>(
                    getAccountSql,
                    { account_id },
                    'READ'
                );

                console.log('Account query result:', accountResult); // Debug log

                // Handle different possible result formats
                let currentAccount;
                if (Array.isArray(accountResult) && accountResult.length > 0) {
                    currentAccount = accountResult[0];
                } else if (accountResult && typeof accountResult === 'object') {
                    currentAccount = accountResult;
                } else {
                    await db.queryWithType('ROLLBACK', {}, 'WRITE');
                    return res.status(404).json({
                        success: false,
                        message: 'Account not found'
                    });
                }

                // Check if initialamount exists in the result
                if (!currentAccount || currentAccount.initialamount === undefined) {
                    console.log('Current account data:', currentAccount); // Debug log
                    await db.queryWithType('ROLLBACK', {}, 'WRITE');
                    return res.status(404).json({
                        success: false,
                        message: 'Account balance not found'
                    });
                }

                const currentBalance = parseFloat(currentAccount.initialamount) || 0;
                const loanAmount = parseFloat(amount);

                console.log(`Current balance: ${currentBalance}, Loan amount: ${loanAmount}`); // Debug log

                // Check if sufficient balance for GIVE_LOAN
                if (loanType === 'GIVE_LOAN' && currentBalance < loanAmount) {
                    await db.queryWithType('ROLLBACK', {}, 'WRITE');
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient balance in account. Current balance: ${currentBalance}, Required: ${loanAmount}`
                    });
                }

                // 2. Update account balance based on loan type
                const newBalance = loanType === 'TAKE_LOAN'
                    ? currentBalance + loanAmount
                    : currentBalance - loanAmount;

                const accountUpdateSql = `
                UPDATE accounts 
                SET initialamount = :newBalance,
                    updated_at = NOW()
                WHERE id = :account_id
            `;

                const updateResult = await db.queryWithType(
                    accountUpdateSql,
                    {
                        newBalance,
                        account_id
                    },
                    'WRITE'
                );

                console.log('Account update result:', updateResult); // Debug log

                // 3. Create the loan record
                const loanSql = `
                INSERT INTO loans (
                    loan_account_id, 
                    account_id, 
                    loan_type, 
                    amount, 
                    start_date, 
                    end_date, 
                    remaining_balance, 
                    description, 
                    status, 
                    created_by,
                    created_at,
                    updated_at
                ) VALUES (
                    :loan_account_id, 
                    :account_id, 
                    :loan_type, 
                    :amount, 
                    :start_date, 
                    :end_date, 
                    :remaining_balance, 
                    :description, 
                    :status, 
                    :created_by,
                    NOW(),
                    NOW()
                ) RETURNING *
            `;

                const replacements = {
                    loan_account_id,
                    account_id,
                    loan_type: loanType,
                    amount: loanAmount,
                    start_date,
                    end_date: end_date || null,
                    remaining_balance: loanAmount,
                    description: description || null,
                    status: 'ACTIVE',
                    created_by: (req as any).user?.id || null
                };

                const result = await db.queryWithType<Loan[]>(loanSql, replacements, 'WRITE');

                // Handle different result formats for loan creation
                let loan;
                if (Array.isArray(result) && result.length > 0) {
                    loan = result[0];
                } else if (result && typeof result === 'object') {
                    loan = result;
                } else {
                    throw new Error('Failed to create loan record');
                }

                // Commit transaction
                await db.queryWithType('COMMIT', {}, 'WRITE');

                return res.status(201).json({
                    success: true,
                    message: `${loanType === 'TAKE_LOAN' ? 'Loan taken' : 'Loan given'} created successfully. ${loanType === 'TAKE_LOAN' ? 'Amount added to' : 'Amount deducted from'} your account.`,
                    data: loan
                });

            } catch (error: any) {
                // Rollback transaction in case of error
                await db.queryWithType('ROLLBACK', {}, 'WRITE');
                console.error('Transaction error:', error);
                throw error;
            }

        } catch (error: any) {
            console.error('Error creating loan:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }

    protected async getAllLoans(
        req: Request,
        res: Response,
        loanType: 'TAKE_LOAN' | 'GIVE_LOAN'
    ) {
        try {
            console.log(`📋 Fetching all loans of type: ${loanType}`);

            const sql = `
      SELECT 
        l.*,

        -- Loan Account Details
        la.account_name   AS loan_account_account_name,
        la.bank_name      AS loan_account_bank_name,
        la.account_number AS loan_account_account_number,
        la.ifsc_code      AS loan_account_ifsc_code,
        la.branch         AS loan_account_branch,
        la.mobile         AS loan_account_mobile,

        -- Main Account (Customer) Details
        a.accountname     AS account_accountname,
        a.bankname        AS account_bankname,
        a.accountnumber   AS account_accountnumber,
        a.ifsc            AS account_ifsc,
        a.branch          AS account_branch
      FROM loans l
      LEFT JOIN loan_accounts la ON l.loan_account_id = la.id
      LEFT JOIN accounts a      ON l.account_id      = a.id
      WHERE l.loan_type = :loan_type
      ORDER BY l.created_at DESC
    `;

            const raw = await db.queryWithType<any>(sql, { loan_type: loanType }, 'READ');

            console.log('🔍 Raw DB result (getAllLoans):', raw);

            // ✅ Normalize ANY possible format into a plain array
            let rowsArray: any[] = [];

            if (Array.isArray(raw)) {
                // Case 1: [rows, metadata]  (Sequelize style)
                if (raw.length === 2 && Array.isArray(raw[0])) {
                    rowsArray = raw[0];
                } else {
                    // Case 2: already an array of row objects
                    rowsArray = raw as any[];
                }
            } else if (raw && typeof raw === 'object') {
                const r: any = raw;

                // Case 3: { rows: [...] } (pg style)
                if (Array.isArray(r.rows)) {
                    rowsArray = r.rows;
                } else {
                    // Case 4: try to find any array property inside the object
                    const firstArrayProp = Object.values(r).find((v) => Array.isArray(v));
                    if (Array.isArray(firstArrayProp)) {
                        rowsArray = firstArrayProp;
                    } else {
                        // Case 5: single row object
                        rowsArray = [r];
                    }
                }
            } else {
                rowsArray = [];
            }

            console.log('🎯 Normalized rowsArray length:', rowsArray.length);

            if (!Array.isArray(rowsArray)) {
                console.error('❌ rowsArray is not an array:', typeof rowsArray, rowsArray);
                rowsArray = [];
            }

            const transformedLoans: LoanWithRelations[] = rowsArray.map((loan: any) => ({
                id: loan.id,
                loan_account_id: loan.loan_account_id,
                account_id: loan.account_id,
                loan_type: loan.loan_type,
                amount: parseFloat(loan.amount) || 0,
                start_date: loan.start_date,
                end_date: loan.end_date,
                status: loan.status,
                remaining_balance: parseFloat(loan.remaining_balance) || 0,
                total_principal_paid: parseFloat(loan.total_principal_paid) || 0,
                description: loan.description,
                created_at: loan.created_at,
                updated_at: loan.updated_at,
                created_by: loan.created_by,

                loanAccount: {
                    id: loan.loan_account_id,
                    account_name: loan.loan_account_account_name,
                    bank_name: loan.loan_account_bank_name,
                    account_number: loan.loan_account_account_number,
                    branch: loan.loan_account_branch,
                    ifsc_code: loan.loan_account_ifsc_code,   // ✅ from la.ifsc_code alias
                    mobile: loan.loan_account_mobile,
                },

                account: {
                    id: loan.account_id,
                    accountname: loan.account_accountname,
                    bankname: loan.account_bankname,
                    accountnumber: loan.account_accountnumber,
                    branch: loan.account_branch,
                    ifsc: loan.account_ifsc,                  // ✅ matches AccountRelation.ifsc
                },
            }));

            return res.status(200).json({
                success: true,
                data: transformedLoans,
                count: transformedLoans.length,
            });
        } catch (error: any) {
            console.error('❌ Error fetching loans:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message,
            });
        }
    }

    // Common get by ID method
    protected async getLoanById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const sql = `
      SELECT 
        l.*,
        la.account_name   AS loan_account_account_name,
        la.bank_name      AS loan_account_bank_name,
        la.account_number AS loan_account_account_number,
        la.ifsc_code      AS loan_account_ifsc_code,
        la.branch         AS loan_account_branch,
        la.mobile         AS loan_account_mobile,
        a.accountname     AS account_accountname,
        a.bankname        AS account_bankname,
        a.accountnumber   AS account_accountnumber,
        a.ifsc            AS account_ifsc,
        a.branch          AS account_branch
      FROM loans l
      LEFT JOIN loan_accounts la ON l.loan_account_id = la.id
      LEFT JOIN accounts a      ON l.account_id      = a.id
      WHERE l.id = :id
      LIMIT 1
    `;

            const loan = await db.queryOne<any>(sql, { id }, 'READ');

            if (!loan) {
                return res.status(404).json({
                    success: false,
                    message: 'Loan not found'
                });
            }

            const transformedLoan: LoanWithRelations = {
                id: loan.id,
                loan_account_id: loan.loan_account_id,
                account_id: loan.account_id,
                loan_type: loan.loan_type,
                amount: parseFloat(loan.amount),
                start_date: loan.start_date,
                end_date: loan.end_date,
                status: loan.status,
                remaining_balance: parseFloat(loan.remaining_balance),
                total_principal_paid: parseFloat(loan.total_principal_paid),
                description: loan.description,
                created_at: loan.created_at,
                updated_at: loan.updated_at,
                created_by: loan.created_by,

                loanAccount: {
                    id: loan.loan_account_id,
                    account_name: loan.loan_account_account_name,
                    bank_name: loan.loan_account_bank_name,
                    account_number: loan.loan_account_account_number,
                    ifsc_code: loan.loan_account_ifsc_code,
                    branch: loan.loan_account_branch,
                    mobile: loan.loan_account_mobile,
                },

                account: {
                    id: loan.account_id,
                    accountname: loan.account_accountname,
                    bankname: loan.account_bankname,
                    accountnumber: loan.account_accountnumber,
                    ifsc: loan.account_ifsc,
                    branch: loan.account_branch,
                },
            };

            return res.status(200).json({
                success: true,
                data: transformedLoan,
            });

        } catch (error: any) {
            console.error('Error fetching loan:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message,
            });
        }
    }

    // Common update method
    protected async updateLoan(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const {
                loan_account_id,
                account_id,
                amount,
                start_date,
                end_date,
                status,
                remaining_balance,
                total_principal_paid,
                description
            } = req.body;

            // First check if loan exists
            const checkSql = `SELECT id FROM loans WHERE id = $id`;
            const existingLoan = await db.queryOne<any>(checkSql, { id }, 'READ');

            if (!existingLoan) {
                return res.status(404).json({
                    success: false,
                    message: 'Loan not found'
                });
            }

            // Build dynamic update query
            const updateFields: string[] = [];
            const replacements: any = { id };

            if (loan_account_id) {
                updateFields.push('loan_account_id = $loan_account_id');
                replacements.loan_account_id = loan_account_id;
            }
            if (account_id) {
                updateFields.push('account_id = $account_id');
                replacements.account_id = account_id;
            }
            if (amount !== undefined) {
                updateFields.push('amount = $amount');
                replacements.amount = amount;
            }
            if (start_date) {
                updateFields.push('start_date = $start_date');
                replacements.start_date = start_date;
            }
            if (end_date !== undefined) {
                updateFields.push('end_date = $end_date');
                replacements.end_date = end_date;
            }
            if (status) {
                updateFields.push('status = $status');
                replacements.status = status;
            }
            if (remaining_balance !== undefined) {
                updateFields.push('remaining_balance = $remaining_balance');
                replacements.remaining_balance = remaining_balance;
            }
            if (total_principal_paid !== undefined) {
                updateFields.push('total_principal_paid = $total_principal_paid');
                replacements.total_principal_paid = total_principal_paid;
            }
            if (description !== undefined) {
                updateFields.push('description = $description');
                replacements.description = description;
            }

            // Always update the updated_at timestamp
            updateFields.push('updated_at = NOW()');

            if (updateFields.length === 1) { // Only updated_at was added
                return res.status(400).json({
                    success: false,
                    message: 'No fields to update'
                });
            }

            const updateSql = `
  UPDATE loans 
  SET ${updateFields.join(', ')}
  WHERE id = :id
  RETURNING *
`;

            const result = await db.queryWithType<Loan[]>(updateSql, replacements, 'WRITE');
            const updatedLoan = result[0];

            return res.status(200).json({
                success: true,
                message: 'Loan updated successfully',
                data: updatedLoan
            });

        } catch (error: any) {
            console.error('Error updating loan:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }

    // Common delete method
    protected async deleteLoan(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // First check if loan exists
            const checkSql = `SELECT id FROM loans WHERE id = $id`;
            const existingLoan = await db.queryOne<any>(checkSql, { id }, 'READ');

            if (!existingLoan) {
                return res.status(404).json({
                    success: false,
                    message: 'Loan not found'
                });
            }

            const deleteSql = `DELETE FROM loans WHERE id = :id`;
            await db.queryWrite(deleteSql, { id }, 'WRITE');

            return res.status(200).json({
                success: true,
                message: 'Loan deleted successfully'
            });

        } catch (error: any) {
            console.error('Error deleting loan:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }

    // Get dropdown data for loan accounts and accounts
    protected async getDropdownData(req: Request, res: Response) {
        try {
            // Get loan accounts for dropdown
            const loanAccountsSql = `
                SELECT id, account_name, bank_name, account_number 
                FROM loan_accounts 
                ORDER BY account_name
            `;
            const loanAccounts = await db.queryWithType<any[]>(loanAccountsSql, {}, 'READ');

            // Get accounts for dropdown
            const accountsSql = `
                SELECT id, accountname, bankname, accountnumber 
                FROM accounts 
                ORDER BY accountname
            `;
            const accounts = await db.queryWithType<any[]>(accountsSql, {}, 'READ');

            return res.status(200).json({
                success: true,
                data: {
                    loanAccounts,
                    accounts
                }
            });

        } catch (error: any) {
            console.error('Error fetching dropdown data:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
}