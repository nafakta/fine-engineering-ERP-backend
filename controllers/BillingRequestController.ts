// src/controllers/BillingRequestController.ts
import { Request, Response } from "express";
import * as Yup from "yup";
import { Transaction } from "sequelize";
import BaseController from "./BaseController";
import BillingRequest, {
  BillingRequestCreationAttributes,
} from "../models/BillingRequest";
import BillingRequestPaymentHistory from "../models/BillingRequestPaymentHistory";
import db from "../models";

// ==================== VALIDATION SCHEMAS ====================

// Billing Request – CREATE schema (matches DDL + frontend payload)
const createSchema = Yup.object({
  amc_contract_id: Yup.string()
    .uuid("amc_contract_id must be a valid UUID")
    .required("amc_contract_id is required"),
  company_name: Yup.string().required("company_name is required"),
  client_id: Yup.string()
    .uuid("client_id must be a valid UUID")
    .required("client_id is required"),
  basic_amount: Yup.number().required().min(0),
  tax_amount: Yup.number().required().min(0),
  // Only used for splitting into child rows
  installment: Yup.number().required().integer().min(1),
}).required();

// Mark-next-payment schema
const markNextPaymentSchema = Yup.object({
  billing_request_id: Yup.string()
    .uuid("billing_request_id must be a valid UUID")
    .required("billing_request_id is required"),
}).required();

// Create PI schema
const createPISchema = Yup.object({
  amc_contract_id: Yup.string()
    .uuid("amc_contract_id must be a valid UUID")
    .required("amc_contract_id is required"),
  client_id: Yup.string()
    .uuid("client_id must be a valid UUID")
    .required("client_id is required"),
  basic_amount: Yup.number().required().min(0),
  tax_amount: Yup.number().required().min(0),
  price_including_tax: Yup.number().required().min(0),
  notes: Yup.string().nullable(),
  tax_scheme: Yup.string().required(),
  amcac_contract_details: Yup.array()
    .of(
      Yup.object({
        ac_type: Yup.string().required(),
        maker: Yup.string().required(),
        quantity: Yup.number().required().min(1),
        rate_per_ac: Yup.number().required().min(0),
        total_rate: Yup.number().required().min(0),
        tr_ac: Yup.number().required().min(1),
      })
    )
    .min(1, "At least one AMCAC contract detail is required"),
}).required();

// ==================== CONTROLLER CLASS ====================

