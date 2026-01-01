import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth } from "../middleware/auth";
import { Sequelize, Op } from "sequelize";
import { sequelize } from "../models";
// Import models
import { Quotation } from "../models/Quotation";
import { Boq } from "../models/boq";
import { Client } from "../models/Client";
import { SystemUser } from "../models/SystemUser";

// Import controllers
import SystemUserController from "../controllers/CompressCrmController";
import ClientController from "../controllers/clientController";
import VendorPrintController from "../controllers/VendorPrintController";
import ClientPrint from "../controllers/PrintClientController";
import GSTController from "../controllers/gstController";
import TDSController from "../controllers/TDSController";
import Estimate from "../controllers/estimateController";


// Import other controllers
import {
  getAllAccounts, createAccount, updateAccount, listAccountsByBank, getLatestAccount,
} from "../controllers/BankController";

import {
  listCreditSettlements, listDebitSettlements, latestCreditSettlement,
  latestDebitSettlement, createSettlement,
} from "../controllers/accountsettelmentcontroller";

import {
  createtransferservice, listTransfers, latestTransfer,
} from "../controllers/transferController";

import {
  createVendor, getVendors, deleteVendor, updateVendor,
  searchVendors, getVendorById,
} from "../controllers/vendorcontroller";

import {
  createMarket, listMarkets, listPendingMarkets, listConvertedMarkets,
} from "../controllers/marketcontroller";

import {
  createTicket, listTickets, searchTickets, updateTicket,
  getNextCallerId, createFollowup, resolveTicketId,
  withUpload, uploadTicketMedia, getTicketFilesAndSignatures, checkTicketHasMedia, updateTicketStatus, createNote,
} from "../controllers/ticketerpController";

import {
  createorder, getAllOrders, updateorder, deleteorder,
  searchByVendorOrCompany, printPoHtml, printPoPdf,
  printPoPdfByQuery, printPoPdfFromBody, convertToBill, uploadSignedPoFile, signedPoUpload,
} from "../controllers/purchaseordersController";

import {
  createHVACTicket, getHVACTicketById, listHVACTickets, updateHVACTicket,
  closeHVACTicket, deleteHVACTicket, resolveHVACTicketId, withHVACUpload,
  uploadHVACTicketMedia, searchHVACTickets, getNextHVACCallerId,
  createHVACFollowup, getHVACTicketFilesAndSignatures, checkHVACTicketHasMedia, checkHVACTicketStatusEligibility, updateHVACTicketStatus, getHVACTicketMediaCount,
  createServiceReportAndReturnUrl, streamServiceReportPdf,
} from "../controllers/hvacticketController";

import {
  listInvoices, getInvoiceById, printInvoicePdf, printInvoicePdfByQuery,
  printInvoicePdfFromBody, updatePaymentStatus, updatePaymentDetails,
  bulkUpdatePaymentStatus, setPaymentStatusByGet, getAllPayments,
  listPartialPayment, printPaymentSlipPdf, printPaymentSlipPdfFromBody,
  printPaymentSlipHtml, searchInvoicesByClientName, checkTdsStatus,
} from "../controllers/invoiceController";


import {
  listBills, createVendorPayment, printBillPdf,
} from "../controllers/OrderBillController";

import { VendorLedgerController } from "../controllers/vendorLedgerController";

import {
  listVendorBillPayments, createVendorBillPayment, getBankAccounts,
  validatePaymentAmount, getBillPaymentStatus, printVendorPaymentReceipt, uploadVendorPaymentAttachment, serveVendorPaymentAttachment, checkAttachmentExists, sendToPaymentClearance,
} from "../controllers/vendorBillPaymentsController";

import {
  createBoq, updateBoq, getAllBoqs, getBoqById, deleteBoq,
  searchBoqs, updateBoqStatus, printBoqHtml, printBoqPdf,
  printBoqPdfByQuery, printBoqPdfFromBody,
} from "../controllers/boqController";

import { QuotationController } from "../controllers/quotationController";

import {
  checkServiceReportData,
  createServiceReportData,
  generateServiceReport,
  previewServiceReportHtml,
  serviceReportWorkflow
} from '../controllers/serviceReportController';

