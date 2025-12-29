import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { SystemuserRouter } from "./routes";
import * as Sentry from "@sentry/node";
import cors from "cors";
import path from "path";
import fs from "fs";
import './scheduler';

dotenv.config();
import "./config/production/env_config";
import "./database/sync";

console.clear();
const app: Express = express();
const port = Number(process.env.COMPRESS_CRM_PORT) || 3000;
const localIp = "192.168.1.9";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  serverName: "Compress Crm Backend",
  profilesSampleRate: 1.0,
});

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

/** 🔑 Serve uploads BEFORE routes and 404 */
/** ⬇️ Only this line changed */
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

/** 🔧 Probe & debug helpers (optional; remove in prod) */
app.get("/_probe-uploads/*", (req: Request, res: Response) => {
  const tail = (req.params as any)[0] || "";
  const publicPath = path.join(process.cwd(), "public", "uploads", tail);
  const legacyPath = path.join(process.cwd(), "uploads", tail);
  res.json({
    tail,
    publicPath,
    legacyPath,
    existsPublic: fs.existsSync(publicPath),
    existsLegacy: fs.existsSync(legacyPath),
  });
});

// Debug: serve an explicit file using project-root paths (not __dirname)
app.get("/debug-file/:ticketId/:filename", (req: Request, res: Response) => {
  const { ticketId, filename } = req.params;
  const filePathPublic = path.join(process.cwd(), "public", "uploads", "hvac_tickets", ticketId, filename);
  const filePathLegacy = path.join(process.cwd(), "uploads", "hvac_tickets", ticketId, filename);

  const filePath = fs.existsSync(filePathPublic) ? filePathPublic : filePathLegacy;
  if (!fs.existsSync(filePath)) {
    return res
      .status(404)
      .json({ success: false, error: "File not found", tried: [filePathPublic, filePathLegacy] });
  }
  res.sendFile(filePath);
});

// Routes
app.use("/api/v1/compresscrmbackend", SystemuserRouter);

// Root
app.get("/", (_req, res) => {
  res.send("Express + TypeScript server is running.");
});

// 404 LAST
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Errors
app.use(Sentry.Handlers.errorHandler());

// Start
app.listen(port, "0.0.0.0", () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
  //console.log(`⚡️[server]: Server is running at https://crmbackend.dynsimulation.com:${port}`);
  console.log(`📁 Serving uploads from:`);
  console.log(`   - ${path.join(__dirname, "../uploads")} → /uploads`);
});
