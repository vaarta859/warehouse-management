import express from "express";

import {
  listUsers,
  updateUserRole,
  updateUser,
  deleteUser,
  getUserWarehouses,
} from "../controllers/authController.js";

import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate);

// Listing / creating-adjacent actions are SUPER_ADMIN only.
// (Company scoping for SUPER_ADMIN happens inside the controllers.)
router.get("/", authorize("SUPER_ADMIN"), listUsers);
router.patch("/:id/role", authorize("SUPER_ADMIN"), updateUserRole);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteUser);

// A user can always edit their own profile, so no role gate here —
// canManageUser() inside updateUser() enforces "self, or SUPER_ADMIN".
router.patch("/:id", updateUser);

// Same — a WAREHOUSE_MANAGER can look up their own warehouse list.
router.get("/:id/warehouses", getUserWarehouses);

export default router;