import {
  checkHvacServiceReportData,
  createHvacServiceReportData,
  generateHvacServiceReport,
  previewHvacServiceReportHtml,
  hvacServiceReportWorkflow
} from "../controllers/hvacServiceReportController";
import RoleController from "../controllers/RoleController";
import PermissionAssignmentController from "../controllers/PermissionAssignmentController";
import PermissionController from "../controllers/PermissionController";
import { vendorPaymentClearanceController } from '../controllers/vendorPaymentClearance.controller';

const SystemUserRouter = express.Router();

// Initialize controllers
const systemUserController = new SystemUserController();
const clientController = new ClientController();
const quotationController = new QuotationController();
const roleController = new RoleController(sequelize);
const permissionAssignmentController = new PermissionAssignmentController(sequelize);
const permissionController = new PermissionController(sequelize);
// ==================== MULTER CONFIGURATIONS ====================

// General file upload for expenses, etc.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});
const upload = multer({ storage });

// Loan documents upload configuration
const LOAN_UPLOAD_DIR = path.join(process.cwd(), "uploads", "loan-documents");
fs.mkdirSync(LOAN_UPLOAD_DIR, { recursive: true });

const loanUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, LOAN_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
      cb(null, `${timestamp}_${safeName}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png',
      'image/webp', 'application/pdf'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only images and PDFs are allowed.`));
    }
  }
});

// Quotation file upload configuration
const QUOTATION_UPLOAD_DIR = path.join(process.cwd(), "uploads", "quotations");
fs.mkdirSync(QUOTATION_UPLOAD_DIR, { recursive: true });

const quotationUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, QUOTATION_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
      cb(null, `${timestamp}_${safeName}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only PDF, Word, Excel, and image files are allowed.`));
    }
  }
});

// Vendor payment attachment upload configuration
const ATTACHMENT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "attachments");
fs.mkdirSync(ATTACHMENT_UPLOAD_DIR, { recursive: true });

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, ATTACHMENT_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
      cb(null, `${timestamp}_${safeName}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png',
      'image/webp', 'application/pdf'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only images and PDFs are allowed.`));
    }
  }
});

// ==================== ROUTES ====================

/* -------------------------- SYSTEM USERS -------------------------- */
SystemUserRouter.post("/login", systemUserController.authLogin);
SystemUserRouter.post("/register", requireAuth, systemUserController.createUser);
SystemUserRouter.post("/generateqrcode", systemUserController.generateQRCode);
SystemUserRouter.get("/getuser", systemUserController.getUserDetails);
SystemUserRouter.get("/getalluser", systemUserController.getAllUsers);
SystemUserRouter.get("/getroles", systemUserController.getRoles);
SystemUserRouter.post("/updateuser", systemUserController.UpdateUser);
SystemUserRouter.post("/deleteuser", systemUserController.deleteUser);
SystemUserRouter.post("/logout", systemUserController.logout);
SystemUserRouter.post("/verifytotp", systemUserController.verifyTOTP);
SystemUserRouter.get('/admin-users-with-totp', requireAuth, systemUserController.getAdminUsersWithTOTP);
SystemUserRouter.post('/verify-admin-totp', requireAuth, systemUserController.verifyAdminTOTP);
SystemUserRouter.post('/verify-any-admin-totp', requireAuth, systemUserController.verifyAnyAdminTOTP);
SystemUserRouter.post("/fetchsecret", systemUserController.fetchSecretKey);
SystemUserRouter.post("/deletesecert", systemUserController.deleteSecretKey);
SystemUserRouter.post("/resetpassword", systemUserController.resetPassword);
SystemUserRouter.post("/loguseractivity", systemUserController.logUserActivity);
SystemUserRouter.get("/getallactivites", systemUserController.getAllUserActivities);
SystemUserRouter.get("/getallusername", systemUserController.getAllUserNamesAndUUIDs);
SystemUserRouter.post("/filteruseractivites", systemUserController.filterUserActivities);
SystemUserRouter.get("/getalldeleteduser", systemUserController.getAllDeletedUsers);

/* ----------------------------- BANK ------------------------------- */
SystemUserRouter.get("/getallaccounts", getAllAccounts);
SystemUserRouter.post("/createaccount", createAccount);
SystemUserRouter.post("/updateaccount", updateAccount);
SystemUserRouter.get("/listaccountsByBank", listAccountsByBank);
SystemUserRouter.get("/getlatestaccount", getLatestAccount);

