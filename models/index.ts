// src/models/index.ts
import { Sequelize } from "sequelize";
import { db } from "../database/DBService";

// ── Model initializers (1 file = 1 init function) ──────────────────────────────
import { initAccountModel } from "./Banks";
import { initSystemUserModel } from "./SystemUser";
import { initUserRoleModel } from "./UserRole";
import { initRoleModel } from "./Role";
import { initPermissionModel } from "./Permission";
import { initRolePermissionModel } from "./RolePermission";
import { initSystemUserSecretModel } from "./SystemUserSecret";

import { initMarketModel } from "./market";
import { initTicketerpModel } from "./ticketerp";
import { initVendorModel } from "./vendor";
import { initPurchaseOrderModel } from "./purchaseorder";
import { initOrderItemModel } from "./orderitem";
import { initAccountTransfer } from "./AccountTransfer";
import { initClientModel } from "./Client";
import { initTicketFollowupModel } from "./ticket_followup";
import { initEstimateModel } from "./Estimate";
import { initEstimateItemModel } from "./EstimateItem";

import { initHVACTicketModel } from "./hvacticket";
import { initHVACTicketMediaModel } from "./hvac_ticket_media";
import { initHVACTicketFollowupModel } from "./hvac_ticket_followup";
import { initTicketMediaModel } from "./ticket_media";

import { initPiModel } from "./Pi";
import { initPiItemModel } from "./PiItem";
import { initInvoiceModel } from "./Invoice";
import { initInvoiceItemModel } from "./InvoiceItem";
import { initGstRecordModel } from "./gst_record";
import { initInvoicePaymentModel } from "./invoicePayment";
import TdsRecord from "./tds_records";

import { initOrderBillModel } from "./OrderBill";
import { initVendorBillPaymentModel } from "./VendorBillPayment";

import { initVendorDocumentModel } from "./VendorDocument";

import { initBoqModel } from "./boq";
import { initBoqItemModel } from "./boqitem";
import { initQuotationModel } from "./Quotation";

import { initErpServiceReportModel } from "./erp_service_report";
import { initHvacErpServiceReportModel } from "./hvac_erp_service_report";

import initCategoryModel from "./Category";
import { initJobModel } from "./Job";
import { initPendingMaterialModel } from "./PendingMaterial";

// AMC Contract models

import { initVendorPaymentClearanceModel } from "./VendorPaymentClearance";
import { initBoqItemFileModel } from "./boq-item-file";

const sequelize = db.write;

// ── 1) Initialize all models ───────────────────────────────────────────────────
const dbModels: any = {
  Sequelize,
  sequelize,

  // Core / AuthZ
  SystemUser: initSystemUserModel(sequelize),
  UserRole: initUserRoleModel(sequelize),
  Role: initRoleModel(sequelize),
  Permission: initPermissionModel(sequelize),
  RolePermission: initRolePermissionModel(sequelize),
  SystemUserSecret: initSystemUserSecretModel(sequelize),

  // Banking / Accounts
  Account: initAccountModel(sequelize),
  AccountTransfer: initAccountTransfer(sequelize),

  Market: initMarketModel(sequelize),
  TicketERP: initTicketerpModel(sequelize),
  TicketFollowup: initTicketFollowupModel(sequelize),
  TicketMedia: initTicketMediaModel(sequelize),

  Category: initCategoryModel(sequelize),
  Job: initJobModel(sequelize),
  PendingMaterial: initPendingMaterialModel(sequelize),

  Vendor: initVendorModel(sequelize),
  PurchaseOrder: initPurchaseOrderModel(sequelize),
  OrderItem: initOrderItemModel(sequelize),

  Client: initClientModel(sequelize),

  Estimate: initEstimateModel(sequelize),
  EstimateItem: initEstimateItemModel(sequelize),

  Pi: initPiModel(sequelize),
  PiItem: initPiItemModel(sequelize),

  Invoice: initInvoiceModel(sequelize),
  InvoiceItem: initInvoiceItemModel(sequelize),
  InvoicePayment: initInvoicePaymentModel(sequelize),

  HVACTicket: initHVACTicketModel(sequelize),
  HVACTicketMedia: initHVACTicketMediaModel(sequelize),
  HVACTicketFollowup: initHVACTicketFollowupModel(sequelize),

  GstRecord: initGstRecordModel(sequelize),
  TdsRecord: TdsRecord(sequelize),

  OrderBill: initOrderBillModel(sequelize),
  VendorBillPayment: initVendorBillPaymentModel(sequelize),

  VendorDocument: initVendorDocumentModel(sequelize),


  // BOQ MODELS
  Boq: initBoqModel(sequelize),
  BoqItem: initBoqItemModel(sequelize),
  Quotation: initQuotationModel(sequelize),


  ErpServiceReport: initErpServiceReportModel(sequelize),
  HvacErpServiceReport: initHvacErpServiceReportModel(sequelize),

  VendorPaymentClearance: initVendorPaymentClearanceModel(sequelize),
  BoqItemFile: initBoqItemFileModel(sequelize),
};

