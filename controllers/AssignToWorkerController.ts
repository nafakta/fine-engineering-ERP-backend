import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";
import { JobType } from "../models/Job";
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
 // WORKER LIST - ONLY LOGGED IN WORKER
 public workerList = async (req: Request, res: Response) => {
  try {
    if (!this.AssignToWorker) {
      return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
    }

    const worker = (req as any).worker;
    const workerName = String(worker?.worker_name || "").trim();

    if (!workerName) {
      return res.status(401).json({ success: false, error: "Unauthorized worker" });
    }

    const status = String(req.query.status ?? "in-progress").trim();

    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const offset = (page - 1) * limit;

    const where: any = {
      worker_name: { [Op.iLike]: workerName },
    };
    if (status) where.status = status;

    const { rows, count } = await this.AssignToWorker.findAndCountAll({
      where,
      limit,
      offset,
      order: [["created_at", "DESC"]],
      include: [
        {
          model: dbModels.Job,
          as: "job",
          required: false,
          attributes: ["item_description", "moc", "item_no"],
        },
      ],
    });

    const data = rows.map((r: any) => {
      const j = r.toJSON();
      return {
        ...j,
        item_description: j.job?.item_description ?? null,
        moc: j.job?.moc ?? null,
        job_item_no: j.job?.item_no ?? null,
      };
    });

    return res.json({
      success: true,
      data,
      meta: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (err) {
    console.error("Worker list error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
public getReviewAssignmentsPublic = async (req: Request, res: Response) => {
  try {
    const { status = "in-review", job_type } = req.query;

    const where: any = { status };

    if (job_type) where.machine_category = job_type; // or your column

    const data = await this.AssignToWorker.findAll({
      where,
      order: [["assigning_date", "DESC"]],
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error("Public review fetch error:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
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

      if (req.query.worker_name) {
        where.worker_name = { [Op.iLike]: `%${String(req.query.worker_name).trim()}%` };
      }

      if (req.query.status) {
        where.status = { [Op.iLike]: `%${String(req.query.status).trim()}%` };
      } else {
        where.status = {
          [Op.or]: [{ [Op.ne]: "rejected" }, { [Op.eq]: null }],
        };
      }

      const queryOptions: any = {
        where,
        limit,
        offset,
        order: [["created_at", "DESC"]],
      };

      const jobType = req.query.job_type as JobType | undefined;
      if (jobType && ["JOB_SERVICE", "TSO_SERVICE", "KANBAN"].includes(jobType)) {
        queryOptions.include = [{
          model: dbModels.Job,
          as: "job",
          where: { job_type: jobType },
          required: true,
          attributes: [] // This prevents Job data from being included in the response
        }];
      }

      const { rows, count } = await this.AssignToWorker.findAndCountAll(queryOptions);

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

  // MOVE TO REVIEW
public moveToReview = async (req: Request, res: Response) => {
  const transaction = await dbModels.sequelize.transaction();
  try {
    const { id } = req.params;
    const { updated_by, qty } = req.body;

    const schema = Yup.object({
      updated_by: Yup.string().uuid().nullable().optional(),
      qty: Yup.number().integer().min(1).required(),
    });

    const body = await schema.validate({ updated_by, qty }, { abortEarly: false, stripUnknown: true });

    if (!this.AssignToWorker) {
      await transaction.rollback();
      return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
    }

    const record = await this.AssignToWorker.findByPk(id, { transaction });

    if (!record) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: "Assignment not found" });
    }

    if ((record.status ?? "in-progress") !== "in-progress") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: `Only assignments with status 'in-progress' can be moved to review. Current status is '${record.status}'.`,
      });
    }

    const assignedQty = Number(record.quantity_no ?? 0);
    const moveQty = Number(body.qty);

    if (assignedQty <= 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: "Assignment quantity is 0" });
    }

    if (moveQty > assignedQty) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: `Move qty cannot be greater than assigned qty. Assigned: ${assignedQty}`,
      });
    }

    // ✅ If worker completed full qty -> just move status to in-review
    if (moveQty === assignedQty) {
      await record.update({ status: "in-review", updated_by }, { transaction });
      await transaction.commit();

      return res.json({
        success: true,
        data: record,
        message: "Full assignment moved to 'in-review'",
      });
    }

    // ✅ If partial -> SPLIT
    // 1) Update current record to remaining qty (still in-progress)
    const remainingQty = assignedQty - moveQty;

    await record.update(
      {
        quantity_no: remainingQty,
        updated_by,
        status: "in-progress",
      },
      { transaction }
    );

    // 2) Create new record for review qty (same job/serial/worker)
    const reviewRecordPayload = {
      jo_no: record.jo_no,
      item_no: record.item_no,
      machine_category: record.machine_category,
      machine_size: record.machine_size,
      machine_code: record.machine_code,
      worker_name: record.worker_name,
      worker_id: record.worker_id,
      serial_no: record.serial_no,
      job_id: record.job_id,
      assigning_date: record.assigning_date,

      quantity_no: moveQty,
      status: "in-review",
      created_by: record.created_by,
      updated_by,
    };

    const newReviewRow = await this.AssignToWorker.create(reviewRecordPayload, { transaction });

    await transaction.commit();

    return res.json({
      success: true,
      data: {
        remaining_assignment: record,
        review_assignment: newReviewRow,
      },
      message: `Partial qty moved to 'in-review' (${moveQty}), remaining ${remainingQty} stays 'in-progress'`,
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
    return res.status(500).json({ success: false, error: "Internal server error" });
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

      if (record.status !== "in-review") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only assignments with status 'in-review' can be rejected. Current status is '${record.status}'.`,
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
}
