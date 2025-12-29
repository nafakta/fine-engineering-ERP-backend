// config/jwt.ts
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_change_me_123";

// Add validation
if (!JWT_SECRET || JWT_SECRET === "super_secret_change_me_123") {
    console.warn("⚠️  Using default JWT secret - this is insecure for production!");
}

console.log("🔐 JWT Configuration Loaded - Secret Length:", JWT_SECRET.length);

export { JWT_SECRET };