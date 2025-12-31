import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { SystemuserRouter } from "./routes";
import { SystemuserRouter2 } from "./routes";
import * as Sentry from "@sentry/node";
import cors from "cors";
import path from "path";
import fs from "fs";
import "./scheduler";
import syncDatabase from "./database/sync";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}
import "./config/production/env_config";
import "./database/sync";

// ---- App Init ----
const app: Express = express();
const port = Number(process.env.FINE_ENGINEERING_PORT) || 3000;
const localIp = "192.168.1.9";

(async () => {
  // 1️⃣ Run DB sync FIRST
  await syncDatabase();

  // 2️⃣ Start server ONLY after DB is ready
  app.listen(port, "0.0.0.0", () => {
    console.log(`⚡️ Server running on port ${port}`);
  });
})();

// ---- Sentry ----
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  serverName: "Compress Crm Backend",
  profilesSampleRate: 1.0,
});

// ---- Middleware ----
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
  })
);

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "500mb" }));

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// ---- Static uploads (IMPORTANT) ----
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ---- Debug helpers (optional) ----
app.get("/_probe-uploads/*", (req: Request, res: Response) => {
  const tail = (req.params as any)[0] || "";
  const publicPath = path.join(process.cwd(), "public", "uploads", tail);
  const legacyPath = path.join(process.cwd(), "uploads", tail);

  res.json({
    tail,
    existsPublic: fs.existsSync(publicPath),
    existsLegacy: fs.existsSync(legacyPath),
  });
});

// ---- Debug file access ----
app.get("/debug-file/:ticketId/:filename", (req: Request, res: Response) => {
  const { ticketId, filename } = req.params;

  const publicPath = path.join(
    process.cwd(),
    "public",
    "uploads",
    "hvac_tickets",
    ticketId,
    filename
  );

  const legacyPath = path.join(
    process.cwd(),
    "uploads",
    "hvac_tickets",
    ticketId,
    filename
  );

  const filePath = fs.existsSync(publicPath) ? publicPath : legacyPath;

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: "File not found",
    });
  }

  res.sendFile(filePath);
});

// ---- Routes ----
app.use("/api/v1/compresscrmbackend", SystemuserRouter);
app.use("/api/v1/fineengg_erp", SystemuserRouter2);

// ---- Root ----
app.get("/", (_req, res) => {
  res.send("fine-engineering-erp-backend is running 🚀");
});

// ---- 404 LAST ----
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ---- Errors ----
app.use(Sentry.Handlers.errorHandler());

// ---- Start Server ----
app.listen(port, "0.0.0.0", () => {
  console.log(`⚡️ Server running on port ${port}`);
  console.log(`📁 Uploads available at /uploads`);
});
