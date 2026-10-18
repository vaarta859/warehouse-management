import express from "express";

import {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  toggleInwardStatus,
  toggleOutwardStatus,
  deleteWarehouse,
  listWarehouseAccess,
  grantWarehouseAccess,
  revokeWarehouseAccess,
} from "../controllers/warehouseController.js";

import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate);

// SUPER_ADMIN sees all; WAREHOUSE_MANAGER sees only granted warehouses.
router.get("/", getAllWarehouses);
router.get("/:id", getWarehouseById);

// Creating, editing, deleting warehouses and managing grants is SUPER_ADMIN-only.
router.post("/", authorize("SUPER_ADMIN"), createWarehouse);
router.put("/:id", authorize("SUPER_ADMIN"), updateWarehouse);
router.patch("/:id/inward", authorize("SUPER_ADMIN"), toggleInwardStatus);
router.patch("/:id/outward", authorize("SUPER_ADMIN"), toggleOutwardStatus);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteWarehouse);

// Access grants — who can reach this warehouse, and what they can do on it.
router.get("/:id/access", authorize("SUPER_ADMIN"), listWarehouseAccess);
router.put("/:id/access", authorize("SUPER_ADMIN"), grantWarehouseAccess);
router.delete("/:id/access/:userId", authorize("SUPER_ADMIN"), revokeWarehouseAccess);

export default router;
