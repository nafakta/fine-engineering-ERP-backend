import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes, Transaction } from "sequelize";
import db from "../models";
import path from "path";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Page, Browser } from "puppeteer";

/* ===== Type Definitions ===== */
interface ContractAcDetail {
  id?: string;
  ac_type: string;
  maker: string;
  quantity: number;
  tr_ac: number;
  rate_per_ac: number;
  total_rate?: number;
  _delete?: boolean;
}

interface ContractServiceSchedule {
  id?: string;
  service_no: number;
  planned_date: string;
  status?: string;
  service_completed_date?: string | null;
  notes?: string | null;
}

interface ContractViewModel {
  doc_title: string;
  doc_label: string;
  logo: string;
  contract_number: string;
  contract_date: string;
  valid_until: string;
  our_company: {
    name: string;
    legal_name: string;
    tax_id: string;
    address_line: string;
    city_state: string;
    phone: string;
    email: string;
  };
  customer: {
    company: string;
    name: string;
    address: string;
    city: string;
    state: string;
    pin_code: string;
    gstin: string;
    contact_person: string;
    designation: string;
    phone: string;
    email: string;
  };
  amc_details: {
    service_type: string;
    service_frequency: string;
    start_date: string;
    end_date: string;
    no_of_services: number;
    working_address: string;
    deal_offer: string;
    deal_offer_description: string;
    payment_date: string;
    installment: string;
    tax_calculation: string;
    notes: string;
  };
  ac_details: any[];
  service_progress: {
    completed: number;
    total: number;
    recent_service: string;
    upcoming_service: string;
  };
    service_schedules: ContractServiceSchedule[];
  financial_summary: {
    subtotal: number;
    gst_percentage: number;
    gst_amount: number;
    grand_total: number;
  };
  amount_in_words: string;
  terms: string[];

  signatures: {
    prepared_by: {
      name: string;
      designation: string;
      date: string;
    };
    accepted_by: {
      name: string;
      designation: string;
      date: string;
    };
  };
}

/* ===== Validation ===== */
const contractDetailSchema = Yup.object({
  id: Yup.string().uuid().optional(),
  ac_type: Yup.string().nullable(),
  maker: Yup.string().nullable(),
  quantity: Yup.number().integer().nullable(),
  tr_ac: Yup.number().integer().nullable(),
  rate_per_ac: Yup.number().nullable(),
  total_rate: Yup.number().nullable(),
  _delete: Yup.boolean().optional(),
});

const createContractSchema = Yup.object({
  client_id: Yup.string().uuid().required("Client ID is required"),
  service_frequency: Yup.string().required("Service frequency is required"),
  start_date: Yup.string().required("Start date is required"),
  end_date: Yup.string().required("End date is required"),
  service_type: Yup.string().required("Service type is required"),
  deal_offer: Yup.string().nullable().optional(),
  payment_date: Yup.string().nullable().optional(),
  installment: Yup.string().nullable().optional(),
  payment_installment: Yup.number().integer().min(0).default(0),
  tax_cal: Yup.string().nullable().optional(),
  no_of_services: Yup.number().integer().min(1).required("Number of services is required"),
  working_address: Yup.string().required("Working address is required"),
  notes: Yup.string().nullable().optional(),
  details: Yup.array().of(contractDetailSchema).default([]),
});

const updateContractSchema = Yup.object({
  id: Yup.string().uuid().required(),
  client_id: Yup.string().uuid().optional(),
  service_frequency: Yup.string().optional(),
  start_date: Yup.string().optional(),
  end_date: Yup.string().optional(),
  service_type: Yup.string().optional(),
  deal_offer: Yup.string().nullable().optional(),
  payment_date: Yup.string().nullable().optional(),
  installment: Yup.string().nullable().optional(),
  payment_installment: Yup.number().integer().min(0).optional(),
  tax_cal: Yup.string().nullable().optional(),
  no_of_services: Yup.number().integer().nullable(),
  working_address: Yup.string().optional(),
  notes: Yup.string().nullable().optional(),
  details: Yup.array().of(contractDetailSchema).default([]),
});

const contractServiceScheduleUpdateSchema = Yup.object({
  schedule_id: Yup.string().uuid().required(),
  status: Yup.string().required(),
  service_completed_date: Yup.string().nullable(),
  notes: Yup.string().nullable(),
});

// ✅ RENEW CONTRACT FORM SCHEMA
const renewContractFormSchema = Yup.object({
  id: Yup.string().uuid().required("Contract ID is required"),
  client_id: Yup.string().uuid().required("Client is required"),
  service_frequency: Yup.string().required("Service Frequency is required"),
  start_date: Yup.string().required("Start Date is required"),
  end_date: Yup.string().required("End Date is required"),
  service_type: Yup.string().required("Service Type is required"),
  deal_offer: Yup.string().nullable().optional(),
  tax_cal: Yup.string().nullable().optional(),
  no_of_services: Yup.number()
    .typeError("No of services must be a number")
    .min(1, "At least 1 service is required")
    .required("No of services is required"),
  working_address: Yup.string().required("Working address is required"),
  notes: Yup.string().nullable().optional(),
  details: Yup.array()
    .of(
      Yup.object().shape({
        ac_type: Yup.string(),
        maker: Yup.string(),
        quantity: Yup.number().typeError("Quantity must be a number"),
        tr_ac: Yup.number().typeError("TR / AC must be a number"),
        rate_per_ac: Yup.number().typeError("Rate / AC must be a number"),
      })
    )
    .test(
      "at-least-one-filled",
      "At least one AC detail must be completely filled",
      function (details) {
        if (!details || details.length === 0) return false;
        const filledDetails = details.filter(
          (detail) =>
            detail.ac_type &&
            detail.ac_type.trim() !== "" &&
            detail.maker &&
            detail.maker.trim() !== "" &&
            detail.quantity &&
            detail.tr_ac &&
            detail.rate_per_ac
        );
        return filledDetails.length > 0;
      }
    ),
});

// ✅ ADD RENEW CONTRACT SCHEMA (simple version)
const renewContractSchema = Yup.object({
  id: Yup.string().uuid().required("Contract ID is required"),
  new_start_date: Yup.string().required("New start date is required"),
  new_end_date: Yup.string().required("New end date is required"),
  new_service_frequency: Yup.string().optional(),
  new_no_of_services: Yup.number().integer().min(1).required("Number of services is required"),
  notes: Yup.string().nullable().optional(),
});

// ✅ SEND TO BILL SCHEMA
const sendToBillSchema = Yup.object({
  id: Yup.string().uuid().required("Contract ID is required"),
});

// Handlebars helpers for Contract PDF
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
// ✅ NEW: Helper for safe HTML display
Handlebars.registerHelper("safeHtml", (text) => {
  if (!text) return "";
  return new Handlebars.SafeString(text);
});

// Template path resolution
async function resolveExistingPath(...segments: string[]): Promise<string | null> {
  const p = path.resolve(...segments);
  try { 
    await fs.access(p); 
    return p; 
  } catch { 
    return null; 
  }
}

async function resolveContractTemplateFile(rel: string): Promise<string> {
  let p = await resolveExistingPath(__dirname, "../templates", rel);
  if (p) return p;
  p = await resolveExistingPath(__dirname, "../../templates", rel);
  if (p) return p;
  throw new Error(`Contract template not found: ${rel}`);
}

const CONTRACT_TEMPLATE_PATH_PROMISE = resolveContractTemplateFile("amc_contract.hbs");

