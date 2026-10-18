import express from "express";

import {
  downloadDocument,
  deleteDocument,
} from "../controllers/documentController.js";

import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.use(authenticate);


// Download document
router.get(
  "/:id/download",
  downloadDocument
);


// Delete document
router.delete(
  "/:id",
  deleteDocument
);

export default router;