// ── 2) Associations ───────────────────────────────────────────────────────────

// ==================== RBAC ASSOCIATIONS ====================
dbModels.Role.belongsToMany(dbModels.Permission, {
  through: dbModels.RolePermission,
  foreignKey: "role_id",
  otherKey: "permission_id",
  as: "permissions",
});
dbModels.Permission.belongsToMany(dbModels.Role, {
  through: dbModels.RolePermission,
  foreignKey: "permission_id",
  otherKey: "role_id",
  as: "roles",
});

dbModels.SystemUser.belongsToMany(dbModels.Role, {
  through: dbModels.UserRole,
  foreignKey: "system_user_id",
  otherKey: "role_id",
  as: "roles",
});
dbModels.Role.belongsToMany(dbModels.SystemUser, {
  through: dbModels.UserRole,
  foreignKey: "role_id",
  otherKey: "system_user_id",
  as: "users",
});

// ==================== JOB & CATEGORY ASSOCIATIONS ====================
// A Job (if it's a JOB_SERVICE) can belong to a Category via job_no
// IMPORTANT: This assumes `job_no` is a UNIQUE key in the `category` table.
dbModels.Job.belongsTo(dbModels.Category, {
  foreignKey: "job_no",
  targetKey: "job_no",
  as: "categoryDetails",
});

// A Category can have many Jobs associated with it via job_no
dbModels.Category.hasMany(dbModels.Job, {
  foreignKey: "job_no",
  sourceKey: "job_no",
  as: "jobs",
});

dbModels.PendingMaterial.belongsTo(dbModels.Category, {
  foreignKey: "job_no",
  targetKey: "job_no",
  as: "category",
});

dbModels.Category.hasMany(dbModels.PendingMaterial, {
  foreignKey: "job_no",
  sourceKey: "job_no",
  as: "pendingMaterials",
});

dbModels.SystemUser.hasMany(dbModels.SystemUserSecret, {
  foreignKey: "user_id",
  as: "secrets",
});
dbModels.SystemUserSecret.belongsTo(dbModels.SystemUser, {
  foreignKey: "user_id",
  as: "user",
});

// ==================== CLIENT ASSOCIATIONS ====================
dbModels.Client.hasMany(dbModels.TicketERP, {
  foreignKey: "client_id",
  as: "tickets",
  onDelete: "SET NULL",
});
dbModels.Client.hasMany(dbModels.Estimate, {
  foreignKey: "client_id",
  as: "estimates",
  onDelete: "SET NULL",
});
// ✅ CRITICAL FIX: Add Pi association from Client side
dbModels.Client.hasMany(dbModels.Pi, {
  foreignKey: "client_id",
  as: "pis",
  onDelete: "SET NULL",
});
dbModels.Client.hasMany(dbModels.Invoice, {
  foreignKey: "client_id",
  as: "invoices",
  onDelete: "SET NULL",
});
dbModels.Client.hasMany(dbModels.HVACTicket, {
  foreignKey: "client_id",
  as: "hvacTickets",
  onDelete: "SET NULL",
});
dbModels.Client.hasMany(dbModels.ErpServiceReport, {
  foreignKey: "client_id",
  as: "erpServiceReports",
  onDelete: "SET NULL",
});

