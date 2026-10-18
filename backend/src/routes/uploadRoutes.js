import express from "express";
import { uploadFile, deleteUploadedFile } from "../controllers/uploadController.js";
import { upload } from "../middleware/uploadMiddleware.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";

const router = express.Router();

// User must be logged in
router.use(authenticate);

// Payment proof is uploaded by Sales (super admin can do it too).
router.use(authorize("SUPER_ADMIN", "SALES"));

// Upload file
router.post(
  "/",
  upload.single("file"),
  uploadFile
);

// Remove a proof that was uploaded but replaced / removed before saving
router.delete("/", deleteUploadedFile);

export default router;