/* --------------------- SETTLEMENTS / TRANSFERS -------------------- */
SystemUserRouter.post("/createsettlement", createSettlement);
SystemUserRouter.get("/settlements/credits", listCreditSettlements);
SystemUserRouter.get("/settlements/debits", listDebitSettlements);
SystemUserRouter.get("/settlements/credits/latest", latestCreditSettlement);
SystemUserRouter.get("/settlements/debits/latest", latestDebitSettlement);
SystemUserRouter.get("/listtransfers", listTransfers);
SystemUserRouter.get("/latesttransfer", latestTransfer);
SystemUserRouter.post("/createtransferservice", createtransferservice);


/* ----------------------------- VENDORS ---------------------------- */
SystemUserRouter.post("/createvendor", createVendor);
SystemUserRouter.put("/updatevendor/:id", updateVendor);
SystemUserRouter.get("/searchvendors", searchVendors);
SystemUserRouter.get("/listvendors", getVendors);
SystemUserRouter.post("/deletevendor", deleteVendor);
SystemUserRouter.get("/getvendorbyid", getVendorById);

/* ----------------------------- MARKETS ---------------------------- */
SystemUserRouter.post("/createmarket", createMarket);
SystemUserRouter.get("/listmarkets", listMarkets);
SystemUserRouter.get("/listpendingmarkets", listPendingMarkets);
SystemUserRouter.get("/listconvertedmarkets", listConvertedMarkets);

/* ----------------------------- TICKETS ---------------------------- */
SystemUserRouter.post("/createticket", createTicket);
SystemUserRouter.get("/listtickets", listTickets);
SystemUserRouter.get("/getnextcallerid", getNextCallerId);
SystemUserRouter.post("/createfollowup", createFollowup);
SystemUserRouter.post(
  "/uploadticketmedia/:ticket_id?",
  resolveTicketId,
  withUpload,
  uploadTicketMedia
);
SystemUserRouter.get("/getticketassets/:ticketId", getTicketFilesAndSignatures);
SystemUserRouter.get("/searchtickets", searchTickets);
SystemUserRouter.post("/updateticket", updateTicket);
SystemUserRouter.get("/check-ticket-media/:ticketId", checkTicketHasMedia);
SystemUserRouter.post("/tickets/:ticketId/status", updateTicketStatus);
SystemUserRouter.post("/notes", createNote);

/* --------------------------- HVAC TICKETS -------------------------- */
SystemUserRouter.post("/createhvacticket", createHVACTicket);
SystemUserRouter.get("/hvac/tickets/:id", getHVACTicketById);
SystemUserRouter.get("/listhvactickets", listHVACTickets);
SystemUserRouter.get("/gethvacnextcallerid", getNextHVACCallerId);
SystemUserRouter.post("/createhvacfollowup", createHVACFollowup);
SystemUserRouter.post(
  "/uploadhvacticketmedia/:hvac_ticket_id?",
  resolveHVACTicketId,
  withHVACUpload,
  uploadHVACTicketMedia
);
SystemUserRouter.get("/searchhvactickets", searchHVACTickets);
SystemUserRouter.post("/updatehvacticket", updateHVACTicket);
SystemUserRouter.post("/closehvacticket", closeHVACTicket);
SystemUserRouter.post("/deletehvacticket", deleteHVACTicket);
SystemUserRouter.get("/getHVACticketassets/:ticketId", getHVACTicketFilesAndSignatures);
SystemUserRouter.post("/servicereports", createServiceReportAndReturnUrl);
SystemUserRouter.get("/servicereports/:ticketId/:file", streamServiceReportPdf);

/* ------------------------------ LOANS ----------------------------- */

/* ------------------------ PURCHASE ORDERS ------------------------- */
SystemUserRouter.post("/createorder", requireAuth, createorder);
SystemUserRouter.get("/getallorder", getAllOrders);
SystemUserRouter.post("/updateorder", requireAuth, updateorder);
SystemUserRouter.post("/deleteorder", deleteorder);
SystemUserRouter.post("/searchpurches", searchByVendorOrCompany);
SystemUserRouter.get("/purchase-orders/:id/invoice", printPoHtml);
SystemUserRouter.get("/purchase-orders/:id/invoice.pdf", printPoPdf);
SystemUserRouter.get("/purchase-orderspdf", printPoPdfByQuery);
SystemUserRouter.post("/purchase-orderspdf", printPoPdfFromBody);
SystemUserRouter.post("/po/:id/convert-to-bill", requireAuth, convertToBill);
SystemUserRouter.post(
  "/purchase-orders/:id/upload-signed",
  requireAuth,
  signedPoUpload.single("signed_po"),   // field name in Postman / frontend
  uploadSignedPoFile
);

