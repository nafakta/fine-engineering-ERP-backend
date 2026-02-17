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

      // Auto-generate serial_no sequence (e.g., input "ABC" -> "ABC-0001")
      if (body.serial_no) {
        const baseSerial = body.serial_no.trim();
        const lastRecord = await this.AssignToWorker.findOne({
          where: {
            serial_no: { [Op.iLike]: `${baseSerial}-%` },
          },
          order: [
            [dbModels.sequelize.fn("length", dbModels.sequelize.col("serial_no")), "DESC"],
            ["serial_no", "DESC"],
          ],
          transaction,
        });

        let nextSeq = 1;
        if (lastRecord && lastRecord.serial_no) {
          const parts = lastRecord.serial_no.split("-");
          const lastSeqNum = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastSeqNum)) nextSeq = lastSeqNum + 1;
        }

        body.serial_no = `${baseSerial}-${String(nextSeq).padStart(4, "0")}`;
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
          { status: { [Op.iLike]: `%${q}%` } },
        ];

        where[Op.or] = orConditions;
      }

      if (req.query.jo_no) {
        where.jo_no = String(req.query.jo_no).trim();
      }

      if (req.query.job_id) {
        where.job_id = req.query.job_id;
      }

      if (req.query.status) {
        where.status = { [Op.iLike]: `%${String(req.query.status).trim()}%` };
      } else {
        where.status = {
          [Op.or]: [{ [Op.ne]: "rejected" }, { [Op.eq]: null }],
        };
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

  // MOVE TO REVIEW
  public moveToReview = async (req: Request, res: Response) => {
    const transaction = await dbModels.sequelize.transaction();
    try {
      const { id } = req.params;
      const { updated_by } = req.body;

      const schema = Yup.object({
        updated_by: Yup.string().uuid().nullable().optional(),
      });
      await schema.validate({ updated_by }, { abortEarly: false, stripUnknown: true });

      if (!this.AssignToWorker) {
        await transaction.rollback();
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, { transaction });

      if (!record) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      if (record.status !== "in-progress") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only assignments with status 'in-progress' can be moved to review. Current status is '${record.status}'.`,
        });
      }

      await record.update({ status: "in-review", updated_by }, { transaction });

      await transaction.commit();

      return res.json({
        success: true,
        data: record,
        message: "Assignment status updated to 'in-review' successfully",
      });
    } catch (err: any) {
      await transaction.rollback();
      console.error("Move to Review Error:", err);
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

  // REJECT ASSIGNMENT
  public rejectAssignment = async (req: Request, res: Response) => {
    const transaction = await dbModels.sequelize.transaction();
    try {
      const { id } = req.params;
      const { updated_by } = req.body;

      const schema = Yup.object({
        updated_by: Yup.string().uuid().nullable().optional(),
      });
      await schema.validate({ updated_by }, { abortEarly: false, stripUnknown: true });

      if (!this.AssignToWorker) {
        await transaction.rollback();
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, { transaction });

      if (!record) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      if (record.status !== "in-progress") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only assignments with status 'in-progress' can be rejected. Current status is '${record.status}'.`,
        });
      }

      await record.update({ status: "rejected", updated_by }, { transaction });

      // Add quantity back to Job
      if (record.quantity_no && record.quantity_no > 0) {
        let job = null;

        if (record.job_id) {
          job = await dbModels.Job.findByPk(record.job_id, { transaction });
        }

        // Fallback: match serial_no (remove last 5 chars: hyphen + 4 digits)
        if (!job && record.serial_no && record.serial_no.length > 5) {
          const jobSerial = record.serial_no.slice(0, -5);
          job = await dbModels.Job.findOne({
            where: { serial_no: jobSerial },
            transaction,
          });
        }

        if (job) {
          const currentQty = Number(job.qty);
          const restoreQty = Number(record.quantity_no);
          await job.update({ qty: currentQty + restoreQty }, { transaction });
        }
      }

      await transaction.commit();

      return res.json({
        success: true,
        data: record,
        message: "Assignment rejected and quantity restored to job successfully",
      });
    } catch (err: any) {
      await transaction.rollback();
      console.error("Reject Assignment Error:", err);
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

  // MOVE TO READY FOR QC
  public moveToReadyForQC = async (req: Request, res: Response) => {
    const transaction = await dbModels.sequelize.transaction();
    try {
      const { id } = req.params;
      const { updated_by } = req.body;

      const schema = Yup.object({
        updated_by: Yup.string().uuid().nullable().optional(),
      });
      await schema.validate({ updated_by }, { abortEarly: false, stripUnknown: true });

      if (!this.AssignToWorker) {
        await transaction.rollback();
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, { transaction });

      if (!record) {
        await transaction.rollback();
        return res
          .status(404)
          .json({ success: false, error: "Assignment not found" });
      }

      if (record.status !== "in-review") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only assignments with status 'in-review' can be moved to ready-for-qc. Current status is '${record.status}'.`,
        });
      }

      await record.update({ status: "ready-for-qc", updated_by }, { transaction });

      await transaction.commit();

      return res.json({
        success: true,
        data: record,
        message: "Assignment status updated to 'ready-for-qc' successfully",
      });
    } catch (err: any) {
      await transaction.rollback();
      console.error("Move to Ready For QC Error:", err);
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

  // LIST BY WORKER (IN-PROGRESS)
  public listByWorker = async (req: Request, res: Response) => {
    try {
      const { worker_name } = req.query;

      if (!worker_name) {
        return res.status(400).json({
          success: false,
          error: "worker_name is required as a query parameter",
        });
      }

      if (!this.AssignToWorker) {
        return res
          .status(500)
          .json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const rows = await this.AssignToWorker.findAll({
        where: {
          worker_name: String(worker_name),
          status: "in-progress",
        },
        order: [["created_at", "DESC"]],
        include: [
          {
            model: dbModels.Job,
            as: "job",
          },
        ],
      });

      return res.json({ success: true, data: rows });
    } catch (err: any) {
      console.error("List By Worker Error:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };
}
