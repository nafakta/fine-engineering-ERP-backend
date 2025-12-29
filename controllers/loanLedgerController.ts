// src/controllers/loanLedgerController.ts
import { Request, Response } from "express";
import db from "../models";
import fs from "fs/promises";
import Handlebars from "handlebars";
import puppeteer, { Browser } from "puppeteer";
import path from "path";

// ---------- Handlebars helpers (copied from EstimateController) ----------
Handlebars.registerHelper("inc", (v: any) => Number(v) + 1);
Handlebars.registerHelper("formatCurrency", (v: any) => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    });
});
Handlebars.registerHelper("hasAnyExtra", function (party: any) {
    if (!party) return false;
    return Boolean(
        party.job_position ||
        party.aadhar_number ||
        party.pan_number ||
        party.reason
    );
});

Handlebars.registerHelper("isEqual", function (a: any, b: any) {
    return a === b;
});

Handlebars.registerHelper("or", function (a: any, b: any) {
    return a || b;
});

Handlebars.registerHelper('eq', function (a: any, b: any) {
    return a === b;
});

Handlebars.registerHelper('or', function (a: any, b: any) {
    return a || b;
});

Handlebars.registerHelper('contains', function (str: any, substr: any) {
    if (typeof str === 'string' && typeof substr === 'string') {
        return str.includes(substr);
    }
    return false;
});

const LOAN_PAYMENT_TEMPLATE_PATH = path.resolve(
    __dirname,
    "../templates/loan-payment-slip.hbs"
);

const LOAN_LEDGER_TEMPLATE_PATH = path.resolve(
    __dirname,
    "../templates/loan-ledger.hbs"
);

// Updated LOGO_PATH_PROMISE to use resolveLogoPath function
const resolveExistingPath = async (...segments: string[]): Promise<string | null> => {
    const p = path.resolve(...segments);
    try {
        await fs.access(p);
        return p;
    } catch {
        return null;
    }
};

const resolveLogoPath = async (): Promise<string> => {
    // 1️⃣ ENV override (highest priority)
    const fromEnv = process.env.COMPANY_LOGO_PATH;
    if (fromEnv) {
        const p = await resolveExistingPath(fromEnv);
        if (p) return p;
    }

    // 2️⃣ YOUR ACTUAL IMAGE LOCATION (PRIMARY)
    const publicUploadsLogo = path.resolve(
        process.cwd(),
        "public",
        "uploads",
        "images",
        "compress-india-logo-traced.png"
    );

    try {
        await fs.access(publicUploadsLogo);
        return publicUploadsLogo;
    } catch {
        // continue fallback
    }

    // 3️⃣ Fallbacks (optional / legacy)
    const candidates: string[][] = [
        [__dirname, "../images", "compress-india-logo-traced.png"],
        [__dirname, "../../images", "compress-india-logo-traced.png"],
        [__dirname, "../templates", "logo.png"],
        [__dirname, "../../templates", "logo.png"],
    ];

    for (const parts of candidates) {
        const p = await resolveExistingPath(...parts);
        if (p) return p;
    }

    return "";
};


const LOGO_PATH_PROMISE = resolveLogoPath();

const LOAN_LEDGER_TEMPLATE_CONTENT_PROMISE = fs.readFile(
    LOAN_LEDGER_TEMPLATE_PATH,
    "utf8"
);