/* ----------------------------- CLIENTS ---------------------------- */
SystemUserRouter.post("/createclient", requireAuth, clientController.createClient);
SystemUserRouter.get("/getclients", clientController.getClients);
SystemUserRouter.post("/deleteclient", clientController.deleteClient);
SystemUserRouter.post("/updateclient", requireAuth, clientController.updateClient);
SystemUserRouter.get("/getclientbyname", clientController.getClientByName);
SystemUserRouter.get("/getclientsbyvendor", clientController.getClientsByVendor);

/* ---------------------------- ESTIMATES --------------------------- */
SystemUserRouter.post("/createestimate", requireAuth, Estimate.createEstimate);
SystemUserRouter.post("/updateestimate", requireAuth, Estimate.updateEstimate);
SystemUserRouter.get("/getallestimates", Estimate.getAllEstimates);
SystemUserRouter.post("/deleteestimate", Estimate.deleteEstimate);
SystemUserRouter.get("/getestimateid", Estimate.getEstimateById);
SystemUserRouter.put("/estimate/:id", Estimate.updateEstimate);
SystemUserRouter.delete("/estimate/:id", Estimate.deleteEstimate);
SystemUserRouter.post("/estimate/:id/items", (req, res) => (Estimate as any).addItemToEstimate?.(req, res));
SystemUserRouter.get("/estimate/:id/items", (req, res) => (Estimate as any).getItemsByEstimateId?.(req, res));
SystemUserRouter.put("/estimate/:id/items/:itemId", (req, res) => (Estimate as any).updateEstimateItem?.(req, res));
SystemUserRouter.delete("/estimate/:id/items/:itemId", (req, res) => (Estimate as any).deleteEstimateItem?.(req, res));
SystemUserRouter.get("/estimate/:id/html", Estimate.printEstimateHtml);
SystemUserRouter.get("/estimatequote", Estimate.printEstimatePdf);
SystemUserRouter.post("/estimate/:id/convert", requireAuth, (req, res) => (Estimate as any).convertToPI?.(req, res));
SystemUserRouter.get("/status", Estimate.status);
SystemUserRouter.get("/estimates/search", Estimate.searchEstimates);
SystemUserRouter.post('/estimate/:id/status', requireAuth, Estimate.updateEstimateStatus);

/* ----------------------------- INVOICES --------------------------- */
SystemUserRouter.get("/listinvoices", listInvoices);
SystemUserRouter.get("/invoicespdf", printInvoicePdfByQuery);
SystemUserRouter.get("/invoices/:id/print.pdf", printInvoicePdf);
SystemUserRouter.post("/invoicespdf", printInvoicePdfFromBody);
SystemUserRouter.get("/invoices/:id", getInvoiceById);
SystemUserRouter.patch("/invoices/:id/payment-status", updatePaymentStatus);
SystemUserRouter.patch("/invoices/payment-status/bulk", bulkUpdatePaymentStatus);
SystemUserRouter.post("/payments/update/:invoiceId", requireAuth, updatePaymentDetails);
SystemUserRouter.get("/paymentsattus", setPaymentStatusByGet);
SystemUserRouter.get("/getallpayments", getAllPayments);
SystemUserRouter.get("/partialpayment", listPartialPayment);
SystemUserRouter.get("/payments/:payment_id/payslip.html", printPaymentSlipHtml);
SystemUserRouter.get("/payments/:payment_id/payslip.pdf", printPaymentSlipPdf);
SystemUserRouter.post("/paymentslip", printPaymentSlipPdfFromBody);
SystemUserRouter.get("/invoices/search", searchInvoicesByClientName);
SystemUserRouter.get('/payments/invoice/:invoice_id/tds-check', checkTdsStatus);

/* ------------------------- PURCHASE REQUESTS ---------------------- */
SystemUserRouter.get("/listpurchaserequests", listPi);
SystemUserRouter.get("/purchaserequest/:id/print.html", printPiHtml);
SystemUserRouter.get("/purchaserequest/:id/print.pdf", printPiPdf);
SystemUserRouter.post("/createinvoicefrompi", createInvoiceFromPi);
SystemUserRouter.get("/pi/search/by-client", searchPiByCompanyExact);