// Logo path resolution
const LOGO_PATH_PROMISE = (async (): Promise<string> => {
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

const ENCODED_LOGO_PROMISE = (async (): Promise<string> => {
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
const sanitizeUuid = (raw: unknown): string => {
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


// ✅ UPDATED: Build AMC Contract View Model for PDF (WITH service_schedules planned_date only)
async function buildAmcContractVM(id: string): Promise<ContractViewModel> {
  const sql = `
    SELECT
      c.*,

      ao.title as deal_offer_title,
      ao.description as deal_offer_description,

      cl.company as client_company,
      cl.client as client_name,
      cl.mobile as client_mobile,
      cl.email_id as client_email,
      cl.city as client_city,
      cl.state as client_state,
      cl.pin_code as client_pin_code,
      cl.gstn as client_gstn,
      cl.address as client_address,
      cl.contact_person as client_contact_person,
      cl.designation as client_designation,
      cl.contact_person_number as client_contact_phone,

      -- ✅ AC Details as JSONB (avoid json equality operator error)
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'ac_type', d.ac_type,
            'maker', d.maker,
            'quantity', d.quantity,
            'tr_ac', d.tr_ac,
            'rate_per_ac', d.rate_per_ac,
            'total_rate', (d.quantity * d.rate_per_ac)
          )
          ORDER BY d.id
        ) FILTER (WHERE d.id IS NOT NULL),
        '[]'::jsonb
      ) AS details,

      -- ✅ Service schedule (only planned_date + service_no) as JSONB
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'service_no', s2.service_no,
              'planned_date', to_char(s2.planned_date, 'DD Mon YYYY')
            )
            ORDER BY s2.service_no
          )
          FROM public.amc_contract_service_schedule s2
          WHERE s2.amc_contract_id = c.id
        ),
        '[]'::jsonb
      ) AS service_schedules,

      -- ✅ Service schedule summary (unchanged)
      COALESCE(s.total_services, 0) AS total_services,
      COALESCE(s.completed_services, 0) AS completed_services,
      s.recent_service_date,
      s.upcoming_service_date

    FROM public.amc_contract c

    LEFT JOIN public.clients cl
      ON cl.id = c.client_id

    LEFT JOIN public.amc_offer ao
      ON ao.id = c.deal_offer

    LEFT JOIN public.amcac_contract_details d
      ON d.amc_contract_id = c.id

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS total_services,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
        MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
        MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
      FROM public.amc_contract_service_schedule s
      WHERE s.amc_contract_id = c.id
    ) s ON TRUE

    WHERE c.id = :id
    GROUP BY
      c.id,
      cl.id,
      ao.title,
      ao.description,
      s.total_services,
      s.completed_services,
      s.recent_service_date,
      s.upcoming_service_date
    LIMIT 1;
  `;

  const rows = await db.sequelize.query(sql, {
    type: db.sequelize.QueryTypes.SELECT,
    replacements: { id },
  });

  const data = (rows as any[])[0];
  if (!data) throw new Error("AMC Contract not found");

  // ✅ Normalize details/service_schedules (Sequelize may return string/object)
  const acDetails: any[] = Array.isArray(data.details) ? data.details : [];
  const serviceSchedules: any[] = Array.isArray(data.service_schedules)
    ? data.service_schedules
    : Array.isArray(data.service_schedules)
      ? data.service_schedules
      : Array.isArray(data.service_schedules)
        ? data.service_schedules
        : Array.isArray(data.service_schedules)
          ? data.service_schedules
          : [];

  // Sometimes alias is exactly "service_schedules"
  const schedulesRaw: any[] = Array.isArray(data.service_schedules)
    ? data.service_schedules
    : Array.isArray(data.service_schedules)
      ? data.service_schedules
      : Array.isArray(data.service_schedules)
        ? data.service_schedules
        : Array.isArray(data.service_schedules)
          ? data.service_schedules
          : Array.isArray(data.service_schedules)
            ? data.service_schedules
            : [];

  const finalSchedules: { service_no: number; planned_date: string }[] =
    (Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : Array.isArray(data.service_schedules) ? data.service_schedules : [])
      .map((x: any) => ({
        service_no: Number(x?.service_no ?? 0),
        planned_date: String(x?.planned_date ?? ""),
      }))
      .filter((x: any) => x.service_no > 0 || x.planned_date);

  // ✅ Calculate subtotal
  const subtotal = (acDetails || []).reduce((total: number, item: any) => {
    const quantity = Number(item.quantity || 0);
    const rate = Number(item.rate_per_ac || 0);
    return total + quantity * rate;
  }, 0);

  // ✅ GST
  const gstPercentage = extractGstPercentage(data.tax_cal);
  const gstAmount = (subtotal * gstPercentage) / 100;
  const grandTotal = subtotal + gstAmount;

  const our_company = {
    name: process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.",
    legal_name:
      process.env.COMPANY_LEGAL ||
      "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
    tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
    address_line:
      process.env.COMPANY_ADDR ||
      "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Naga Near SCLR Road, Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
    city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
    phone:
      process.env.COMPANY_PHONE ||
      "8655 0114 65 / 9920 5299 61 / 9152 1571 14",
    email:
      process.env.COMPANY_EMAIL ||
      "sales.compressindia@gmail.com / info@compressindia.com",
    website:
      process.env.COMPANY_WEBSITE ||
      "www.compressindia.in / www.compressindia.com / www.compressindia.co.in",
  };

  const logoDataUrl = await ENCODED_LOGO_PROMISE;

  const vm: ContractViewModel = {
    doc_title: "AMC CONTRACT",
    doc_label: "Contract Number",
    logo: logoDataUrl,

    contract_number: data.amc_contract_no || data.id,
    contract_date: new Date(data.created_at || new Date()).toLocaleDateString("en-IN"),
    valid_until: new Date(data.end_date).toLocaleDateString("en-IN"),

    our_company,

    customer: {
      company: data.client_company || "",
      name: data.client_name || "",
      address: data.client_address || data.working_address || "",
      city: data.client_city || "",
      state: data.client_state || "",
      pin_code: data.client_pin_code || "",
      gstin: data.client_gstn || "",
      contact_person: data.client_contact_person || data.client_name || "",
      designation: data.client_designation || "",
      phone: data.client_contact_phone || data.client_mobile || "",
      email: data.client_email || "",
    },

    amc_details: {
      service_type: data.service_type || "",
      service_frequency: data.service_frequency || "",
      start_date: new Date(data.start_date).toLocaleDateString("en-IN"),
      end_date: new Date(data.end_date).toLocaleDateString("en-IN"),
      no_of_services: data.no_of_services || 0,
      working_address: data.working_address || "",
      deal_offer: data.deal_offer_title || data.deal_offer || "None",
      deal_offer_description: data.deal_offer_description || "",
      payment_date: data.payment_date
        ? new Date(data.payment_date).toLocaleDateString("en-IN")
        : "To be discussed",
      installment: data.installment || "Not specified",
      tax_calculation: data.tax_cal || "As applicable",
      notes: data.notes || "",
    },

    ac_details: acDetails || [],

    service_progress: {
      completed: data.completed_services || 0,
      total: data.total_services || data.no_of_services || 0,
      recent_service: data.recent_service_date
        ? new Date(data.recent_service_date).toLocaleDateString("en-IN")
        : "None",
      upcoming_service: data.upcoming_service_date
        ? new Date(data.upcoming_service_date).toLocaleDateString("en-IN")
        : "None",
    },

    financial_summary: {
      subtotal,
      gst_percentage: gstPercentage,
      gst_amount: gstAmount,
      grand_total: grandTotal,
    },

    amount_in_words: `INR ${inWordsIndian(grandTotal)}`,

    terms: [
      "This contract is valid for the duration specified above.",
      "Services will be provided as per the agreed schedule.",
      "Any additional services not covered in this AMC will be charged separately.",
      "Payment terms: As per the agreed schedule.",
      "All disputes are subject to Mumbai jurisdiction.",
      "This contract supersedes all previous agreements.",
    ],

    // ✅ REQUIRED FIELD (only planned_date will be shown in PDF)
    service_schedules: finalSchedules,

    signatures: {
      prepared_by: {
        name: "Authorized Signatory",
        designation: "Service Manager",
        date: new Date().toLocaleDateString("en-IN"),
      },
      accepted_by: {
        name: "___________________",
        designation: "Client Authorized Signatory",
        date: "___________________",
      },
    },
  };

  return vm;
}




async function renderAmcContractPdfBuffer(id: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    const vm = await buildAmcContractVM(id);
    const hbsPath = await CONTRACT_TEMPLATE_PATH_PROMISE;
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
        await fs.writeFile(path.resolve(process.cwd(), "amc-contract-debug.html"), html);
        console.warn("PDF generation produced a very small buffer — debug HTML written to amc-contract-debug.html");
      } catch { }
      throw new Error("AMC Contract PDF generation failed (empty or too small buffer). Check amc-contract-debug.html");
    }

    return pdfBuffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to render AMC Contract PDF: ${msg}`);
  } finally {
    try {
      await browser?.close();
    } catch {
      // ignore close errors
    }
  }
}

/* ===== Controller ===== */
export class AmcContractController {
  // ✅ CREATE NEW CONTRACT - POST /api/amc-contracts
  static async create(req: Request, res: Response): Promise<Response> {
    try {
      const payload = await createContractSchema.validate(req.body, {
        abortEarly: false,
      });
      
      const { details = [], ...contractData } = payload;

      const result = await db.sequelize.transaction(async (tx: Transaction) => {
        // First verify client exists
        const client = await db.sequelize.query(
          `SELECT id, company, client, mobile, email_id, address, city, state, pin_code, gstn, 
                  contact_person, designation, contact_person_number 
           FROM public.clients WHERE id = :client_id`,
          {
            type: QueryTypes.SELECT,
            transaction: tx,
            replacements: { client_id: contractData.client_id },
          }
        );

        if (!client || client.length === 0) {
          throw new Error("Client not found");
        }

        // Create the contract with correct fields - is_send_to_bill column remove kiya
        const createContractSQL = `
          INSERT INTO public.amc_contract (
            client_id, company_name, service_frequency, start_date, end_date, service_type,
            deal_offer, payment_date, installment, payment_installment, tax_cal, no_of_services, working_address,
            notes
          ) VALUES (
            :client_id, :company_name, :service_frequency, :start_date, :end_date, :service_type,
            :deal_offer, :payment_date, :installment, :payment_installment, :tax_cal, :no_of_services, :working_address,
            :notes
          ) RETURNING *;
        `;

        const replacements = {
          ...contractData,
          company_name: client[0].company || 'Default Company',
          payment_installment: contractData.payment_installment || 0
          // is_send_to_bill explicitly set nahi karna, database default false use hoga
        };

        const [contractRows] = await db.sequelize.query(createContractSQL, {
          type: QueryTypes.INSERT,
          transaction: tx,
          replacements,
        });

        const contract = (contractRows as any[])[0];
        if (!contract) {
          throw new Error("Failed to create contract");
        }

        // Create AC details if provided
        if (Array.isArray(details) && details.length > 0) {
          const validDetails = details.filter(
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

          if (validDetails.length > 0) {
            const bulkInsertSQL = `
              INSERT INTO public.amcac_contract_details
                (amc_contract_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
              VALUES ${validDetails.map((_, index) => 
                `(:amc_contract_id, :ac_type_${index}, :maker_${index}, :quantity_${index}, :tr_ac_${index}, :rate_per_ac_${index})`
              ).join(', ')}
            `;
            
            const detailReplacements: any = { amc_contract_id: contract.id };
            validDetails.forEach((detail, index) => {
              detailReplacements[`ac_type_${index}`] = detail.ac_type;
              detailReplacements[`maker_${index}`] = detail.maker;
              detailReplacements[`quantity_${index}`] = detail.quantity;
              detailReplacements[`tr_ac_${index}`] = detail.tr_ac;
              detailReplacements[`rate_per_ac_${index}`] = detail.rate_per_ac;
            });

            await db.sequelize.query(bulkInsertSQL, {
              type: QueryTypes.INSERT,
              transaction: tx,
              replacements: detailReplacements,
            });
          }
        }

        // Generate service schedules based on no_of_services and frequency
        await AmcContractController.generateServiceSchedules(contract.id, contractData, tx);

        return await AmcContractController._getByIdRaw(contract.id, tx);
      });

      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      console.error("AMC Contract create error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message || "Internal server error" 
      });
    }
  }

// ✅ LIST ALL CONTRACTS - POST /api/amc-contracts (pagination body mein)
static async list(req: Request, res: Response): Promise<Response> {
  try {
    // Body se page aur limit lo
    const page = Math.max(parseInt(String(req.body?.page ?? 1)), 1);
    const limit = Math.min(Math.max(parseInt(String(req.body?.limit ?? 10)), 1), 100);
    const offset = (page - 1) * limit;

    // Total count nikal lo
    const countSQL = `
      SELECT COUNT(*) AS total_count
      FROM public.amc_contract c
    `;

    const countResult = await db.sequelize.query(countSQL, {
      type: QueryTypes.SELECT,
    });

    const totalCount = parseInt((countResult[0] as any)?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    // Data with pagination
    const dataSQL = `
      SELECT
        c.*,
        c.is_send_to_bill,
        c.is_expired,
        c.is_renewed,
        ao.title AS deal_offer_title,
        ao.description AS deal_offer_description,
        cl.id AS client_id,
        cl.company AS client_company,
        cl.client AS client_name,
        cl.mobile AS client_mobile,
        cl.email_id AS client_email,
        cl.contact_person AS client_contact_person,
        cl.designation AS client_designation,
        cl.contact_person_number AS client_contact_phone,
        d.details,
        s.service_schedules,
        COALESCE(s_summary.total_services, 0) AS total_services,
        COALESCE(s_summary.completed_services, 0) AS completed_services,
        CONCAT(
          COALESCE(s_summary.completed_services, 0),
          '/',
          COALESCE(
            NULLIF(s_summary.total_services, 0),
            NULLIF(c.no_of_services, 0),
            0
          )
        ) AS service_progress,
        s_summary.recent_service_date,
        s_summary.upcoming_service_date,
        CASE 
          WHEN c.installment IS NULL OR c.installment = '' THEN 'N/A'
          WHEN c.payment_installment >= CAST(REGEXP_REPLACE(c.installment, '[^0-9]', '', 'g') AS INTEGER) THEN 'Paid'
          WHEN c.payment_installment > 0 THEN CONCAT(c.payment_installment, '/', REGEXP_REPLACE(c.installment, '[^0-9]', '', 'g'))
          ELSE 'Unpaid'
        END AS payment_status
      FROM public.amc_contract c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
      LEFT JOIN public.amc_offer ao ON ao.id = c.deal_offer
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            jsonb_build_object(
              'id', d.id,
              'ac_type', d.ac_type,
              'maker', d.maker,
              'quantity', d.quantity,
              'tr_ac', d.tr_ac,
              'rate_per_ac', d.rate_per_ac,
              'total_rate', (d.quantity * d.rate_per_ac)
            ) ORDER BY d.id
          ),
          '[]'::json
        ) AS details
        FROM public.amcac_contract_details d
        WHERE d.amc_contract_id = c.id
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
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
        FROM public.amc_contract_service_schedule ss
        WHERE ss.amc_contract_id = c.id
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_services,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
          MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
          MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
        FROM public.amc_contract_service_schedule ss
        WHERE ss.amc_contract_id = c.id
      ) s_summary ON TRUE
      ORDER BY c.created_at DESC
      LIMIT :limit OFFSET :offset
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
    console.error("AMC Contract list error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

  // ✅ GET CONTRACT BY ID - POST /api/amc-contracts
  static async getById(req: Request, res: Response): Promise<Response> {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) {
        return res
          .status(400)
          .json({ success: false, error: "id is required" });
      }

      const data = await AmcContractController._getByIdRaw(id);
      if (!data) {
        return res.status(404).json({ success: false, error: "Contract not found" });
      }

      return res.json({ success: true, data });
    } catch (err) {
      console.error("AMC Contract getById error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ UPDATE CONTRACT - POST /api/amc-contracts-update
  static async update(req: Request, res: Response): Promise<Response> {
    try {
      const payload = await updateContractSchema.validate(req.body, {
        abortEarly: false,
      });
      const { id, details = [], ...contractData } = payload;

      const result = await db.sequelize.transaction(async (tx: Transaction) => {
        const updates: string[] = [];
        const replacements: Record<string, any> = { id };

        // Build update fields dynamically
        [
          "client_id",
          "service_frequency",
          "start_date",
          "end_date",
          "service_type",
          "deal_offer",
          "payment_date",
          "installment",
          "payment_installment",
          "tax_cal",
          "no_of_services",
          "working_address",
          "notes",
        ].forEach((field) => {
          if (field in contractData) {
            updates.push(`${field} = :${field}`);
            replacements[field] = (contractData as any)[field];
          }
        });

        // Add updated_at timestamp
        updates.push("updated_at = NOW()");

        if (updates.length > 0) {
          const updateSQL = `UPDATE public.amc_contract SET ${updates.join(", ")} WHERE id = :id;`;
          await db.sequelize.query(updateSQL, {
            type: QueryTypes.UPDATE,
            transaction: tx,
            replacements,
          });
        }

        // Smart AC Details Management
        if (Array.isArray(details)) {
          await AmcContractController.manageContractDetails(id, details, tx);
        }

        // Return updated contract data
        return await AmcContractController._getByIdRaw(id, tx);
      });

      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      console.error("AMC Contract update error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ GET CONTRACT DATA FOR RENEWAL - POST /api/amc-contracts-renew-data
  static async getRenewData(req: Request, res: Response): Promise<Response> {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) {
        return res.status(400).json({ success: false, error: "id is required" });
      }

      // Get contract data with details
      const sql = `
        SELECT
          c.*,
          cl.company as client_company,
          cl.client as client_name,
          cl.mobile as client_mobile,
          cl.email_id as client_email,
          cl.city as client_city,
          cl.state as client_state,
          cl.pin_code as client_pin_code,
          cl.gstn as client_gstn,
          cl.address as client_address,
          cl.contact_person as client_contact_person,
          cl.designation as client_designation,
          cl.contact_person_number as client_contact_phone,
          
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
              ORDER BY d.id
            ) FILTER (WHERE d.id IS NOT NULL),
            '[]'::json
          ) AS details
          
        FROM public.amc_contract c
        LEFT JOIN public.clients cl ON cl.id = c.client_id
        LEFT JOIN public.amcac_contract_details d ON d.amc_contract_id = c.id
        WHERE c.id = :id
        GROUP BY c.id, cl.id
        LIMIT 1;
      `;

      const rows = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { id },
      });

      const data = (rows as any[])[0];
      if (!data) {
        return res.status(404).json({ success: false, error: "Contract not found" });
      }

      return res.json({ success: true, data });
    } catch (err: any) {
      console.error("AMC Contract get renew data error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message || "Internal server error" 
      });
    }
  }

// ✅ RENEW CONTRACT WITH FORM DATA - POST /api/amc-contracts-renew-form
static async renewWithForm(req: Request, res: Response): Promise<Response> {
  const t = await db.sequelize.transaction();
  
  try {
    console.log("🔄 Renew contract with form data - Request Body:", req.body);
    
    const payload = await renewContractFormSchema.validate(req.body, {
      abortEarly: false,
    });
    
    const { 
      id: oldContractId, 
      client_id,
      service_frequency,
      start_date,
      end_date,
      service_type,
      deal_offer,
      tax_cal,
      no_of_services,
      working_address,
      notes,
      details = []
    } = payload;

    console.log("🔄 Starting contract renewal process for ID:", oldContractId);

    // Step 1: Get the old contract data for reference
    const oldContractSQL = `
      SELECT 
        c.*,
        cl.company as client_company
      FROM public.amc_contract c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
      WHERE c.id = :oldContractId
      LIMIT 1;
    `;

    const oldContractRows = await db.sequelize.query(oldContractSQL, {
      type: QueryTypes.SELECT,
      transaction: t,
      replacements: { oldContractId },
    });

    if (oldContractRows.length === 0) {
      await t.rollback();
      return res.status(404).json({ 
        success: false, 
        error: "Old contract not found" 
      });
    }

    const oldContract = (oldContractRows as any[])[0];

    // Step 2: Check if contract is already renewed
    if (oldContract.is_renewed) {
      await t.rollback();
      return res.status(400).json({ 
        success: false, 
        error: "Contract has already been renewed" 
      });
    }

    // Step 3: Generate new contract number
    const newContractNo = `REN-${oldContract.amc_contract_no || oldContract.id.substring(0, 8)}-${Date.now().toString().slice(-4)}`;
    
    // Step 4: Create new contract with form data (NEW RECORD WITH DEFAULT VALUES)
    const createNewContractSQL = `
      INSERT INTO public.amc_contract (
        client_id,
        company_name,
        service_frequency,
        start_date,
        end_date,
        service_type,
        deal_offer,
        tax_cal,
        no_of_services,
        working_address,
        notes,
        installment,
        payment_installment,
        amc_contract_no,
        created_at,
        updated_at
      ) VALUES (
        :client_id,
        :company_name,
        :service_frequency,
        :start_date,
        :end_date,
        :service_type,
        :deal_offer,
        :tax_cal,
        :no_of_services,
        :working_address,
        :notes,
        :installment,
        :payment_installment,
        :amc_contract_no,
        NOW(), -- created_at
        NOW()  -- updated_at
      ) RETURNING *;
    `;

    const newContractReplacements = {
      client_id,
      company_name: oldContract.client_company || "Company",
      service_frequency,
      start_date,
      end_date,
      service_type,
      deal_offer,
      tax_cal,
      no_of_services,
      working_address,
      notes: notes || `Renewed from contract ${oldContract.amc_contract_no || oldContract.id}`,
      installment: oldContract.installment || null,
      payment_installment: 0, // Reset payment for new contract
      amc_contract_no: newContractNo,
      // is_send_to_bill explicitly set nahi karna, database default false use hoga
    };

    console.log("🔄 Creating new contract with data:", newContractReplacements);

    const [newContractRows] = await db.sequelize.query(createNewContractSQL, {
      type: QueryTypes.INSERT,
      transaction: t,
      replacements: newContractReplacements,
    });

    const newContract = (newContractRows as any[])[0];
    if (!newContract) {
      await t.rollback();
      throw new Error("Failed to create new contract");
    }

    console.log("✅ New contract created with ID:", newContract.id);

    // Step 5: Add AC details from form data
    if (Array.isArray(details) && details.length > 0) {
      const validDetails = details.filter(
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

      if (validDetails.length > 0) {
        const values = validDetails.map((detail: any, index: number) => 
          `(:amc_contract_id, :ac_type_${index}, :maker_${index}, :quantity_${index}, :tr_ac_${index}, :rate_per_ac_${index})`
        ).join(', ');

        const bulkInsertSQL = `
          INSERT INTO public.amcac_contract_details
            (amc_contract_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
          VALUES ${values}
        `;
        
        const detailReplacements: any = { amc_contract_id: newContract.id };
        validDetails.forEach((detail: any, index: number) => {
          detailReplacements[`ac_type_${index}`] = detail.ac_type;
          detailReplacements[`maker_${index}`] = detail.maker;
          detailReplacements[`quantity_${index}`] = detail.quantity;
          detailReplacements[`tr_ac_${index}`] = detail.tr_ac;
          detailReplacements[`rate_per_ac_${index}`] = detail.rate_per_ac;
        });

        await db.sequelize.query(bulkInsertSQL, {
          type: QueryTypes.INSERT,
          transaction: t,
          replacements: detailReplacements,
        });
        
        console.log(`✅ Added ${validDetails.length} AC details to new contract`);
      }
    }

    // Step 6: Generate service schedules for new contract
    const serviceScheduleData = {
      no_of_services,
      start_date,
      end_date,
      service_frequency
    };
    
    await AmcContractController.generateServiceSchedules(newContract.id, serviceScheduleData, t);
    console.log("✅ Service schedules generated for new contract");

    // Step 7: Mark old contract as renewed (BAS YEHI KARNA HAI)
    const updateOldContractSQL = `
      UPDATE public.amc_contract 
      SET 
        is_renewed = true,
        updated_at = NOW()
      WHERE id = :oldContractId
      RETURNING *;
    `;

    await db.sequelize.query(updateOldContractSQL, {
      type: QueryTypes.UPDATE,
      transaction: t,
      replacements: { oldContractId },
    });

    console.log("✅ Old contract marked as renewed");

    // Step 8: Get the new contract data
    const newContractData = await AmcContractController._getByIdRaw(newContract.id, t);

    // Commit transaction
    await t.commit();
    console.log("✅ Transaction committed successfully");

    return res.json({ 
      success: true, 
      message: "Contract renewed successfully",
      data: {
        old_contract_id: oldContractId,
        new_contract_id: newContract.id,
        new_contract_no: newContractNo,
        new_contract: newContractData
      }
    });

  } catch (err: any) {
    await t.rollback();
    console.error("❌ AMC Contract renew error:", err);
    
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, error: err.errors });
    }
    
    return res.status(500).json({ 
      success: false, 
      error: err.message || "Internal server error" 
    });
  }
}