const fileToDataUri = async (absPath: string): Promise<string | null> => {
    try {
        const buf = await fs.readFile(absPath);
        const ext = (path.extname(absPath).slice(1) || "png").toLowerCase();
        return `data:image/${ext};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
};

type LoanLedgerRowVM = {
    index: number;
    date: string;
    description: string;
    amount: string;
    principal: string;
    remaining: string;
};

type LoanLedgerVM = {
    doc_title: string;
    logo: string;
    printedOn: string;
    companyName: string;

    // Added letterhead structure from EstimateController
    our_company: {
        name: string;
        legal_name: string;
        tax_id: string;
        address_line: string;
        city_state: string;
        mobile_number: string;
        email_id: string;
        website: string;
    };

    loan: {
        loanId: string;
        loanTypeLabel: string;
        sanctionedAmount: string;
        remainingBalance: string;
        totalPrincipalPaid: string;
        status: string;
        startDate: string;
        endDate: string;
        isLoanTaken?: boolean;
        isLoanGiven?: boolean;
    };

    lenderParty: {
        name: string;
        bank: string;
        accountNumber: string;
        ifsc: string;
        branch: string;
        mobile: string;
        reason?: string | null;
        job_position?: string | null;
        aadhar_number?: string | null;
        pan_number?: string | null;
    };

    borrowerParty: {
        name: string;
        bank: string;
        accountNumber: string;
        ifsc: string;
        branch: string;
        mobile: string;
        reason?: string | null;
        job_position?: string | null;
        aadhar_number?: string | null;
        pan_number?: string | null;
    };

    rows: LoanLedgerRowVM[];
};

type LoanPaymentSlipVM = {
    doc_title: string;
    logo: string;
    printedOn: string;
    companyName: string;

    // Added letterhead structure from EstimateController
    our_company: {
        name: string;
        legal_name: string;
        tax_id: string;
        address_line: string;
        city_state: string;
        mobile_number: string;
        email_id: string;
        website: string;
    };

    loan: LoanLedgerVM["loan"];
    lenderParty: LoanLedgerVM["lenderParty"];
    borrowerParty: LoanLedgerVM["borrowerParty"];

    payment: {
        index: number;
        date: string;
        type: string;
        description: string;
        amount: string;
        principal: string;
        remaining: string;
        transactionId: string;
    };
};

const formatINR = (v: any): string => {
    const n = Number(v || 0);
    return n.toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    });
};

const formatDate = (v: any): string => {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-IN");
};

class LoanLedgerController {
    // -------------- PUBLIC: HTML (for debugging / preview) --------------
    public printLoanLedgerHtml = async (req: Request, res: Response) => {
        try {
            const loanId = String(
                req.params.id || req.params.loan_id || req.query.loan_id || ""
            ).trim();

            if (!loanId) {
                return res
                    .status(400)
                    .type("text/plain")
                    .send("Invalid or missing loan id");
            }

            // ✅ Use instance method
            const vm = await this.buildLoanLedgerViewModel(loanId);

            // logo (same logic as estimate)
            const logoFile = await LOGO_PATH_PROMISE;
            vm.logo =
                (logoFile ? await fileToDataUri(logoFile) : null) ||
                "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

            const templateContent = await LOAN_LEDGER_TEMPLATE_CONTENT_PROMISE;
            if (!templateContent || typeof templateContent !== "string") {
                console.error("Loan ledger template missing or invalid");
                return res.status(500).type("text/plain").send("Template content missing");
            }

            let html: string;
            try {
                html = Handlebars.compile(templateContent)(vm);
            } catch (err) {
                console.error("Handlebars compile error for loan ledger template:", err);
                return res.status(500).type("text/plain").send("Template render failed");
            }

            return res.status(200).type("html").send(html);
        } catch (err: any) {
            console.error("printLoanLedgerHtml error:", err?.stack || err);
            return res
                .status(500)
                .type("text/plain")
                .send(`Failed to render Loan Ledger HTML: ${err?.message || err}`);
        }
    };

    // -------------- PUBLIC: PDF (for download from frontend) --------------
    public printLoanLedgerPdf = async (req: Request, res: Response) => {
        let browser: Browser | null = null;

        try {
            const loanId = String(
                req.params.id || req.params.loan_id || req.query.loan_id || ""
            ).trim();

            if (!loanId) {
                return res.status(400).type("text/plain").send("Missing loan id");
            }

            // ✅ Build view model using the private method (handles loan + transactions)
            const vm = await this.buildLoanLedgerViewModel(loanId);

            // ✅ Load logo (same approach as Estimate PDF)
            const logoFile = await LOGO_PATH_PROMISE;
            vm.logo =
                (logoFile ? await fileToDataUri(logoFile) : null) ||
                "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

            // ✅ Load HBS template content for loan ledger
            const templateContent = await LOAN_LEDGER_TEMPLATE_CONTENT_PROMISE;
            const html = Handlebars.compile(templateContent)(vm);

            // 5️⃣ Puppeteer → PDF (same pattern as estimate)
            browser = await puppeteer.launch({
                executablePath:
                    process.env.PUPPETEER_EXECUTABLE_PATH ||
                    process.env.CHROME_EXECUTABLE_PATH ||
                    (process.platform === "win32"
                        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                        : process.platform === "darwin"
                            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                            : "/usr/bin/chromium"),
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
            await page.emulateMediaType("screen");

            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
                preferCSSPageSize: true,
            });

            if (!pdfBuffer || pdfBuffer.length < 1000) {
                console.error("Loan PDF DEBUG: empty/short buffer");
                return res
                    .status(500)
                    .type("text/plain")
                    .send(
                        "Loan PDF generation failed (empty buffer). Check Chromium/fonts in container."
                    );
            }

            const filename = `Loan-Ledger-${loanId}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                `inline; filename="${filename}"`
            );
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Length", String(pdfBuffer.length));

            return res.end(pdfBuffer);
        } catch (err: any) {
            console.error("printLoanLedgerPdf error:", err?.stack || err);
            return res
                .status(500)
                .type("text/plain")
                .send(
                    `Failed to render Loan Ledger PDF: ${err?.message || err}`
                );
        } finally {
            try {
                await browser?.close();
            } catch {
                // ignore
            }
        }
    };

    // Map Account model to party structure
    private mapAccountToParty = (account: any) => {
        console.log('Mapping Account to Party:', account);
        return {
            name: account.accountname || "Your Company",
            bank: account.bankname || "",
            accountNumber: account.accountnumber || "",
            ifsc: account.ifsc || "",
            branch: account.branch || "",
            mobile: "", // Account model doesn't have mobile
            source: 'Account'
        };
    };

    // Map LoanAccount model to party structure
    private mapLoanAccountToParty = (loanAccount: any) => {
        console.log('Mapping LoanAccount to Party:', loanAccount);
        return {
            name: loanAccount.account_name || "",
            bank: loanAccount.bank_name || "",
            accountNumber: loanAccount.account_number || "",
            ifsc: loanAccount.ifsc_code || "",
            branch: loanAccount.branch || "",
            mobile: loanAccount.mobile || "",
            reason: loanAccount.reason || null,
            job_position: loanAccount.job_position || null,
            aadhar_number: loanAccount.aadhar_number || null,
            pan_number: loanAccount.pan_number || null,
            source: 'LoanAccount'
        };
    };

    // -------------- PRIVATE: Build VM for loan-ledger.hbs --------------
    private buildLoanLedgerViewModel = async (loanId: string): Promise<LoanLedgerVM> => {
        // 1) Loan + joined parties (LoanAccount + Account)
        const loanRows: any[] = await db.sequelize.query(
            `SELECT 
        l.*,

        -- Loan Account (external party)
        la.account_name   AS loan_account_account_name,
        la.bank_name      AS loan_account_bank_name,
        la.account_number AS loan_account_account_number,
        la.ifsc_code      AS loan_account_ifsc_code,
        la.branch         AS loan_account_branch,
        la.mobile         AS loan_account_mobile,
        la.reason         AS loan_account_reason,
        la.job_position   AS loan_account_job_position,
        la.aadhar_number  AS loan_account_aadhar_number,
        la.pan_number     AS loan_account_pan_number,

        -- Account (your company account)
        a.accountname     AS account_accountname,
        a.bankname        AS account_bankname,
        a.accountnumber   AS account_accountnumber,
        a.ifsc            AS account_ifsc,
        a.branch          AS account_branch

     FROM loans l
     LEFT JOIN loan_accounts la ON l.loan_account_id = la.id
     LEFT JOIN accounts a ON l.account_id = a.id
     WHERE l.id = :loanId`,
            {
                replacements: { loanId },
                type: db.Sequelize.QueryTypes.SELECT,
            }
        );

        if (!loanRows?.length) {
            throw new Error("Loan not found");
        }

        const loanJson = loanRows[0];

        // 2) Normalize joined blocks
        const loanAccountData = {
            account_name: loanJson.loan_account_account_name ?? "",
            bank_name: loanJson.loan_account_bank_name ?? "",
            account_number: loanJson.loan_account_account_number ?? "",
            ifsc_code: loanJson.loan_account_ifsc_code ?? "",
            branch: loanJson.loan_account_branch ?? "",
            mobile: loanJson.loan_account_mobile ?? "",
            reason: loanJson.loan_account_reason ?? null,
            job_position: loanJson.loan_account_job_position ?? null,
            aadhar_number: loanJson.loan_account_aadhar_number ?? null,
            pan_number: loanJson.loan_account_pan_number ?? null,
        };

        const mainAccountData = {
            accountname: loanJson.account_accountname ?? "",
            bankname: loanJson.account_bankname ?? "",
            accountnumber: loanJson.account_accountnumber ?? "",
            ifsc: loanJson.account_ifsc ?? "",
            branch: loanJson.account_branch ?? "",
        };

        // ✅ 3) Normalize loan_type (THIS FIXES GIVE_LOAN NOT MATCHING)
        const loanTypeRaw = String(loanJson.loan_type ?? "");
        const loanType = loanTypeRaw.trim().toUpperCase();

        const isLoanTaken = loanType === "TAKE_LOAN";
        const isLoanGiven = loanType === "GIVE_LOAN";

        const loanTypeLabel = isLoanGiven
            ? "Loan Given (Asset)"
            : isLoanTaken
                ? "Loan Taken (Liability)"
                : loanTypeRaw;

        // 4) Map parties correctly based on loan type
        //    GIVE_LOAN -> Account is lender, LoanAccount is borrower (extra fields should appear in BORROWER)
        //    TAKE_LOAN -> LoanAccount is lender (extra fields should appear in LENDER), Account is borrower
        let lenderParty: any;
        let borrowerParty: any;

        if (isLoanGiven) {
            lenderParty = this.mapAccountToParty(mainAccountData);
            borrowerParty = this.mapLoanAccountToParty(loanAccountData);
        } else if (isLoanTaken) {
            lenderParty = this.mapLoanAccountToParty(loanAccountData);
            borrowerParty = this.mapAccountToParty(mainAccountData);
        } else {
            // fallback (avoid empty)
            lenderParty = this.mapAccountToParty(mainAccountData);
            borrowerParty = this.mapLoanAccountToParty(loanAccountData);
        }

        // 5) Fetch transactions
        const txRows: any[] = await db.LoanTransaction.findAll({
            where: { loan_id: loanId },
            order: [
                ["transaction_date", "ASC"],
                ["created_at", "ASC"],
            ],
        });

        const rows: LoanLedgerRowVM[] = txRows.map((tx, idx) => ({
            index: idx + 1,
            date: formatDate(tx.transaction_date || tx.created_at),
            description: tx.description || "",
            amount: formatINR(tx.amount),
            principal: tx.principal_amount != null ? formatINR(tx.principal_amount) : "-",
            remaining: formatINR(tx.remaining_balance),
        }));

        // 6) Letterhead
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
            mobile_number:
                process.env.COMPANY_MOBILE_NUMBER || "8655 0114 65 / 9920 5299 61",
            email_id:
                process.env.COMPANY_EMAIL || "sales@compressindia.in / info@compressindia.com",
            website: process.env.COMPANY_WEBSITE || "www.compressindia.com",
        };

        // 7) Final VM
        const vm: LoanLedgerVM = {
            doc_title: "Loan Ledger",
            logo: "",
            printedOn: formatDate(new Date()),
            companyName: "COMPRESS INDIA AIR CONDITIONING PVT.LTD.",
            our_company,

            loan: {
                loanId: String(loanJson.id),
                loanTypeLabel,
                sanctionedAmount: formatINR(loanJson.amount),
                remainingBalance: formatINR(loanJson.remaining_balance),
                totalPrincipalPaid: formatINR(loanJson.total_principal_paid),
                status: String(loanJson.status || ""),
                startDate: formatDate(loanJson.start_date),
                endDate: loanJson.end_date ? formatDate(loanJson.end_date) : "",
                isLoanTaken,
                isLoanGiven,
            },

            lenderParty,
            borrowerParty,
            rows,
        };

        // ✅ Helpful debug (remove later)
        console.log("DEBUG loan_type raw:", loanTypeRaw, "normalized:", loanType);
        console.log("DEBUG flags:", { isLoanGiven: vm.loan.isLoanGiven, isLoanTaken: vm.loan.isLoanTaken });
        console.log("DEBUG borrowerParty (should contain extra fields on GIVE_LOAN):", vm.borrowerParty);

        return vm;
    };

    private buildPaymentSlipViewModel = async (
        transactionId: string
    ): Promise<LoanPaymentSlipVM> => {
        // Fetch transaction + loan + account info in one raw query
        const transactionRows: any[] = await db.sequelize.query(
            `SELECT 
      lt.*,
      l.loan_type,
      l.amount AS loan_amount,
      l.start_date,
      l.end_date,
      l.status AS loan_status,
      l.remaining_balance AS loan_remaining_balance,
      l.total_principal_paid AS loan_total_principal_paid,

      la.account_name AS loan_account_account_name,
      la.bank_name AS loan_account_bank_name, 
      la.account_number AS loan_account_account_number,
      la.ifsc_code AS loan_account_ifsc_code,
      la.branch AS loan_account_branch,
      la.mobile AS loan_account_mobile,

      -- ✅ NEW FIELDS
      la.reason AS loan_account_reason,
      la.job_position AS loan_account_job_position,
      la.aadhar_number AS loan_account_aadhar_number,
      la.pan_number AS loan_account_pan_number,

      a.accountname AS account_accountname,
      a.bankname AS account_bankname,
      a.accountnumber AS account_accountnumber, 
      a.ifsc AS account_ifsc,
      a.branch AS account_branch
   FROM loan_transactions lt
   JOIN loans l ON lt.loan_id = l.id
   LEFT JOIN loan_accounts la ON l.loan_account_id = la.id
   LEFT JOIN accounts a ON l.account_id = a.id
   WHERE lt.id = :transactionId`,
            { replacements: { transactionId }, type: db.Sequelize.QueryTypes.SELECT }
        );


        if (!transactionRows.length) {
            throw new Error("Loan transaction not found");
        }

        const txJson = transactionRows[0];

        // Build a compact loan object from joined fields
        const loanJson = {
            id: txJson.loan_id,
            loan_type: txJson.loan_type,
            amount: txJson.loan_amount,
            start_date: txJson.start_date,
            end_date: txJson.end_date,
            status: txJson.loan_status,
            remaining_balance: txJson.loan_remaining_balance,
            total_principal_paid: txJson.loan_total_principal_paid,
        };

        // Extract account / loanAccount raw pieces
        const loanAccountData = {
            account_name: txJson.loan_account_account_name,
            bank_name: txJson.loan_account_bank_name,
            account_number: txJson.loan_account_account_number,
            ifsc_code: txJson.loan_account_ifsc_code,
            branch: txJson.loan_account_branch,
            mobile: txJson.loan_account_mobile,
            reason: txJson.loan_account_reason ?? null,
            job_position: txJson.loan_account_job_position ?? null,
            aadhar_number: txJson.loan_account_aadhar_number ?? null,
            pan_number: txJson.loan_account_pan_number ?? null,
        };

        const mainAccountData = {
            accountname: txJson.account_accountname,
            bankname: txJson.account_bankname,
            accountnumber: txJson.account_accountnumber,
            ifsc: txJson.account_ifsc,
            branch: txJson.account_branch,
        };

        console.log("Payment Slip - Extracted LoanAccount Data:", loanAccountData);
        console.log("Payment Slip - Extracted Main Account Data:", mainAccountData);

        // Decide lender / borrower based on loan_type
        let lenderParty: any = {};
        let borrowerParty: any = {};

        if (loanJson.loan_type === "GIVE_LOAN") {
            console.log("GIVE_LOAN Payment - You are lender, LoanAccount is borrower");
            lenderParty = this.mapAccountToParty(mainAccountData);
            borrowerParty = this.mapLoanAccountToParty(loanAccountData);
        } else if (loanJson.loan_type === "TAKE_LOAN") {
            console.log("TAKE_LOAN Payment - LoanAccount is lender, You are borrower");
            lenderParty = this.mapLoanAccountToParty(loanAccountData);
            borrowerParty = this.mapAccountToParty(mainAccountData);
        } else {
            // fallback
            lenderParty = this.mapAccountToParty(mainAccountData);
            borrowerParty = this.mapLoanAccountToParty(loanAccountData);
        }

        // Friendly label for display
        const loanTypeLabel =
            loanJson.loan_type === "GIVE_LOAN"
                ? "Loan Given (Asset)"
                : loanJson.loan_type === "TAKE_LOAN"
                    ? "Loan Taken (Liability)"
                    : String(loanJson.loan_type || "");

        // Prepare the payment VM. Set both loanTypeLabel and `type` (backwards-compat)
        const payment = {
            index: 1,
            date: formatDate(txJson.transaction_date || txJson.created_at),
            // keep original transaction type separate if needed:
            transactionType: String(txJson.transaction_type || ""),
            // expose loan type label explicitly
            loanTypeLabel,
            // keep `type` pointing to loanTypeLabel so older templates that use {{payment.type}} keep working
            type: loanTypeLabel,
            description: txJson.description || "",
            amount: formatINR(txJson.amount),
            principal:
                txJson.principal_amount != null ? formatINR(txJson.principal_amount) : "-",
            remaining: formatINR(txJson.remaining_balance),
            transactionId: String(txJson.id),
        };

        // Added letterhead structure from EstimateController
        const our_company = {
            name: process.env.COMPANY_SHORT || "COMPRESS INDIA PVT. LTD.",
            legal_name: process.env.COMPANY_LEGAL || "COMPRESS INDIA AIR CONDITIONING PRIVATE LIMITED.",
            tax_id: process.env.COMPANY_GSTIN || "27AAKCC6103D1Z0",
            address_line: process.env.COMPANY_ADDR ||
                "Off no. 103, 1st Floor, Hi - Tech Commercial Complex, V.B Naga Near SCLR Road, Kurla (west) Mumbai - 400070. Maharashtra (INDIA)",
            city_state: process.env.COMPANY_CITY_STATE || "Mumbai, Maharashtra",
            mobile_number: process.env.COMPANY_MOBILE_NUMBER || "8655 0114 65 / 9920 5299 61",
            email_id: process.env.COMPANY_EMAIL || "sales@compressindia.in / info@compressindia.com",
            website: process.env.COMPANY_WEBSITE ||
                "www.compressindia.com",
        };

        // Build the final view model
        const vm: LoanPaymentSlipVM = {
            doc_title: "Loan Payment Receipt",
            logo: "",
            printedOn: formatDate(new Date()),
            companyName: "COMPRESS INDIA AIR CONDITIONING PVT.LTD.",

            // Added letterhead structure
            our_company,

            loan: {
                loanId: loanJson.id,
                loanTypeLabel,
                sanctionedAmount: formatINR(loanJson.amount),
                remainingBalance: formatINR(loanJson.remaining_balance),
                totalPrincipalPaid: formatINR(loanJson.total_principal_paid),
                status: String(loanJson.status || ""),
                startDate: formatDate(loanJson.start_date),
                endDate: loanJson.end_date ? formatDate(loanJson.end_date) : "",
            },
            lenderParty,
            borrowerParty,
            payment,
        };

        return vm;
    };


    // Helper method to map fields from different models to consistent loanParty structure
    private mapLoanPartyFields = (loanParty: any, loanType: string) => {
        if (loanType === 'GIVE_LOAN') {
            // LoanAccount model fields
            return {
                name: loanParty.account_name || "",
                bank: loanParty.bank_name || "",
                accountNumber: loanParty.account_number || "",
                ifsc: loanParty.ifsc_code || "",
                branch: loanParty.branch || "",
                mobile: loanParty.mobile || "",
            };
        } else {
            // Account model fields
            return {
                name: loanParty.accountname || "",
                bank: loanParty.bankname || "",
                accountNumber: loanParty.accountnumber || "",
                ifsc: loanParty.ifsc || "",
                branch: loanParty.branch || "",
                mobile: "", // Account model doesn't have mobile field
            };
        }
    };

    public printLoanPaymentSlipPdf = async (req: Request, res: Response) => {
        let browser: Browser | null = null;

        try {
            const transactionId = String(
                req.params.transaction_id ||
                req.params.id ||
                req.query.transaction_id ||
                req.query.id ||
                ""
            ).trim();

            if (!transactionId) {
                return res.status(400).type("text/plain").send("Missing transaction id");
            }

            // 1️⃣ Build VM
            const vm = await this.buildPaymentSlipViewModel(transactionId);

            // 2️⃣ Logo
            const logoFile = await LOGO_PATH_PROMISE;
            vm.logo =
                (logoFile ? await fileToDataUri(logoFile) : null) ||
                "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

            // 3️⃣ Template
            const templateContent = await fs.readFile(LOAN_PAYMENT_TEMPLATE_PATH, "utf8");
            const html = Handlebars.compile(templateContent)(vm);

            // 4️⃣ Puppeteer → PDF
            browser = await puppeteer.launch({
                executablePath:
                    process.env.PUPPETEER_EXECUTABLE_PATH ||
                    process.env.CHROME_EXECUTABLE_PATH ||
                    (process.platform === "win32"
                        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                        : process.platform === "darwin"
                            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                            : "/usr/bin/chromium"),
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
            await page.emulateMediaType("screen");

            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" },
                preferCSSPageSize: true,
            });

            if (!pdfBuffer || pdfBuffer.length < 500) {
                return res
                    .status(500)
                    .type("text/plain")
                    .send("Payment slip PDF generation failed.");
            }

            const filename = `Loan-Payment-${transactionId}.pdf`;
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                `inline; filename="${filename}"`
            );
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Length", String(pdfBuffer.length));

            return res.end(pdfBuffer);
        } catch (err: any) {
            console.error("printLoanPaymentSlipPdf error:", err?.stack || err);
            return res
                .status(500)
                .type("text/plain")
                .send(`Failed to render Loan Payment Slip PDF: ${err?.message || err}`);
        } finally {
            try {
                await browser?.close();
            } catch {
                // ignore
            }
        }
    };

}

export default new LoanLedgerController();