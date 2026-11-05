import express from "express";

import { getReportSummary, getReportLedger, getStockLedger, getStockLedgerSerials, getInwardSerialTrail } from "../controllers/reportController.js";

import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// =====================================================
// AUTHENTICATION
// =====================================================

router.use(authenticate);

// =====================================================
// GET /api/reports/summary
// =====================================================

router.get("/summary", getReportSummary);

// =====================================================
// GET /api/reports/ledger
// =====================================================

router.get("/ledger", getReportLedger);

// =====================================================
// GET /api/reports/stock-ledger
// =====================================================

router.get("/stock-ledger", getStockLedger);

// Serial numbers behind a ledger row / serial search, and one inward entry's serials
router.get("/stock-ledger/serials", getStockLedgerSerials);
router.get("/stock-ledger/inward/:grnId", getInwardSerialTrail);

export default router;
