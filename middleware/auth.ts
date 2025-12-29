import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization || "";

    console.log("🔐 Auth Debug - Authorization Header:", header);
    console.log(
        "🔐 Auth Debug - JWT_SECRET:",
        JWT_SECRET ? `Set (length: ${JWT_SECRET.length})` : "Not set"
    );

    if (!header.startsWith("Bearer ")) {
        console.log("❌ No Bearer token found");
        return res
            .status(401)
            .json({ success: false, msg: "Unauthorized", data: {} });
    }

    const token = header.slice(7);
    console.log(
        "🔐 Auth Debug - Token received:",
        token.substring(0, 20) + "..."
    );

    try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        console.log("✅ JWT Verified Successfully - Decoded payload:", payload);

        // 🔑 Normalize ID
        const userId =
            payload.userId || payload.system_user_id || payload.id || null;

        (req as any).user = {
            userId,                 // ✅ primary field you will use
            system_user_id: userId, // ✅ kept for backward compatibility
            email: payload.email,
            role: payload.role,
            secretKey: payload.secretKey,
        };

        if (!userId) {
            console.log("❌ No userId found in token");
            return res.status(401).json({
                success: false,
                msg: "Unauthorized - Invalid token payload",
                data: {},
            });
        }

        console.log("✅ Authenticated user:", (req as any).user);
        next();
    } catch (err: any) {
        console.error("❌ JWT Verification Failed:", {
            error: err.message,
            secretUsed: JWT_SECRET ? `Set (length: ${JWT_SECRET.length})` : "Not set",
            tokenPrefix: token.substring(0, 20) + "...",
        });
        return res.status(401).json({
            success: false,
            msg: "Unauthorized - Invalid token",
            data: {},
        });
    }
}
