import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import dbModels from "../models";
import { JobType } from "../models/Job";
import {
  createAssignToWorkerSchema,
  updateAssignToWorkerSchema,
} from "./Validations";
const qcIncomingSchema = Yup.object({
  // REQUIRED: which queue this incoming belongs to
  incoming_for: Yup.string()
    .oneOf(["welding", "vendor"], "incoming_for must be welding or vendor")
    .required("incoming_for is required"),

  // Optional fields - keep what your form sends
  incoming_qty: Yup.number().nullable().min(0),
  remarks: Yup.string().nullable(),
  vendor_name: Yup.string().nullable(),
  challan_no: Yup.string().nullable(),
  received_date: Yup.string().nullable(), // or date
}).noUnknown(true);

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
//   public list = async (req: Request, res: Response) => {
//     try {
//       if (!this.AssignToWorker) {
//         return res
//           .status(500)
//           .json({ success: false, error: "AssignToWorker model not initialized" });
//       }

//       const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
//       const limit = Math.min(
//         100,
//         Math.max(1, parseInt(String(req.query.limit ?? "20"), 10))
//       );
//       const offset = (page - 1) * limit;
//       const q = String(req.query.q ?? "").trim();

//       const where: any = {};

//       if (q) {
//         const orConditions: any[] = [
//           { worker_name: { [Op.iLike]: `%${q}%` } },
//           { machine_category: { [Op.iLike]: `%${q}%` } },
//           { machine_code: { [Op.iLike]: `%${q}%` } },
//           { serial_no: { [Op.iLike]: `%${q}%` } },
//           { jo_no: { [Op.iLike]: `%${q}%` } },
//           { status: { [Op.iLike]: `%${q}%` } },
//         ];

//         where[Op.or] = orConditions;
//       }

//       if (req.query.jo_no) {
//         where.jo_no = String(req.query.jo_no).trim();
//       }

//       if (req.query.job_id) {
//         where.job_id = req.query.job_id;
//       }

//       if (req.query.worker_name) {
//         where.worker_name = { [Op.iLike]: `%${String(req.query.worker_name).trim()}%` };
//       }
//       if (req.query.review_for) {
//         where.review_for = req.query.review_for;
//       }
      // if (req.query.worker_id) {
      //   where.worker_id = req.query.worker_id;
      // }

      // if (req.query.worker_name) {
      //   where.worker_name = { [Op.iLike]: `%${String(req.query.worker_name).trim()}%` };
      // }

//       if (req.query.status) {
//         where.status = { [Op.iLike]: `%${String(req.query.status).trim()}%` };
//       } else {
//         where.status = {
//           [Op.or]: [{ [Op.ne]: "rejected" }, { [Op.eq]: null }],
//         };
//       }

//       const queryOptions: any = {
//         where,
//         limit,
//         offset,
//         order: [["created_at", "DESC"]],
//       };

//       const jobType = req.query.job_type as JobType | undefined;
//       if (jobType && ["JOB_SERVICE", "TSO_SERVICE", "KANBAN"].includes(jobType)) {
//         queryOptions.include = [{
//           model: dbModels.Job,
//           as: "job",
//           where: { job_type: jobType },
//           required: true,
//           attributes: [] // This prevents Job data from being included in the response
//         }];
//       }

//       const { rows, count } = await this.AssignToWorker.findAndCountAll(queryOptions);

//       return res.json({
//         success: true,
//         data: rows,
//         meta: {
//           page,
//           limit,
//           total: count,
//           totalPages: Math.ceil(count / limit),
//         },
//       });
//     } catch (err: any) {
//       console.error("List AssignToWorker Error:", err);
//       return res
//         .status(500)
//         .json({ success: false, error: "Internal server error" });
//     }
//   };


// public listAssignToWorker = async (req: Request, res: Response) => {
//   try {
//     const AssignToWorker = (dbModels as any).AssignToWorker;

//     const { status, review_for } = req.query as any;

//     const where: any = {};

//     if (status) where.status = status;
//     if (review_for && (review_for === "vendor" || review_for === "welding")) {
//       where.review_for = review_for;
//     }