// ✅ RENEW CONTRACT - POST /api/amc-contracts-renew
static async renew(req: Request, res: Response): Promise<Response> {
  const t = await db.sequelize.transaction();
  
  try {
    const payload = await renewContractSchema.validate(req.body, {
      abortEarly: false,
    });
    
    const { 
      id: oldContractId, 
      new_start_date, 
      new_end_date, 
      new_service_frequency, 
      new_no_of_services,
      notes 
    } = payload;

    console.log("🔄 Renewing contract:", { oldContractId, new_start_date, new_end_date });

    // Step 1: Get the old contract data
    const oldContractSQL = `
      SELECT 
        c.*,
        cl.company as client_company
      FROM public.amc_contract c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
      WHERE c.id = :oldContractId
      LIMIT 1;
    `;

    const oldContractRows = await db.sequelize.query(oldContractSQL, {
      type: QueryTypes.SELECT,
      transaction: t,
      replacements: { oldContractId },
    });

    if (oldContractRows.length === 0) {
      await t.rollback();
      return res.status(404).json({ 
        success: false, 
        error: "Old contract not found" 
      });
    }

    const oldContract = (oldContractRows as any[])[0];

    // Step 2: Check if contract is already renewed
    if (oldContract.is_renewed) {
      await t.rollback();
      return res.status(400).json({ 
        success: false, 
        error: "Contract has already been renewed" 
      });
    }

    // Step 3: Generate new contract number
    const newContractNo = `REN-${oldContract.amc_contract_no || oldContract.id.substring(0, 8)}`;
    
    // Step 4: Create new contract (copy all data from old contract) - WITHOUT is_expired/is_renewed
    const createNewContractSQL = `
      INSERT INTO public.amc_contract (
        client_id,
        company_name,
        service_frequency,
        start_date,
        end_date,
        service_type,
        deal_offer,
        tax_cal,
        no_of_services,
        working_address,
        notes,
        installment,
        payment_installment,
        amc_contract_no,
        created_at,
        updated_at
      ) VALUES (
        :client_id,
        :company_name,
        :new_service_frequency,
        :new_start_date,
        :new_end_date,
        :service_type,
        :deal_offer,
        :tax_cal,
        :new_no_of_services,
        :working_address,
        :notes,
        :installment,
        :payment_installment,
        :amc_contract_no,
        NOW(), -- created_at
        NOW()  -- updated_at
      ) RETURNING *;
    `;

    const newContractReplacements = {
      client_id: oldContract.client_id,
      company_name: oldContract.company_name || oldContract.client_company || "Company",
      new_service_frequency: new_service_frequency || oldContract.service_frequency,
      new_start_date,
      new_end_date,
      service_type: oldContract.service_type,
      deal_offer: oldContract.deal_offer,
      tax_cal: oldContract.tax_cal,
      new_no_of_services,
      working_address: oldContract.working_address,
      notes: notes || `Renewed from contract ${oldContract.amc_contract_no || oldContract.id}`,
      installment: oldContract.installment || null,
      payment_installment: 0, // Reset payment for new contract
      amc_contract_no: newContractNo,
      // is_send_to_bill explicitly set nahi karna, database default false use hoga
    };

    const [newContractRows] = await db.sequelize.query(createNewContractSQL, {
      type: QueryTypes.INSERT,
      transaction: t,
      replacements: newContractReplacements,
    });

    const newContract = (newContractRows as any[])[0];
    if (!newContract) {
      await t.rollback();
      throw new Error("Failed to create new contract");
    }

    // Step 5: Copy AC details from old contract to new contract
    const acDetailsSQL = `
      SELECT * FROM public.amcac_contract_details 
      WHERE amc_contract_id = :oldContractId;
    `;
    
    const acDetailsRows = await db.sequelize.query(acDetailsSQL, {
      type: QueryTypes.SELECT,
      transaction: t,
      replacements: { oldContractId },
    });

    if (Array.isArray(acDetailsRows) && acDetailsRows.length > 0) {
      const values = acDetailsRows.map((detail: any, index: number) => 
        `(:amc_contract_id, :ac_type_${index}, :maker_${index}, :quantity_${index}, :tr_ac_${index}, :rate_per_ac_${index})`
      ).join(', ');

      const bulkInsertSQL = `
        INSERT INTO public.amcac_contract_details
          (amc_contract_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
        VALUES ${values}
      `;
      
      const detailReplacements: any = { amc_contract_id: newContract.id };
      acDetailsRows.forEach((detail: any, index: number) => {
        detailReplacements[`ac_type_${index}`] = detail.ac_type;
        detailReplacements[`maker_${index}`] = detail.maker;
        detailReplacements[`quantity_${index}`] = detail.quantity;
        detailReplacements[`tr_ac_${index}`] = detail.tr_ac;
        detailReplacements[`rate_per_ac_${index}`] = detail.rate_per_ac;
      });

      await db.sequelize.query(bulkInsertSQL, {
        type: QueryTypes.INSERT,
        transaction: t,
        replacements: detailReplacements,
      });
    }

    // Step 6: Generate service schedules for new contract
    const serviceScheduleData = {
      no_of_services: new_no_of_services,
      start_date: new_start_date,
      end_date: new_end_date,
      service_frequency: new_service_frequency || oldContract.service_frequency
    };
    
    await AmcContractController.generateServiceSchedules(newContract.id, serviceScheduleData, t);

    // Step 7: Mark old contract as renewed (BAS YEHI KARNA HAI)
    const updateOldContractSQL = `
      UPDATE public.amc_contract 
      SET 
        is_renewed = true,
        updated_at = NOW()
      WHERE id = :oldContractId
      RETURNING *;
    `;

    await db.sequelize.query(updateOldContractSQL, {
      type: QueryTypes.UPDATE,
      transaction: t,
      replacements: { oldContractId },
    });

    // Step 8: Get the new contract data
    const newContractData = await AmcContractController._getByIdRaw(newContract.id, t);

    // Commit transaction
    await t.commit();

    return res.json({ 
      success: true, 
      message: "Contract renewed successfully",
      data: {
        old_contract_id: oldContractId,
        new_contract_id: newContract.id,
        new_contract_no: newContractNo,
        new_contract: newContractData
      }
    });

  } catch (err: any) {
    await t.rollback();
    console.error("❌ AMC Contract renew error:", err);
    
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, error: err.errors });
    }
    
    return res.status(500).json({ 
      success: false, 
      error: err.message || "Internal server error" 
    });
  }
}

