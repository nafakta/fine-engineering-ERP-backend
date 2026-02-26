// controllers/Validations.ts
import * as Yup from "yup";
import * as yup from "yup";

/* ---------------- Shared helpers ---------------- */
const E164_PHONE = /^\+\d{1,3}\d{10}$/; // +<cc><10digits>
const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const uuid = () => yup.string().matches(UUID_RX, "Must be a valid UUID");

/* ---------------- Users ---------------- */
export const createUserSchema = Yup.object().shape({
  name: Yup.string().required("Name is required"),
  mobile_number: Yup.string()
    .matches(
      E164_PHONE,
      "Mobile number must include country code and be in the format +<country_code><number>"
    )
    .required("Mobile number is required"),
  email: Yup.string().email("Invalid email format").required("Email is required"),
  password: Yup.string()
    .min(6, "Password must be at least 6 characters")
    .required("Password is required"),
  roleLevel: Yup.number()
    .typeError("Role level must be a number")
    .required("Role level is required"),
  departmentId: Yup.string().optional(),
}).noUnknown(true);

// Define Yup schema for login user
export const loginSchema = Yup.object().shape({
  email: Yup.string().email("Invalid email format").required("Email is required"),
  password: Yup.string().required("Password is required"),
}).noUnknown(true);

// Define Yup schema for userId
export const getUserDetailsSchema = Yup.object({
  id: Yup.string().required("User ID is required"),
}).noUnknown(true);

// Define Yup schema for updating user details
export const updateUserSchema = Yup.object({
  name: Yup.string().optional(),
  mobile_number: Yup.string()
    .matches(
      E164_PHONE,
      "Mobile number must include country code and be in the format +<country_code><number>"
    )
    .optional(),
  email: Yup.string().email("Invalid email format").optional(),
}).noUnknown(true);

// Define Yup schema for getalluser details
export const getAllUsersSchema = Yup.object().shape({
  page: Yup.number().min(1).default(1), // Optional pagination, defaulting to page 1
  pageSize: Yup.number().min(1).max(100).default(10), // Optional page size, defaulting to 10
}).noUnknown(true);

// Define Yup schema for delete user
export const deleteUserSchema = Yup.object().shape({
  id: Yup.string().required("User ID is required"),
}).noUnknown(true);

