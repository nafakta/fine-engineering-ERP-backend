import { Request, Response } from "express";
import { Op } from "sequelize";
import { AssignToWorker } from "../models/AssignToWorker"; // adjust import
// If you store user id in req.user, use that, else pass updated_by in body.

// --- helpers ---
function sendError(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}
function sendSuccess(res: Response, data: any) {
  return res.json({ success: true, data });
}

type ReviewFor = "welding" | "vendor";
type QCType = "outgoing" | "incoming";

function inferReviewFor(row: any, explicit?: any): ReviewFor | null {
  const rf = (explicit || row?.review_for || "").toString().toLowerCase();
  if (rf === "welding" || rf === "vendor") return rf;

  const st = (row?.status || "").toString().toLowerCase();
  if (st.includes("weld")) return "welding";
  if (st.includes("vendor")) return "vendor";
  return null;
}

function nextStatus(reviewFor: ReviewFor, type: QCType) {
  // Outgoing OK -> goes to IN queue
  if (type === "outgoing") return reviewFor === "welding" ? "in-welding" : "in-vendor";

  // Incoming OK -> goes to review queue
  // IMPORTANT: your review/vendor page expects status="in-review" and review_for="vendor"
  return "in-review";
}

export const qcOutgoing = async (req: Request, res: Response) => {
  const id = req.params.id;

  const { qc_date, qc_quantity, gatepass_no, review_for } = req.body || {};

  if (!qc_date) return sendError(res, 400, "qc_date is required");
  const qty = Number(qc_quantity);
  if (!qty || qty < 1) return sendError(res, 400, "qc_quantity must be >= 1");

  try {
    const row = await AssignToWorker.findByPk(id);
    if (!row) return sendError(res, 404, "Assignment not found");

    const rf = inferReviewFor(row, review_for);
    if (!rf) return sendError(res, 400, "Cannot infer review_for (welding/vendor)");

    // ✅ Optional: validate pending
    const totalOutgoing = Number((row as any).qc_outgoing_qty ?? 0);
    const totalIncoming = Number((row as any).qc_incoming_qty ?? 0);
    const baseQty = Number((row as any).quantity_no ?? 0);

    // If first outgoing, allow up to baseQty; else allow up to remaining
    const pending = totalOutgoing > 0 ? Math.max(totalOutgoing - totalIncoming, 0) : baseQty;
    if (pending > 0 && qty > pending) {
      return sendError(res, 400, `qc_quantity cannot exceed pending (${pending})`);
    }

    // ✅ update fields (adjust columns if different in your DB)
    (row as any).qc_outgoing_date = qc_date;
    (row as any).qc_outgoing_qty = totalOutgoing + qty; // accumulate
    (row as any).gatepass_no = gatepass_no ?? (row as any).gatepass_no ?? null;

    (row as any).review_for = rf; // store welding/vendor
    (row as any).status = nextStatus(rf, "outgoing"); // in-welding / in-vendor

    await row.save();

    return sendSuccess(res, row);
  } catch (e: any) {
    console.error("qcOutgoing error:", e);
    return sendError(res, 500, "Internal server error");
  }
};

export const qcIncoming = async (req: Request, res: Response) => {
  const id = req.params.id;

  const { qc_date, qc_quantity, review_for } = req.body || {};

  if (!qc_date) return sendError(res, 400, "qc_date is required");
  const qty = Number(qc_quantity);
  if (!qty || qty < 1) return sendError(res, 400, "qc_quantity must be >= 1");

  try {
    const row = await AssignToWorker.findByPk(id);
    if (!row) return sendError(res, 404, "Assignment not found");

    const rf = inferReviewFor(row, review_for);
    if (!rf) return sendError(res, 400, "Cannot infer review_for (welding/vendor)");

    const totalOutgoing = Number((row as any).qc_outgoing_qty ?? 0);
    const totalIncoming = Number((row as any).qc_incoming_qty ?? 0);

    const pending = Math.max(totalOutgoing - totalIncoming, 0);
    if (pending <= 0) return sendError(res, 400, "No pending qty for incoming");
    if (qty > pending) return sendError(res, 400, `qc_quantity cannot exceed pending (${pending})`);

    // ✅ update incoming fields (adjust columns if different)
    (row as any).qc_incoming_date = qc_date;
    (row as any).qc_incoming_qty = totalIncoming + qty; // accumulate

    // ✅ now goes to review module
    (row as any).review_for = rf;
    (row as any).status = nextStatus(rf, "incoming"); // in-review

    await row.save();

    return sendSuccess(res, row);
  } catch (e: any) {
    console.error("qcIncoming error:", e);
    return sendError(res, 500, "Internal server error");
  }
};