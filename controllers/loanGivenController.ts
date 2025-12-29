// src/controllers/loanGivenController.ts
import { Request, Response } from 'express';
import { BaseLoanController } from './baseloanController';

export class LoanGivenController extends BaseLoanController {
  constructor() {
    super();
  }

  // Create a new loan given
  public createLoanGiven = async (req: Request, res: Response): Promise<Response> => {
    return this.createLoan(req, res, 'GIVE_LOAN');
  };

  // Get all loans given
  public getAllLoansGiven = async (req: Request, res: Response): Promise<Response> => {
    return this.getAllLoans(req, res, 'GIVE_LOAN');
  };

  // Get loan given by ID
  public getLoanGivenById = async (req: Request, res: Response): Promise<Response> => {
    return this.getLoanById(req, res);
  };

  // Update loan given
  public updateLoanGiven = async (req: Request, res: Response): Promise<Response> => {
    return this.updateLoan(req, res);
  };

  // Delete loan given
  public deleteLoanGiven = async (req: Request, res: Response): Promise<Response> => {
    return this.deleteLoan(req, res);
  };

  // Get dropdown data for loan given form
  public getDropdownData = async (req: Request, res: Response): Promise<Response> => {
    return this.getDropdownData(req, res);
  };
}