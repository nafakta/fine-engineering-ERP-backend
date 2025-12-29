import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes, Transaction } from "sequelize";
import db from "../models";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Page, Browser } from "puppeteer";

/* ===== Validation ===== */
const detailSchema = Yup.object({
  id: Yup.string().uuid().optional(),
  ac_type: Yup.string().nullable(),
  maker: Yup.string().nullable(),
  quantity: Yup.number().integer().nullable(),
  tr_ac: Yup.number().nullable(), // ✅ Changed from .integer() to .number()
  rate_per_ac: Yup.number().nullable(),
  total_rate: Yup.number().nullable(),
  _delete: Yup.boolean().optional(),
});

const createSchema = Yup.object({
  client_id: Yup.string().uuid().required(),
  service_frequency: Yup.string().required(),
  start_date: Yup.string().required(),
  end_date: Yup.string().required(),
  service_type: Yup.string().required(),
  deal_offer: Yup.string().nullable(),
  installment: Yup.string().nullable(),
  tax_cal: Yup.string().nullable(),
  no_of_services: Yup.number().integer().nullable(),
  working_address: Yup.string().required(),
  notes: Yup.string().nullable(),
  details: Yup.array().of(detailSchema).default([]),
});

// ✅ AMC CONTRACT CREATE SCHEMA (List se value leke banayenge)
const createContractFromEstimateSchema = Yup.object({
  estimate_id: Yup.string().uuid().required(), // AMC Estimate ka ID
  company_name: Yup.string().required(), // Contract ke liye company name
  contract_date: Yup.string().required(), // Contract date
});

const updateSchema = createSchema.shape({
  client_id: Yup.string().uuid().optional(),
  service_frequency: Yup.string().optional(),
  start_date: Yup.string().optional(),
  end_date: Yup.string().optional(),
  service_type: Yup.string().optional(),
  working_address: Yup.string().optional(),
  details: Yup.array().of(detailSchema).optional(), // ✅ This will use the updated detailSchema
});

const serviceScheduleUpdateSchema = Yup.object({
  schedule_id: Yup.string().uuid().required(),
  status: Yup.string().required(),
  service_completed_date: Yup.string().nullable(),
  notes: Yup.string().nullable(),
});

// ✅ ADD THIS - Validation Schema for updating planned_date
const serviceScheduleUpdatePlannedDateSchema = Yup.object({
  schedule_id: Yup.string().uuid().required(),
  planned_date: Yup.string()
    .required("Planned date is required")
    .matches(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
});

// Handlebars helpers
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
  const n = Number(v || 0);
  return n.toLocaleString("en-IN", { 
    style: "currency", 
    currency: "INR", 
    maximumFractionDigits: 2 
  });
});
Handlebars.registerHelper("formatINR", (v: any) => {
  const n = Number(v || 0);
  return n.toLocaleString("en-IN", { 
    style: "currency", 
    currency: "INR", 
    maximumFractionDigits: 2 
  });
});
Handlebars.registerHelper("formatDate", (v: any) => {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN");
});
Handlebars.registerHelper("calculateTotal", (quantity: any, rate: any) => {
  const qty = Number(quantity || 0);
  const rt = Number(rate || 0);
  return (qty * rt).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
});
Handlebars.registerHelper("calculateGrandTotal", (details: any[]) => {
  const total = details.reduce((sum: number, item: any) => {
    const quantity = Number(item.quantity || 0);
    const rate = Number(item.rate_per_ac || 0);
    return sum + (quantity * rate);
  }, 0);
  return total.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  });
});

// Template path resolution
async function resolveExistingPath(...segments: string[]) {
  const p = path.resolve(...segments);
  try { 
    await fs.access(p); 
    return p; 
  } catch { 
    return null; 
  }
}

async function resolveTemplateFile(rel: string): Promise<string> {
  let p = await resolveExistingPath(__dirname, "../templates", rel);
  if (p) return p;
  p = await resolveExistingPath(__dirname, "../../templates", rel);
  if (p) return p;
  throw new Error(`Template not found: ${rel}`);
}

const TEMPLATE_PATH_PROMISE = resolveTemplateFile("amc_estimate.hbs");

// Logo path resolution
const LOGO_PATH_PROMISE = (async () => {
  const tryPaths = [
    [__dirname, "../images/compress-india-logo-traced.png"],
    [__dirname, "../../images/compress-india-logo-traced.png"],
    [__dirname, "../public/uploads/images/compress-india-logo-traced.png"],
    [__dirname, "../../public/uploads/images/compress-india-logo-traced.png"],
  ];
  for (const parts of tryPaths) {
    const p = path.resolve(...parts);
    try {
      await fs.access(p);
      return p;
    } catch {/* continue */ }
  }
  return "";
})();