// ✅ MARK CONTRACT AS RENEWED - POST /api/amc-contracts-renew
static async expire(req: Request, res: Response): Promise<Response> {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: "Contract ID is required" 
      });
    }

    const updateSQL = `
      UPDATE public.amc_contract 
      SET 
        is_renewed = true,
        updated_at = NOW()
      WHERE 
        id = :id 
        AND is_renewed = false
      RETURNING *;
    `;

    const [updatedRows] = await db.sequelize.query(updateSQL, {
      type: QueryTypes.UPDATE,
      replacements: { id },
    });

    if (!updatedRows || (updatedRows as any[]).length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Contract not found or already marked as renewed" 
      });
    }

    return res.json({ 
      success: true, 
      message: "Contract marked as renewed",
      data: (updatedRows as any[])[0]
    });

  } catch (err: any) {
    console.error("AMC Contract mark as renewed error:", err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || "Internal server error" 
    });
  }
}

  // ✅ UPDATE SERVICE SCHEDULE STATUS - POST /api/amc-contracts-schedule-update
  static async updateServiceSchedule(req: Request, res: Response): Promise<Response> {
    try {
      console.log("🔍 UPDATE SERVICE SCHEDULE REQUEST BODY:", req.body);
      
      const payload = await contractServiceScheduleUpdateSchema.validate(req.body, { 
        abortEarly: false 
      });
      const { schedule_id, status, service_completed_date, notes } = payload;

      console.log("🔍 PARSED PAYLOAD - Schedule ID:", schedule_id);
      console.log("🔍 PARSED PAYLOAD - Status:", status);

      // ✅ PEHLE CHECK KARO SCHEDULE EXIST KARTA HAI YA NAHI
      const checkSQL = `SELECT * FROM public.amc_contract_service_schedule WHERE id = :schedule_id`;
      const existingSchedules = await db.sequelize.query(checkSQL, {
        type: QueryTypes.SELECT,
        replacements: { schedule_id },
      });

      console.log("🔍 FOUND SCHEDULES IN DATABASE:", existingSchedules);

      if (!existingSchedules || (existingSchedules as any[]).length === 0) {
        console.log("❌ SCHEDULE NOT FOUND WITH ID:", schedule_id);
        return res.status(404).json({
          success: false,
          error: `Service schedule not found with ID: ${schedule_id}`,
        });
      }

      // Treat empty string as NULL
      const completedDate =
        service_completed_date && service_completed_date.trim() !== ""
          ? service_completed_date
          : null;

      const safeNotes = notes && notes.trim() !== "" ? notes.trim() : null;

      console.log("🔍 FINAL UPDATE VALUES:", {
        schedule_id,
        status,
        service_completed_date: completedDate,
        notes: safeNotes,
      });

      // ✅ FIXED: Use schedule_id in the SQL query
      const updateSQL = `
        UPDATE public.amc_contract_service_schedule
        SET
          status = :status,
          service_completed_date = :service_completed_date,
          notes = :notes
        WHERE id = :schedule_id
        RETURNING *;
      `;

      const [rows] = await db.sequelize.query(updateSQL, {
        type: QueryTypes.UPDATE,
        replacements: {
          schedule_id,
          status,
          service_completed_date: completedDate,
          notes: safeNotes,
        },
      });

      console.log("✅ UPDATE SUCCESSFUL - ROWS UPDATED:", rows);

      if (!rows || (rows as any[]).length === 0) {
        return res.status(404).json({
          success: false,
          error: "Service schedule not found after update attempt",
        });
      }

      return res.json({
        success: true,
        message: "Service schedule updated successfully",
        data: (rows as any[])[0],
      });
    } catch (err: any) {
      console.error("❌ AMC Contract service schedule update error:", err);
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error",
        details: err.message 
      });
    }
  }

  // ✅ UPDATE PAYMENT - POST /api/amc-contracts-update-payment
  static async updatePayment(req: Request, res: Response): Promise<Response> {
    try {
      const { id, payment_date } = req.body;

      if (!id || !payment_date) {
        return res.status(400).json({ 
          success: false, 
          error: "Contract ID and Payment Date are required" 
        });
      }

      const updateSQL = `
        UPDATE public.amc_contract 
        SET 
          payment_date = :payment_date,
          payment_installment = COALESCE(payment_installment, 0) + 1,
          updated_at = NOW()
        WHERE id = :id
        RETURNING *;
      `;

      const [updatedRows] = await db.sequelize.query(updateSQL, {
        type: QueryTypes.UPDATE,
        replacements: { id, payment_date },
      });

      if (!updatedRows || (updatedRows as any[]).length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: "Contract not found" 
        });
      }

      return res.json({ 
        success: true, 
        message: "Payment updated successfully",
        data: (updatedRows as any[])[0]
      });

    } catch (err: any) {
      console.error("AMC Contract payment update error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message || "Internal server error" 
      });
    }
  }

  // ✅ SEND TO BILL - POST /api/amc-contracts-send-to-bill
  static async sendToBill(req: Request, res: Response): Promise<Response> {
    try {
      const payload = await sendToBillSchema.validate(req.body, {
        abortEarly: false,
      });
      
      const { id } = payload;

      console.log("📤 Sending contract to bill - Contract ID:", id);

      // Update is_send_to_bill to true
      const updateSQL = `
        UPDATE public.amc_contract 
        SET 
          is_send_to_bill = true,
          updated_at = NOW()
        WHERE id = :id
        RETURNING *;
      `;

      const [updatedRows] = await db.sequelize.query(updateSQL, {
        type: QueryTypes.UPDATE,
        replacements: { id },
      });

      if (!updatedRows || (updatedRows as any[]).length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: "Contract not found" 
        });
      }

      const updatedContract = (updatedRows as any[])[0];

      console.log("✅ Contract sent to bill successfully:", {
        contract_id: updatedContract.id,
        contract_no: updatedContract.amc_contract_no,
        is_send_to_bill: updatedContract.is_send_to_bill
      });

      return res.json({ 
        success: true, 
        message: "Contract sent to bill successfully",
        data: updatedContract
      });

    } catch (err: any) {
      console.error("❌ AMC Contract send to bill error:", err);
      
      if (err?.name === "ValidationError") {
        return res.status(400).json({ success: false, error: err.errors });
      }
      
      return res.status(500).json({ 
        success: false, 
        error: err.message || "Internal server error" 
      });
    }
  }

  
  // ✅ DELETE CONTRACT - POST /api/amc-contracts-delete
  static async remove(req: Request, res: Response): Promise<Response> {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) {
        return res
          .status(400)
          .json({ success: false, error: "id is required" });
      }

      await db.sequelize.transaction(async (tx: Transaction) => {
        // Delete related records first
        await db.sequelize.query(
          `DELETE FROM public.amcac_contract_details WHERE amc_contract_id = :id;`,
          { type: QueryTypes.DELETE, transaction: tx, replacements: { id } }
        );

        await db.sequelize.query(
          `DELETE FROM public.amc_contract_service_schedule WHERE amc_contract_id = :id;`,
          { type: QueryTypes.DELETE, transaction: tx, replacements: { id } }
        );

        // Delete the contract
        await db.sequelize.query(
          `DELETE FROM public.amc_contract WHERE id = :id;`,
          { type: QueryTypes.DELETE, transaction: tx, replacements: { id } }
        );
      });

      return res.json({ success: true, message: "Contract deleted successfully" });
    } catch (err) {
      console.error("AMC Contract delete error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ UPDATED: GET CONTRACT HISTORY - POST /api/amc-contracts-history
  static async history(req: Request, res: Response): Promise<Response> {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) {
        return res
          .status(400)
          .json({ success: false, error: "id is required" });
      }

      const sql = `
        SELECT
          c.*,
          -- ✅ AMC OFFER DETAILS (TITLE AUR DESCRIPTION)
          ao.title as deal_offer_title,
          ao.description as deal_offer_description,
          
          cl.company as client_company,
          cl.client as client_name,
          cl.mobile as client_mobile,
          cl.email_id as client_email,
          cl.city as client_city,
          cl.state as client_state,
          cl.pin_code as client_pin_code,
          cl.gstn as client_gstn,
          cl.address as client_address,
          cl.contact_person as client_contact_person,
          cl.designation as client_designation,
          cl.contact_person_number as client_contact_phone,

          -- AC DETAILS ARRAY
          d.details,

          -- FULL SERVICE SCHEDULE
          s.service_schedules,

          -- PAYMENT HISTORY
          p.payment_history

        FROM public.amc_contract c

        -- Join with clients table
        LEFT JOIN public.clients cl ON cl.id = c.client_id
        
        -- ✅ JOIN WITH AMC OFFER TABLE FOR DEAL OFFER TITLE
        LEFT JOIN public.amc_offer ao ON ao.id = c.deal_offer

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
                  'total_rate', (d.quantity * d.rate_per_ac)
                )
                ORDER BY d.id
              ),
              '[]'::json
            ) AS details
          FROM public.amcac_contract_details d
          WHERE d.amc_contract_id = c.id
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
                ORDER BY s.service_no
              ),
              '[]'::json
            ) AS service_schedules
          FROM public.amc_contract_service_schedule s
          WHERE s.amc_contract_id = c.id
        ) s ON TRUE

        -- Payment History
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id', p.id,
                  'payment_date_schedule', p.payment_date_schedule,
                  'amount', p.amount
                )
                ORDER BY p.payment_date_schedule
              ),
              '[]'::json
            ) AS payment_history
          FROM public.amc_payment_history p
          WHERE p.amc_contract_id = c.id
        ) p ON TRUE

        WHERE c.id = :id
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
          .json({ success: false, error: "AMC contract not found" });
      }

      return res.json({ success: true, data });
    } catch (err) {
      console.error("AMC Contract history error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  }

  // ✅ PRINT CONTRACT HTML - GET /api/amc-contracts-print/html/:id
  static async printAmcContractHtml(req: Request, res: Response): Promise<void> {
    try {
      console.log("Contract HTML Route Hit - ID:", req.params.id);
      const id = sanitizeUuid(req.params.id);
      if (!id) {
        res.status(400).type("text/plain").send("Invalid or missing AMC Contract id");
        return;
      }

      const vm = await buildAmcContractVM(id);
      const hbsPath = await CONTRACT_TEMPLATE_PATH_PROMISE;
      const tpl = await fs.readFile(hbsPath, "utf-8");
      const html = Handlebars.compile(tpl)(vm);

      res.status(200).type("html").send(html);
      return;
    } catch (err: any) {
      console.error("AMC Contract HTML render error:", err);
      res.status(500).type("text/plain").send(`Failed to render HTML: ${err?.message || err}`);
      return;
    }
  }

  // ✅ PRINT CONTRACT PDF - GET /api/amc-contracts-print/pdf/:id
  static async printAmcContractPdf(req: Request, res: Response): Promise<void> {
    try {
      console.log("Contract PDF Route Hit - ID:", req.params.id);
      console.log("Query params:", req.query);
      
      const id = sanitizeUuid(req.params.id);
      if (!id) {
        console.log("Invalid Contract ID provided");
        res.status(400).type("text/plain").send("Invalid or missing AMC Contract id");
        return;
      }

      console.log("Generating Contract PDF for ID:", id);
      const pdfBuffer = await renderAmcContractPdfBuffer(id);
      
      // ✅ Get the contract data to get amc_contract_no
      const vm = await buildAmcContractVM(id);
      const download = String(req.query.dl || req.query.download) === "1";
      
      // ✅ Use amc_contract_no in filename if available
      const filename = `AMC-Contract-${vm.contract_number}.pdf`;

      console.log("Contract PDF generated successfully, size:", pdfBuffer.length);
      console.log("Filename:", filename);
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
      
      res.end(pdfBuffer);
      return;
    } catch (err: any) {
      console.error("AMC Contract PDF render error:", err);
      res.status(500).type("text/plain").send(`Failed to render PDF: ${err?.message || err}`);
      return;
    }
  }


// ✅ GET AMC DATA (TOTAL, RUNNING, EXPIRED) - GET /api/amc-contracts/amc-data
static async getAmcData(req: Request, res: Response): Promise<Response> {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Query to get counts excluding renewed contracts from all categories
    const sql = `
      SELECT
        -- Total only non-renewed contracts
        COUNT(*) FILTER (WHERE is_renewed = false) as total_amc,
        
        -- Running contracts: end_date >= today AND not renewed
        COUNT(*) FILTER (WHERE end_date >= :today AND is_renewed = false) as running_amc,
        
        -- Expired contracts: end_date < today AND not renewed
        COUNT(*) FILTER (WHERE end_date < :today AND is_renewed = false) as expired_amc
      FROM public.amc_contract;
    `;

    const rows = await db.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      replacements: { today: todayStr },
    });

    const result = (rows as any[])[0] || {};

    return res.json({ 
      success: true, 
      data: {
        total_amc: parseInt(result.total_amc) || 0,
        running_amc: parseInt(result.running_amc) || 0,
        expired_amc: parseInt(result.expired_amc) || 0
      },
      timestamp: new Date().toISOString(),
      today: todayStr
    });
  } catch (err: any) {
    console.error("AMC Contract data error:", err);
    return res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      details: err.message 
    });
  }
}
  
  // ✅ GET AMC AMOUNT DATA WITH GST - GET /api/amc-contracts/amc-amount-data
  static async getAmcAmountData(req: Request, res: Response): Promise<Response> {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Query to get amounts with GST calculation
      const sql = `
        SELECT
          -- Total amount with GST (all contracts)
          COALESCE(
            SUM(
              d.quantity * d.rate_per_ac * 
              (1 + COALESCE(
                CAST(REGEXP_REPLACE(c.tax_cal, '[^0-9.]', '', 'g') AS DECIMAL) / 100,
                0
              ))
            ),
            0
          ) as total_amount_with_gst,
          
          -- Running amount with GST (active contracts)
          COALESCE(
            SUM(
              d.quantity * d.rate_per_ac * 
              (1 + COALESCE(
                CAST(REGEXP_REPLACE(c.tax_cal, '[^0-9.]', '', 'g') AS DECIMAL) / 100,
                0
              ))
            ) FILTER (WHERE c.end_date >= :today),
            0
          ) as running_amount_with_gst,
          
          -- Expired amount with GST (completed contracts)
          COALESCE(
            SUM(
              d.quantity * d.rate_per_ac * 
              (1 + COALESCE(
                CAST(REGEXP_REPLACE(c.tax_cal, '[^0-9.]', '', 'g') AS DECIMAL) / 100,
                0
              ))
            ) FILTER (WHERE c.end_date < :today),
            0
          ) as expired_amount_with_gst
        FROM public.amc_contract c
        LEFT JOIN public.amcac_contract_details d ON d.amc_contract_id = c.id;
      `;

      const rows = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { today: todayStr },
      });

      const result = (rows as any[])[0] || {};

      return res.json({ 
        success: true, 
        data: {
          total_amount_with_gst: parseFloat(result.total_amount_with_gst) || 0,
          running_amount_with_gst: parseFloat(result.running_amount_with_gst) || 0,
          expired_amount_with_gst: parseFloat(result.expired_amount_with_gst) || 0
        },
        timestamp: new Date().toISOString(),
        today: todayStr
      });
    } catch (err: any) {
      console.error("AMC Contract amount data error:", err);
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error",
        details: err.message 
      });
    }
  }

// ✅ SEARCH CONTRACTS WITH CLIENT (REQUIRED) AND DATE FILTERS (OPTIONAL) - POST /api/amc-contracts/search
static async search(req: Request, res: Response): Promise<Response> {
  try {
    const { 
      client_id,
      start_date,
      end_date,
      start_date_from,
      start_date_to,
      end_date_from,
      end_date_to,
      page = 1, 
      limit = 10 
    } = req.body;

    // Validation - only client_id is required
    if (!client_id) {
      return res.status(400).json({ 
        success: false, 
        error: "Client ID is required" 
      });
    }

    const pageNum = Math.max(parseInt(String(page)), 1);
    const limitNum = Math.min(Math.max(parseInt(String(limit)), 1), 100);
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE conditions
    let whereConditions: string[] = ["c.client_id = :client_id"];
    const replacements: Record<string, any> = { client_id };

    // Exact start date filter
    if (start_date) {
      whereConditions.push("c.start_date = :start_date");
      replacements.start_date = start_date;
    }

    // Exact end date filter
    if (end_date) {
      whereConditions.push("c.end_date = :end_date");
      replacements.end_date = end_date;
    }

    // Start date range (optional)
    if (start_date_from) {
      whereConditions.push("c.start_date >= :start_date_from");
      replacements.start_date_from = start_date_from;
    }

    if (start_date_to) {
      whereConditions.push("c.start_date <= :start_date_to");
      replacements.start_date_to = start_date_to;
    }

    // End date range (optional)
    if (end_date_from) {
      whereConditions.push("c.end_date >= :end_date_from");
      replacements.end_date_from = end_date_from;
    }

    if (end_date_to) {
      whereConditions.push("c.end_date <= :end_date_to");
      replacements.end_date_to = end_date_to;
    }

    // Build WHERE clause
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    // Count total matching records
    const countSQL = `
      SELECT COUNT(*) AS total_count
      FROM public.amc_contract c
      ${whereClause}
    `;

    const countResult = await db.sequelize.query(countSQL, {
      type: QueryTypes.SELECT,
      replacements,
    });

    const totalCount = parseInt((countResult[0] as any)?.total_count || 0);
    const totalPages = Math.ceil(totalCount / limitNum);

    // Add pagination to replacements
    replacements.limit = limitNum;
    replacements.offset = offset;

    // Data query
    const dataSQL = `
      SELECT
        c.*,
        c.is_send_to_bill,
        c.is_expired,
        c.is_renewed,
        ao.title AS deal_offer_title,
        ao.description AS deal_offer_description,
        cl.id AS client_id,
        cl.company AS client_company,
        cl.client AS client_name,
        cl.mobile AS client_mobile,
        cl.email_id AS client_email,
        cl.contact_person AS client_contact_person,
        cl.designation AS client_designation,
        cl.contact_person_number AS client_contact_phone,
        d.details,
        s.service_schedules,
        COALESCE(s_summary.total_services, 0) AS total_services,
        COALESCE(s_summary.completed_services, 0) AS completed_services,
        CONCAT(
          COALESCE(s_summary.completed_services, 0),
          '/',
          COALESCE(
            NULLIF(s_summary.total_services, 0),
            NULLIF(c.no_of_services, 0),
            0
          )
        ) AS service_progress,
        s_summary.recent_service_date,
        s_summary.upcoming_service_date,
        CASE 
          WHEN c.installment IS NULL OR c.installment = '' THEN 'N/A'
          WHEN c.payment_installment >= CAST(REGEXP_REPLACE(c.installment, '[^0-9]', '', 'g') AS INTEGER) THEN 'Paid'
          WHEN c.payment_installment > 0 THEN CONCAT(c.payment_installment, '/', REGEXP_REPLACE(c.installment, '[^0-9]', '', 'g'))
          ELSE 'Unpaid'
        END AS payment_status
      FROM public.amc_contract c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
      LEFT JOIN public.amc_offer ao ON ao.id = c.deal_offer
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            jsonb_build_object(
              'id', d.id,
              'ac_type', d.ac_type,
              'maker', d.maker,
              'quantity', d.quantity,
              'tr_ac', d.tr_ac,
              'rate_per_ac', d.rate_per_ac,
              'total_rate', (d.quantity * d.rate_per_ac)
            ) ORDER BY d.id
          ),
          '[]'::json
        ) AS details
        FROM public.amcac_contract_details d
        WHERE d.amc_contract_id = c.id
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(
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
        FROM public.amc_contract_service_schedule ss
        WHERE ss.amc_contract_id = c.id
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_services,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_services,
          MAX(service_completed_date) FILTER (WHERE status = 'COMPLETED') AS recent_service_date,
          MIN(planned_date) FILTER (WHERE status <> 'COMPLETED' OR status IS NULL) AS upcoming_service_date
        FROM public.amc_contract_service_schedule ss
        WHERE ss.amc_contract_id = c.id
      ) s_summary ON TRUE
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT :limit OFFSET :offset
    `;

    const rows = await db.sequelize.query(dataSQL, {
      type: QueryTypes.SELECT,
      replacements,
    });

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
      filters_applied: {
        client_id,
        start_date,
        end_date,
        start_date_from,
        start_date_to,
        end_date_from,
        end_date_to
      }
    });
  } catch (err: any) {
    console.error("AMC Contract search error:", err);
    return res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      details: err.message 
    });
  }
}

  // ✅ GET AMC TR DATA - GET /api/amc-contracts/amc-tr-data
  static async getAmcTrData(req: Request, res: Response): Promise<Response> {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Query to get TR (Ton of Refrigeration) data
      const sql = `
        SELECT
          -- Total TR: sum of (quantity * tr_ac) for all AC details
          COALESCE(SUM(d.quantity * d.tr_ac), 0) as total_tr,
          
          -- Running TR: sum for active contracts (end_date >= today)
          COALESCE(SUM(d.quantity * d.tr_ac) FILTER (WHERE c.end_date >= :today), 0) as running_tr,
          
          -- Expired TR: sum for expired contracts (end_date < today)
          COALESCE(SUM(d.quantity * d.tr_ac) FILTER (WHERE c.end_date < :today), 0) as expired_tr
        FROM public.amcac_contract_details d
        INNER JOIN public.amc_contract c ON c.id = d.amc_contract_id
        WHERE d.tr_ac IS NOT NULL AND d.quantity IS NOT NULL;
      `;

      const rows = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements: { today: todayStr },
      });

      const result = (rows as any[])[0] || {};

      return res.json({ 
        success: true, 
        data: {
          total_tr: parseInt(result.total_tr) || 0,
          running_tr: parseInt(result.running_tr) || 0,
          expired_tr: parseInt(result.expired_tr) || 0
        },
        timestamp: new Date().toISOString(),
        today: todayStr
      });
    } catch (err: any) {
      console.error("AMC Contract TR data error:", err);
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error",
        details: err.message 
      });
    }
  }
  
  // ✅ UPDATED: PRIVATE: Get contract by ID with AMC Offer details
  private static async _getByIdRaw(id: string, tx?: Transaction): Promise<any> {
    const sql = `
      SELECT
        c.*,
        -- ✅ AMC OFFER DETAILS (TITLE AUR DESCRIPTION)
        ao.title as deal_offer_title,
        ao.description as deal_offer_description,
        
        cl.company as client_company,
        cl.client as client_name,
        cl.mobile as client_mobile,
        cl.email_id as client_email,
        cl.city as client_city,
        cl.state as client_state,
        cl.pin_code as client_pin_code,
        cl.gstn as client_gstn,
        cl.address as client_address,
        cl.contact_person as client_contact_person,
        cl.designation as client_designation,
        cl.contact_person_number as client_contact_phone,
        
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
            ORDER BY d.id
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'::json
        ) AS details
      FROM public.amc_contract c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
      -- ✅ JOIN WITH AMC OFFER TABLE
      LEFT JOIN public.amc_offer ao ON ao.id = c.deal_offer
      LEFT JOIN public.amcac_contract_details d
        ON d.amc_contract_id = c.id
      WHERE c.id = :id
      GROUP BY c.id, cl.id, ao.title, ao.description;
    `;
    
    const rows = await db.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      transaction: tx,
      replacements: { id },
    });
    
    return (rows as any[])[0] || null;
  }

  // ✅ PRIVATE: Manage contract AC details
  private static async manageContractDetails(
    contractId: string, 
    details: any[], 
    tx: Transaction
  ): Promise<void> {
    // Step 1: Fetch existing details
    const existingDetails = await db.sequelize.query(
      `SELECT id, ac_type, maker, quantity, tr_ac, rate_per_ac 
       FROM public.amcac_contract_details 
       WHERE amc_contract_id = :id`,
      {
        type: QueryTypes.SELECT,
        transaction: tx,
        replacements: { id: contractId },
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
          amc_contract_id: contractId,
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
        `DELETE FROM public.amcac_contract_details WHERE id IN (:detailsToDelete)`,
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
        `UPDATE public.amcac_contract_details 
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
      const values = detailsToCreate.map((detail, index) => 
        `(:amc_contract_id, :ac_type_${index}, :maker_${index}, :quantity_${index}, :tr_ac_${index}, :rate_per_ac_${index})`
      ).join(', ');

      const bulkInsertSQL = `
        INSERT INTO public.amcac_contract_details
          (amc_contract_id, ac_type, maker, quantity, tr_ac, rate_per_ac)
        VALUES ${values}
      `;
      
      const detailReplacements: any = { amc_contract_id: contractId };
      detailsToCreate.forEach((detail, index) => {
        detailReplacements[`ac_type_${index}`] = detail.ac_type;
        detailReplacements[`maker_${index}`] = detail.maker;
        detailReplacements[`quantity_${index}`] = detail.quantity;
        detailReplacements[`tr_ac_${index}`] = detail.tr_ac;
        detailReplacements[`rate_per_ac_${index}`] = detail.rate_per_ac;
      });

      await db.sequelize.query(bulkInsertSQL, {
        type: QueryTypes.INSERT,
        transaction: tx,
        replacements: detailReplacements,
      });
    }
  }

  // ✅ PRIVATE: Generate service schedules based on contract parameters
  private static async generateServiceSchedules(
    contractId: string,
    contractData: any,
    tx: Transaction
  ): Promise<void> {
    const { no_of_services, start_date, end_date, service_frequency } = contractData;
    
    if (!no_of_services || no_of_services <= 0) return;

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const totalDuration = endDate.getTime() - startDate.getTime();
    const interval = totalDuration / no_of_services;

    const schedules = [];

    for (let i = 0; i < no_of_services; i++) {
      const plannedDate = new Date(startDate.getTime() + (interval * i));
      
      schedules.push({
        amc_contract_id: contractId,
        service_no: i + 1,
        planned_date: plannedDate.toISOString().split('T')[0],
        status: 'PENDING',
        service_completed_date: null,
        notes: null
      });
    }

    if (schedules.length > 0) {
      const values = schedules.map((schedule, index) => 
        `(:amc_contract_id, :service_no_${index}, :planned_date_${index}, :status_${index}, :service_completed_date_${index}, :notes_${index})`
      ).join(', ');

      const bulkInsertSQL = `
        INSERT INTO public.amc_contract_service_schedule
          (amc_contract_id, service_no, planned_date, status, service_completed_date, notes)
        VALUES ${values}
      `;
      
      const scheduleReplacements: any = { amc_contract_id: contractId };
      schedules.forEach((schedule, index) => {
        scheduleReplacements[`service_no_${index}`] = schedule.service_no;
        scheduleReplacements[`planned_date_${index}`] = schedule.planned_date;
        scheduleReplacements[`status_${index}`] = schedule.status;
        scheduleReplacements[`service_completed_date_${index}`] = schedule.service_completed_date;
        scheduleReplacements[`notes_${index}`] = schedule.notes;
      });

      await db.sequelize.query(bulkInsertSQL, {
        type: QueryTypes.INSERT,
        transaction: tx,
        replacements: scheduleReplacements,
      });
    }
  }
}