import { Router } from "express";
import JobController from "../controllers/JobController";
import CategoryController from "../controllers/CategoryController";
import PendingMaterialController from "../controllers/PendingMaterialController";
import PoServiceController from "../controllers/PoServiceController";

const router = Router();
const jobController = new JobController();
const categoryController = new CategoryController();
const pendingMaterialController = new PendingMaterialController();
const poServiceController = new PoServiceController();

// Define routes for the unified Job API
router.post("/jobs", jobController.create);
router.get("/jobs", jobController.list);
router.get("/jobs/:id", jobController.get);
router.put("/jobs/:id", jobController.update);
router.delete("/jobs/:id", jobController.delete);
router.post("/jobs/:id/urgent", jobController.markUrgent);

router.post("/categories", categoryController.create);
router.get("/categories", categoryController.list);
router.get("/categories/:id", categoryController.get);
router.put("/categories/:id", categoryController.update);
router.delete("/categories/:id", categoryController.delete);

router.post("/pending-materials", pendingMaterialController.create);
router.get("/pending-materials", pendingMaterialController.list);
router.get("/pending-materials/:id", pendingMaterialController.get);
router.put("/pending-materials/:id", pendingMaterialController.update);
router.delete("/pending-materials/:id", pendingMaterialController.delete);
router.post("/pending-materials/:id/complete", pendingMaterialController.completeAndCreateJob);

router.post("/po-services", poServiceController.create);
router.get("/po-services", poServiceController.list);
router.get("/po-services/:id", poServiceController.get);
router.put("/po-services/:id", poServiceController.update);
router.delete("/po-services/:id", poServiceController.delete);

export default router;