// ==================== SYSTEMUSER ASSOCIATIONS ====================
dbModels.SystemUser.hasMany(dbModels.TicketERP, {
  foreignKey: "created_by",
  as: "createdTickets",
});
dbModels.SystemUser.hasMany(dbModels.Estimate, {
  foreignKey: "created_by",
  as: "estimates",
});
dbModels.SystemUser.hasMany(dbModels.Pi, {
  foreignKey: "created_by",
  as: "pis",
});
dbModels.SystemUser.hasMany(dbModels.Invoice, {
  foreignKey: "created_by",
  as: "invoices",
});
dbModels.SystemUser.hasMany(dbModels.InvoicePayment, {
  foreignKey: "created_by",
  as: "createdPayments",
});
dbModels.SystemUser.hasMany(dbModels.PurchaseOrder, {
  foreignKey: "created_by",
  as: "purchaseOrders",
});
dbModels.SystemUser.hasMany(dbModels.OrderBill, {
  foreignKey: "created_by",
  as: "orderBills",
});
dbModels.SystemUser.hasMany(dbModels.VendorBillPayment, {
  foreignKey: "created_by",
  as: "vendorCreatedPayments",
});
dbModels.SystemUser.hasMany(dbModels.Boq, {
  foreignKey: "created_by",
  as: "boqs",
});
dbModels.SystemUser.hasMany(dbModels.Boq, {
  foreignKey: "updated_by",
  as: "updatedBoqs",
});
dbModels.SystemUser.hasMany(dbModels.Quotation, {
  foreignKey: "created_by",
  as: "createdQuotations",
});
dbModels.SystemUser.hasMany(dbModels.Quotation, {
  foreignKey: "updated_by",
  as: "updatedQuotations",
});
dbModels.SystemUser.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "created_by",
  as: "createdVendorPaymentClearances",
});
dbModels.SystemUser.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "updated_by",
  as: "updatedVendorPaymentClearances",
});
dbModels.SystemUser.hasMany(dbModels.ErpServiceReport, {
  foreignKey: "created_by",
  as: "createdErpServiceReports",
});
dbModels.SystemUser.hasMany(dbModels.HvacErpServiceReport, {
  foreignKey: "created_by",
  as: "createdHvacErpServiceReports",
});

// ==================== TICKET ERP ASSOCIATIONS ====================
dbModels.TicketERP.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client",
  onDelete: "SET NULL",
});
dbModels.TicketERP.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "creator",
  onDelete: "SET NULL",
});
dbModels.TicketERP.hasMany(dbModels.TicketFollowup, {
  foreignKey: "ticket_id",
  as: "followups",
  onDelete: "CASCADE",
});
dbModels.TicketERP.hasMany(dbModels.TicketMedia, {
  foreignKey: "ticket_id",
  as: "media",
  onDelete: "CASCADE",
});
dbModels.TicketERP.hasMany(dbModels.ErpServiceReport, {
  foreignKey: "erp_id",
  as: "serviceReports",
  onDelete: "CASCADE",
});

dbModels.TicketFollowup.belongsTo(dbModels.TicketERP, {
  foreignKey: "ticket_id",
  as: "ticket",
  onDelete: "CASCADE",
});

dbModels.TicketMedia.belongsTo(dbModels.TicketERP, {
  foreignKey: "ticket_id",
  as: "ticket",
  onDelete: "CASCADE",
});

// ==================== PURCHASE ORDER ASSOCIATIONS ====================
dbModels.PurchaseOrder.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendorRef",
  onDelete: "SET NULL",
});
dbModels.PurchaseOrder.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "creator",
  onDelete: "SET NULL",
});
dbModels.PurchaseOrder.hasMany(dbModels.OrderItem, {
  foreignKey: "po_id",
  as: "items",
  onDelete: "CASCADE",
});
dbModels.PurchaseOrder.hasOne(dbModels.OrderBill, {
  foreignKey: "po_id",
  as: "bill",
  onDelete: "CASCADE",
});

dbModels.Vendor.hasMany(dbModels.PurchaseOrder, {
  foreignKey: "vendor_id",
  as: "purchaseOrders",
  onDelete: "SET NULL",
});

dbModels.OrderItem.belongsTo(dbModels.PurchaseOrder, {
  foreignKey: "po_id",
  as: "purchaseOrder",
  onDelete: "CASCADE",
});

