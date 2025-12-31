import fs from "fs";

// Path to optional secrets file (used ONLY outside Docker production)
const secretFilePath = "/tmp/orizon_dev_postgresql";

/**
 * PRODUCTION RULE:
 * - If running in Docker production → use Docker environment variables ONLY
 * - NEVER override process.env values in production
 */
if (process.env.NODE_ENV === "production") {
  console.log("🔐 Production mode detected. Using Docker environment variables only.");
} else {
  // Non-production (local / VM) fallback to secrets file
  if (fs.existsSync(secretFilePath)) {
    try {
      const secrets = fs.readFileSync(secretFilePath, "utf8");
      const config = JSON.parse(secrets);

      // Only set env vars if they are NOT already defined
      Object.entries(config).forEach(([key, value]) => {
        if (!process.env[key]) {
          process.env[key] = String(value);
        }
      });

      console.log("🔐 Secrets file loaded for non-production environment");
    } catch (err) {
      console.error("❌ Error reading or parsing the secrets file:", err);
    }
  } else {
    console.warn("⚠️ Secrets file not found. Using default or .env configurations");
  }
}
