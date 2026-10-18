import express from "express";
import { signup, login, me, listPublicCompanies } from "../controllers/authController.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// Public — no token needed
router.post("/signup", signup);
router.post("/login", login);
router.get("/companies", listPublicCompanies);

// Protected
router.get("/me", authenticate, me);

export default router;
