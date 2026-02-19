import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt";

export function requireWorkerAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, msg: "Unauthorized" });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;

    if (payload.type !== "WORKER") {
      return res.status(401).json({ success: false, msg: "Unauthorized - not worker token" });
    }

    (req as any).worker = {
      workerId: payload.workerId ?? payload.id ?? null,
      worker_name: payload.worker_name ?? null,
    };

    if (!(req as any).worker.worker_name) {
      return res.status(401).json({ success: false, msg: "Unauthorized - invalid worker token" });
    }

    next();
  } catch (e: any) {
    return res.status(401).json({ success: false, msg: "Unauthorized - Invalid token" });
  }
}
