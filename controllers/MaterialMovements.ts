import { Request, Response } from "express";
import { Op } from "sequelize";
import dbModels from "../models";

export default class MaterialMovementController {
  private get AssignToWorker() {
    return (dbModels as any).AssignToWorker;
  }

  private get Worker() {
    return (dbModels as any).Worker || (dbModels as any).Workers || (dbModels as any).workers;
  }

  // ✅ GET CURRENT MATERIAL MOVEMENT LIST
  // Filters: q, status, machine_category, machine_size, machine_code, worker_id, vendor_name
  public list = async (req: Request, res: Response) => {
    try {
      const {
        q,
        status,
        machine_category,
        machine_size,
        machine_code,
        worker_id,
        vendor_name,
        page = "1",
        limit = "20",
      } = req.query as any;

      if (!this.AssignToWorker) {
        return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const where: any = {};

      if (status) where.status = String(status);
      if (machine_category) where.machine_category = String(machine_category);
      if (machine_size) where.machine_size = String(machine_size);
      if (machine_code) where.machine_code = String(machine_code);
      if (worker_id) where.worker_id = String(worker_id);
      if (vendor_name) where.vendor_name = { [Op.iLike]: `%${String(vendor_name)}%` };

      if (q) {
        const like = `%${String(q)}%`;
        where[Op.or] = [
          { serial_no: { [Op.iLike]: like } },
          { jo_no: { [Op.iLike]: like } },
          // item_no is int so cast search (safe)
          dbModels.sequelize.where(dbModels.sequelize.cast(dbModels.sequelize.col("AssignToWorker.item_no"), "text"), {
            [Op.iLike]: like,
          }),
          { machine_category: { [Op.iLike]: like } },
          { machine_size: { [Op.iLike]: like } },
          { machine_code: { [Op.iLike]: like } },
          { worker_name: { [Op.iLike]: like } },
          { vendor_name: { [Op.iLike]: like } },
          { status: { [Op.iLike]: like } },
        ];
      }

      const p = Math.max(parseInt(page, 10) || 1, 1);
      const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const offset = (p - 1) * l;

      // ✅ include Worker table if you have association
      // If you DON’T have association, still works because worker_name is in this table.
      const rows = await this.AssignToWorker.findAndCountAll({
        where,
        order: [["updated_at", "DESC"]],
        limit: l,
        offset,
      });

      return res.json({
        success: true,
        data: rows.rows,
        pagination: {
          page: p,
          limit: l,
          total: rows.count,
          pages: Math.ceil(rows.count / l),
        },
      });
    } catch (err: any) {
      console.error("MaterialMovement list error:", err);
      return res.status(500).json({ success: false, error: err?.message || "Internal server error" });
    }
  };

  // ✅ GET MACHINE SUMMARY (counts by category/size/code/status)
  public machineSummary = async (_req: Request, res: Response) => {
    try {
      const sql = `
        SELECT
          COALESCE(machine_category,'-') as machine_category,
          COALESCE(machine_size,'-') as machine_size,
          COALESCE(machine_code,'-') as machine_code,
          status,
          COUNT(*)::int as total_rows
        FROM public.assign_to_worker
        GROUP BY machine_category, machine_size, machine_code, status
        ORDER BY machine_category ASC, machine_size ASC, machine_code ASC, status ASC;
      `;

      const rows = await dbModels.sequelize.query(sql, {
        type: (dbModels.sequelize as any).QueryTypes.SELECT,
      });

      return res.json({ success: true, data: rows });
    } catch (err: any) {
      console.error("machineSummary error:", err);
      return res.status(500).json({ success: false, error: err?.message || "Internal server error" });
    }
  };
}