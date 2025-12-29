// src/controllers/loanTakenController.ts
import { Request, Response } from 'express';
import { BaseLoanController } from './baseloanController';

export class LoanTakenController extends BaseLoanController {
    constructor() {
        super();
    }

    // Create a new loan taken
    public createLoanTaken = async (req: Request, res: Response): Promise<Response> => {
        return this.createLoan(req, res, 'TAKE_LOAN');
    };

    // Get all loans taken
    public getAllLoansTaken = async (req: Request, res: Response): Promise<Response> => {
        return this.getAllLoans(req, res, 'TAKE_LOAN');
    };

    // Get loan taken by ID
    public getLoanTakenById = async (req: Request, res: Response): Promise<Response> => {
        return this.getLoanById(req, res);
    };

    // Update loan taken
    public updateLoanTaken = async (req: Request, res: Response): Promise<Response> => {
        return this.updateLoan(req, res);
    };

    // Delete loan taken
    public deleteLoanTaken = async (req: Request, res: Response): Promise<Response> => {
        return this.deleteLoan(req, res);
    };

    // Get dropdown data for loan taken form
    public getDropdownData = async (req: Request, res: Response): Promise<Response> => {
        return this.getDropdownData(req, res);
    };
}