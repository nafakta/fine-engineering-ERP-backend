import { Request, Response } from "express";
import { Op, Sequelize } from "sequelize";
import dbModels from "../models"; // <-- adjust to your project import

// ✅ Update this if your model name differs
const AssignToWorker = dbModels.AssignToWorker;

const STATUS_LIST = [
  "in-progress",
  "in-review",
  "machine",
  "ready-for-qc",
  "qc-welding",
  "vendor-outsource",
  "qc-vendor",
  "in-welding",
  "in-vendor",
  "completed",
  "not-ok",
  "rejected",
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default class MaterialMovementController {
  /**
   * ✅ GET /material-movement/options
   * Returns distinct values for dropdowns
   * Supports filtering machine codes by category + size (dependent dropdown)
   */
  options = async (req: Request, res: Response) => {
    try {
      const machine_category = (req.query.machine_category as string) || "";
      const machine_size = (req.query.machine_size as string) || "";

      const whereCodes: any = {};
      if (machine_category) whereCodes.machine_category = machine_category;
      if (machine_size) whereCodes.machine_size = machine_size;

      const distinct = async (col: string, where: any = {}) => {
        const rows = await AssignToWorker.findAll({
          attributes: [[Sequelize.fn("DISTINCT", Sequelize.col(col)), col]],
          where,
          raw: true,
        });
        return rows
          .map((r: any) => r[col])
          .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== "");
      };

      const [machineCategories, machineSizes, machineCodes, workers, vendors] =
        await Promise.all([
          distinct("machine_category"),
          distinct("machine_size", machine_category ? { machine_category } : {}),
          distinct("machine_code", whereCodes),
          distinct("worker_name"),
          distinct("vendor_name"),
        ]);

      return res.json({
        success: true,
        data: {
          statuses: STATUS_LIST,
          machineCategories,
          machineSizes,
          machineCodes,
          workers,
          vendors,
        },
      });
    } catch (err: any) {
      console.error("material-movement options error:", err);
      return res.status(500).json({
        success: false,
        message: err?.message || "Internal server error",
      });
    }
  };

  /**
   * ✅ GET /material-movement
   * Table API with filters:
   * - q (search)
   * - status
   * - machine_category, machine_size, machine_code
   * - vendor_name, worker_name
   * - page, limit
   */
  list = async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || "";
      const status = (req.query.status as string) || "";
      const machine_category = (req.query.machine_category as string) || "";
      const machine_size = (req.query.machine_size as string) || "";
      const machine_code = (req.query.machine_code as string) || "";
      const vendor_name = (req.query.vendor_name as string) || "";
      const worker_name = (req.query.worker_name as string) || "";

      const page = clamp(parseInt((req.query.page as string) || "1", 10) || 1, 1, 100000);
      const limit = clamp(parseInt((req.query.limit as string) || "10", 10) || 10, 1, 200);

      const where: any = {};

      if (status) where.status = status;
      if (machine_category) where.machine_category = machine_category;
      if (machine_size) where.machine_size = machine_size;
      if (machine_code) where.machine_code = machine_code;
      if (vendor_name) where.vendor_name = vendor_name;
      if (worker_name) where.worker_name = worker_name;

      if (q) {
        // ✅ search across common columns
        where[Op.or] = [
          { job_no: { [Op.iLike]: `%${q}%` } },
          { jo_number: { [Op.iLike]: `%${q}%` } },
          { item_description: { [Op.iLike]: `%${q}%` } },
          { machine_code: { [Op.iLike]: `%${q}%` } },
          { vendor_name: { [Op.iLike]: `%${q}%` } },
          { worker_name: { [Op.iLike]: `%${q}%` } },
        ];
      }

      const offset = (page - 1) * limit;

      const { rows, count } = await AssignToWorker.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit,
        offset,
      });

      return res.json({
        success: true,
        data: rows,
        meta: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err: any) {
      console.error("material-movement list error:", err);
      return res.status(500).json({
        success: false,
        message: err?.message || "Internal server error",
      });
    }
  };
}