/* --------------------------- GST / TDS ---------------------------- */
SystemUserRouter.get("/gstrecords", GSTController.listGST);
SystemUserRouter.post("/paygst", requireAuth, GSTController.payGST);
SystemUserRouter.get("/tds", TDSController.listTDS);
SystemUserRouter.post("/paytds", requireAuth, TDSController.payTDS);
SystemUserRouter.get("/tds/search", TDSController.searchTDS);


/* -------------------------- CLIENT PRINTS ------------------------- */
SystemUserRouter.get("/estimate/:id/pdf", ClientPrint.renderEstimatePDF);
SystemUserRouter.get("/invoice/:id/pdf", ClientPrint.renderInvoicePDF);
SystemUserRouter.get("/payment/:id/pdf", ClientPrint.renderPaymentPDF);
SystemUserRouter.get("/estimate/client/:clientId/pdf", ClientPrint.renderEstimatePDF);
SystemUserRouter.get("/invoice/client/:clientId/pdf", ClientPrint.renderInvoicePDF);
SystemUserRouter.get("/payment/client/:clientId/pdf", ClientPrint.renderPaymentPDF);
SystemUserRouter.get("/client/:clientId/activity", ClientPrint.getClientActivity);
SystemUserRouter.get("/search/clients-by-doc", ClientPrint.clientsByDoc);

/* --------------------------- ORDER BILLS -------------------------- */
SystemUserRouter.get("/getallbilllist", listBills);
SystemUserRouter.post("/vendor-payments", requireAuth, createVendorPayment);
SystemUserRouter.get("/api/bills/:id/print-pdf", printBillPdf);

SystemUserRouter.get("/list/vendor/payment", listVendorBillPayments);
SystemUserRouter.post("/vendor-bill-payments", requireAuth, createVendorBillPayment);
SystemUserRouter.get("/vendor-bill-payments/bank-accounts", getBankAccounts);
SystemUserRouter.post("/vendor-bill-payments/validate-amount", validatePaymentAmount);
SystemUserRouter.get("/vendor-bill-payments/bill-status/:bill_id", getBillPaymentStatus);
SystemUserRouter.get("/vendor-bill-payments/:payment_id/print-pdf", printVendorPaymentReceipt);
SystemUserRouter.post(
  "/vendor-bill-payments/:payment_id/attachment",
  attachmentUpload.single("attachment"),      // form field name: "attachment"
  uploadVendorPaymentAttachment
);
SystemUserRouter.post("/vendor-bill-payments/send-to-clearance", requireAuth, sendToPaymentClearance);
SystemUserRouter.get(
  "/vendor-bill-payments/:payment_id/attachment",
  serveVendorPaymentAttachment
);
SystemUserRouter.get(
  "/vendor-bill-payments/:payment_id/attachment/status",
  checkAttachmentExists
);

SystemUserRouter.get("/vendors/ledger/list", VendorLedgerController.getVendorLedgerList);
SystemUserRouter.get("/vendors/ledger/report", VendorLedgerController.getVendorLedgerReport);
SystemUserRouter.get("/vendors/ledger/print/html", VendorLedgerController.printVendorLedgerHtml);

SystemUserRouter.get("/print/vendor/po/:id", VendorPrintController.renderPurchaseOrderPDF);
SystemUserRouter.get("/print/vendor/bill/:id", VendorPrintController.renderOrderBillPDF);
SystemUserRouter.get("/print/vendor/payment/:id", VendorPrintController.renderVendorPaymentPDF);
SystemUserRouter.get("/vendor/:vendorId/activity", VendorPrintController.getVendorActivity);
SystemUserRouter.get("/vendors/by-doc", VendorPrintController.vendorsByDoc);

/* ------------------------------- BOQ ------------------------------ */
SystemUserRouter.post("/createboq", requireAuth, createBoq);
SystemUserRouter.put("/updateboq/:id", requireAuth, updateBoq);
SystemUserRouter.get("/getallboqs", getAllBoqs);
SystemUserRouter.get("/getboq/:id", getBoqById);
SystemUserRouter.delete("/deleteboq/:id", deleteBoq);
SystemUserRouter.get("/searchboqs", searchBoqs);
SystemUserRouter.post("/updateboqstatus/:id?", requireAuth, updateBoqStatus);
SystemUserRouter.get("/boq/:id/print.html", printBoqHtml);
SystemUserRouter.get("/boq/:id/print.pdf", printBoqPdf);
SystemUserRouter.get("/boqpdf", printBoqPdfByQuery);
SystemUserRouter.post("/boqpdf", printBoqPdfFromBody);