const FALLBACK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function mimeFromExt(p: string): string {
  const ext = p.toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
  if (ext.endsWith(".webp")) return "image/webp";
  if (ext.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

const ENCODED_LOGO_PROMISE = (async () => {
  try {
    const p = await LOGO_PATH_PROMISE;
    if (!p) return FALLBACK_PIXEL;
    const buf = await fs.readFile(p);
    return `data:${mimeFromExt(p)};base64,${buf.toString("base64")}`;
  } catch {
    return FALLBACK_PIXEL;
  }
})();

// ID sanitization
const sanitizeUuid = (raw: unknown) => {
  let s = String(raw ?? "");
  s = s.replace(/^:+/, "").replace(/^"+|"+$/g, "").trim();
  s = s.replace(/[\u0000-\u001F\u007F]/g, "");
  if (s.includes("/")) s = s.split("/").filter(Boolean).pop() || s;
  return s.replace(/\/+$/, "");
};

// Extract GST percentage from tax_cal field
function extractGstPercentage(taxCal: string | null): number {
  if (!taxCal) return 0;
  
  const match = taxCal.match(/(\d+(\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  
  return 0;
}

// Calculate payment status (e.g., "1/4", "1/2")
function calculatePaymentStatus(installment: string | null): string {
  if (!installment) return "N/A";
  
  // Extract number from installment string (e.g., "4 Installments" -> 4)
  const match = installment.match(/(\d+)/);
  if (!match) return "N/A";
  
  const totalInstallments = parseInt(match[1]);
  return `0/${totalInstallments}`;
}

// Build AMC Estimate View Model
async function buildAmcEstimateVM(id: string) {
  const sql = `
    SELECT
      e.*,
      
      -- ✅ AmcOffer ka title aur description lene ke liye LEFT JOIN
      ao.title as deal_offer_title, 
      ao.description as deal_offer_description, 
      
      -- Client info
      jsonb_build_object(
        'id', c.id,
        'company', c.company,
        'client', c.client,
        'mobile', c.mobile,
        'email_id', c.email_id,
        'city', c.city,
        'state', c.state,
        'pin_code', c.pin_code,
        'gstn', c.gstn,
        'address', c.address,
        'contact_person', c.contact_person,
        'designation', c.designation
      ) AS client,

      -- AC Details with calculated totals
      COALESCE(
        json_agg(
          jsonb_build_object(
            'id', d.id,
            'ac_type', d.ac_type,
            'maker', d.maker,
            'quantity', d.quantity,
            'tr_ac', d.tr_ac,
            'rate_per_ac', d.rate_per_ac,
            'total_rate', (d.quantity * d.rate_per_ac)
          ) 
        ) FILTER (WHERE d.id IS NOT NULL),
        '[]'::json
      ) AS details,

      -- Service schedule summary
      COALESCE(s.total_services, 0) AS total_services,
      COALESCE(s.completed_services, 0) AS completed_services,
      s.recent_service_date,
      s.upcoming_service_date

    FROM public.amc_estimates e

    LEFT JOIN public.clients c
      ON c.id = e.client_id

    -- ✅ AmcOffer table join karo
    LEFT JOIN public.amc_offer ao
      ON ao.id = e.deal_offer

    LEFT JOIN public.amcac_details d
      ON d.amc_estimate_id = e.id

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS total_services,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
        MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
        MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
      FROM public.amc_service_schedule s
      WHERE s.amc_estimate_id = e.id
    ) s ON TRUE

    WHERE e.id = :id
    GROUP BY e.id, c.id, ao.title, ao.description, s.total_services, s.completed_services, s.recent_service_date, s.upcoming_service_date
    LIMIT 1;
  `;

  const rows = await db.sequelize.query(sql, {
    type: db.sequelize.QueryTypes.SELECT,
    replacements: { id },
  });

  const data = (rows as any[])[0];
  if (!data) throw new Error("AMC Estimate not found");

  // Calculate subtotal (sum of all AC details)
  const subtotal = (data.details || []).reduce((total: number, item: any) => {
    const quantity = Number(item.quantity || 0);
    const rate = Number(item.rate_per_ac || 0);
    return total + (quantity * rate);
  }, 0);

  // Extract GST percentage from tax_cal field
  const gstPercentage = extractGstPercentage(data.tax_cal);
  const gstAmount = (subtotal * gstPercentage) / 100;
  
  // Calculate grand total
  const grandTotal = subtotal + gstAmount;

  const our_company = {
    name: process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.",
    legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
    tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
    address_line: process.env.COMPANY_ADDR || "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Naga Near SCLR Road, Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
    city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
    phone: process.env.COMPANY_PHONE || "8655 0114 65 / 9920 5299 61 / 9152 1571 14",
    email: process.env.COMPANY_EMAIL || "sales.compressindia@gmail.com / info@compressindia.com",
    website: process.env.COMPANY_WEBSITE || "www.compressindia.in / www.compressindia.com / www.compressindia.co.in",
  };

  // ✅ Client data se customer object banaye
  const client = data.client || {};
  const customer = {
    company: client.company || "",
    name: client.client || "",
    address: client.address || "",
    city: client.city || "",
    state: client.state || "",
    pin_code: client.pin_code || "",
    gstin: client.gstn || "",
    contact_person: client.contact_person || "",
    designation: client.designation || "",
    phone: client.mobile || "",
    email: client.email_id || "",
  };

  const logoDataUrl = await ENCODED_LOGO_PROMISE;

  const vm = {
    doc_title: "AMC Estimate",
    doc_label: "Estimate Number",
    logo: logoDataUrl,

    estimate_number: data.estimate_no || data.id,  
    estimate_date: new Date(data.created_at || new Date()).toLocaleDateString("en-IN"),
    valid_until: new Date(data.end_date).toLocaleDateString("en-IN"),

    our_company,
    customer,

    // AMC Specific Details
    amc_details: {
      service_type: data.service_type || "",
      service_frequency: data.service_frequency || "",
      start_date: new Date(data.start_date).toLocaleDateString("en-IN"),
      end_date: new Date(data.end_date).toLocaleDateString("en-IN"),
      no_of_services: data.no_of_services || 0,
      working_address: data.working_address || "",
      deal_offer: data.deal_offer_title || data.deal_offer || "None", // ✅ ID ki jagah title
      deal_offer_description: data.deal_offer_description || "", // ✅ NAYA FIELD
      installment: data.installment || "Not specified",
      tax_calculation: data.tax_cal || "As applicable",
      notes: data.notes || "",
    },

    // AC Equipment Details
    ac_details: data.details || [],

    // Service Progress
    service_progress: {
      completed: data.completed_services || 0,
      total: data.total_services || data.no_of_services || 0,
      recent_service: data.recent_service_date ? new Date(data.recent_service_date).toLocaleDateString("en-IN") : "None",
      upcoming_service: data.upcoming_service_date ? new Date(data.upcoming_service_date).toLocaleDateString("en-IN") : "None",
    },

    // Financial Summary with GST
    financial_summary: {
      subtotal: subtotal,
      gst_percentage: gstPercentage,
      gst_amount: gstAmount,
      grand_total: grandTotal,
    },

    amount_in_words: `INR ${inWordsIndian(grandTotal)}`,

    terms: [
      "This estimate is valid for 30 days from the date of issue.",
      "Services will be provided as per the agreed schedule.",
      "Any additional services not covered in this AMC will be charged separately.",
      "Payment terms: 50% advance, 50% on completion.",
      "All disputes are subject to Mumbai jurisdiction.",
    ],

    // Signature section
    signatures: {
      prepared_by: {
        name: "Authorized Signatory",
        designation: "Sales Manager",
        date: new Date().toLocaleDateString("en-IN")
      },
      accepted_by: {
        name: "___________________",
        designation: "Client Authorized Signatory",
        date: "___________________"
      }
    }
  };

  return vm;
}

// Number to words function (Indian format)
function inWordsIndian(num: number): string {
  const wholeNumber = Math.round(num);
  const units: string[] = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const tens: string[] = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];
  const thousands: string[] = ["", "Thousand", "Lakh", "Crore"];

  if (wholeNumber === 0) return "Zero";

  let words = '';
  let n = wholeNumber;
  let place = 0;

  do {
    let chunk = n % 1000;
    if (chunk !== 0) {
      let chunkWords = '';

      // Hundreds place
      if (chunk >= 100) {
        chunkWords += units[Math.floor(chunk / 100)] + ' Hundred ';
        chunk %= 100;
      }

      // Tens and units place
      if (chunk >= 20) {
        chunkWords += tens[Math.floor(chunk / 10)] + ' ';
        chunk %= 10;
      }

      if (chunk > 0) {
        chunkWords += units[chunk] + ' ';
      }

      words = chunkWords + thousands[place] + ' ' + words;
    }
    n = Math.floor(n / 1000);
    place++;
  } while (n > 0);

  return words.trim() + ' Rupees Only';
}

async function renderAmcEstimatePdfBuffer(id: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    const vm = await buildAmcEstimateVM(id);
    const hbsPath = await TEMPLATE_PATH_PROMISE;
    const tpl = await fs.readFile(hbsPath, "utf-8");
    const html = Handlebars.compile(tpl)(vm);

    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_EXECUTABLE_PATH ||
      (process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/usr/bin/chromium-browser");

    const explicitPathProvided = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH);
    if (explicitPathProvided) {
      try {
        await fs.access(executablePath as string);
      } catch (ex) {
        throw new Error(
          `Chrome/Chromium executable not found at path: ${executablePath}. ` +
          `Set PUPPETEER_EXECUTABLE_PATH or CHROME_EXECUTABLE_PATH to a valid binary.`
        );
      }
    }

    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--font-render-hinting=none",
    ];

    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath,
      args: launchArgs,
    });

    const page: Page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(60000);

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await page.emulateMediaType("screen");

    const pdfU8 = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
      preferCSSPageSize: true,
    });

    const pdfBuffer = Buffer.from(pdfU8);
    if (!pdfBuffer || pdfBuffer.length < 1000) {
      try {
        await fs.writeFile(path.resolve(process.cwd(), "amc-estimate-debug.html"), html);
        console.warn("PDF generation produced a very small buffer — debug HTML written to amc-estimate-debug.html");
      } catch { }
      throw new Error("AMC Estimate PDF generation failed (empty or too small buffer). Check amc-estimate-debug.html");
    }

    return pdfBuffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to render AMC Estimate PDF: ${msg}`);
  } finally {
    try {
      await browser?.close();
    } catch {
      // ignore close errors
    }
  }
}

/* ===== Type Definitions ===== */
interface AcDetail {
  id?: string;
  ac_type: string;
  maker: string;
  quantity: number;
  tr_ac: number;
  rate_per_ac: number;
  total_rate?: number;
  _delete?: boolean;
}

interface ServiceSchedule {
  id?: string;
  service_no: number;
  planned_date: string;
  status?: string;
  service_completed_date?: string | null;
  notes?: string | null;
}

interface EstimateData {
  id: string;
  client_id: string;
  service_frequency: string;
  start_date: string;
  end_date: string;
  service_type: string;
  deal_offer: string | null;
  installment: string | null;
  tax_cal: string | null;
  no_of_services: number | null;
  working_address: string;
  notes: string | null;
    is_create_contract: boolean;
  details: AcDetail[];
  service_schedules: ServiceSchedule[];
  client_company?: string;
  client_mobile?: string;
}

/* ===== Controller ===== */
export class AmcEstimateController {
  // ✅ CREATE AMC ESTIMATE (Updated - payment_date removed)
  static async create(req: Request, res: Response) {
    try {
      const payload = await createSchema.validate(req.body, {
        abortEarly: false,
      });
      const { details = [], ...e } = payload;

      if (!Array.isArray(details)) {
        return res.status(400).json({
          success: false,
          error: "Field 'details' must be an array of objects",
        });
      }

      await db.sequelize.transaction(async (tx: Transaction) => {
        // 1) Insert estimate and fetch UUID safely
        const insertEstimateSQL = `
          WITH ins AS (
            INSERT INTO public.amc_estimates
              (client_id,
               service_frequency,
               start_date,
               end_date,
               service_type,
               deal_offer,
               installment,
               tax_cal,
               no_of_services,
               working_address,
               notes)
            VALUES
              (:client_id,
               :service_frequency,
               :start_date,
               :end_date,
               :service_type,
               :deal_offer,
               :installment,
               :tax_cal,
               :no_of_services,
               :working_address,
               :notes)
            RETURNING id
          )
          SELECT id FROM ins;
        `;

        const inserted = await db.sequelize.query(insertEstimateSQL, {
          type: QueryTypes.SELECT,
          transaction: tx,
          replacements: {
            client_id: e.client_id,
            service_frequency: e.service_frequency,
            start_date: e.start_date,
            end_date: e.end_date,
            service_type: e.service_type,
            deal_offer: e.deal_offer ?? null,
            installment: e.installment ?? null,
            tax_cal: e.tax_cal ?? null,
            no_of_services: e.no_of_services ?? null,
            working_address: e.working_address,
            notes: e.notes ?? null,
          },
        });

        const estimateId = (inserted[0] as any).id as string;

        // 2) Bulk-insert AC details (if any)
        if (details.length > 0) {
          const bulkInsertSQL = `
            INSERT INTO public.amcac_details
              (amc_estimate_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
            SELECT
              :amc_estimate_id,
              x.ac_type,
              x.maker,
              x.quantity,
              x.tr_ac,
              x.rate_per_ac
            FROM jsonb_to_recordset(:details::jsonb) AS x(
              ac_type      text,
              maker        text,
              quantity     int,
              tr_ac        numeric,
              rate_per_ac  numeric
            );
          `;
          await db.sequelize.query(bulkInsertSQL, {
            type: QueryTypes.INSERT,
            transaction: tx,
            replacements: {
              amc_estimate_id: estimateId,
              details: JSON.stringify(details),
            },
          });
        }

        // 3) Generate AMC service schedule rows
        await AmcEstimateController.generateScheduleForEstimate(
          estimateId,
          e.start_date,
          e.end_date,
          e.no_of_services ?? null,
          tx
        );

        // 4) Return with aggregated details from DB
        const data = await AmcEstimateController._getByIdRaw(estimateId, tx);
        res.json({ success: true, data });
      });
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

static async createContractFromEstimate(req: Request, res: Response) {
  // small local helper (no need to create a global class)
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  try {
    const payload = await createContractFromEstimateSchema.validate(req.body, {
      abortEarly: false,
    });

    const { estimate_id, company_name, contract_date } = payload;

    await db.sequelize.transaction(async (tx: Transaction) => {
      // 1) Get estimate (LOCKED) so it can't be used twice in parallel requests
  const estimateData = await AmcEstimateController._getEstimateForContract(
  estimate_id,
  tx
);

      if (!estimateData) {
        throw new HttpError(404, "AMC Estimate not found");
      }

      // ✅ prevent duplicate create
      if (estimateData.is_create_contract === false) {
        throw new HttpError(409, "Contract already created for this estimate");
      }

      // Calculate subtotal from AC details
      const subtotal = (estimateData.details || []).reduce((total: number, item: any) => {
        const quantity = Number(item.quantity || 0);
        const rate = Number(item.rate_per_ac || 0);
        return total + quantity * rate;
      }, 0);

      // Extract GST percentage from tax_cal field
      const gstPercentage = extractGstPercentage(estimateData.tax_cal);
      const gstAmount = (subtotal * gstPercentage) / 100;

      // Grand total
      const grandTotal = subtotal + gstAmount;

      // 2) Create AMC Contract
      const insertContractSQL = `
        INSERT INTO public.amc_contract (
          company_name,
          client_id,
          service_frequency,
          start_date,
          end_date,
          service_type,
          deal_offer,
          installment,
          tax_cal,
          no_of_services,
          working_address,
          notes,
          payment_installment,
          amc_contract_no,
          created_at,
          updated_at
        ) VALUES (
          :company_name,
          :client_id,
          :service_frequency,
          :start_date,
          :end_date,
          :service_type,
          :deal_offer,
          :installment,
          :tax_cal,
          :no_of_services,
          :working_address,
          :notes,
          :payment_installment,
          NULL,
          NOW(),
          NOW()
        ) RETURNING *;
      `;

      const insertedContract = await db.sequelize.query(insertContractSQL, {
        type: QueryTypes.SELECT,
        transaction: tx,
        replacements: {
          company_name,
          client_id: estimateData.client_id,
          service_frequency: estimateData.service_frequency,
          start_date: estimateData.start_date,
          end_date: estimateData.end_date,
          service_type: estimateData.service_type,
          deal_offer: estimateData.deal_offer,
          installment: estimateData.installment,
          tax_cal: estimateData.tax_cal,
          no_of_services: estimateData.no_of_services,
          working_address: estimateData.working_address,
          notes: estimateData.notes,
          payment_installment: grandTotal,
        },
      });

      const contractId = (insertedContract[0] as any).id;

      // 3) Copy AC Details
      if (estimateData.details && estimateData.details.length > 0) {
        const bulkInsertDetailsSQL = `
          INSERT INTO public.amcac_contract_details (
            amc_contract_id,
            ac_type,
            maker,
            quantity,
            tr_ac,
            rate_per_ac
          ) SELECT
            :amc_contract_id,
            x.ac_type,
            x.maker,
            x.quantity,
            x.tr_ac,
            x.rate_per_ac
          FROM jsonb_to_recordset(:details::jsonb) AS x(
            ac_type text,
            maker text,
            quantity int,
            tr_ac numeric,
            rate_per_ac numeric
          );
        `;

        await db.sequelize.query(bulkInsertDetailsSQL, {
          type: QueryTypes.INSERT,
          transaction: tx,
          replacements: {
            amc_contract_id: contractId,
            details: JSON.stringify(
              estimateData.details.map((d: AcDetail) => ({
                ac_type: d.ac_type,
                maker: d.maker,
                quantity: d.quantity,
                tr_ac: d.tr_ac,
                rate_per_ac: d.rate_per_ac,
              }))
            ),
          },
        });
      }

      // 4) Copy Service Schedules
      if (estimateData.service_schedules && estimateData.service_schedules.length > 0) {
        const bulkInsertSchedulesSQL = `
          INSERT INTO public.amc_contract_service_schedule (
            amc_contract_id,
            service_no,
            planned_date,
            status,
            service_completed_date,
            notes
          ) SELECT
            :amc_contract_id,
            x.service_no,
            x.planned_date::date,
            x.status,
            CASE
              WHEN x.service_completed_date IS NOT NULL AND x.service_completed_date != ''
              THEN x.service_completed_date::date
              ELSE NULL
            END,
            x.notes
          FROM jsonb_to_recordset(:schedules::jsonb) AS x(
            service_no int,
            planned_date text,
            status text,
            service_completed_date text,
            notes text
          );
        `;

        await db.sequelize.query(bulkInsertSchedulesSQL, {
          type: QueryTypes.INSERT,
          transaction: tx,
          replacements: {
            amc_contract_id: contractId,
            schedules: JSON.stringify(
              estimateData.service_schedules.map((s: ServiceSchedule) => ({
                service_no: s.service_no,
                planned_date: s.planned_date,
                status: s.status || "PENDING",
                service_completed_date: s.service_completed_date,
                notes: s.notes,
              }))
            ),
          },
        });
      }

      // 5) Create Payment History
      await AmcEstimateController.generatePaymentHistoryForContract(
        contractId,
        estimateData.start_date,
        estimateData.end_date,
        estimateData.installment,
        grandTotal,
        tx
      );

      // ✅ 6) IMPORTANT: mark estimate as "contract created" (atomic + safe)
      // also protects against edge cases (if someone flips it in DB)
const updatedRows = await db.sequelize.query(
  `
  UPDATE public.amc_estimates
  SET is_create_contract = false,
      updated_at = NOW()
  WHERE id = :estimate_id
    AND is_create_contract = true
  RETURNING id;
  `,
  {
    type: QueryTypes.SELECT, // ✅ use SELECT because we RETURNING rows
    transaction: tx,
    replacements: { estimate_id },
  }
);

if (!updatedRows || (updatedRows as any[]).length === 0) {
  throw new HttpError(409, "Contract already created for this estimate");
}

      // 7) Return complete contract
      const completeContract = await AmcEstimateController._getContractById(contractId, tx);

      res.json({
        success: true,
        message: "AMC Contract created successfully from estimate",
        data: completeContract,
      });
    });
  } catch (err: any) {
    // Yup validation
    if (err?.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: err.errors,
      });
    }

    // our controlled errors
    if (err instanceof Error && (err as any).status) {
      return res.status((err as any).status).json({
        success: false,
        error: err.message,
      });
    }

    console.error("AMC Contract creation error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}


  // ✅ LIST AMC ESTIMATES (Updated - payment_date references removed from payment_status)
 static async list(req: Request, res: Response) {
  try {
    const page = Math.max(parseInt(String(req.body?.page ?? 1)), 1);
    const limit = Math.min(Math.max(parseInt(String(req.body?.limit ?? 10)), 1), 100);
    const offset = (page - 1) * limit;

    // Get total count
    const countSQL = `
      SELECT COUNT(*) as total_count
      FROM public.amc_estimates e
      WHERE 1=1
    `;

    const countResult = await db.sequelize.query(countSQL, {
      type: QueryTypes.SELECT,
    });

    const totalCount = parseInt((countResult[0] as any)?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    const dataSQL = `
      SELECT
        e.*,
        e.is_create_contract, -- ✅ ADDED (frontend will get this flag)
        c.company AS client_company,
        c.mobile AS client_mobile,
        c.id AS client_id,
        d.details,
        s.service_schedules,
        COALESCE(s_summary.total_services, 0) AS total_services,
        COALESCE(s_summary.completed_services, 0) AS completed_services,
        CONCAT(
          COALESCE(s_summary.completed_services, 0),
          '/',
          COALESCE(
            NULLIF(s_summary.total_services, 0),
            NULLIF(e.no_of_services, 0),
            0
          )
        ) AS service_progress,
        s_summary.recent_service_date,
        s_summary.upcoming_service_date,
        -- ✅ Payment Status Calculation (payment_date removed)
        CASE 
          WHEN e.installment IS NULL OR e.installment = '' THEN 'N/A'
          ELSE CONCAT('0/', REGEXP_REPLACE(e.installment, '[^0-9]', '', 'g'))
        END AS payment_status

      FROM public.amc_estimates e
      LEFT JOIN public.clients c ON c.id = e.client_id

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              jsonb_build_object(
                'id', d.id,
                'ac_type', d.ac_type,
                'maker', d.maker,
                'quantity', d.quantity,
                'tr_ac', d.tr_ac,
                'rate_per_ac', d.rate_per_ac,
                'total_rate', d.total_rate
              ) ORDER BY d.id
            ),
            '[]'::json
          ) AS details
        FROM public.amcac_details d
        WHERE d.amc_estimate_id = e.id
      ) d ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              jsonb_build_object(
                'id', ss.id,
                'service_no', ss.service_no,
                'planned_date', ss.planned_date,
                'status', ss.status,
                'service_completed_date', ss.service_completed_date,
                'notes', ss.notes
              ) ORDER BY ss.service_no
            ),
            '[]'::json
          ) AS service_schedules
        FROM public.amc_service_schedule ss
        WHERE ss.amc_estimate_id = e.id
      ) s ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_services,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
          MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
          MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
        FROM public.amc_service_schedule ss
        WHERE ss.amc_estimate_id = e.id
      ) s_summary ON TRUE

      ORDER BY e.estimate_no DESC, e.created_at DESC
      LIMIT :limit OFFSET :offset;
    `;

    const rows = await db.sequelize.query(dataSQL, {
      type: QueryTypes.SELECT,
      replacements: { limit, offset },
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}
// ✅ SEARCH AMC ESTIMATES BY CLIENT (with optional date range)
static async search(req: Request, res: Response) {
  try {
    // Validation schema - only client_id is required
    const searchSchema = Yup.object({
      client_id: Yup.string().uuid().required("Client ID is required"),
      start_date: Yup.string()
        .nullable()
        .matches(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
      end_date: Yup.string()
        .nullable()
        .matches(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
      page: Yup.number().min(1).default(1),
      limit: Yup.number().min(1).max(100).default(10),
    });

    const payload = await searchSchema.validate(req.body, { abortEarly: false });
    const { client_id, start_date, end_date, page = 1, limit = 10 } = payload;
    const offset = (page - 1) * limit;

    // Build WHERE conditions dynamically
    const whereConditions: string[] = ["e.client_id = :client_id"];
    const replacements: any = { client_id, limit, offset };

    if (start_date) {
      whereConditions.push("e.start_date >= :start_date");
      replacements.start_date = start_date;
    }

    if (end_date) {
      whereConditions.push("e.end_date <= :end_date");
      replacements.end_date = end_date;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Count query
    const countSQL = `
      SELECT COUNT(*) as total_count
      FROM public.amc_estimates e
      ${whereClause}
    `;

    const countResult = await db.sequelize.query(countSQL, {
      type: QueryTypes.SELECT,
      replacements,
    });

    const totalCount = parseInt((countResult[0] as any)?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    // Main search query
    const searchSQL = `
      SELECT
        e.*,
        e.is_create_contract,
        c.company AS client_company,
        c.mobile AS client_mobile,
        c.id AS client_id,
        d.details,
        s.service_schedules,
        COALESCE(s_summary.total_services, 0) AS total_services,
        COALESCE(s_summary.completed_services, 0) AS completed_services,
        CONCAT(
          COALESCE(s_summary.completed_services, 0),
          '/',
          COALESCE(
            NULLIF(s_summary.total_services, 0),
            NULLIF(e.no_of_services, 0),
            0
          )
        ) AS service_progress,
        s_summary.recent_service_date,
        s_summary.upcoming_service_date,
        CASE 
          WHEN e.installment IS NULL OR e.installment = '' THEN 'N/A'
          ELSE CONCAT('0/', REGEXP_REPLACE(e.installment, '[^0-9]', '', 'g'))
        END AS payment_status

      FROM public.amc_estimates e
      LEFT JOIN public.clients c ON c.id = e.client_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              jsonb_build_object(
                'id', d.id,
                'ac_type', d.ac_type,
                'maker', d.maker,
                'quantity', d.quantity,
                'tr_ac', d.tr_ac,
                'rate_per_ac', d.rate_per_ac,
                'total_rate', d.total_rate
              ) ORDER BY d.id
            ),
            '[]'::json
          ) AS details
        FROM public.amcac_details d
        WHERE d.amc_estimate_id = e.id
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(
            json_agg(
              jsonb_build_object(
                'id', ss.id,
                'service_no', ss.service_no,
                'planned_date', ss.planned_date,
                'status', ss.status,
                'service_completed_date', ss.service_completed_date,
                'notes', ss.notes
              ) ORDER BY ss.service_no
            ),
            '[]'::json
          ) AS service_schedules
        FROM public.amc_service_schedule ss
        WHERE ss.amc_estimate_id = e.id
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_services,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
          MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
          MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
        FROM public.amc_service_schedule ss
        WHERE ss.amc_estimate_id = e.id
      ) s_summary ON TRUE
      ${whereClause}
      ORDER BY e.estimate_no DESC, e.created_at DESC
      LIMIT :limit OFFSET :offset;
    `;

    const rows = await db.sequelize.query(searchSQL, {
      type: QueryTypes.SELECT,
      replacements,
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    });
  } catch (err: any) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, error: err.errors });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
}

  // ✅ GET BY ID (Original)
  static async getById(req: Request, res: Response) {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id)
        return res
          .status(400)
          .json({ success: false, error: "id is required" });

      const data = await AmcEstimateController._getByIdRaw(id);
      if (!data)
        return res.status(404).json({ success: false, error: "Not found" });

      res.json({ success: true, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ UPDATE + manage child rows + regenerate schedule (Updated - payment_date removed)
  static async update(req: Request, res: Response) {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id)
        return res
          .status(400)
          .json({ success: false, error: "id is required" });

      const payload = await updateSchema.validate(req.body, {
        abortEarly: false,
      });
      const { details, ...e } = payload;

      await db.sequelize.transaction(async (tx: Transaction) => {
        const updates: string[] = [];
        const r: Record<string, any> = { id };

        [
          "client_id",
          "service_frequency",
          "start_date",
          "end_date",
          "service_type",
          "deal_offer",
          "installment",
          "tax_cal",
          "no_of_services",
          "working_address",
          "notes",
        ].forEach((k) => {
          if (k in e) {
            updates.push(`${k} = :${k}`);
            r[k] = (e as any)[k];
          }
        });

        if (updates.length) {
          const sql = `UPDATE public.amc_estimates SET ${updates.join(
            ", "
          )} WHERE id = :id;`;
          await db.sequelize.query(sql, {
            type: QueryTypes.UPDATE,
            transaction: tx,
            replacements: r,
          });
        }

        // Smart AC Details Management
        if (Array.isArray(details)) {
          // Step 1: Fetch existing details
          const existingDetails = await db.sequelize.query(
            `SELECT id, ac_type, maker, quantity, tr_ac, rate_per_ac 
             FROM public.amcac_details 
             WHERE amc_estimate_id = :id`,
            {
              type: QueryTypes.SELECT,
              transaction: tx,
              replacements: { id },
            }
          );

          // Step 2: Filter frontend details (remove empty rows)
          const validFrontendDetails = details.filter(
            (d: any) =>
              d.ac_type &&
              d.ac_type.trim() !== "" &&
              d.maker &&
              d.maker.trim() !== "" &&
              d.quantity !== null &&
              d.quantity !== undefined &&
              d.tr_ac !== null &&
              d.tr_ac !== undefined &&
              d.rate_per_ac !== null &&
              d.rate_per_ac !== undefined
          );

          // Step 3: Identify operations
          const detailsToDelete: string[] = [];
          const detailsToUpdate: any[] = [];
          const detailsToCreate: any[] = [];

          // Check which existing details to delete
          (existingDetails as any[]).forEach((existing: any) => {
            const existsInFrontend = validFrontendDetails.some(
              (frontend: any) => frontend.id === existing.id
            );

            if (!existsInFrontend) {
              detailsToDelete.push(existing.id);
            }
          });

          // Check what to update/create
          validFrontendDetails.forEach((frontend: any) => {
            if (frontend.id) {
              // Existing detail - update
              detailsToUpdate.push({
                id: frontend.id,
                ac_type: frontend.ac_type,
                maker: frontend.maker,
                quantity: frontend.quantity,
                tr_ac: frontend.tr_ac,
                rate_per_ac: frontend.rate_per_ac,
              });
            } else {
              // New detail - create
              detailsToCreate.push({
                amc_estimate_id: id,
                ac_type: frontend.ac_type,
                maker: frontend.maker,
                quantity: frontend.quantity,
                tr_ac: frontend.tr_ac,
                rate_per_ac: frontend.rate_per_ac,
              });
            }
          });

          // Step 4: Execute operations
          // Delete removed details
          if (detailsToDelete.length > 0) {
            await db.sequelize.query(
              `DELETE FROM public.amcac_details WHERE id IN (:detailsToDelete)`,
              {
                type: QueryTypes.DELETE,
                transaction: tx,
                replacements: { detailsToDelete },
              }
            );
          }

          // Update existing details
          for (const detail of detailsToUpdate) {
            await db.sequelize.query(
              `UPDATE public.amcac_details 
               SET ac_type = :ac_type, maker = :maker, quantity = :quantity, 
                   tr_ac = :tr_ac, rate_per_ac = :rate_per_ac
               WHERE id = :id`,
              {
                type: QueryTypes.UPDATE,
                transaction: tx,
                replacements: detail,
              }
            );
          }

          // Create new details
          if (detailsToCreate.length > 0) {
            const bulkInsertSQL = `
              INSERT INTO public.amcac_details
                (amc_estimate_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
              SELECT
                x.amc_estimate_id,
                x.ac_type,
                x.maker,
                x.quantity,
                x.tr_ac,
                x.rate_per_ac
              FROM jsonb_to_recordset(:details::jsonb) AS x(
                amc_estimate_id uuid,
                ac_type text,
                maker text,
                quantity int,
                tr_ac numeric,
                rate_per_ac numeric
              );
            `;
            await db.sequelize.query(bulkInsertSQL, {
              type: QueryTypes.INSERT,
              transaction: tx,
              replacements: {
                details: JSON.stringify(detailsToCreate),
              },
            });
          }
        }

        // Schedule regenerate (get latest values from DB)
        const metaRows = await db.sequelize.query(
          `
          SELECT
            start_date::text AS start_date,
            end_date::text   AS end_date,
            no_of_services
          FROM public.amc_estimates
          WHERE id = :id;
        `,
          {
            type: QueryTypes.SELECT,
            transaction: tx,
            replacements: { id },
          }
        );

        const meta = metaRows[0] as any | undefined;

        if (meta) {
          await AmcEstimateController.generateScheduleForEstimate(
            id,
            meta.start_date,
            meta.end_date,
            meta.no_of_services,
            tx
          );
        }

        const data = await AmcEstimateController._getByIdRaw(id, tx);
        res.json({ success: true, data });
      });
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }



// ✅ UPDATE ONLY PLANNED_DATE IN SERVICE SCHEDULE
static async updateServiceSchedulePlannedDate(req: Request, res: Response) {
  try {
    const payload = await serviceScheduleUpdatePlannedDateSchema.validate(req.body, { 
      abortEarly: false 
    });
    const { schedule_id, planned_date } = payload;

    // Validate date is a real date
    const date = new Date(planned_date);
    if (isNaN(date.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date provided",
      });
    }

    // Update only planned_date column
    const updateSQL = `
      UPDATE public.amc_service_schedule
      SET planned_date = :planned_date
      WHERE id = :schedule_id
      RETURNING 
        id,
        amc_estimate_id,
        service_no,
        planned_date,
        status,
        service_completed_date,
        notes;
    `;

    const [rows] = (await db.sequelize.query(updateSQL, {
      type: QueryTypes.UPDATE,
      replacements: {
        schedule_id,
        planned_date,
      },
    })) as [any[], number];

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Service schedule not found",
      });
    }

    res.json({
      success: true,
      message: "Planned date updated successfully",
      data: rows[0],
    });
  } catch (err: any) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ 
        success: false, 
        error: err.errors 
      });
    }
    console.error(err);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
}


  // ✅ UPDATE SERVICE STATUS + COMPLETED DATE + NOTES
  static async updateServiceSchedule(req: Request, res: Response) {
    try {
      const payload = await serviceScheduleUpdateSchema.validate(req.body, { abortEarly: false });
      const { schedule_id, status, service_completed_date, notes } = payload;

      // Treat empty string as NULL
      const completedDate =
        service_completed_date && service_completed_date.trim() !== ""
          ? service_completed_date
          : null;

      const safeNotes = notes && notes.trim() !== "" ? notes.trim() : null;

      const updateSQL = `
        UPDATE public.amc_service_schedule
        SET
          status = :status,
          service_completed_date = :service_completed_date,
          notes = :notes
        WHERE id = :schedule_id
        RETURNING *;
      `;

      const [rows, affected] = (await db.sequelize.query(updateSQL, {
        type: QueryTypes.UPDATE,
        replacements: {
          schedule_id,
          status,
          service_completed_date: completedDate,
          notes: safeNotes,
        },
      })) as [any[], number];

      if (!affected || affected === 0 || !rows || rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Schedule not found",
        });
      }

      res.json({
        success: true,
        message: "Service schedule updated successfully",
        data: rows[0],
      });
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ DELETE
  static async remove(req: Request, res: Response) {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id)
        return res
          .status(400)
          .json({ success: false, error: "id is required" });

      await db.sequelize.query(
        `DELETE FROM public.amc_estimates WHERE id = :id;`,
        { type: QueryTypes.DELETE, replacements: { id } }
      );

      res.json({ success: true, msg: "Deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ HISTORY: Full AMC + Client + AC Details + Service Schedule (with status)
  static async history(req: Request, res: Response) {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) {
        return res
          .status(400)
          .json({ success: false, error: "id is required" });
      }

      const sql = `
        SELECT
          e.*,

          -- FULL CLIENT DATA
          jsonb_build_object(
            'id', c.id,
            'department', c.department,
            'company', c.company,
            'client', c.client,
            'mobile', c.mobile,
            'email_id', c.email_id,
            'city', c.city,
            'state', c.state,
            'pin_code', c.pin_code,
            'gstn', c.gstn,
            'address', c.address,
            'shipping_city', c.shipping_city,
            'shipping_state', c.shipping_state,
            'shipping_pincode', c.shipping_pincode,
            'shipping_address', c.shipping_address,
            'contact_person', c.contact_person,
            'designation', c.designation,
            'client_designation', c.client_designation,
            'contact_person_number', c.contact_person_number
          ) AS client,

          -- AC DETAILS ARRAY (including total_rate)
          d.details,

          -- FULL AMC SERVICE SCHEDULE (with status + completed_date + notes)
          s.service_schedule

        FROM public.amc_estimates e

        LEFT JOIN public.clients c
          ON c.id = e.client_id

        -- AC Details
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id', d.id,
                  'ac_type', d.ac_type,
                  'maker', d.maker,
                  'quantity', d.quantity,
                  'tr_ac', d.tr_ac,
                  'rate_per_ac', d.rate_per_ac,
                  'total_rate', d.total_rate
                )
              ),
              '[]'::json
            ) AS details
          FROM public.amcac_details d
          WHERE d.amc_estimate_id = e.id
        ) d ON TRUE

        -- Service Schedule
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id', s.id,
                  'service_no', s.service_no,
                  'planned_date', s.planned_date,
                  'status', s.status,
                  'service_completed_date', s.service_completed_date,
                  'notes', s.notes
                )
                ORDER BY s.planned_date
              ),
              '[]'::json
            ) AS service_schedule
          FROM public.amc_service_schedule s
          WHERE s.amc_estimate_id = e.id
        ) s ON TRUE

        WHERE e.id = :id
        LIMIT 1;
      `;

      const rows = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { id },
      });

      const data = (rows as any[])[0] || null;

      if (!data) {
        return res
          .status(404)
          .json({ success: false, error: "AMC estimate not found" });
      }

      return res.json({ success: true, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ PRINT HTML
  static async printAmcEstimateHtml(req: Request, res: Response) {
    try {
      console.log("HTML Route Hit - ID:", req.params.id);
      const id = sanitizeUuid(req.params.id);
      if (!id) {
        return res.status(400).type("text/plain").send("Invalid or missing AMC Estimate id");
      }

      const vm = await buildAmcEstimateVM(id);
      const hbsPath = await TEMPLATE_PATH_PROMISE;
      const tpl = await fs.readFile(hbsPath, "utf-8");
      const html = Handlebars.compile(tpl)(vm);

      return res.status(200).type("html").send(html);
    } catch (err: any) {
      console.error("AMC Estimate HTML render error:", err);
      return res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
    }
  }

  // ✅ PRINT PDF
  static async printAmcEstimatePdf(req: Request, res: Response) {
    try {
      console.log("PDF Route Hit - ID:", req.params.id);
      console.log("Query params:", req.query);
      
      const id = sanitizeUuid(req.params.id);
      if (!id) {
        console.log("Invalid ID provided");
        return res.status(400).type("text/plain").send("Invalid or missing AMC Estimate id");
      }

      console.log("Generating PDF for ID:", id);
      const pdfBuffer = await renderAmcEstimatePdfBuffer(id);
      const download = String(req.query.dl || req.query.download) === "1";
      const filename = `AMC-Estimate-${id}.pdf`;

      console.log("PDF generated successfully, size:", pdfBuffer.length);
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
      
      return res.end(pdfBuffer);
    } catch (err: any) {
      console.error("AMC Estimate PDF render error:", err);
      return res.status(500).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
    }
  }

  // ✅ PRIVATE: Get by ID (with AC details + client info light)
  private static async _getByIdRaw(id: string, tx?: Transaction) {
    const sql = `
      SELECT
        e.*,
        c.company AS client_company,
        c.mobile  AS client_mobile,
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', d.id,
              'ac_type', d.ac_type,
              'maker', d.maker,
              'quantity', d.quantity,
              'tr_ac', d.tr_ac,
              'rate_per_ac', d.rate_per_ac,
              'total_rate', d.total_rate
            )
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'
        ) AS details
      FROM public.amc_estimates e
      LEFT JOIN public.clients c
        ON c.id = e.client_id
      LEFT JOIN public.amcac_details d
        ON d.amc_estimate_id = e.id
      WHERE e.id = :id
      GROUP BY e.id, c.company, c.mobile;
    `;
    const rows = await db.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      transaction: tx,
      replacements: { id },
    });
    return (rows as any[])[0] || null;
  }

// ✅ PRIVATE: Get Estimate data for Contract creation (WITH SAFE ROW LOCK)
private static async _getEstimateForContract(
  estimateId: string,
  tx?: Transaction
): Promise<EstimateData | null> {
  const sql = `
    -- ✅ Lock ONLY amc_estimates row (safe with LEFT JOIN)
    WITH estimate_base AS (
      SELECT 
        e.*,
        c.company AS client_company,
        c.mobile AS client_mobile,
        c.id AS client_id
      FROM public.amc_estimates e
      LEFT JOIN public.clients c ON c.id = e.client_id
      WHERE e.id = :estimateId
      FOR UPDATE OF e   -- ✅ IMPORTANT FIX (lock only e, not left-joined table)
    ),

    ac_details_data AS (
      SELECT 
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', ad.id,
              'ac_type', ad.ac_type,
              'maker', ad.maker,
              'quantity', ad.quantity,
              'tr_ac', ad.tr_ac,
              'rate_per_ac', ad.rate_per_ac,
              'total_rate', (ad.rate_per_ac * ad.quantity)
            )
          ),
          '[]'::json
        ) as details
      FROM public.amcac_details ad
      WHERE ad.amc_estimate_id = :estimateId
    ),

    service_schedules_data AS (
      SELECT 
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', ss.id,
              'service_no', ss.service_no,
              'planned_date', ss.planned_date,
              'status', ss.status,
              'service_completed_date', ss.service_completed_date,
              'notes', ss.notes
            )
            ORDER BY ss.service_no
          ),
          '[]'::json
        ) as service_schedules
      FROM public.amc_service_schedule ss
      WHERE ss.amc_estimate_id = :estimateId
    )

    SELECT 
      eb.*,
      add.details AS details,
      ssd.service_schedules AS service_schedules
    FROM estimate_base eb
    LEFT JOIN ac_details_data add ON true
    LEFT JOIN service_schedules_data ssd ON true
    LIMIT 1;
  `;

  const rows = await db.sequelize.query(sql, {
    type: QueryTypes.SELECT,
    transaction: tx,
    replacements: { estimateId },
  });

  return (rows as any[])[0] || null;
}



  // ✅ PRIVATE: Get Contract by ID
  private static async _getContractById(contractId: string, tx?: Transaction) {
    const sql = `
      SELECT
        c.*,
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', d.id,
              'ac_type', d.ac_type,
              'maker', d.maker,
              'quantity', d.quantity,
              'tr_ac', d.tr_ac,
              'rate_per_ac', d.rate_per_ac,
              'total_rate', d.total_rate
            )
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'::json
        ) AS details,
        COALESCE(
          json_agg(
            jsonb_build_object(
              'id', ss.id,
              'service_no', ss.service_no,
              'planned_date', ss.planned_date,
              'status', ss.status,
              'service_completed_date', ss.service_completed_date,
              'notes', ss.notes
            )
          ) FILTER (WHERE ss.id IS NOT NULL),
          '[]'::json
        ) AS service_schedules
      FROM public.amc_contract c
      LEFT JOIN public.amcac_contract_details d ON d.amc_contract_id = c.id
      LEFT JOIN public.amc_contract_service_schedule ss ON ss.amc_contract_id = c.id
      WHERE c.id = :contractId
      GROUP BY c.id
      LIMIT 1;
    `;

    const rows = await db.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      transaction: tx,
      replacements: { contractId },
    });

    return (rows as any[])[0] || null;
  }

// ✅ NEW: Generate Payment History for Contract
private static async generatePaymentHistoryForContract(
  amcContractId: string,
  startDateStr: string | null,
  endDateStr: string | null,
  installment: string | null,
  totalAmount: number,
  tx: Transaction
) {
  try {
    // Parse installment number (e.g., "4 Installments" -> 4)
    let installmentCount = 1;
    if (installment) {
      const match = installment.match(/(\d+)/);
      if (match) {
        installmentCount = parseInt(match[1]);
      }
    }

    // Calculate amount per installment
    const amountPerInstallment = totalAmount / installmentCount;

    // Calculate dates for each installment
    if (!startDateStr || !endDateStr) return;

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    if (end.getTime() <= start.getTime()) return;

    const diffMs = end.getTime() - start.getTime();
    const stepMs = diffMs / installmentCount;

    // Create payment schedule
    const paymentSchedule: { installment_no: number; payment_date: string; amount: number }[] = [];

    for (let i = 1; i <= installmentCount; i++) {
      const ms = start.getTime() + stepMs * (i - 1);
      const d = new Date(ms);
      
      paymentSchedule.push({
        installment_no: i,
        payment_date: AmcEstimateController.formatDate(d),
        amount: i === installmentCount ? 
          totalAmount - (amountPerInstallment * (installmentCount - 1)) : // Last installment gets remaining amount
          parseFloat(amountPerInstallment.toFixed(2))
      });
    }

    // Insert payment history
    if (paymentSchedule.length > 0) {
  const insertPaymentHistorySQL = `
  INSERT INTO public.amc_payment_history
    (amc_contract_id, payment_date_schedule, amount)  -- ✅ CHANGE HERE
  SELECT
    :amc_contract_id,
    x.payment_date::date,
    x.amount
  FROM jsonb_to_recordset(:schedule::jsonb) AS x(
    installment_no int,
    payment_date text,
    amount numeric
  );
