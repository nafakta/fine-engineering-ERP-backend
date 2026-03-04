import { Router } from "express";
import JobController from "../controllers/JobController";
import CategoryController from "../controllers/CategoryController";
import PendingMaterialController from "../controllers/PendingMaterialController";
import PoServiceController from "../controllers/PoServiceController";
import AssignToWorkerController from "../controllers/AssignToWorkerController";
import WorkerAuthController from "../controllers/WorkerAuthController";
import MaterialMovements from "../controllers/MaterialMovements";
import { qcOutgoing, qcIncoming } from "../controllers/qcController";

import { upload } from "../multerconfig";
import { requireWorkerAuth } from "../middleware/auth";

const router = Router();
const jobController = new JobController();
const categoryController = new CategoryController();
const pendingMaterialController = new PendingMaterialController();
const poServiceController = new PoServiceController();
const assignToWorkerController = new AssignToWorkerController();
const workerAuthController = new WorkerAuthController();
const materialMovementController = new MaterialMovements();

// Define routes for the unified Job API
router.post("/jobs", jobController.create);
router.post("/jobs/bulk", jobController.bulkCreate);
router.get("/jobs", jobController.list);
router.get("/jobs/:id", jobController.get);
router.put("/jobs/:id", jobController.update);
router.delete("/jobs/:id", jobController.delete);
router.post("/jobs/mark-urgent", jobController.markUrgent);
router.post("/jobs/mark-urgent-by-tso", jobController.markUrgentByTso);
router.post("/jobs/mark-urgent-by-jo-number", jobController.markUrgentByJoNumber);
router.post("/jobs/:id/assign", jobController.assignJob);
router.post("/jobs/:id/approve", jobController.approveJob);
router.post("/jobs/:id/reject", jobController.rejectJob);
router.post("/jobs/:id/not-ok", jobController.markAsNotOk);
router.post("/jobs/:id/rework", jobController.reworkJob);
router.post("/jobs/dispatch", jobController.updateDispatchDetails);
router.post("/jobs/:id/backToQc", jobController.markAsReadyForQc);
router.post("/jobs/:id/reject-not-ok", jobController.rejectNotOkJob);

router.post("/categories", categoryController.create);
router.get("/categories", categoryController.list);
router.get("/categories/:id", categoryController.get);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.delete);
router.post("/categories/mark-urgent", categoryController.markUrgent);

router.post("/pending-materials", pendingMaterialController.create);
router.get("/pending-materials", pendingMaterialController.list);
router.get("/pending-materials/:id", pendingMaterialController.get);
router.put("/pending-materials/:id", pendingMaterialController.update);
router.delete("/pending-materials/:id", pendingMaterialController.delete);
router.post("/pending-materials/:id/complete", pendingMaterialController.completeAndCreateJob);
router.post("/pending-material/send-mail", upload.array("followup_images", 10), pendingMaterialController.sendMail);

router.post("/po-services", poServiceController.create);
router.get("/po-services", poServiceController.list);
router.get("/po-services/:id", poServiceController.get);
router.put("/po-services/:id", poServiceController.update);
router.delete("/po-services/:id", poServiceController.delete);

router.post("/assign-to-worker", assignToWorkerController.create);

router.get("/assign-to-worker/:id", assignToWorkerController.get);
router.get("/assign-to-worker", assignToWorkerController.list);
router.put("/assign-to-worker/:id", assignToWorkerController.update);
router.delete("/assign-to-worker/:id", assignToWorkerController.delete);
router.get("/worker/assignments", requireWorkerAuth, assignToWorkerController.workerList);
router.post("/worker/assignments/:id/review", requireWorkerAuth, assignToWorkerController.moveToReview);
router.post("/assign-to-worker/:id/reject", assignToWorkerController.rejectAssignment);
router.post("/assign-to-worker/:id/ready-for-qc", assignToWorkerController.moveToReadyForQC);
router.post("/worker/register", workerAuthController.register);
router.post("/worker/login", workerAuthController.login);
router.get("/worker/me", requireWorkerAuth, workerAuthController.me);
router.get(
  "/public/review-assignments",
  assignToWorkerController.getReviewAssignmentsPublic
);
router.post("/assign-to-worker/:id/machine", assignToWorkerController.moveToMachine);
router.post("/assign-to-worker/:id/assign-vendor", assignToWorkerController.assignVendor);
// QC Welding outgoing/incoming
router.post("/assign-to-worker/:id/qc-outgoing-welding", assignToWorkerController.qcOutgoingWelding);
router.post("/assign-to-worker/:id/qc-incoming-welding", assignToWorkerController.qcIncomingWelding);

// QC Vendor outgoing/incoming
router.post("/assign-to-worker/:id/qc-outgoing-vendor", assignToWorkerController.qcOutgoingVendor);
router.post("/assign-to-worker/:id/qc-incoming-vendor", assignToWorkerController.qcIncomingVendor);


// QC outgoing (for qc-welding and qc-vendor)
// router.post("/assign-to-worker/:id/qc-outgoing", assignToWorkerController.qcOutgoing);
router.post("/assign-to-worker/:id/welding", assignToWorkerController.moveToWelding);
router.post("/assign-to-worker/:id/vendor", assignToWorkerController.moveToVendor);
// router.post("/assign-to-worker/:id/qc-incoming", assignToWorkerController.qcIncoming);
router.get("/review/welding", assignToWorkerController.getReviewWelding);
router.get("/review/vendor", assignToWorkerController.getReviewVendor);

router.get("/material-movement", materialMovementController.list);
router.get("/material-movement/summary", materialMovementController.machineSummary);
router.post("/assign-to-worker/:id/qc-outgoing",qcOutgoing);
router.post("/assign-to-worker/:id/qc-incoming",qcIncoming);

export default router;