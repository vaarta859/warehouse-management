import express from "express";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate);

// Everyone logged in can read the list (inward / outward forms need it).
router.get("/", listProducts);

// Admins and warehouse managers can ADD a product (the inward form has an
// "Add" button next to Category / SKU for items missing from the dropdown).
router.post("/", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), createProduct);

// Only admins can rename or delete existing products.
router.patch("/:id", authorize("SUPER_ADMIN"), updateProduct);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteProduct);

export default router;
