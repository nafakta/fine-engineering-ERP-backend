import { Request, Response } from "express";
import * as Yup from "yup";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dbModels from "../models";
import { JWT_SECRET } from "../config/jwt";

export default class WorkerAuthController {
  private get Worker() {
    return (dbModels as any).Worker || (dbModels as any).Workers || (dbModels as any).workers;
  }

  // ✅ REGISTER WORKER
  public register = async (req: Request, res: Response) => {
    try {
      const schema = Yup.object({
        worker_name: Yup.string().trim().min(2).required(),
        mobile: Yup.string().trim().nullable().optional(),
        password: Yup.string().min(4).required(),
      });

      const body = await schema.validate(req.body, { abortEarly: false, stripUnknown: true });

      if (!this.Worker) {
        return res.status(500).json({ success: false, error: "Worker model not initialized" });
      }

      // ensure unique worker_name (case-insensitive)
      const existing = await this.Worker.findOne({
        where: dbModels.sequelize.where(
          dbModels.sequelize.fn("LOWER", dbModels.sequelize.col("worker_name")),
          body.worker_name.toLowerCase()
        ),
      });

      if (existing) {
        return res.status(409).json({ success: false, error: "Worker name already exists" });
      }

      const password_hash = await bcrypt.hash(body.password, 10);

      const worker = await this.Worker.create({
        worker_name: body.worker_name,
        mobile: body.mobile || null,
        password_hash, // ✅ store hash
      });

      return res.status(201).json({
        success: true,
        data: {
          id: worker.id,
          worker_name: worker.worker_name,
          mobile: worker.mobile,
        },
        message: "Worker registered successfully",
      });
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      console.error("Worker Register Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ✅ LOGIN WORKER (by worker_name OR mobile)
  public login = async (req: Request, res: Response) => {
    try {
      const schema = Yup.object({
        worker_name: Yup.string().trim().nullable().optional(),
        mobile: Yup.string().trim().nullable().optional(),
        password: Yup.string().required(),
      });

      const body = await schema.validate(req.body, { abortEarly: false, stripUnknown: true });

      if (!this.Worker) {
        return res.status(500).json({ success: false, error: "Worker model not initialized" });
      }

      if (!body.worker_name && !body.mobile) {
        return res.status(400).json({ success: false, error: "worker_name or mobile is required" });
      }

      const where: any = {};
      if (body.worker_name) {
        where.worker_name = dbModels.sequelize.where(
          dbModels.sequelize.fn("LOWER", dbModels.sequelize.col("worker_name")),
          body.worker_name.toLowerCase()
        );
      } else if (body.mobile) {
        where.mobile = body.mobile;
      }

      const worker = await this.Worker.findOne({ where });

      if (!worker) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      const ok = await bcrypt.compare(body.password, worker.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      const token = jwt.sign(
        {
          workerId: worker.id,
          worker_name: worker.worker_name,
          type: "WORKER",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        success: true,
        token,
        data: {
          id: worker.id,
          worker_name: worker.worker_name,
          mobile: worker.mobile,
        },
      });
    } catch (err: any) {
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      console.error("Worker Login Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

  // ✅ ME
  public me = async (req: Request, res: Response) => {
    try {
      const worker = (req as any).worker;
      if (!worker?.workerId) {
        return res.status(401).json({ success: false, msg: "Unauthorized" });
      }

      if (!this.Worker) {
        return res.status(500).json({ success: false, error: "Worker model not initialized" });
      }

      const row = await this.Worker.findByPk(worker.workerId);

      if (!row) {
        return res.status(404).json({ success: false, error: "Worker not found" });
      }

      return res.json({
        success: true,
        data: {
          id: row.id,
          worker_name: row.worker_name,
          mobile: row.mobile,
        },
      });
    } catch (err: any) {
      console.error("Worker Me Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}