class BillingRequestController extends BaseController {

// ========== CREATE PI ==========
public createPI = async (req: Request, res: Response) => {
  const transaction: Transaction = await db.sequelize.transaction();
  try {
    console.log(
      "📥 [PI] Received request to create PI:",
      JSON.stringify(req.body, null, 2)
    );

    const raw = await createPISchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    const {
      amc_contract_id,
      client_id,
      basic_amount,
      tax_amount,
      price_including_tax,
      notes,
      tax_scheme,
      amcac_contract_details,
    } = raw;

    // ✅ TypeScript array check
    const details = amcac_contract_details as Array<{
      ac_type: string;
      maker: string;
      quantity: number;
      rate_per_ac: number;
      total_rate: number;
      tr_ac: number;
    }>;

    // 1️⃣ Create PI record ONLY
    const pi = await db.sequelize.query(
      `
        INSERT INTO public.pi (
          amc_contract_id,
          client_id,
          amount,
          tax_amount,
          price_inc_tax,
          notes,
          tax_scheme,
          created_at,
          updated_at
        ) VALUES (
          :amc_contract_id,
          :client_id,
          :amount,
          :tax_amount,
          :price_inc_tax,
          :notes,
          :tax_scheme,
          NOW(),
          NOW()
        ) RETURNING *
      `,
      {
        replacements: {
          amc_contract_id,
          client_id,
          amount: basic_amount,
          tax_amount,
          price_inc_tax: price_including_tax,
          notes: notes || null,
          tax_scheme,
        },
        transaction,
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    const piRecord = pi[0];
    const piId = piRecord[0].id;

    console.log(`✅ [PI] PI created with ID: ${piId}`);

    // 2️⃣ Create PI Items ONLY
    for (const detail of details) {
      // Extract GST percentage from tax_scheme (remove % sign)
      const gstPercent = parseFloat(tax_scheme.replace('%', ''));
      
      // Calculate line total (rate_per_ac * quantity)
      const lineTotal = detail.rate_per_ac * detail.quantity;

      await db.sequelize.query(
        `
          INSERT INTO public.pi_items (
            pi_id,
            description,
            quantity,
            rate,
            unit,
            gst_percent,
            line_total,
            created_at,
            updated_at,
            make,
            item_name
          ) VALUES (
            :pi_id,
            :description,
            :quantity,
            :rate,
            :unit,
            :gst_percent,
            :line_total,
            NOW(),
            NOW(),
            :make,
            :item_name
          )
        `,
        {
          replacements: {
            pi_id: piId,
            description: `${detail.ac_type} - ${detail.maker}`,
            quantity: detail.quantity,
            rate: detail.rate_per_ac,
            unit: 'NOS',
            gst_percent: gstPercent,
            line_total: lineTotal,
            make: detail.maker,
            item_name: detail.ac_type,
          },
          transaction,
          type: db.sequelize.QueryTypes.INSERT,
        }
      );

      console.log(
        `   ✅ [PI] Added item: ${detail.ac_type} (${detail.maker}) - Quantity: ${detail.quantity}, Rate: ₹${detail.rate_per_ac}`
      );
    }

    await transaction.commit();
    console.log(`✅ [PI] Transaction committed successfully for PI ID: ${piId}`);

    // 3️⃣ Fetch the complete PI with items
    const completePI = await db.sequelize.query(
      `
        SELECT 
          p.*,
          json_agg(pi_items.*) as pi_items
        FROM public.pi p
        LEFT JOIN public.pi_items ON p.id = pi_items.pi_id
        WHERE p.id = :pi_id
        GROUP BY p.id
      `,
      {
        replacements: { pi_id: piId },
        transaction: false,
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    return this.sendSuccess(
      res,
      {
        success: true,
        message: "PI created successfully",
        data: completePI[0] || piRecord[0],
      },
      "PI created successfully",
      201
    );
  } catch (err: any) {
    await transaction.rollback();
    console.error("❌ [PI] Error in createPI:", err);

    if (err instanceof Yup.ValidationError) {
      return this.sendError(
        res,
        {
          success: false,
          message: "Validation error",
          errors: err.errors,
        },
        "Validation error",
        400
      );
    }

    return this.sendError(
      res,
      {
        success: false,
        message: "Internal server error",
        error: err.message,
      },
      "Internal server error",
      500
    );
  }
};
  // ========== CREATE BILLING REQUEST ==========
  public create = async (req: Request, res: Response) => {
    const transaction: Transaction = await db.sequelize.transaction();
    try {
      console.log(
        "📥 [BILLING] Received request (create):",
        JSON.stringify(req.body, null, 2)
      );

      const raw = await createSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      const {
        amc_contract_id,
        company_name,
        client_id,
        basic_amount,
        tax_amount,
        installment,
      } = raw;

      const basic = Number(basic_amount);
      const tax = Number(tax_amount);
      const installmentsCount = Number(installment);
      const total_amount = basic + tax;

      // 1️⃣ Create billing request
      const billingRequest = await BillingRequest.create(
        {
          amc_contract_id,
          company_name,
          client_id,
          basic_amount: basic,
          tax_amount: tax,
          total_amount,
        },
        { transaction }
      );

      console.log(
        `✅ [BILLING] Billing request created - ID: ${billingRequest.id}, Client ID: ${client_id}`
      );

      // 2️⃣ Create payment history with split amounts
      const perInstallmentBasic = basic / installmentsCount;
      const perInstallmentTax = tax / installmentsCount;
      const perInstallmentTotal = total_amount / installmentsCount;
      
      const perInstallmentBasicBase = Math.floor(perInstallmentBasic * 100) / 100;
      const perInstallmentTaxBase = Math.floor(perInstallmentTax * 100) / 100;
      const perInstallmentTotalBase = Math.floor(perInstallmentTotal * 100) / 100;
      
      let accumulatedBasic = 0;
      let accumulatedTax = 0;
      let accumulatedTotal = 0;

      const paymentRows: BillingRequestPaymentHistory[] = [];

      for (let i = 0; i < installmentsCount; i++) {
        let installmentBasic = perInstallmentBasicBase;
        let installmentTax = perInstallmentTaxBase;
        let installmentTotal = perInstallmentTotalBase;

        // For the last installment, adjust to match exact totals
        if (i === installmentsCount - 1) {
          installmentBasic = Number((basic - accumulatedBasic).toFixed(2));
          installmentTax = Number((tax - accumulatedTax).toFixed(2));
          installmentTotal = Number((total_amount - accumulatedTotal).toFixed(2));
        }

        accumulatedBasic += installmentBasic;
        accumulatedTax += installmentTax;
        accumulatedTotal += installmentTotal;

        const row = await BillingRequestPaymentHistory.create(
          {
            billing_request_id: billingRequest.id,
            basic_amount: installmentBasic,
            tax_amount: installmentTax,
            total_amount: installmentTotal,
          },
          { transaction }
        );

        paymentRows.push(row);
        console.log(
          `   📅 [BILLING] Installment ${i + 1}: Basic=₹${installmentBasic}, Tax=₹${installmentTax}, Total=₹${installmentTotal} (Status: pending)`
        );
      }

      // 3️⃣ 🔒 UPDATE AMC CONTRACT → mark as sent to bill
      await db.sequelize.query(
        `
          UPDATE public.amc_contract
          SET is_send_to_bill = true
          WHERE id = :amc_contract_id
        `,
        {
          replacements: { amc_contract_id },
          transaction,
        }
      );

      console.log(
        `✅ [BILLING] AMC Contract ${amc_contract_id} marked as sent to bill`
      );

      await transaction.commit();
      console.log("✅ [BILLING] Transaction committed successfully");

      return this.sendSuccess(
        res,
        {
          success: true,
          message: "Billing request created and AMC contract marked as billed",
          data: {
            billing_request: billingRequest,
            payment_schedule: paymentRows,
            summary: {
              basic_amount: basic,
              tax_amount: tax,
              total_amount,
              installments: installmentsCount,
              client_id,
            },
          },
        },
        "Billing request created",
        201
      );
    } catch (err: any) {
      await transaction.rollback();
      console.error("❌ [BILLING] Error in create:", err);

      if (err instanceof Yup.ValidationError) {
        return this.sendError(
          res,
          {
            success: false,
            message: "Validation error",
            errors: err.errors,
          },
          "Validation error",
          400
        );
      }

      return this.sendError(
        res,
        {
          success: false,
          message: "Internal server error",
          error: err.message,
        },
        "Internal server error",
        500
      );
    }
  };

// ========== MARK NEXT INSTALLMENT AS COMPLETED ==========
public markNextPaymentAsCompleted = async (req: Request, res: Response) => {
  const transaction: Transaction = await db.sequelize.transaction();
  try {
    console.log(
      "📥 [BILLING] Mark next payment as completed – payload:",
      req.body
    );

    const { billing_request_id } = await markNextPaymentSchema.validate(
      req.body,
      {
        abortEarly: false,
        stripUnknown: true,
      }
    );

    // 1️⃣ Find next pending row (oldest first)
    const nextPending = await BillingRequestPaymentHistory.findOne({
      where: {
        billing_request_id,
        status: "pending",
      },
      order: [
        ["created_at", "ASC"],
        ["id", "ASC"],
      ],
      transaction,
    });

    if (!nextPending) {
      await transaction.rollback();
      console.log(
        "ℹ️ [BILLING] No pending installment left for billing_request_id:",
        billing_request_id
      );

      return this.sendError(
        res,
        {
          success: false,
          message: "No pending installment left for this billing request",
        },
        "No pending installment left for this billing request",
        400
      );
    }

    // 2️⃣ Mark ONLY THIS ROW as completed
    await nextPending.update(
      {
        status: "completed",
      },
      { transaction }
    );

    console.log(
      `✅ [BILLING] Installment marked as completed - ID: ${nextPending.id}, Amount: ₹${nextPending.total_amount}`
    );

    // 3️⃣ Get updated counts and amounts for stats
    const pendingRows = await BillingRequestPaymentHistory.findAll({
      where: { billing_request_id, status: "pending" },
      transaction,
    });

    const completedRows = await BillingRequestPaymentHistory.findAll({
      where: { billing_request_id, status: "completed" },
      transaction,
    });

    // Calculate totals
    const pendingBasic = pendingRows.reduce((sum, row) => sum + row.basic_amount, 0);
    const pendingTax = pendingRows.reduce((sum, row) => sum + row.tax_amount, 0);
    const pendingTotal = pendingRows.reduce((sum, row) => sum + row.total_amount, 0);

    const completedBasic = completedRows.reduce((sum, row) => sum + row.basic_amount, 0);
    const completedTax = completedRows.reduce((sum, row) => sum + row.tax_amount, 0);
    const completedTotal = completedRows.reduce((sum, row) => sum + row.total_amount, 0);

    await transaction.commit();
    console.log(
      `✅ [BILLING] Transaction committed. billing_request_id=${billing_request_id}`
    );

    return this.sendSuccess(
      res,
      {
        success: true,
        message: "Next pending installment marked as completed",
        data: {
          updated_payment: nextPending,
          stats: {
            pending: {
              count: pendingRows.length,
              basic_amount: Number(pendingBasic.toFixed(2)),
              tax_amount: Number(pendingTax.toFixed(2)),
              total_amount: Number(pendingTotal.toFixed(2)),
            },
            completed: {
              count: completedRows.length,
              basic_amount: Number(completedBasic.toFixed(2)),
              tax_amount: Number(completedTax.toFixed(2)),
              total_amount: Number(completedTotal.toFixed(2)),
            },
            total: pendingRows.length + completedRows.length,
          },
        },
      },
      "Next pending installment marked as completed",
      200
    );
  } catch (err: any) {
    await transaction.rollback();
    console.error(
      "❌ [BILLING] Error in markNextPaymentAsCompleted:",
      err
    );

    if (err instanceof Yup.ValidationError) {
      return this.sendError(
        res,
        {
          success: false,
          message: "Validation error",
          errors: err.errors,
        },
        "Validation error",
        400
      );
    }

    return this.sendError(
      res,
      {
        success: false,
        message: "Internal server error",
        error: err.message,
      },
      "Internal server error",
      500
    );
  }
};

  // ========== GET ALL BILLING REQUESTS ==========
  public getAll = async (req: Request, res: Response) => {
    try {
      console.log("🔍 [BILLING] Fetching all billing requests...");

      const { amc_contract_id, client_id } = req.query;
      const where: any = {};

      if (amc_contract_id) {
        where.amc_contract_id = amc_contract_id;
        console.log(`   Filtering by amc_contract_id: ${amc_contract_id}`);
      }

      if (client_id) {
        where.client_id = client_id;
        console.log(`   Filtering by client_id: ${client_id}`);
      }

      // Fetch billing requests with payment history
      const data = await BillingRequest.findAll({
        where,
        order: [["created_at", "DESC"]],
        include: [
          {
            model: db.BillingRequestPaymentHistory,
            as: "paymentHistory",
          },
        ],
      });

      console.log(`✅ [BILLING] Found ${data.length} billing requests`);

      // Extract all unique amc_contract_ids
      const amcContractIds = data.map(item => item.amc_contract_id).filter(Boolean);

      // Fetch AMC contract data in one query
      let amcContractsMap = new Map();
      if (amcContractIds.length > 0) {
        const amcContractsData = await db.sequelize.query(
          `
            SELECT 
              ac.*,
              json_agg(acd.*) as amcac_contract_details
            FROM public.amc_contract ac
            LEFT JOIN public.amcac_contract_details acd ON ac.id = acd.amc_contract_id
            WHERE ac.id IN (:amcContractIds)
            GROUP BY ac.id
          `,
          {
            replacements: { amcContractIds },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        // Create a map for easy lookup
        amcContractsMap = new Map(
          amcContractsData.map((item: any) => [item.id, item])
        );
      }

      // 🔢 Enrich each billing request with summary and AMC data
      const enriched = data.map((item) => {
        const plain = item.toJSON() as any;
        const payments: any[] = plain.paymentHistory || [];

        const totalInstallments = payments.length;
        const completedInstallments = payments.filter(
          (p) => p.status === "completed"
        ).length;
        const pendingInstallments = totalInstallments - completedInstallments;

        // Calculate amounts from child payment rows
        const paidBasic = payments
          .filter((p) => p.status === "completed")
          .reduce((sum, p) => sum + Number(p.basic_amount ?? 0), 0);

        const paidTax = payments
          .filter((p) => p.status === "completed")
          .reduce((sum, p) => sum + Number(p.tax_amount ?? 0), 0);

        const paidTotal = payments
          .filter((p) => p.status === "completed")
          .reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0);

        const pendingBasic = payments
          .filter((p) => p.status === "pending")
          .reduce((sum, p) => sum + Number(p.basic_amount ?? 0), 0);

        const pendingTax = payments
          .filter((p) => p.status === "pending")
          .reduce((sum, p) => sum + Number(p.tax_amount ?? 0), 0);

        const pendingTotal = payments
          .filter((p) => p.status === "pending")
          .reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0);

        // Parent amounts (should match sum of all child rows)
        const totalBasic = Number(plain.basic_amount ?? 0);
        const totalTax = Number(plain.tax_amount ?? 0);
        const totalAmount = Number(plain.total_amount ?? 0);

        // Get AMC contract data
        const amcContractData = plain.amc_contract_id ? amcContractsMap.get(plain.amc_contract_id) : null;
        
        // Separate AMC contract and AMCAC contract details
        let amc_contract = null;
        let amcac_contract_details = null;
        
        if (amcContractData) {
          // Create a copy of the data
          const amcContractCopy = { ...amcContractData };
          
          // Extract and remove the amcac_contract_details from the main object
          if (amcContractCopy.amcac_contract_details) {
            amcac_contract_details = amcContractCopy.amcac_contract_details;
            delete amcContractCopy.amcac_contract_details;
          }
          
          amc_contract = amcContractCopy;
        }

        return {
          ...plain,
          // Include AMC data as separate objects
          amc_contract,
          amcac_contract_details,
          summary: {
            // Parent totals
            basic_amount: totalBasic,
            tax_amount: totalTax,
            total_amount: totalAmount,
            
            // Paid amounts
            paid_basic_amount: Number(paidBasic.toFixed(2)),
            paid_tax_amount: Number(paidTax.toFixed(2)),
            paid_total_amount: Number(paidTotal.toFixed(2)),
            
            // Pending amounts
            pending_basic_amount: Number(pendingBasic.toFixed(2)),
            pending_tax_amount: Number(pendingTax.toFixed(2)),
            pending_total_amount: Number(pendingTotal.toFixed(2)),
            
            // Remaining amounts (same as pending)
            remaining_basic_amount: Number(pendingBasic.toFixed(2)),
            remaining_tax_amount: Number(pendingTax.toFixed(2)),
            remaining_total_amount: Number(pendingTotal.toFixed(2)),
            
            // Installment counts
            installments_total: totalInstallments,
            installments_completed: completedInstallments,
            installments_pending: pendingInstallments,
            installments_label: `${completedInstallments}/${totalInstallments}`,
            
            // Client info
            client_id: plain.client_id,
          },
        };
      });

      return this.sendSuccess(
        res,
        {
          success: true,
          message: "Billing requests fetched successfully",
          data: enriched,
          count: enriched.length,
        },
        "Billing requests fetched successfully",
        200
      );
    } catch (err: any) {
      console.error("❌ [BILLING] Error in getAll:", err);
      return this.sendError(
        res,
        {
          success: false,
          message: "Internal server error",
          error: err.message,
        },
        "Internal server error",
        500
      );
    }
  };

  // ========== GET BILLING REQUEST BY ID ==========
  public getById = async (req: Request, res: Response) => {
    try {
      const { id } = req.body;

      if (!id) {
        return this.sendError(
          res,
          {
            success: false,
            message: "ID is required in request body",
          },
          "ID is required in request body",
          400
        );
      }

      console.log(`🔍 [BILLING] Fetching billing request with ID: ${id}`);

      // Fetch billing request with payment history
      const item = await BillingRequest.findByPk(id, {
        include: [
          {
            model: db.BillingRequestPaymentHistory,
            as: "paymentHistory",
            order: [["created_at", "ASC"]],
          },
        ],
      });

      if (!item) {
        return this.sendError(
          res,
          {
            success: false,
            message: "Billing request not found",
          },
          "Billing request not found",
          404
        );
      }

      console.log(`✅ [BILLING] Billing request found - ID: ${item.id}`);

      const plain = item.toJSON() as any;
      const amc_contract_id = plain.amc_contract_id;
      
      // Fetch AMC contract data if available
      let amc_contract = null;
      let amcac_contract_details = null;
      
      if (amc_contract_id) {
        const amcContractData = await db.sequelize.query(
          `
            SELECT 
              ac.*,
              json_agg(acd.*) as amcac_contract_details
            FROM public.amc_contract ac
            LEFT JOIN public.amcac_contract_details acd ON ac.id = acd.amc_contract_id
            WHERE ac.id = :amc_contract_id
            GROUP BY ac.id
          `,
          {
            replacements: { amc_contract_id },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        if (amcContractData && amcContractData.length > 0) {
          // Create a copy of the data
          const amcContractCopy = { ...amcContractData[0] };
          
          // Extract and remove the amcac_contract_details from the main object
          if (amcContractCopy.amcac_contract_details) {
            amcac_contract_details = amcContractCopy.amcac_contract_details;
            delete amcContractCopy.amcac_contract_details;
          }
          
          amc_contract = amcContractCopy;
        }
      }

      const payments: any[] = plain.paymentHistory || [];

      const totalInstallments = payments.length;
      const completedInstallments = payments.filter(
        (p) => p.status === "completed"
      ).length;
      const pendingInstallments = totalInstallments - completedInstallments;

      // Calculate amounts from child payment rows
      const paidBasic = payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.basic_amount ?? 0), 0);

      const paidTax = payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.tax_amount ?? 0), 0);

      const paidTotal = payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0);

      const pendingBasic = payments
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.basic_amount ?? 0), 0);

      const pendingTax = payments
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.tax_amount ?? 0), 0);

      const pendingTotal = payments
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0);

      // Parent amounts
      const totalBasic = Number(plain.basic_amount ?? 0);
      const totalTax = Number(plain.tax_amount ?? 0);
      const totalAmount = Number(plain.total_amount ?? 0);

      const enriched = {
        ...plain,
        // Include AMC data as separate objects
        amc_contract,
        amcac_contract_details,
        summary: {
          // Parent totals
          basic_amount: totalBasic,
          tax_amount: totalTax,
          total_amount: totalAmount,
          
          // Paid amounts
          paid_basic_amount: Number(paidBasic.toFixed(2)),
          paid_tax_amount: Number(paidTax.toFixed(2)),
          paid_total_amount: Number(paidTotal.toFixed(2)),
          
          // Pending amounts
          pending_basic_amount: Number(pendingBasic.toFixed(2)),
          pending_tax_amount: Number(pendingTax.toFixed(2)),
          pending_total_amount: Number(pendingTotal.toFixed(2)),
          
          // Remaining amounts (same as pending)
          remaining_basic_amount: Number(pendingBasic.toFixed(2)),
          remaining_tax_amount: Number(pendingTax.toFixed(2)),
          remaining_total_amount: Number(pendingTotal.toFixed(2)),
          
          // Installment counts
          installments_total: totalInstallments,
          installments_completed: completedInstallments,
          installments_pending: pendingInstallments,
          installments_label: `${completedInstallments}/${totalInstallments}`,
          
          // Client info
          client_id: plain.client_id,
        },
      };

      return this.sendSuccess(
        res,
        {
          success: true,
          message: "Billing request fetched successfully",
          data: enriched,
        },
        "Billing request fetched successfully",
        200
      );
    } catch (err: any) {
      console.error("❌ [BILLING] Error in getById:", err);
      return this.sendError(
        res,
        {
          success: false,
          message: "Internal server error",
          error: err.message,
        },
        "Internal server error",
        500
      );
    }
  };
}

export default new BillingRequestController();