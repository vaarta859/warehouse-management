import express from "express";

import {
  getTransferOptions,
  getTransferStock,
  getTransferSerials,
  createTransfer,
  listTransfers,
  getTransferById,
  downloadTransferDocument,
} from "../controllers/transferController.js";

import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(authenticate);

// Everyone who can open the Stock Ledger can see the transfer list (each sees only their own scope).
router.use(authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER", "SALES", "ACCOUNT"));

// Static paths first, "/:id" last.
router.get("/options", getTransferOptions);
router.get("/stock", getTransferStock);
router.get("/serials", getTransferSerials);
router.get("/documents/:docId/download", downloadTransferDocument);
router.get("/", listTransfers);
router.get("/:id", getTransferById);

// Making a transfer: Account team and Super Admin (company / warehouse is checked in the controller).
// Multipart (payload + categories + files) when documents are attached, plain JSON otherwise.
router.post("/", authorize("SUPER_ADMIN", "ACCOUNT"), upload.array("files", 10), createTransfer);

export default router;