// ==================== ESTIMATE ASSOCIATIONS ====================
dbModels.Estimate.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client",
  onDelete: "SET NULL",
});
dbModels.Estimate.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});
dbModels.Estimate.hasMany(dbModels.EstimateItem, {
  foreignKey: "estimate_id",
  as: "items",
  onDelete: "CASCADE",
});
dbModels.Estimate.hasMany(dbModels.Pi, {
  foreignKey: "estimate_id",
  as: "pis",
  onDelete: "SET NULL",
});
dbModels.Estimate.hasOne(dbModels.Invoice, {
  foreignKey: "estimate_id",
  as: "invoice",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

dbModels.EstimateItem.belongsTo(dbModels.Estimate, {
  foreignKey: "estimate_id",
  as: "estimate",
  onDelete: "CASCADE",
});

// ==================== PI ASSOCIATIONS ====================
// ✅ CRITICAL FIX: Keep only ONE association between Pi and Client
dbModels.Pi.belongsTo(dbModels.Estimate, {
  foreignKey: "estimate_id",
  as: "estimate",
  onDelete: "SET NULL",
});
dbModels.Pi.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client", // ✅ MUST BE "client"
  onDelete: "SET NULL",
});
dbModels.Pi.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});
dbModels.Pi.hasMany(dbModels.PiItem, {
  foreignKey: "pi_id",
  as: "items",
  onDelete: "CASCADE",
});
// ✅ CRITICAL FIX: Add Pi to Invoice association
dbModels.Pi.hasOne(dbModels.Invoice, {
  foreignKey: "pi_id",
  as: "invoice",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

dbModels.PiItem.belongsTo(dbModels.Pi, {
  foreignKey: "pi_id",
  as: "pi",
  onDelete: "CASCADE",
});

// ==================== INVOICE ASSOCIATIONS ====================
dbModels.Invoice.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client",
  onDelete: "SET NULL",
});
dbModels.Invoice.belongsTo(dbModels.Estimate, {
  foreignKey: "estimate_id",
  as: "estimate",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
// ✅ CRITICAL FIX: Add Pi association to Invoice
dbModels.Invoice.belongsTo(dbModels.Pi, {
  foreignKey: "pi_id",
  as: "pi",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
dbModels.Invoice.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});
dbModels.Invoice.hasMany(dbModels.InvoiceItem, {
  foreignKey: "invoice_id",
  as: "items",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
dbModels.Invoice.hasMany(dbModels.InvoicePayment, {
  foreignKey: "invoice_id",
  as: "payments",
  onDelete: "CASCADE",
});
dbModels.Invoice.belongsTo(dbModels.Account, {
  foreignKey: "account_id",
  as: "account",
  onDelete: "SET NULL",
});

dbModels.InvoiceItem.belongsTo(dbModels.Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
  onDelete: "CASCADE",
});

// ==================== INVOICE PAYMENT ASSOCIATIONS ====================
dbModels.InvoicePayment.belongsTo(dbModels.Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
  onDelete: "CASCADE",
});
dbModels.InvoicePayment.belongsTo(dbModels.Account, {
  foreignKey: "account_id",
  as: "account",
  onDelete: "SET NULL",
});
dbModels.InvoicePayment.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});

dbModels.Account.hasMany(dbModels.InvoicePayment, {
  foreignKey: "account_id",
  as: "invoicePayments",
});

// ==================== HVAC TICKET ASSOCIATIONS ====================
dbModels.HVACTicket.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client",
  onDelete: "SET NULL",
});
dbModels.HVACTicket.hasMany(dbModels.HVACTicketMedia, {
  foreignKey: "hvac_ticket_id",
  as: "media",
  onDelete: "CASCADE",
});
dbModels.HVACTicket.hasMany(dbModels.HVACTicketFollowup, {
  foreignKey: "hvac_ticket_id",
  as: "followups",
  onDelete: "CASCADE",
});
dbModels.HVACTicket.hasOne(dbModels.HvacErpServiceReport, {
  foreignKey: "hvac_erp_id",
  as: "serviceReport",
  onDelete: "CASCADE",
});

dbModels.HVACTicketMedia.belongsTo(dbModels.HVACTicket, {
  foreignKey: "hvac_ticket_id",
  as: "ticket",
  onDelete: "CASCADE",
});

