import express from "express";
import {
  createCompany,
  listCompanies,
  getCompany,
  updateCompany,
  deleteCompany,
} from "../controllers/companyController.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("SUPER_ADMIN"), createCompany);
router.get("/", authorize("SUPER_ADMIN"), listCompanies);
router.get("/:id", authorize("SUPER_ADMIN"), getCompany);
router.patch("/:id", authorize("SUPER_ADMIN"), updateCompany);
router.delete("/:id", authorize("SUPER_ADMIN"), deleteCompany);

export default router;