/* ------------------------ LOAN ACCOUNTS ------------------------ */





/* ------------------- LOAN TRANSACTIONS ROUTES ------------------- */
/* ==================== QUOTATION ROUTES ==================== */

/* ------------------------- QUOTATIONS ------------------------- */
// Upload multiple quotations for a BOQ
SystemUserRouter.post(
  "/quotations/upload",
  requireAuth,
  quotationUpload.any(),
  quotationController.uploadQuotations
);

// Get all quotations for a specific BOQ
SystemUserRouter.get(
  "/quotations/boq/:boqId",
  requireAuth,
  quotationController.getQuotationsByBoq
);

// Download quotation file
SystemUserRouter.get(
  "/quotations/file/:id",
  requireAuth,
  quotationController.getQuotationFile
);

// Update quotation status
SystemUserRouter.patch(
  "/quotations/:id/status",
  requireAuth,
  quotationController.updateQuotationStatus
);

// Delete quotation
SystemUserRouter.delete(
  "/quotations/:id",
  requireAuth,
  quotationController.deleteQuotation
);

// Get lowest quotation for a BOQ
SystemUserRouter.get(
  "/quotations/boq/:boqId/lowest",
  requireAuth,
  quotationController.getLowestQuotation
);

SystemUserRouter.get('/quotations/:id/file', quotationController.getQuotationFile);
// Get quotation by ID
SystemUserRouter.get(
  "/quotations/:id",
  requireAuth,
  async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      const quotation = await Quotation.findByPk(id, {
        include: [
          {
            model: Boq,
            as: "boq",
            attributes: ["id", "title", "boq_number", "currency"]
          },
          {
            model: Client,
            as: "client",
            attributes: ["id", "email_id", "mobile", "gstn", "address"]
          },
          {
            model: SystemUser,
            as: "creator",
            attributes: ["id", "name", "email"]
          }
        ]
      });

      if (!quotation) {
        return res.status(404).json({
          success: false,
          message: "Quotation not found"
        });
      }

      res.json({
        success: true,
        data: quotation
      });
    } catch (error: any) {
      console.error("Error fetching quotation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quotation",
        error: error.message
      });
    }
  }
);

// Search quotations
SystemUserRouter.get(
  "/quotations/search",
  requireAuth,
  async (req: express.Request, res: express.Response) => {
    try {
      const { q, boqId, clientName, companyName, status } = req.query;

      const whereClause: any = {};

      if (boqId) whereClause.boq_id = boqId;
      if (status) whereClause.status = status;

      if (q) {
        whereClause[Op.or] = [
          { client_name: { [Op.iLike]: `%${q}%` } },
          { company_name: { [Op.iLike]: `%${q}%` } },
          { file_name: { [Op.iLike]: `%${q}%` } }
        ];
      }

      if (clientName) {
        whereClause.client_name = { [Op.iLike]: `%${clientName}%` };
      }

      if (companyName) {
        whereClause.company_name = { [Op.iLike]: `%${companyName}%` };
      }

      const quotations = await Quotation.findAll({
        where: whereClause,
        include: [
          {
            model: Boq,
            as: "boq",
            attributes: ["id", "title", "boq_number", "currency"]
          },
          {
            model: Client,
            as: "client",
            attributes: ["id", "email_id", "mobile", "gstn", "address"]
          }
        ],
        order: [["created_at", "DESC"]]
      });

      res.json({
        success: true,
        data: quotations
      });
    } catch (error: any) {
      console.error("Error searching quotations:", error);
      res.status(500).json({
        success: false,
        message: "Failed to search quotations",
        error: error.message
      });
    }
  }
);

