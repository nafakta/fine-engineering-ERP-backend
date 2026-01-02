import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Sequelize, Op } from "sequelize";
import { sequelize } from "../models";
// Import models

import { SystemUser } from "../models/SystemUser";

// Import controllers
import SystemUserController from "../controllers/CompressCrmController";

const SystemUserRouter = express.Router();

// Initialize controllers
const systemUserController = new SystemUserController();

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
SystemUserRouter.post("/register", systemUserController.createUser);
SystemUserRouter.post("/generateqrcode", systemUserController.generateQRCode);
SystemUserRouter.get("/getuser", systemUserController.getUserDetails);
SystemUserRouter.get("/getalluser", systemUserController.getAllUsers);
SystemUserRouter.get("/getroles", systemUserController.getRoles);
SystemUserRouter.post("/updateuser", systemUserController.UpdateUser);
SystemUserRouter.post("/deleteuser", systemUserController.deleteUser);
SystemUserRouter.post("/logout", systemUserController.logout);
SystemUserRouter.post("/verifytotp", systemUserController.verifyTOTP);
SystemUserRouter.get('/admin-users-with-totp',  systemUserController.getAdminUsersWithTOTP);
SystemUserRouter.post('/verify-admin-totp',  systemUserController.verifyAdminTOTP);
SystemUserRouter.post('/verify-any-admin-totp',  systemUserController.verifyAnyAdminTOTP);
SystemUserRouter.post("/fetchsecret", systemUserController.fetchSecretKey);
SystemUserRouter.post("/deletesecert", systemUserController.deleteSecretKey);
SystemUserRouter.post("/resetpassword", systemUserController.resetPassword);
SystemUserRouter.post("/loguseractivity", systemUserController.logUserActivity);
SystemUserRouter.get("/getallactivites", systemUserController.getAllUserActivities);
SystemUserRouter.get("/getallusername", systemUserController.getAllUserNamesAndUUIDs);
SystemUserRouter.post("/filteruseractivites", systemUserController.filterUserActivities);
SystemUserRouter.get("/getalldeleteduser", systemUserController.getAllDeletedUsers);



export default SystemUserRouter;