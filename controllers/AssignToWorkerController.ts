import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";
import {
  createAssignToWorkerSchema,
  updateAssignToWorkerSchema,
} from "./Validations";

export default class AssignToWorkerController {
  private get AssignToWorker() {
    return (dbModels as any).AssignToWorker;
  }

  // CREATE
  public create = async (req: Request, res: Response) => {
    const transaction = await dbModels.sequelize.transaction();
    try {
      const body = await createAssignToWorkerSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (!this.AssignToWorker) {
        await transaction.rollback();
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      // Subtract quantity from Job
      if (body.quantity_no && body.quantity_no > 0) {
        let job: any = null;

        if (body.job_id) {
          job = await dbModels.Job.findByPk(body.job_id, { transaction });
        } else if (body.jo_no) {
          job = await dbModels.Job.findOne({
            where: { job_no: body.jo_no },
            transaction,
          });
        }

        if (job) {
          const currentQty = Number(job.qty);
          const assignQty = Number(body.quantity_no);

          if (currentQty < assignQty) {
            await transaction.rollback();
            return res.status(400).json({
              success: false,
              error: `Insufficient job quantity. Available: ${currentQty}, Requested: ${assignQty}`,
            });
          }

          await job.update({ qty: currentQty - assignQty }, { transaction });

          if (!body.job_id) {
            body.job_id = job.id;
          }
        }
      }

      const record = await this.AssignToWorker.create(body, { transaction });

      await transaction.commit();

      return res.status(201).json({
        success: true,
        data: record,
        message: "Worker assignment created successfully",
      });
    } catch (err: any) {
      await transaction.rollback();
      console.error("Create AssignToWorker Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };

  // LIST
  public list = async (req: Request, res: Response) => {
    try {
      if (!this.AssignToWorker) {
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
      );
      const offset = (page - 1) * limit;
      const q = String(req.query.q ?? "").trim();

      const where: any = {};

      if (q) {
        const orConditions: any[] = [
          { worker_name: { [Op.iLike]: `%${q}%` } },
          { machine_category: { [Op.iLike]: `%${q}%` } },
          { machine_code: { [Op.iLike]: `%${q}%` } },
          { serial_no: { [Op.iLike]: `%${q}%` } },
          { jo_no: { [Op.iLike]: `%${q}%` } },
        ];

        where[Op.or] = orConditions;
      }

      if (req.query.jo_no) {
        where.jo_no = String(req.query.jo_no).trim();
      }

      if (req.query.job_id) {
        where.job_id = req.query.job_id;
      }

      const { rows, count } = await this.AssignToWorker.findAndCountAll({
        where,
        limit,
        offset,
        order: [["created_at", "DESC"]],
        // include: [
        //   {
        //     model: dbModels.Job,
        //     as: "job",
        //   },
        // ],
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
      console.error("List AssignToWorker Error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };

  // GET ONE
  public get = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!this.AssignToWorker) {
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, {
        include: [
          {
            model: dbModels.Job,
            as: "job",
          },
        ],
      });

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      return res.json({ success: true, data: record });
    } catch (err: any) {
      console.error("Get AssignToWorker Error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };

  // UPDATE
  public update = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const body = await updateAssignToWorkerSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (!this.AssignToWorker) {
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id);

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      await record.update(body);

      return res.json({
        success: true,
        data: record,
        message: "Assignment updated successfully",
      });
    } catch (err: any) {
      console.error("Update AssignToWorker Error:", err);
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };

  // DELETE
  public delete = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!this.AssignToWorker) {
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id);

      if (!record) {
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      await record.destroy();

      return res.json({
        success: true,
        message: "Assignment deleted successfully",
      });
    } catch (err: any) {
      console.error("Delete AssignToWorker Error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  };
}