// Get quotation statistics for a BOQ
SystemUserRouter.get(
  "/quotations/boq/:boqId/stats",
  requireAuth,
  async (req: express.Request, res: express.Response) => {
    try {
      const { boqId } = req.params;

      const quotations = await Quotation.findAll({
        where: { boq_id: boqId },
        attributes: [
          "status",
          [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
          [Sequelize.fn("MIN", Sequelize.col("rate")), "min_rate"],
          [Sequelize.fn("MAX", Sequelize.col("rate")), "max_rate"],
          [Sequelize.fn("AVG", Sequelize.col("rate")), "avg_rate"]
        ],
        group: ["status"]
      });

      const totalQuotations = await Quotation.count({
        where: { boq_id: boqId }
      });

      const lowestQuotation = await Quotation.findOne({
        where: {
          boq_id: boqId,
          status: {
            [Op.ne]: 'rejected'
          }
        },
        order: [["rate", "ASC"]],
        include: [
          {
            model: Client,
            as: "client",
            attributes: ["id", "company", "email_id"]
          }
        ]
      });

      res.json({
        success: true,
        data: {
          statistics: quotations,
          total_quotations: totalQuotations,
          lowest_quotation: lowestQuotation
        }
      });
    } catch (error: any) {
      console.error("Error fetching quotation statistics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quotation statistics",
        error: error.message
      });
    }
  }
);

SystemUserRouter.get('/service-reports/check/:ticketId', checkServiceReportData);
SystemUserRouter.post('/service-reports/data/:ticketId', createServiceReportData);
SystemUserRouter.get('/service-reports/generate/:ticketId', generateServiceReport);
SystemUserRouter.get('/service-reports/preview/:ticketId', previewServiceReportHtml);
SystemUserRouter.get('/service-reports/workflow/:ticketId', serviceReportWorkflow);

SystemUserRouter.post("/hvac-service-reports/data/:ticketId", createHvacServiceReportData);
SystemUserRouter.get("/hvac-service-reports/check/:ticketId", checkHvacServiceReportData);
SystemUserRouter.get("/hvac-service-reports/workflow/:ticketId", hvacServiceReportWorkflow);
SystemUserRouter.get("/hvac-service-reports/preview/:ticketId", previewHvacServiceReportHtml);
SystemUserRouter.get("/hvac-service-reports/generate/:ticketId", generateHvacServiceReport);
SystemUserRouter.get('/hvac-tickets/:ticketId/check-media', checkHVACTicketHasMedia);
SystemUserRouter.get('/hvac-tickets/:ticketId/status-eligibility', checkHVACTicketStatusEligibility);
SystemUserRouter.post('/hvac-tickets/:ticketId/status', updateHVACTicketStatus);
SystemUserRouter.get('/hvac-tickets/:ticketId/media-count', getHVACTicketMediaCount);


/* ------------------------------ ROLES ------------------------------ */
SystemUserRouter.post("/roles", roleController.createRole);
SystemUserRouter.get("/roles", roleController.getRoles);
SystemUserRouter.get("/roles/:id", roleController.getRoleById);
SystemUserRouter.put("/roles/:id", roleController.updateRole);
SystemUserRouter.delete("/roles/:id", roleController.deleteRole);

SystemUserRouter.post("/role-permissions", permissionAssignmentController.assignPermissionsToRole);
SystemUserRouter.get("/role-permissions/:role_id", permissionAssignmentController.getPermissionsByRole);
SystemUserRouter.get("/role-permissions/:role_id/all", permissionAssignmentController.getAllPermissionsWithStatus);
SystemUserRouter.get("/permissions", permissionController.getAllPermissions);
SystemUserRouter.get('/role-permissions/:role_id/by-module', permissionAssignmentController.getPermissionsByModuleForRole);


// SystemUserRouter.get('/getallpaymentclearances', vendorPaymentClearanceController.getPaymentClearances);
// SystemUserRouter.get('/getpaymentclearance/:id', vendorPaymentClearanceController.getPaymentClearanceById);
// SystemUserRouter.post('/createpaymentclearance', vendorPaymentClearanceController.createPaymentClearance);
SystemUserRouter.get('/getallpaymentclearances', vendorPaymentClearanceController.getPaymentClearances);
SystemUserRouter.get('/getpaymentclearance/:id', vendorPaymentClearanceController.getPaymentClearanceById);
SystemUserRouter.post('/createpaymentclearance', vendorPaymentClearanceController.createPaymentClearance);
// Add the update route that your frontend is calling
SystemUserRouter.post('/vendor-payment-clearances/update-existing', vendorPaymentClearanceController.createPaymentClearance);

export default SystemUserRouter;