`;

      await db.sequelize.query(insertPaymentHistorySQL, {
        type: QueryTypes.INSERT,
        transaction: tx,
        replacements: {
          amc_contract_id: amcContractId,
          schedule: JSON.stringify(paymentSchedule),
        },
      });
    }

    console.log(`Created ${paymentSchedule.length} payment records for contract ${amcContractId}`);
  } catch (error) {
    console.error("Error generating payment history:", error);
    throw error;
  }
}

  // ✅ PRIVATE: Schedule generator (fills amc_service_schedule) - FIXED DATE CASTING
  private static async generateScheduleForEstimate(
    amcEstimateId: string,
    startDateStr: string | null,
    endDateStr: string | null,
    noOfServices: number | null,
    tx: Transaction
  ) {
    // No services? skip
    if (!noOfServices || noOfServices <= 0) {
      // Clear old schedule if any
      await db.sequelize.query(
        `DELETE FROM public.amc_service_schedule WHERE amc_estimate_id = :id;`,
        {
          type: QueryTypes.DELETE,
          transaction: tx,
          replacements: { id: amcEstimateId },
        }
      );
    } else {
      if (!startDateStr || !endDateStr) return;

      const start = new Date(startDateStr);
      const end = new Date(endDateStr);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
      if (end.getTime() <= start.getTime()) return;

      const diffMs = end.getTime() - start.getTime();
      const stepMs = diffMs / noOfServices;

      const schedule: { service_no: number; planned_date: string }[] = [];

      for (let i = 1; i <= noOfServices; i++) {
        const ms = start.getTime() + stepMs * i;
        const d = new Date(ms);
        schedule.push({
          service_no: i,
          planned_date: AmcEstimateController.formatDate(d),
        });
      }

      // Set last service to exact end_date
      schedule[schedule.length - 1].planned_date = endDateStr;

      // Delete old schedule
      await db.sequelize.query(
        `DELETE FROM public.amc_service_schedule WHERE amc_estimate_id = :id;`,
        {
          type: QueryTypes.DELETE,
          transaction: tx,
          replacements: { id: amcEstimateId },
        }
      );

      // ✅ FIXED: Insert new schedule with proper date casting
      const insertScheduleSQL = `
        INSERT INTO public.amc_service_schedule
          (amc_estimate_id, service_no, planned_date)
        SELECT
          :amc_estimate_id,
          x.service_no,
          x.planned_date::date  -- ✅ CAST to DATE
        FROM jsonb_to_recordset(:schedule::jsonb) AS x(
          service_no int,
          planned_date text
        );
      `;

      await db.sequelize.query(insertScheduleSQL, {
        type: QueryTypes.INSERT,
        transaction: tx,
        replacements: {
          amc_estimate_id: amcEstimateId,
          schedule: JSON.stringify(schedule),
        },
      });
    }
  }

  // ✅ PRIVATE: Date → "YYYY-MM-DD"
  private static formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}