dbModels.HVACTicketFollowup.belongsTo(dbModels.HVACTicket, {
  foreignKey: "hvac_ticket_id",
  as: "ticket",
  onDelete: "CASCADE",
});

// ==================== ORDER BILL ASSOCIATIONS ====================
dbModels.OrderBill.belongsTo(dbModels.PurchaseOrder, {
  foreignKey: "po_id",
  as: "purchaseOrder",
  onDelete: "CASCADE",
});
dbModels.OrderBill.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendor",
  onDelete: "SET NULL",
});
dbModels.OrderBill.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});
dbModels.OrderBill.hasMany(dbModels.VendorBillPayment, {
  foreignKey: "bill_id",
  as: "billPayments",
  onDelete: "CASCADE",
});
dbModels.OrderBill.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "bill_id",
  as: "orderBillClearances",
  onDelete: "CASCADE",
});

dbModels.Vendor.hasMany(dbModels.OrderBill, {
  foreignKey: "vendor_id",
  as: "bills",
  onDelete: "SET NULL",
});

// ==================== VENDOR BILL PAYMENT ASSOCIATIONS ====================
dbModels.VendorBillPayment.belongsTo(dbModels.OrderBill, {
  foreignKey: "bill_id",
  as: "orderBill",
  onDelete: "CASCADE",
});
dbModels.VendorBillPayment.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendor",
  onDelete: "SET NULL",
});
dbModels.VendorBillPayment.belongsTo(dbModels.Account, {
  foreignKey: "account_id",
  as: "account",
  onDelete: "SET NULL",
});
dbModels.VendorBillPayment.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});
dbModels.VendorBillPayment.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "vendor_bill_payment_id",
  as: "vendorBillPaymentClearances",
  onDelete: "CASCADE",
});

dbModels.Vendor.hasMany(dbModels.VendorBillPayment, {
  foreignKey: "vendor_id",
  as: "vendorPayments",
  onDelete: "SET NULL",
});
dbModels.Account.hasMany(dbModels.VendorBillPayment, {
  foreignKey: "account_id",
  as: "vendorBillPayments",
});

// ==================== VENDOR DOCUMENT ASSOCIATIONS ====================
dbModels.VendorDocument.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendor",
  onDelete: "CASCADE",
});

dbModels.Vendor.hasMany(dbModels.VendorDocument, {
  foreignKey: "vendor_id",
  as: "documents",
  onDelete: "CASCADE",
});

// ==================== BOQ ASSOCIATIONS ====================
dbModels.Boq.hasMany(dbModels.BoqItem, {
  foreignKey: "boq_id",
  as: "items",
  onDelete: "CASCADE",
});
dbModels.Boq.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "creator",
  onDelete: "SET NULL",
});
dbModels.Boq.belongsTo(dbModels.SystemUser, {
  foreignKey: "updated_by",
  as: "updater",
  onDelete: "SET NULL",
});
dbModels.Boq.hasMany(dbModels.Quotation, {
  foreignKey: "boq_id",
  as: "quotations",
  onDelete: "CASCADE",
});

dbModels.BoqItem.belongsTo(dbModels.Boq, {
  foreignKey: "boq_id",
  as: "boq",
  onDelete: "CASCADE",
});

// ==================== BOQ ITEM FILE ASSOCIATIONS ====================
dbModels.BoqItem.hasMany(dbModels.BoqItemFile, {
  foreignKey: "boq_item_id",
  as: "files",
  onDelete: "CASCADE",
});

dbModels.BoqItemFile.belongsTo(dbModels.BoqItem, {
  foreignKey: "boq_item_id",
  as: "boqItem",
  onDelete: "CASCADE",
});

dbModels.BoqItemFile.belongsTo(dbModels.SystemUser, {
  foreignKey: "uploaded_by",
  as: "uploader",
  onDelete: "SET NULL",
});

// ==================== QUOTATION ASSOCIATIONS ====================
dbModels.Quotation.belongsTo(dbModels.Boq, {
  foreignKey: "boq_id",
  as: "quotationBoq",
  onDelete: "CASCADE",
});
dbModels.Quotation.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendor",
  onDelete: "SET NULL",
});
dbModels.Quotation.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "creator",
  onDelete: "SET NULL",
});
dbModels.Quotation.belongsTo(dbModels.SystemUser, {
  foreignKey: "updated_by",
  as: "updater",
  onDelete: "SET NULL",
});

