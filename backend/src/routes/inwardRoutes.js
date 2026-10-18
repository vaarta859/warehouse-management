import express from "express";

import {
  listGrn,
  getGrnSummary,
  getGrnById,
  createGrn,
  updateGrn,
  listInwardModels,
  createInwardModel,
  listInwardCompanies,
  createInwardCompany,
  listGrnHistory,
} from "../controllers/inwardController.js";

import {
  uploadGrnDocument,
} from "../controllers/documentController.js";

import authenticate from "../middleware/authenticate.js";

import authorize from "../middleware/authorize.js";

import requireWarehouseAccess from "../middleware/requireWarehouseAccess.js";

import {
  upload,
} from "../middleware/uploadMiddleware.js";

const router = express.Router();


// =====================================================
// AUTHENTICATION
// =====================================================

router.use(authenticate);

// Sales / Account can only VIEW inward (list, detail, history, lookups).
// Every write route below is restricted to SUPER_ADMIN / WAREHOUSE_MANAGER.
router.use(authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER", "SALES", "ACCOUNT"));


// =====================================================
// GET ALL GRN
// =====================================================

router.get(
  "/",
  listGrn
);


// =====================================================
// GET ONE GRN
// =====================================================

// KPI cards of the list page. Must stay above "/:id".
router.get("/summary", getGrnSummary);

router.get(
  "/models",
  listInwardModels
);

router.post(
  "/models",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  createInwardModel
);

router.get(
  "/companies",
  listInwardCompanies
);

router.post(
  "/companies",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  createInwardCompany
);

// -------------------------------------------------
// ACTIVITY FEED (across all GRNs the caller can see) —
// must stay above "/:id" or "/history" would be matched
// as an id.
// -------------------------------------------------

router.get(
  "/history",
  listGrnHistory
);

router.get(
  "/:id",
  getGrnById
);


// =====================================================
// CREATE GRN
// =====================================================

router.put(
  "/:id",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  updateGrn
);

router.post(
  "/",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  // Blocks on: warehouse not found, parent company Inactive, this
  // warehouse's own Inward toggle off, or (for WAREHOUSE_MANAGER) no
  // grant / canInward off for this specific user on this warehouse.
  requireWarehouseAccess("canInward", (req) => req.body.warehouseId),
  createGrn
);


// =====================================================
// UPLOAD DOCUMENT TO GRN
// =====================================================

router.post(
  "/:id/documents",
  authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"),
  upload.single("file"),
  uploadGrnDocument
);


export default router;