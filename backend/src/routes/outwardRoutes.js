import express from "express";
import {
  listOutward,
  getOutwardSummary,
  getOutwardById,
  createOutward,
  updateOutward,
  approveOutward,
  rejectOutward,
  holdOutward,
  dispatchOutward,
  saveTransportation,
  getAvailableSerials,
  saveReceiving,
  saveAccountDocuments,
  downloadItemProof,
  downloadPiFile,
  listOutwardModels,
  listOutwardStock,
  createOutwardModel,
  listOutwardCompanies,
  listOutwardCustomers,
  createOutwardCustomer,
  createOutwardCompany,
  listOutwardHistory,
} from "../controllers/outwardController.js";
import { uploadOutwardDocument } from "../controllers/documentController.js";
import authenticate from "../middleware/authenticate.js";
import authorize from "../middleware/authorize.js";
import { upload } from "../middleware/uploadMiddleware.js";

/**
 * Outward workflow
 *
 *   SALES              creates / edits (PI details + payment status, UTR / proof)  -> PENDING_APPROVAL
 *   ACCOUNT            approves, holds or rejects the entry  -> PENDING_DISPATCH / ON_HOLD / REJECTED
 *   WAREHOUSE_MANAGER  fills the TRANSPORTATION form (dedicated vehicle OR transporter + serial numbers) - opens after approval
 *   ACCOUNT            then uploads Invoice / E-way bill / DC Challan / Without Invoice / Other (locked until transportation is in).
 *                      Every document (Invoice included) is shared; any document opens the dispatch form.
 *   WAREHOUSE_MANAGER  fills the DISPATCH form (vehicle read-only, references, documents)  -> DISPATCHED
 *   WAREHOUSE_MANAGER  then fills the receiving details (date, receiver, receiving copy)
 *   SUPER_ADMIN        can do every step
 *
 * Warehouse / company scoping is done inside the controller
 * (assertWarehouseAccess), because SALES and ACCOUNT get access through
 * their company while warehouse managers get it through a warehouse grant.
 */
const router = express.Router();
router.use(authenticate);

router.get("/", listOutward);
// KPI cards of the list page. Must stay above "/:id".
router.get("/summary", getOutwardSummary);
router.get("/models", listOutwardModels);
// Available stock per model - feeds the outward form dropdown. Must stay above "/:id".
router.get("/stock", listOutwardStock);
router.post("/models", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), createOutwardModel);
router.get("/companies", listOutwardCompanies);
router.get("/customers", listOutwardCustomers);
// Saves a new customer for the whole company (every user of the company sees it in the dropdown).
router.post("/customers", authorize("SUPER_ADMIN", "SALES"), createOutwardCustomer);
router.post("/companies", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), createOutwardCompany);
// Must stay above "/:id" or "/history" would be matched as an id.
router.get("/history", listOutwardHistory);

// Sales creates. The controller checks the warehouse / company / stock itself.
router.post("/", authorize("SUPER_ADMIN", "SALES"), createOutward);

router.get("/:id", getOutwardById);
router.put("/:id", authorize("SUPER_ADMIN", "SALES"), updateOutward);

// Outward entries cannot be deleted by anyone (Super admin can update them at any time instead).

// Account decision on the PI / payment details.
router.post("/:id/approve", authorize("SUPER_ADMIN", "ACCOUNT"), approveOutward);
router.post("/:id/reject", authorize("SUPER_ADMIN", "ACCOUNT"), rejectOutward);
router.post("/:id/hold", authorize("SUPER_ADMIN", "ACCOUNT"), holdOutward);

// Warehouse manager fills the transportation form (dedicated vehicle OR transporter) after Account's approval.
// Submitting it unlocks the document upload for the account team.
router.put("/:id/transportation", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), saveTransportation);
// Serial numbers in stock that can be scanned for this entry (dropdown on the transportation form).
router.get("/:id/available-serials", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), getAvailableSerials);

// Warehouse manager fills the dispatch form (opens once Account has shared a non-Invoice document).
// Accepts JSON, or multipart (payload + files + categories) so the documents travel with the dispatch.
router.put("/:id/dispatch", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), upload.array("files", 10), dispatchOutward);

// Warehouse manager fills the receiving details (date, receiver, receiving copy ...) once the entry is dispatched.
router.put("/:id/receiving", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), upload.array("files", 10), saveReceiving);

// Account adds its own reference documents (invoice / e-way bill / other) and files before dispatch.
router.put("/:id/account-documents", authorize("SUPER_ADMIN", "ACCOUNT"), upload.array("files", 10), saveAccountDocuments);

// Payment proof of an item - never reachable by the warehouse manager.
router.get("/:id/items/:itemId/proof", authorize("SUPER_ADMIN", "SALES", "ACCOUNT"), downloadItemProof);

// PI (proforma invoice) file - shared with the warehouse manager too (assertEntryVisible checks warehouse access + status).
router.get("/:id/pi-file", authorize("SUPER_ADMIN", "SALES", "ACCOUNT", "WAREHOUSE_MANAGER"), downloadPiFile);

// Dispatch documents (challan / e-way bill / photo) are a warehouse job.
router.post("/:id/documents", authorize("SUPER_ADMIN", "WAREHOUSE_MANAGER"), upload.single("file"), uploadOutwardDocument);
export default router;