//     const rows = await AssignToWorker.findAll({
//       where,
//       order: [["created_at", "DESC"]],
//     });

//     return res.json({ success: true, data: rows });
//   } catch (e: any) {
//     console.error("listAssignToWorker error:", e);
//     return res.status(500).json({ success: false, error: e?.message || "Internal error" });
//   }
// };


  // ==========================
  // LIST
  // ==========================
  // public list = async (req: Request, res: Response) => {
  //   try {
  //     const { status, job_type, review_for } = req.query as any;

  //     const where: any = {};
  //     if (status) where.status = status;
  //     if (job_type) where.job_type = job_type; // if you have job_type in DB/view

  //     // review_for filtering:
  //     if (review_for === "welding") where.review_for = "welding";
  //     else if (review_for === "vendor") where.review_for = "vendor";
  //     else if (review_for === "null") where.review_for = null;

  //     const data = await this.AssignToWorker.findAll({
  //       where,
  //       order: [["created_at", "DESC"]],
  //     });

  //     return res.json({ success: true, data });
  //   } catch (e: any) {
  //     return res.status(500).json({ success: false, error: e.message });
  //   }
  // };



  // ==========================
  // QC WELDING OUTGOING / INCOMING
  // ==========================
  public qcOutgoingWelding = async (req: Request, res: Response) => {
    const row = await this.AssignToWorker.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });

    const { qc_date, qc_quantity, gatepass_no } = req.body;

    await row.update({
      qc_date,
      qc_quantity,
      gatepass_no,
      status: "in-welding",
    });

    return res.json({ success: true });
  };

  public qcIncomingWelding = async (req: Request, res: Response) => {
    const row = await this.AssignToWorker.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });

    const { qc_date, qc_quantity } = req.body;

    await row.update({
      qc_date,
      qc_quantity,
      status: "in-review",
      review_for: "welding",
    });

    return res.json({ success: true });
  };
  
    // ✅ LIST
    // GET /assign-to-worker?status=in-review&review_for=vendor
    public list = async (req: Request, res: Response) => {
      try {
        const { status, review_for } = req.query as any;
  
        const where: any = {};
  
        if (status) where.status = status;
  
        // ✅ KEY RULE:
        // status=in-review:
        // - if review_for provided => filter by it
        // - else => ONLY normal review (review_for IS NULL)
        if (status === "in-review") {
          if (review_for === "vendor" || review_for === "welding") {
            where.review_for = review_for;
          } else {
            where.review_for = { [Op.is]: null };
          }
        }
  
        const rows = await this.AssignToWorker.findAll({
          where,
          order: [["created_at", "DESC"]],
        });
  
        return res.json({ success: true, data: rows });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: err?.message || "Internal server error",
        });
      }
    };
  
    // ✅ QC OUTGOING
    // POST /assign-to-worker/:id/qc-outgoing
    // Used for both vendor & welding outgoing
    public qcOutgoing = async (req: Request, res: Response) => {
      const t = await dbModels.sequelize.transaction();
      try {
        const schema = Yup.object({
          qc_date: Yup.string().required("qc_date is required"),
          qc_quantity: Yup.number().required("qc_quantity is required").min(1),
          gatepass_no: Yup.string().required("gatepass_no is required"),
        });
  
        const body = await schema.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });
  
        const id = req.params.id;
  
        const row = await this.AssignToWorker.findByPk(id, { transaction: t });
        if (!row) {
          await t.rollback();
          return res.status(404).json({ success: false, error: "Item not found" });
        }
  
        // ⚠️ Outgoing is allowed only if current status is qc-vendor or qc-welding
        if (row.status !== "qc-vendor" && row.status !== "qc-welding") {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `qc-outgoing allowed only from qc-vendor/qc-welding. Current status=${row.status}`,
          });
        }
  
        // ✅ Next status after outgoing
        const nextStatus = row.status === "qc-vendor" ? "in-vendor" : "in-welding";
  
        await row.update(
          {
            qc_date: body.qc_date,
            qc_quantity: body.qc_quantity,
            gatepass_no: body.gatepass_no,
            status: nextStatus,
            // keep review_for null here (incoming decides)
            review_for: null,
          },
          { transaction: t }
        );
  
        await t.commit();
        return res.json({ success: true, data: row });
      } catch (err: any) {
        await t.rollback();
        return res.status(500).json({
          success: false,
          error: err?.message || "Internal server error",
        });
      }
    };
  
    // ✅ QC INCOMING
    // POST /assign-to-worker/:id/qc-incoming
    // MUST be called only when status is in-vendor or in-welding
    // It moves item into in-review and sets review_for correctly
    public qcIncoming = async (req: Request, res: Response) => {
      const t = await dbModels.sequelize.transaction();
      try {
        const schema = Yup.object({
          qc_date: Yup.string().required("qc_date is required"),
          qc_quantity: Yup.number()
            .typeError("qc_quantity must be a number")
            .required("qc_quantity is required")
            .integer("qc_quantity must be an integer")
            .min(1, "qc_quantity must be >= 1"),
        });
    
        const body = await schema.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
        });
    
        const id = req.params.id;
    
        if (!this.AssignToWorker) {
          await t.rollback();
          return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
        }
    
        const row = await this.AssignToWorker.findByPk(id, { transaction: t });
        if (!row) {
          await t.rollback();
          return res.status(404).json({ success: false, error: "Item not found" });
        }
    
        // ✅ allowed only from these statuses
        let nextReviewFor: "vendor" | "welding" | null = null;
        if (row.status === "in-vendor") nextReviewFor = "vendor";
        if (row.status === "in-welding") nextReviewFor = "welding";
    
        if (!nextReviewFor) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `qc-incoming allowed only from in-vendor/in-welding. Current status=${row.status}`,
          });
        }
    
        const currentQty = Number(row.quantity_no ?? 0);
        const incomingQty = Number(body.qc_quantity ?? 0);
    
        if (currentQty <= 0) {
          await t.rollback();
          return res.status(400).json({ success: false, error: "Current assignment quantity is 0" });
        }
    
        if (incomingQty > currentQty) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `Incoming qty cannot be greater than pending qty. Pending=${currentQty}`,
          });
        }
    
        // ✅ CASE 1: FULL INCOMING -> same row moved to review
        if (incomingQty === currentQty) {
          await row.update(
            {
              qc_date: body.qc_date,
              qc_quantity: incomingQty,
    
              status: "in-review",
              review_for: nextReviewFor,
            },
            { transaction: t }
          );
    
          await t.commit();
          return res.json({
            success: true,
            data: row,
            message: `Full incoming received (${incomingQty}). Moved to in-review (${nextReviewFor}).`,
          });
        }
    
        // ✅ CASE 2: PARTIAL INCOMING -> SPLIT
        const remainingQty = currentQty - incomingQty;
    
        // 1) keep original row pending with remaining qty (stays in-vendor / in-welding)
        await row.update(
          {
            quantity_no: remainingQty,
            // do NOT overwrite qc fields here, because this row is still pending
            // qc_date: null,
            // qc_quantity: null,
            // gatepass_no: null,
            status: row.status, // stays as in-vendor or in-welding
          },
          { transaction: t }
        );
    
        // 2) create new row for incoming qty -> move to review
        const reviewRowPayload = {
          jo_no: row.jo_no,
          item_no: row.item_no,
          machine_category: row.machine_category,
          machine_size: row.machine_size,
          machine_code: row.machine_code,
    
          worker_name: row.worker_name,
          worker_id: row.worker_id,
    
          serial_no: row.serial_no,
          job_id: row.job_id,
          assigning_date: row.assigning_date,
    
          vendor_name: row.vendor_name,
    
          quantity_no: incomingQty,
    
          qc_date: body.qc_date,
          qc_quantity: incomingQty,
    
          status: "in-review",
          review_for: nextReviewFor,
    
          created_by: row.created_by,
          updated_by: row.updated_by,
        };
    
        const reviewRow = await this.AssignToWorker.create(reviewRowPayload, { transaction: t });
    
        await t.commit();
    
        return res.json({
          success: true,
          data: {
            remaining_pending: row,
            moved_to_review: reviewRow,
          },
          message: `Partial incoming received (${incomingQty}). Remaining ${remainingQty} still pending in ${row.status}.`,
        });
      } catch (err: any) {
        await t.rollback();
    
        if (err instanceof Yup.ValidationError) {
          return res.status(400).json({
            success: false,
            error: "Validation error",
            details: err.errors,
          });
        }
    
        return res.status(500).json({
          success: false,
          error: err?.message || "Internal server error",
        });
      }
    };

  public qcOutgoingVendor = async (req: Request, res: Response) => {
    const row = await this.AssignToWorker.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });

    const { qc_date, qc_quantity, gatepass_no } = req.body;

    await row.update({
      qc_date,
      qc_quantity,
      gatepass_no,
      status: "in-vendor",
    });

    return res.json({ success: true });
  };

  public qcIncomingVendor = async (req: Request, res: Response) => {
    const row = await this.AssignToWorker.findByPk(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });

    const { qc_date, qc_quantity } = req.body;

    await row.update({
      qc_date,
      qc_quantity,
      status: "in-review",
      review_for: "vendor",
    });

    return res.json({ success: true });
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

  // ✅ REVIEW -> MACHINE (back to in-progress)
  public moveToMachine = async (req: Request, res: Response) => {
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
        return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, { transaction });
      if (!record) {
        await transaction.rollback();
        return res.status(404).json({ success: false, error: "Assignment not found" });
      }

      if (record.status !== "in-review") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only 'in-review' can go to 'in-progress'. Current: '${record.status}'`,
        });
      }

      await record.update({ status: "in-progress", updated_by }, { transaction });
      await transaction.commit();

      return res.json({ success: true, data: record, message: "Moved back to in-progress (Machine)" });
    } catch (err: any) {
      await transaction.rollback();
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };


  public moveToWelding = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const record = await this.AssignToWorker.findByPk(id);
      if (!record) return res.status(404).json({ success: false, error: "Not found" });

      if (record.status !== "in-review") {
        return res.status(400).json({ success: false, error: "Only in-review allowed" });
      }

      await record.update({ status: "qc-welding" });
      return res.json({ success: true, data: record });
    } catch (e: any) {
      console.error("moveToWelding error:", e);
      return res.status(500).json({ success: false, error: e?.message || "Internal error" });
    }
  };

  public moveToVendor = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const record = await this.AssignToWorker.findByPk(id);
      if (!record) return res.status(404).json({ success: false, error: "Not found" });

      if (record.status !== "in-review") {
        return res.status(400).json({ success: false, error: "Only in-review allowed" });
      }

      await record.update({ status: "vendor-outsource", vendor_name: null });
      return res.json({ success: true, data: record });
    } catch (e: any) {
      console.error("moveToVendor error:", e);
      return res.status(500).json({ success: false, error: e?.message || "Internal error" });
    }
  };



  // ✅ PRODUCTION PLANNING -> ASSIGN VENDOR, then goes to QC/VENDOR
  public assignVendor = async (req: Request, res: Response) => {
    const transaction = await dbModels.sequelize.transaction();
    try {
      const { id } = req.params;
      const { vendor_name, updated_by } = req.body;

      const schema = Yup.object({
        vendor_name: Yup.string().trim().min(2).required(),
        updated_by: Yup.string().uuid().nullable().optional(),
      });
      const body = await schema.validate({ vendor_name, updated_by }, { abortEarly: false, stripUnknown: true });

      if (!this.AssignToWorker) {
        await transaction.rollback();
        return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
      }

      const record = await this.AssignToWorker.findByPk(id, { transaction });
      if (!record) {
        await transaction.rollback();
        return res.status(404).json({ success: false, error: "Assignment not found" });
      }

      if (record.status !== "vendor-outsource") {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          error: `Only 'vendor-outsource' can be assigned vendor. Current: '${record.status}'`,
        });
      }

      await record.update(
        { vendor_name: body.vendor_name, status: "qc-vendor", updated_by: body.updated_by },
        { transaction }
      );

      await transaction.commit();
      return res.json({ success: true, data: record, message: "Vendor assigned, moved to QC Vendor" });
    } catch (err: any) {
      await transaction.rollback();
      if (err instanceof Yup.ValidationError) {
        return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  };

// // ✅ QC OUTGOING (qc-welding & qc-vendor) -> moves to in-welding / in-vendor
// public qcOutgoing = async (req: Request, res: Response) => {
//   const transaction = await dbModels.sequelize.transaction();
//   try {
//     const { id } = req.params;
//     const { qc_date, qc_quantity, gatepass_no, updated_by } = req.body;

//     const schema = Yup.object({
//       qc_date: Yup.date().required(),
//       qc_quantity: Yup.number().integer().min(1).required(),
//       gatepass_no: Yup.string().trim().min(1).required(),
//       updated_by: Yup.string().uuid().nullable().optional(),
//     });

//     const body = await schema.validate(
//       { qc_date, qc_quantity, gatepass_no, updated_by },
//       { abortEarly: false, stripUnknown: true }
//     );

//     if (!this.AssignToWorker) {
//       await transaction.rollback();
//       return res.status(500).json({ success: false, error: "AssignToWorker model not initialized" });
//     }

//     const record = await this.AssignToWorker.findByPk(id, { transaction });
//     if (!record) {
//       await transaction.rollback();
//       return res.status(404).json({ success: false, error: "Assignment not found" });
//     }

//     const st = String(record.status || "");
//     if (st !== "qc-welding" && st !== "qc-vendor") {
//       await transaction.rollback();
//       return res.status(400).json({
//         success: false,
//         error: `Outgoing allowed only for 'qc-welding' or 'qc-vendor'. Current: '${record.status}'`,
//       });
//     }

//     const maxQty = Number(record.quantity_no || 0);
//     if (Number(body.qc_quantity) > maxQty) {
//       await transaction.rollback();
//       return res.status(400).json({
//         success: false,
//         error: `QC quantity cannot exceed assignment quantity (${maxQty})`,
//       });
//     }

//     const nextStatus = st === "qc-welding" ? "in-welding" : "in-vendor";

//     await record.update(
//       {
//         qc_date: body.qc_date,
//         qc_quantity: body.qc_quantity,
//         gatepass_no: body.gatepass_no,
//         status: nextStatus,
//         updated_by: body.updated_by,
//       },
//       { transaction }
//     );

//     await transaction.commit();
//     return res.json({ success: true, data: record, message: `Outgoing saved, moved to '${nextStatus}'` });
//   } catch (err: any) {
//     await transaction.rollback();
//     console.error("qcOutgoing error:", err);
//     if (err instanceof Yup.ValidationError) {
//       return res.status(400).json({ success: false, error: "Validation error", details: err.errors });
//     }
//     return res.status(500).json({ success: false, error: err?.message || "Internal server error" });
//   }
// };

// // ✅ QC INCOMING (in-welding & in-vendor) -> moves to in-review and sets review_for
// public qcIncoming = async (req: Request, res: Response) => {
//   try {
//     const { incoming_for, qc_date, qc_quantity, vendor_name } = req.body;
//     const id = req.params.id;

//     const item = await this.AssignToWorker.findByPk(id);
//     if (!item) {
//       return res.status(404).json({ success: false, error: "Not found" });
//     }

//     await item.update({
//       qc_date,
//       qc_quantity,
//       vendor_name: incoming_for === "vendor" ? vendor_name : null,

//       status: "in-review",      // ✅ VALID STATUS
//       review_for: incoming_for, // ✅ separate welding/vendor
//     });

//     return res.json({
//       success: true,
//       message: "Moved to Review successfully",
//     });
//   } catch (err: any) {
//     console.error(err);
//     return res.status(500).json({
//       success: false,
//       error: err.message,
//     });
//   }
// };

public getReviewVendor = async (req: Request, res: Response) => {
  try {
    const data = await this.AssignToWorker.findAll({
      where: {
        status: "review-vendor",
      },
      order: [["updated_at", "DESC"]],
    });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
};
public getReviewWelding = async (req: Request, res: Response) => {
  try {
    const data = await this.AssignToWorker.findAll({
      where: {
        status: "review-welding",
      },
      order: [["updated_at", "DESC"]],
    });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false });
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