dbModels.Vendor.hasMany(dbModels.Quotation, {
  foreignKey: "vendor_id",
  as: "quotations",
  onDelete: "SET NULL",
});


// ==================== ERP SERVICE REPORT ASSOCIATIONS ====================
dbModels.ErpServiceReport.belongsTo(dbModels.TicketERP, {
  foreignKey: "erp_id",
  as: "ticket",
  onDelete: "CASCADE",
});
dbModels.ErpServiceReport.belongsTo(dbModels.Client, {
  foreignKey: "client_id",
  as: "client",
  onDelete: "CASCADE",
});
dbModels.ErpServiceReport.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});

dbModels.HvacErpServiceReport.belongsTo(dbModels.HVACTicket, {
  foreignKey: "hvac_erp_id",
  as: "ticket",
  onDelete: "CASCADE",
});
dbModels.HvacErpServiceReport.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "createdBy",
  onDelete: "SET NULL",
});

// ==================== VENDOR PAYMENT CLEARANCE ASSOCIATIONS ====================
dbModels.VendorPaymentClearance.belongsTo(dbModels.Vendor, {
  foreignKey: "vendor_id",
  as: "vendor",
  onDelete: "CASCADE",
});
dbModels.VendorPaymentClearance.belongsTo(dbModels.Account, {
  foreignKey: "account_id",
  as: "account",
  onDelete: "SET NULL",
});
dbModels.VendorPaymentClearance.belongsTo(dbModels.VendorBillPayment, {
  foreignKey: "vendor_bill_payment_id",
  as: "vendorBillPayment",
  onDelete: "CASCADE",
});
dbModels.VendorPaymentClearance.belongsTo(dbModels.OrderBill, {
  foreignKey: "bill_id",
  as: "orderBill",
  onDelete: "CASCADE",
});
dbModels.VendorPaymentClearance.belongsTo(dbModels.SystemUser, {
  foreignKey: "created_by",
  as: "creator",
  onDelete: "SET NULL",
});
dbModels.VendorPaymentClearance.belongsTo(dbModels.SystemUser, {
  foreignKey: "updated_by",
  as: "updater",
  onDelete: "SET NULL",
});

dbModels.Vendor.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "vendor_id",
  as: "vendorClearances",
  onDelete: "CASCADE",
});
dbModels.Account.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "account_id",
  as: "accountClearances",
});
dbModels.VendorBillPayment.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "vendor_bill_payment_id",
  as: "billPaymentClearances",
  onDelete: "CASCADE",
});
dbModels.OrderBill.hasMany(dbModels.VendorPaymentClearance, {
  foreignKey: "bill_id",
  as: "orderBillClearancesList",
  onDelete: "CASCADE",
});

// ==================== GST RECORD ASSOCIATIONS ====================
dbModels.GstRecord.belongsTo(dbModels.Invoice, {
  foreignKey: "invoice_id",
  as: "invoice",
  onDelete: "CASCADE",
});
dbModels.GstRecord.belongsTo(dbModels.OrderBill, {
  foreignKey: "bill_id",
  as: "orderBill",
  onDelete: "CASCADE",
});

// ==================== TDS RECORD ASSOCIATIONS ====================
dbModels.TdsRecord.belongsTo(dbModels.InvoicePayment, {
  foreignKey: "payment_id",
  as: "invoicePayment",
  onDelete: "CASCADE",
});
dbModels.TdsRecord.belongsTo(dbModels.VendorBillPayment, {
  foreignKey: "vendor_payment_id",
  as: "vendorBillPayment",
  onDelete: "CASCADE",
});

// ── 3) Export registry & bound sequelize ───────────────────────────────────────
export default dbModels;

export const {
  Account,
  SystemUser,
  Pi,
  PiItem,
  Estimate,
  EstimateItem,
  Invoice,
  InvoiceItem,
  Client,
  Vendor,
  PurchaseOrder,
  OrderBill,
  VendorBillPayment,
  VendorPaymentClearance,
  Category,
  Job,
  PendingMaterial,
  // Add other models you need
} = dbModels;

export const { sequelize: sequelizeWriterBound } = dbModels;
export { sequelize };