// Define Yup schema for verifytotp
export const verifytotpSchema = Yup.object().shape({
  token: Yup.string().required("token is required"),
  secretKey: Yup.string().required("SecretKey is required"),
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for fetchsecretkey
export const fetchsecretkeySchema = Yup.object().shape({
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for deletesecretkey
export const deletesecretkeySchema = Yup.object().shape({
  userId: Yup.string().required("userId is required"),
}).noUnknown(true);

// Define Yup schema for resetpassword
export const resetPasswordSchema = Yup.object()
  .shape({
    email: Yup.string().email("Invalid email format").optional(),
    mobile_number: Yup.string()
      .matches(
        E164_PHONE,
        "Mobile number must include country code and be in the format +<country_code><number>"
      )
      .optional(),
    new_password: Yup.string()
      .min(6, "Password must be at least 6 characters")
      .max(20, "Password must be at most 20 characters")
      .notOneOf(
        ["123456", "password", "12345678", "qwerty", "abc123"],
        "Weak password is not allowed"
      )
      .required("New password is required"),
  })
  .test(
    "email-or-mobile",
    "Either email or mobile_number is required",
    (v) => !!(v?.email || v?.mobile_number)
  )
  .noUnknown(true);

export const logUserActivitySchema = Yup.object().shape({
  userId: Yup.string().required("User ID is required"),
  userActivity: Yup.string().required("userActivity is required"),
  module: Yup.string().required("Module is required"), // Ensure module is required
  type: Yup.string().required("Type is required"), // Ensure type is required
}).noUnknown(true);

export const filteruseractivitySchema = Yup.object({
  uuId: Yup.string(),
  userActivity: Yup.string(),
  startDate: Yup.date().typeError(
    "startDate must be a valid date (YYYY-MM-DD format)"
  ),
  endDate: Yup.date().typeError(
    "endDate must be a valid date (YYYY-MM-DD format)"
  ),
  module: Yup.string(),
  type: Yup.string(),
})
  .test(
    "at-least-one-field",
    "At least one filter field is required",
    (value) =>
      !!Object.values(value || {}).filter((v) => v !== undefined && v !== "")
        .length
  )
  .test("date-order", "endDate must be on/after startDate", (v) => {
    if (v?.startDate && v?.endDate) return v.endDate >= v.startDate;
    return true;
  })
  .noUnknown(true);

/* ---------------- Vendors ---------------- */
export const createVendorSchema = yup
  .object({
    company: yup.string().trim().max(255).required(),
    vendor: yup.string().trim().max(255).required(),
    mobile: yup.string().trim().max(20).nullable(),
    email_id: yup.string().trim().email().max(255).nullable(),
    city: yup.string().trim().max(100).nullable(),
    state: yup.string().trim().max(100).nullable(),
    pin_code: yup.string().trim().max(10).nullable(),
    gstin: yup.string().trim().max(20).nullable(),
    category: yup.string().trim().max(100).nullable(),
    address: yup.string().trim().nullable(),
    shipping_address: Yup.string().trim().nullable(),
    site_issue: Yup.string().trim().nullable().optional(),
  })
  .noUnknown(true);

export const updateVendorSchema = createVendorSchema.partial().noUnknown(true);

/* ---------------- Expenses (for your Expense CRUD) ---------------- */
export const createExpenseSchema = yup
  .object({
    user_id: uuid().required("user_id is required"),
    reason: yup.string().trim().max(255).required("reason is required"),
    amount: yup
      .number()
      .typeError("amount must be a number")
      .moreThan(0, "amount must be > 0")
      .max(999999999999.99)
      .required("amount is required"),
    expense_date: yup
      .string()
      .matches(ISO_DATE_RX, "expense_date must be YYYY-MM-DD")
      .required("expense_date is required"),
    transaction_date: yup
      .string()
      .matches(ISO_DATE_RX, "transaction_date must be YYYY-MM-DD")
      .nullable()
      .optional(),
    pay_from: uuid().required("pay_from is required"), // references accounts.id
    description: yup.string().trim().nullable(),
  })
  .noUnknown(true);

export const updateExpenseSchema = yup
  .object({
    reason: yup.string().trim().max(255),
    amount: yup
      .number()
      .typeError("amount must be a number")
      .moreThan(0, "amount must be > 0")
      .max(999999999999.99),
    expense_date: yup
      .string()
      .matches(ISO_DATE_RX, "expense_date must be YYYY-MM-DD"),
    transaction_date: yup
      .string()
      .matches(ISO_DATE_RX, "transaction_date must be YYYY-MM-DD"),
    pay_from: uuid(),
    description: yup.string().trim().nullable(),
  })
  .noUnknown(true);

export const listExpenseQuerySchema = yup
  .object({
    page: yup.number().min(1).default(1),
    pageSize: yup.number().min(1).max(100).default(10),
    startDate: yup
      .string()
      .matches(ISO_DATE_RX, { message: "startDate must be YYYY-MM-DD", excludeEmptyString: true })
      .optional(),
    endDate: yup
      .string()
      .matches(ISO_DATE_RX, { message: "endDate must be YYYY-MM-DD", excludeEmptyString: true })
      .optional(),
    accountId: uuid().optional(),
    search: yup.string().trim().optional(), // reason/description search
  })
  .noUnknown(true);

export const createMarketSchema = yup.object({
  company_name: yup.string().max(255).required(),
  customer_name: yup.string().max(255).required(),
  mobile: yup.string().max(20).nullable(),
  email_id: yup.string().email().max(255).nullable(),
  location: yup.string().max(255).nullable(),
  status: yup.string().max(100).nullable(),
  assign_to_senior: yup.string().max(100),
  review: yup.string().nullable(),
});

export const updateMarketSchema = createMarketSchema.noUnknown(true).shape({
  company_name: yup.string().max(255).optional(),
  customer_name: yup.string().max(255).optional(),
});

export const createTicketSchema = Yup.object({
  caller_id: Yup.string().trim().required(),
  // ❌ REMOVED: market_id, company_name
  // ✅ ADDED: client_id
  client_id: Yup.string().uuid().nullable(),
  subject: Yup.string().trim().required(),
  status: Yup.string().trim().required(),
  category: Yup.string().trim().nullable(),
  priority: Yup.string().trim().nullable(),
  assigned_to: Yup.string().trim().nullable(),
  description: Yup.string().trim().nullable(),
  created_by: Yup.string().uuid().nullable(),

  // ✅ existing fields
  shipping_address: Yup.string().trim().nullable(),
  type: Yup.string().trim().nullable(), // column "type"
});

export const updateTicketSchema = Yup.object({
  caller_id: Yup.string().trim().optional(),
  // ❌ REMOVED: market_id, company_name
  // ✅ ADDED: client_id
  client_id: Yup.string().uuid().nullable().optional(),
  subject: Yup.string().trim().optional(),
  status: Yup.string().trim().optional(),
  category: Yup.string().trim().nullable().optional(),
  priority: Yup.string().trim().nullable().optional(),
  assigned_to: Yup.string().trim().nullable().optional(),
  description: Yup.string().trim().nullable().optional(),
  created_by: Yup.string().uuid().nullable().optional(),

  // ✅ existing fields
  shipping_address: Yup.string().trim().nullable().optional(),
  type: Yup.string().trim().nullable().optional(),

  // if you later add closed_at:
  closed_at: Yup.date().optional(),
});

// --- PO Item schema: accept qty OR quantity, normalize to quantity ---
const POItemSchema = yup
  .object({
    item: yup.string().required('Item name is required'), // Changed from item_desc to item
    description: yup.string().required('Description is required'), // Added
    unit: yup.string().trim().required("unit is required"),
    hsn_sac: yup.string().trim().max(10).nullable(),

    // NEW: make field
    make: yup.string().trim().nullable(),

    // Allow qty as an input alias but strip it from the final value
    qty: yup
      .number()
      .transform((value, originalValue) => {
        const n = Number(originalValue);
        return Number.isNaN(n) ? undefined : n;
      })
      .nullable()
      .strip(true),

    // IMPORTANT: normalize qty -> quantity using `this.parent`
    quantity: yup
      .number()
      .transform(function (value, originalValue) {
        const hasQuantity =
          value !== undefined && value !== null && !Number.isNaN(value);
        if (hasQuantity) return value;

        const q = (this as any)?.parent?.qty;
        const n = Number(q);
        return Number.isNaN(n) ? value : n;
      })
      .typeError("quantity must be a number")
      .moreThan(0, "quantity must be greater than 0")
      .required("quantity is required"),

    rate: yup
      .number()
      .typeError("rate must be a number")
      .min(0, "rate must be >= 0")
      .required("rate is required"),
  })
  .noUnknown(true);

// --- CREATE PO ---
export const CreatePOSchema = yup
  .object({
    vendor_id: yup
      .string()
      .matches(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        "Must be a valid UUID"
      )
      .required("vendor_id is required"),

    delivery_address: yup.string().trim().nullable(),
    delivery_phone: yup.string().trim().nullable(),
    notes: yup.string().trim().nullable(),
    purchase_type: Yup.string()
      .oneOf(["air_conditioning", "HVAC"], "Purchase type must be either 'air_conditioning' or 'HVAC'")
      .nullable(),
    status: yup
      .string()
      .oneOf(["draft", "approved", "cancelled"])
      .default("draft"),
    shipping_address: Yup.string().nullable().optional(),
    shipping_state: Yup.string().nullable().optional(),
    site_issue: Yup.string().nullable(),
    // reuse POItemSchema so qty→quantity + make work here too
    items: yup
      .array()
      .of(POItemSchema)
      .min(1, "At least one item is required")
      .required("items is required"),
  })
  .noUnknown(true);

// --- UPDATE PO ---
export const UpdatePOSchema = yup
  .object({
    vendor_id: yup.string().uuid().optional(),
    delivery_address: yup.string().trim().nullable().optional(),
    delivery_phone: yup.string().trim().nullable().optional(),
    notes: yup.string().trim().nullable().optional(),
    status: yup
      .string()
      .oneOf(["draft", "approved", "cancelled"])
      .optional(),
    shipping_address: Yup.string().nullable().optional(),
    shipping_state: Yup.string().nullable().optional(),
    site_issue: Yup.string().nullable(),

    items: yup
      .array()
      .of(POItemSchema)
      .min(1, "At least one item is required")
      .required("items is required"),
  })
  .noUnknown(true);

export const createClientSchema = Yup.object().shape({
  department: Yup.string().nullable(),
  company: Yup.string().nullable(),
  client: Yup.string().required("Client name is required"),
  mobile: Yup.string().matches(/^[0-9]{10}$/, "Invalid mobile number").required(),
  email_id: Yup.string().email("Invalid email format").required(),
  city: Yup.string().nullable(),
  state: Yup.string().nullable(),
  pin_code: Yup.string().nullable(),
  gstn: Yup.string().nullable(),
  category: Yup.string().nullable(),
  address: Yup.string().nullable(),
  shipping_city: Yup.string().nullable(),
  shipping_state: Yup.string().nullable(),
  shipping_pincode: Yup.string().nullable(),
  shipping_address: Yup.string().nullable(),
  updated_by: Yup.string().nullable(),
});

export const updateClientSchema = Yup.object().shape({
  department: Yup.string().nullable(),
  company: Yup.string().nullable(),
  client: Yup.string().nullable(),
  mobile: Yup.string().matches(/^[0-9]{10}$/, "Invalid mobile number"),
  email_id: Yup.string().email("Invalid email format"),
  city: Yup.string().nullable(),
  state: Yup.string().nullable(),
  pin_code: Yup.string().nullable(),
  gstn: Yup.string().nullable(),
  category: Yup.string().nullable(),
  address: Yup.string().nullable(),
  shipping_city: Yup.string().nullable(),
  shipping_state: Yup.string().nullable(),
  shipping_pincode: Yup.string().nullable(),
  shipping_address: Yup.string().nullable(),
  updated_by: Yup.string().nullable(),
});

export const deleteClientSchema = Yup.object().shape({
  id: Yup.string().required("Client ID is required"),
});

export const EstimateItemSchema = Yup.object({
  // ✅ NEW FIELDS - replace item_desc with item_name and description
  item_name: Yup.string().trim().required("Item name is required"),
  description: Yup.string().trim().nullable(),

  unit: Yup.string().trim().nullable(),
  hsn_sac: Yup.string().trim().nullable(),
  make: Yup.string().trim().nullable(),

  qty: Yup.number()
    .transform(function (value, originalValue) {
      const hasQty = value !== undefined && value !== null && !Number.isNaN(value);
      if (hasQty) return value;

      const qFromQuantity = (this as any)?.parent?.quantity;
      const n = Number(qFromQuantity);
      return Number.isNaN(n) ? value : n;
    })
    .typeError("Qty must be a number")
    .moreThan(0, "Qty must be > 0")
    .required("Qty is required"),

  rate: Yup.number()
    .typeError("Rate must be a number")
    .min(0, "Rate cannot be negative")
    .required("Rate is required"),
}).noUnknown(true);

export const CreateEstimateSchema = Yup.object({
  client_id: Yup.string().required("Client ID is required"),
  subject: Yup.string().nullable(),
  shipping_address: Yup.string().nullable(),
  shipping_state: Yup.string().optional().nullable(),
  tax_scheme: Yup.string()
    .required()
    .matches(/^(no\s*tax|\d+(\.\d+)?%?)$/i, "Use like 'No Tax' or '18%'"),
  service_type: Yup.string()              // ✅ NEW
    .nullable()
    .max(100),
  tds: Yup.number().min(0).default(0),
  discount_value: Yup.number().min(0).default(0),
  discount_type: Yup.mixed<"none" | "percent" | "flat">().oneOf(["none", "percent", "flat"]).default("none"),
  notes: Yup.string().nullable(),

  // Use the fixed EstimateItemSchema instead of inline object
  items: Yup.array().of(EstimateItemSchema).min(1).required(),
});

export const UpdateEstimateSchema = Yup.object({
  client_id: Yup.string().uuid("Invalid client_id").optional(),
  subject: Yup.string().trim().nullable(),
  shipping_address: Yup.string().trim().nullable(),
  tax_scheme: Yup.string().trim().optional(),
  service_type: Yup.string()              // ✅ NEW
    .nullable()
    .max(100),
  tds: Yup.number().typeError("TDS must be a number").min(0).optional(),
  discount_value: Yup.number().typeError("Discount value must be a number").min(0).optional(),
  discount_type: Yup.mixed<"none" | "percent" | "flat">().oneOf(["none", "percent", "flat"]).optional(),
  notes: Yup.string().trim().nullable(),
  items: Yup.array().of(EstimateItemSchema).min(1, "At least one item is required").required(),
}).noUnknown(true);

export const createFollowupSchema = Yup.object({
  ticket_id: Yup.string().uuid().required("ticket_id is required"),
  followup_date: Yup.string()
    .matches(/^\d{4}-\d{2}-\d{2}$/, "followup_date must be YYYY-MM-DD")
    .required("followup_date is required"),
  notes: Yup.string().trim().optional(),
  attendant_name: yup.string().required("Attendant name is required"), // Add this
  technician_name: yup.string().required("Technician name is required"), // Add this
});

export const updateFollowupSchema = Yup.object({
  followup_date: Yup.string()
    .matches(/^\d{4}-\d{2}-\d{2}$/, "followup_date must be YYYY-MM-DD")
    .optional(),
  notes: Yup.string().trim().optional(),
  // paths are updated through upload endpoint; but allow optional manual overwrite:
  customer_signature_path: Yup.string().trim().optional(),
  technician_signature_path: Yup.string().trim().optional(),
});

export const createHVACTicketSchema = Yup.object({
  caller_id: Yup.string().required(),
  subject: Yup.string().required(),
  status: Yup.string().required(),
  client_id: Yup.string().uuid().nullable(), // NEW: replaced market_id
  category: Yup.string().nullable(),
  priority: Yup.string().nullable(),
  assigned_to: Yup.string().nullable(),
  description: Yup.string().nullable(),
  shipping_address: Yup.string().nullable(),
  type: Yup.string().nullable(),
});

export const updateHVACTicketSchema = Yup.object({
  caller_id: Yup.string().optional(),
  subject: Yup.string().optional(),
  status: Yup.string().optional(),
  client_id: Yup.string().uuid().nullable().optional(), // NEW: replaced market_id
  category: Yup.string().nullable().optional(),
  priority: Yup.string().nullable().optional(),
  assigned_to: Yup.string().nullable().optional(),
  description: Yup.string().nullable().optional(),
  shipping_address: Yup.string().nullable().optional(),
  type: Yup.string().nullable().optional(),
});

export const uploadVendorDocSchema = Yup.object({
  vendor_id: Yup.string().uuid().required(),
  document_type: Yup.mixed<"gst_certificate" | "msme_certificate" | "aadhaar_card" | "pan_card" | "attachment">()
    .oneOf(["gst_certificate", "msme_certificate", "aadhaar_card", "pan_card", "attachment"])
    .required(),
});

// Fixed CreateBoqSchema with files support
export const CreateBoqSchema = yup.object().shape({
  title: yup.string().required("Title is required").max(500),
  currency: yup
    .string()
    .length(3, "Currency must be 3 characters")
    .default("INR"),
  notes: yup.string().nullable().max(2000),
  status: yup
    .string()
    .oneOf(["draft", "approved", "cancelled"])
    .default("draft"),
  items: yup
    .array()
    .of(
      yup.object().shape({
        section_label: yup.string().nullable().max(200),
        item_code: yup.string().nullable().max(100),
        make: yup.string().nullable().max(200), // Changed from required to nullable
        description: yup
          .string()
          .required("Item description is required")
          .max(1000),
        unit: yup
          .string()
          .required("Unit is required")
          .max(50),
        quantity: yup
          .mixed() // Use mixed to handle both numbers and strings
          .test('is-number', 'Quantity must be a number', (value) => {
            if (value === null || value === undefined) return false;
            const num = Number(value);
            return !isNaN(num) && num > 0;
          })
          .required("Quantity is required"),
        sort_order: yup.number().integer().default(0),
        is_optional: yup.boolean().default(false),
        // ✅ ADD THESE FIELDS
        line_subtotal: yup
          .mixed()
          .test('is-number-or-null', 'Line subtotal must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable(),
        line_tax: yup
          .mixed()
          .test('is-number-or-null', 'Line tax must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable(),
        line_total: yup
          .mixed()
          .test('is-number-or-null', 'Line total must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable(),
        // ✅ ADD FILES ARRAY
        files: yup
          .array()
          .of(
            yup.object().shape({
              id: yup.string().uuid().optional(),
              boq_item_id: yup.string().uuid().optional(),
              file_name: yup.string().required("File name is required"),
              file_path: yup.string().required("File path is required"),
              file_type: yup.string().required("File type is required"),
              file_size: yup
                .number()
                .typeError("File size must be a number")
                .required("File size is required")
                .positive("File size must be positive"),
              uploaded_by: yup.string().uuid().nullable().optional(),
              is_primary: yup.boolean().default(false),
              sort_order: yup.number().integer().default(0),
            })
          )
          .optional()
          .default([]),
      })
    )
    .min(1, "At least one item is required")
    .required("Items are required"),
});

// Fixed UpdateBoqSchema with files support
export const UpdateBoqSchema = yup.object().shape({
  title: yup.string().max(500).optional(),
  currency: yup.string().length(3, "Currency must be 3 characters").optional(),
  notes: yup.string().nullable().max(2000).optional(),
  status: yup.string().oneOf(["draft", "approved", "cancelled"]).optional(),
  items: yup
    .array()
    .of(
      yup.object().shape({
        id: yup.string().uuid("Invalid item ID").optional(),
        section_label: yup.string().nullable().max(200).optional(),
        item_code: yup.string().nullable().max(100).optional(),
        make: yup.string().nullable().max(200).optional(), // Changed from required
        description: yup
          .string()
          .required("Item description is required")
          .max(1000),
        unit: yup
          .string()
          .required("Unit is required")
          .max(50),
        quantity: yup
          .mixed() // Use mixed to handle both numbers and strings
          .test('is-number', 'Quantity must be a number', (value) => {
            if (value === null || value === undefined) return false;
            const num = Number(value);
            return !isNaN(num) && num > 0;
          })
          .required("Quantity is required"),
        sort_order: yup.number().integer().optional(),
        is_optional: yup.boolean().optional(),
        // ✅ ADD THESE FIELDS
        line_subtotal: yup
          .mixed()
          .test('is-number-or-null', 'Line subtotal must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable()
          .optional(),
        line_tax: yup
          .mixed()
          .test('is-number-or-null', 'Line tax must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable()
          .optional(),
        line_total: yup
          .mixed()
          .test('is-number-or-null', 'Line total must be a number or null', (value) => {
            if (value === null || value === undefined || value === '') return true;
            const num = Number(value);
            return !isNaN(num);
          })
          .nullable()
          .optional(),
        // ✅ ADD FILES ARRAY
        files: yup
          .array()
          .of(
            yup.object().shape({
              id: yup.string().uuid().optional(),
              boq_item_id: yup.string().uuid().optional(),
              file_name: yup.string().required("File name is required"),
              file_path: yup.string().required("File path is required"),
              file_type: yup.string().required("File type is required"),
              file_size: yup
                .number()
                .typeError("File size must be a number")
                .required("File size is required")
                .positive("File size must be positive"),
              uploaded_by: yup.string().uuid().nullable().optional(),
              is_primary: yup.boolean().default(false),
              sort_order: yup.number().integer().default(0),
            })
          )
          .optional()
          .default([]),
      })
    )
    .min(1, "At least one item is required")
    .required("Items are required"),
});

export const createLoanAccountSchema = Yup.object().shape({
  account_name: Yup.string().required("Account name is required"),
  bank_name: Yup.string().required("Bank name is required"),
  account_number: Yup.string().required("Account number is required"),
  ifsc_code: Yup.string().required("IFSC code is required"),
  branch: Yup.string().required("Branch is required"),
  mobile: Yup.string()
    .matches(/^[0-9]{10}$/, "Mobile number must be 10 digits")
    .required("Mobile number is required"),
  reason: Yup.string().optional(),
});

export const updateLoanAccountSchema = Yup.object().shape({
  id: Yup.string().required("Loan account ID is required"),
  account_name: Yup.string().optional(),
  bank_name: Yup.string().optional(),
  account_number: Yup.string().optional(),
  ifsc_code: Yup.string().optional(),
  branch: Yup.string().optional(),
  mobile: Yup.string()
    .matches(/^[0-9]{10}$/, "Mobile number must be 10 digits")
    .optional(),
  reason: Yup.string().nullable().optional(),
});

export const deleteLoanAccountSchema = Yup.object().shape({
  id: Yup.string().required("Loan account ID is required"),
});

export const getLoanAccountSchema = Yup.object().shape({
  id: Yup.string().required("Loan account ID is required"),
});

export const uploadDocumentsSchema = Yup.object({
  loan_account_id: Yup.string().required("Loan account ID is required")
});

// Add these to your existing validation schemas
export const verifyAdminTOTPSchema = Yup.object({
  token: Yup.string()
    .required("TOTP token is required")
    .length(6, "TOTP token must be 6 digits")
    .matches(/^\d+$/, "TOTP token must contain only numbers"),
  loanPayload: Yup.object().optional(), // Optional loan data for context
});

export const verifyAnyAdminTOTPSchema = Yup.object({
  token: Yup.string()
    .required("TOTP token is required")
    .length(6, "TOTP token must be 6 digits")
    .matches(/^\d+$/, "TOTP token must contain only numbers"),
});


const paymentCreateSchema = Yup.object({
  expense_id: Yup.string().uuid().required('expense_id is required'),
  account_id: Yup.string().uuid().required('account_id is required'),
  user_id: Yup.string().uuid().required('user_id is required'),
  department_id: Yup.string().uuid().required('department_id is required'),
  amount_paid: Yup.number().moreThan(0, 'amount_paid must be > 0').required('amount_paid is required'),
  payment_date: Yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD').optional(),
  payment_method: Yup.string().oneOf(['account_transfer', 'cash', 'cheque', 'online', 'card']).optional(),
  transaction_reference: Yup.string().nullable().optional(),
  status: Yup.string().oneOf(['pending', 'completed', 'failed', 'reversed']).optional(),
  notes: Yup.string().nullable().optional(),
  created_by: Yup.string().uuid().nullable().optional(),
});

const ASSIGN_TO_WORKER_STATUSES = [
  "in-progress",
  "in-review",
  "ready-for-qc",
  "completed",
  "rejected",
];

export const createAssignToWorkerSchema = Yup.object({
  jo_no: Yup.string().nullable(),
  item_no: Yup.number().nullable(),
  machine_category: Yup.string().nullable(),
  machine_size: Yup.string().nullable(),
  machine_code: Yup.string().nullable(),
  worker_name: Yup.string().nullable(),
  worker_id: Yup.string().uuid().nullable(),
  quantity_no: Yup.number().nullable(),
  assigning_date: Yup.date().nullable(),
  serial_no: Yup.string().nullable(),
  job_id: Yup.string().uuid().nullable(),
  status: Yup.string().oneOf(ASSIGN_TO_WORKER_STATUSES).optional(),
  created_by: Yup.string().uuid().nullable(),
});

export const updateAssignToWorkerSchema = Yup.object({
  jo_no: Yup.string().nullable(),
  item_no: Yup.number().nullable(),
  machine_category: Yup.string().nullable(),
  machine_size: Yup.string().nullable(),
  machine_code: Yup.string().nullable(),
  worker_name: Yup.string().nullable(),
  worker_id: Yup.string().uuid().nullable(),
  quantity_no: Yup.number().nullable(),
  assigning_date: Yup.date().nullable(),
  serial_no: Yup.string().nullable(),
  job_id: Yup.string().uuid().nullable(),
  status: Yup.string().oneOf(ASSIGN_TO_WORKER_STATUSES).optional(),
  updated_by: Yup.string().uuid().nullable(),
});
