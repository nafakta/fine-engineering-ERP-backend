// src/controllers/accountController.ts
import { Request, Response } from 'express';
import { Account } from '../models/Banks';
import db from '../models';
import { Op } from 'sequelize';

// GET /accounts
export async function getAllAccounts(req: Request, res: Response): Promise<Response> {
    try {
        const accounts = await Account.findAll({
            order: [['id', 'DESC']] // Change 'id' to your desired column
        });
        return res.json(accounts);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to fetch accounts.' });
    }
}


// GET /accounts/:id
export async function getAccountById(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    try {
        const account = await Account.findByPk(id);
        if (!account) {
            return res.status(404).json({ message: 'Account not found.' });
        }
        return res.json(account);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to fetch account.' });
    }
}

// POST /accounts
// controller
export async function createAccount(req: Request, res: Response) {
    try {
        console.log('body:', req.body); // verify payload

        const payload = {
            accountname: req.body.account_name ?? req.body.accountname ?? null,
            bankname: req.body.bank_name ?? req.body.bankname ?? null,
            accountnumber: req.body.account_number ?? req.body.accountnumber ?? null, // STRING(50) in model
            ifsc: req.body.ifsc_code ?? req.body.ifsc ?? null,
            branch: req.body.branch ?? null,
            initialamount: req.body.initial_amount ?? req.body.initialamount ?? null,
        };

        const newAccount = await Account.create(payload, {
            fields: ['accountname', 'bankname', 'accountnumber', 'ifsc', 'branch', 'initialamount'],
        });
        return res.status(200).json(newAccount);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to create account.' });
    }
}



// PUT /accounts/:id
export async function updateAccount(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    // Optional: early check
    const exists = await Account.findByPk(id);
    if (!exists) {
        return res.status(404).json({ message: 'Account not found.' });
    }

    try {
        const [affectedCount, affectedRows] = await Account.update(req.body, {
            where: { id },
            returning: true,    // ← Postgres only
        });

        if (affectedCount === 0) {
            return res.status(404).json({ message: 'Account not found.' });
        }

        // affectedRows[0] is the updated instance
        return res.json(affectedRows[0]);
    } catch (err) {
        console.error('Failed to update account:', err);
        return res.status(500).json({ message: 'Failed to update account.' });
    }
}
// DELETE /accounts/:id
export async function deleteAccount(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    try {
        const deleted = await Account.destroy({ where: { id } });
        if (!deleted) {
            return res.status(404).json({ message: 'Account not found.' });
        }
        return res.status(204).send();
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to delete account.' });
    }
}

export async function listAccountsByBank(req: Request, res: Response) {
    try {
        const bank = (req.query.bank as string | undefined)?.trim();
        if (!bank) return res.status(400).json({ success: false, message: 'bank is required' });

        const rows = await db.Account.findAll({
            where: { bankname: { [Op.iLike]: bank } }, // exact match; change to %bank% if you want partials
            attributes: ['id', 'bankname', 'accountnumber', 'branch', 'holdername'],
            order: [['accountnumber', 'ASC']],
            raw: true,
        });

        const options = rows.map((r: any) => ({
            value: r.id,
            label: `${r.accountnumber} — ${r.holdername || ''} (${r.branch || ''})`.trim(),
            bankname: r.bankname,
        }));

        res.json({ success: true, data: options });
    } catch (e: any) {
        res.status(500).json({ success: false, message: e.message || 'Failed to load accounts' });
    }
}

export async function getLatestAccount(req: Request, res: Response): Promise<Response> {
    try {
        const latest = await Account.findOne({
            order: [['created_at' as any, 'DESC']], // mapped via model options
        });

        if (!latest) return res.status(404).json({ message: 'No accounts found.' });
        return res.json(latest);
    } catch (err) {
        console.error('Failed to fetch latest account:', err);
        return res.status(500).json({ message: 'Failed to fetch latest account.' });
    }
}