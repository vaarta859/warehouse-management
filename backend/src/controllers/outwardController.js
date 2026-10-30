import { randomUUID } from "node:crypto";
import prisma from "../config/prisma.js";
import { warehouseIdsForCompanies, getWarehouseCompanies, allCompaniesInactive, sharesCompany } from "../utils/warehouseCompanies.js";
import { supabase, SUPABASE_BUCKET } from "../config/supabase.js";
import { recordAuditLog, recordAuditLogs, diffFields, diffItems, describeItem } from "../utils/auditLog.js";
import { storeOutwardFiles } from "./documentController.js";
import { outwardFolder, tempProofFolder } from "../utils/outwardWorkflow.js";
import { findUnknownProducts, unknownProductsMessage, withSerialModes } from "../utils/productCatalog.js";
import { getWarehouseStock, getWarehouseStockBreakdown, stockKey, OUTWARD_STOCK_SOURCES, findShortages, shortageMessage } from "../utils/stock.js";
import { canonicalOutwardType } from "../utils/serialSources.js";
import { cleanSerials, validateSerials, replaceSerials, pruneSerials } from "../utils/serials.js";
import { findSerialSourceProblem, listAvailableSerials, listBlockedSerials } from "../utils/serialSources.js";
import {
  STATUS,
  SALES_EDITABLE_STATUSES,
  REJECTABLE_STATUSES,
  APPROVABLE_STATUSES,
  HOLDABLE_STATUSES,
  ewayBillProblem,
  EWAY_BILL_THRESHOLD,
  itemsFingerprint,
  WAREHOUSE_VISIBLE_STATUSES,
  HIDDEN_FROM_WAREHOUSE_ACTIONS,
  isFinanceSide,
  getUserCompanyIds,
  sanitizeForWarehouse,
  shapeForFinance,
  validateItemPayment,
  validatePi,
  validateParty,
  toPiColumns,
  toPartyColumns,
  toItemRow,
  proofKeyProblem,
  ACCOUNT_REF_TYPES,
  ACCOUNT_DOC_STATUSES,
  canonicalAccountRefType,
  isAccountRefType,
  isAccountDocCategory,
  isBiltyDocCategory,
  validateDriver,
  validateReceiving,
  isReceivingDocCategory,
  TRANSPORT_MODE_LABEL,
  validateTransport,
  toTransportColumns,
  outwardStage,
  hasReleaseDocument,
  documentsForWarehouse,
  referencesForWarehouse,
  accountDocsBlock,
  APPROVED_STATUSES,
  DISPATCHED_STATUSES,
  isApprovedStatus,
  isDispatchedStatus,
  deriveApprovedStatus,
  editLockReason,
  syncApprovedStage,
  hasInvoice,
  isInvoiceDocCategory,
  transportLockReason,
  TRANSPORT_LOCK_MESSAGE,
  getManagerCompanyIds,
  getSalesGrantedWarehouseIds,
} from "../utils/outwardWorkflow.js";

const DEFAULT_DOCUMENT_TYPES = ["Delivery challan", "Dispatch photo"];

// Create / edit run the stock check and the save in one serializable transaction.
const STOCK_TRANSACTION_OPTIONS = { isolationLevel: "Serializable", maxWait: 10000, timeout: 10000 };

const httpError = (status, message) => Object.assign(new Error(message), { status });

// Sales-side entries have no dispatch details yet. The Min table requires these
// columns, so they hold a placeholder until the warehouse manager dispatches.
const PLACEHOLDER = "Pending";

// What each role gets back for an entry.
const shapeFor = (req, entry) =>
  req.user.role === "WAREHOUSE_MANAGER" ? sanitizeForWarehouse(entry) : shapeForFinance(entry);

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------
async function getScopedWarehouseIds(req) {
  const role = req.user.role;
  if (role === "SUPER_ADMIN") return null;
  if (role === "WAREHOUSE_MANAGER") {
    const rows = await prisma.warehouseAccess.findMany({
      where: { userId: req.user.id, accessLevel: "MANAGE" },
      select: { warehouseId: true },
    });
    return rows.map((r) => r.warehouseId);
  }
  if (isFinanceSide(role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (!companyIds.length) return [];
    const ids = await warehouseIdsForCompanies(companyIds);
    // A Sales / Account user with warehouse access sees / uses only the warehouses granted to him.
    const granted = await getSalesGrantedWarehouseIds(req.user);
    return granted ? ids.filter((id) => granted.includes(id)) : ids;
  }
  return [];
}

// Which entries a user may see: the entries of their warehouses plus, for Sales / Account, the
// "Dispatch directly" entries (no warehouse) of their companies. The warehouse manager sees only the DELIVERED direct entries (view only).
async function entryScopeWhere(req) {
  const role = req.user.role;
  if (role === "SUPER_ADMIN") return {};
  const warehouseIds = (await getScopedWarehouseIds(req)) || [];
  if (role === "WAREHOUSE_MANAGER") {
    // The manager also SEES (view only) the delivered "Dispatch directly" entries of the companies of his warehouses.
    const managerCompanyIds = await getManagerCompanyIds(req.user);
    const managerClauses = [{ warehouseId: { in: warehouseIds } }];
    if (managerCompanyIds.length) managerClauses.push({ directDispatch: true, status: STATUS.DELIVERED, companyId: { in: managerCompanyIds } });
    return { OR: managerClauses };
  }
  const clauses = [{ warehouseId: { in: warehouseIds } }];
  if (isFinanceSide(role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (companyIds.length) clauses.push({ directDispatch: true, companyId: { in: companyIds } });
  }
  return { OR: clauses };
}

// "Dispatch directly" has no warehouse: the company itself is checked (active, and the user belongs to it).
async function assertDirectCompany(req, companyId) {
  if (!companyId) throw httpError(422, "companyId is required");
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, code: true, status: true } });
  if (!company) throw httpError(404, "Company not found");
  if (company.status === "Inactive") throw httpError(403, "The selected company is inactive.");
  if (req.user.role !== "SUPER_ADMIN") {
    if (req.user.role !== "SALES") throw httpError(403, "Only Sales can create or edit outward entries");
    const userCompanyIds = await getUserCompanyIds(req.user);
    if (!userCompanyIds.includes(companyId)) throw httpError(403, "You are not linked with the selected company");
  }
  return company;
}

// Warehouse filter of the list / summary. A warehouse manager who picked a warehouse also gets the delivered
// "Dispatch directly" entries of that warehouse's companies (they have no warehouse of their own).
async function warehouseFilter(req, warehouseId) {
  if (warehouseId === "DIRECT") return { directDispatch: true };
  if (!warehouseId) return {};
  if (req.user.role !== "WAREHOUSE_MANAGER") return { warehouseId };
  const companies = await getWarehouseCompanies(warehouseId);
  const companyIds = companies.map((c) => c.id);
  return {
    OR: [
      { warehouseId },
      ...(companyIds.length ? [{ directDispatch: true, status: STATUS.DELIVERED, companyId: { in: companyIds } }] : []),
    ],
  };
}

// Extra list filter that depends on who is asking.
function roleWhere(req) {
  switch (req.user.role) {
    // Sales sees every entry of the warehouses of their company(ies), whoever on the team created it
    // (the warehouse scope applied by the callers already limits the list to the user's company).
    case "SALES": return {};
    case "WAREHOUSE_MANAGER": return { status: { in: WAREHOUSE_VISIBLE_STATUSES } };
    default: return {};
  }
}

// The company picked on an outward must be one the warehouse is linked with and,
// for non-admin users (Sales), one the user also belongs to.
// `anyCompanyForAdmin`: when the Super admin edits an existing entry they may pick ANY active company, not only the ones linked with the warehouse.
async function assertCompanyForWarehouse(req, warehouseId, companyId, anyCompanyForAdmin = false) {
  if (!companyId) throw httpError(422, "companyId is required");
  const warehouseCompanies = await getWarehouseCompanies(warehouseId);
  let linked = warehouseCompanies.find((c) => c.id === companyId);
  if (!linked && anyCompanyForAdmin && req.user.role === "SUPER_ADMIN") {
    linked = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true } });
    if (!linked) throw httpError(404, "Company not found");
  }
  if (!linked) {
    throw httpError(400, `This warehouse is not linked with the selected company. Linked companies: ${warehouseCompanies.map((c) => c.name).join(", ") || "none"}.`);
  }
  if (linked.status === "Inactive") throw httpError(403, "The selected company is inactive.");
  if (req.user.role !== "SUPER_ADMIN") {
    const userCompanyIds = await getUserCompanyIds(req.user);
    if (!userCompanyIds.includes(companyId)) throw httpError(403, "You are not linked with the selected company");
  }
}

async function assertWarehouseAccess(req, warehouseId, permission = "canOutward") {
  if (!warehouseId) throw httpError(400, "warehouseId is required (a 'Dispatch directly' entry has no warehouse)");

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, companyId: true, Outward: true, company: { select: { id: true, name: true, status: true } } },
  });
  if (!warehouse) throw httpError(404, "Warehouse not found");
  const warehouseCompanies = await getWarehouseCompanies(warehouseId);
  if (allCompaniesInactive(warehouseCompanies)) throw httpError(403, "This warehouse belongs to an inactive company.");
  if (permission === "canOutward" && warehouse.Outward !== "Active") throw httpError(403, "Outward is disabled for this warehouse.");

  if (req.user.role === "SUPER_ADMIN") return warehouse;

  // SALES / ACCOUNT: access comes from the company they belong to.
  if (isFinanceSide(req.user.role)) {
    const companyIds = await getUserCompanyIds(req.user);
    if (!sharesCompany(warehouseCompanies, companyIds)) {
      throw httpError(403, "You don't have access to this warehouse");
    }
    // A Sales / Account user with warehouse access can use only the warehouses granted to him.
    const granted = await getSalesGrantedWarehouseIds(req.user);
    if (granted && !granted.includes(warehouseId)) {
      throw httpError(403, "You don't have access to this warehouse");
    }
    if (permission === "canOutward" && req.user.role !== "SALES") {
      throw httpError(403, "Only Sales can create or edit outward entries");
    }
    return warehouse;
  }

  const access = await prisma.warehouseAccess.findUnique({
    where: { userId_warehouseId: { userId: req.user.id, warehouseId } },
  });
  if (!access || access.accessLevel !== "MANAGE") throw httpError(403, "You don't have access to this warehouse");
  if (permission && !access[permission]) throw httpError(403, "You don't have permission to do this on this warehouse");
  return warehouse;
}

// Can this user open this one entry at all?
async function assertEntryVisible(req, min) {
  const role = req.user.role;
  if (role === "SUPER_ADMIN") return;
  // Dispatch directly: no warehouse, so access comes from the company. The warehouse manager can only view it once delivered.
  if (min.directDispatch) {
    if (role === "SALES" || role === "ACCOUNT") {
      const companyIds = await getUserCompanyIds(req.user);
      if (!min.companyId || !companyIds.includes(min.companyId)) throw httpError(403, "You don't have access to this entry");
      return;
    }
    if (role === "WAREHOUSE_MANAGER") {
      // View only, and only once the entry is delivered directly.
      const managerCompanyIds = await getManagerCompanyIds(req.user);
      if (min.status !== STATUS.DELIVERED || !min.companyId || !managerCompanyIds.includes(min.companyId)) {
        throw httpError(403, "This entry is not available for the warehouse");
      }
      return;
    }
    throw httpError(403, "Not allowed");
  }
  // Sales and Account: any entry of a warehouse that belongs to one of their companies (the whole team shares them).
  if (role === "SALES" || role === "ACCOUNT") {
    await assertWarehouseAccess(req, min.warehouseId, null);
    return;
  }
  if (role === "WAREHOUSE_MANAGER") {
    const access = await prisma.warehouseAccess.findUnique({
      where: { userId_warehouseId: { userId: req.user.id, warehouseId: min.warehouseId } },
    });
    if (!access || access.accessLevel !== "MANAGE") throw httpError(403, "You don't have access to this entry's warehouse");
    if (!WAREHOUSE_VISIBLE_STATUSES.includes(min.status)) throw httpError(403, "This entry is not ready for the warehouse yet");
    return;
  }
  throw httpError(403, "Not allowed");
}

function documentStatus(documents = []) {
  const required = new Set(DEFAULT_DOCUMENT_TYPES.map((x) => x.toLowerCase()));
  const uploaded = new Set(documents.map((d) => String(d.docCategory || "").toLowerCase()));
  const pendingDocuments = [...required].filter((x) => !uploaded.has(x)).length;
  return {
    status: pendingDocuments === 0 ? "Complete" : "Pending",
    pendingDocuments,
    uploadedDocuments: DEFAULT_DOCUMENT_TYPES.length - pendingDocuments,
    requiredDocuments: DEFAULT_DOCUMENT_TYPES.length,
  };
}

// `status` in the response has always meant the documents checklist
// ("Complete" / "Pending"), and the frontend relies on that. The workflow
// status is therefore sent as `workflowStatus` (to every role, so each sees the real step).
function finishFor(req, entry, allDocs) {
  const shaped = shapeFor(req, entry);
  const stage = outwardStage(entry, allDocs, entry.referenceDocuments || []);
  const workflowStatus = entry.status;
  // Dispatch documents reach Sales / Account only after the warehouse manager
  // has filled the dispatch details (status DISPATCHED). The super admin does
  // not see the documents section while the entry is still at the approval
  // stage (PENDING_APPROVAL / REJECTED) - only from dispatch details onwards.
  let docsVisible = true;
  if (req.user.role === "ACCOUNT") docsVisible = isDispatchedStatus(entry.status);
  // Sales sees every document of its entries (view only).
  else if (req.user.role === "SUPER_ADMIN") docsVisible = isApprovedStatus(entry.status) || isDispatchedStatus(entry.status);
  let docs = docsVisible ? allDocs : [];
  // Warehouse manager: sees every document and reference Account has added, the Invoice included.
  if (req.user.role === "WAREHOUSE_MANAGER") {
    docs = documentsForWarehouse(allDocs);
    if (Array.isArray(shaped.referenceDocuments)) shaped.referenceDocuments = referencesForWarehouse(shaped.referenceDocuments);
  }
  // Account always sees (and, until dispatch, manages) its own invoice / e-way bill / other documents.
  if (req.user.role === "ACCOUNT" && !docsVisible) docs = allDocs.filter((d) => isAccountDocCategory(d.docCategory));
  // Sales / Account / admin are told when the entry is locked (transportation sent + account documents uploaded),
  // so the screens can hide Edit / Reject / Hold. The server enforces it anyway.
  const lockReason = req.user.role === "WAREHOUSE_MANAGER" ? null : editLockReason(entry, allDocs, entry.referenceDocuments || []);
  // Transportation details are frozen once Account has uploaded its documents - for every role (the manager too).
  const transportLocked = Boolean(transportLockReason(entry, allDocs, entry.referenceDocuments || []));
  // Status update for Account / Sales / admin: Account has created the invoice.
  const invoiceCreated = req.user.role === "WAREHOUSE_MANAGER" ? undefined : hasInvoice(allDocs, entry.referenceDocuments || []);
  return { ...shaped, workflowStatus, stage, invoiceCreated, editLocked: Boolean(lockReason), editLockReason: lockReason, transportLocked, ...documentStatus(docs), documents: docs };
}

const plainItem = (i) => ({ category: i.category, sku: i.sku, companyName: i.companyName, quantity: i.quantity, uom: i.uom });

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
export async function listOutward(req, res) {
  try {
    const { search = "", type, status, dateFrom, dateTo, warehouseId, page = "1", pageSize = "20" } = req.query;
    const where = {
      AND: [
        await entryScopeWhere(req),
        await warehouseFilter(req, warehouseId),
        roleWhere(req),
        status && Object.values(STATUS).includes(status) ? { status } : {},
        search ? { OR: [
          { outwardNumber: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { companyName: { contains: search, mode: "insensitive" } },
          { refDocNumber: { contains: search, mode: "insensitive" } },
          { piNumber: { contains: search, mode: "insensitive" } },
          { items: { some: { sku: { contains: search, mode: "insensitive" } } } },
          { items: { some: { category: { contains: search, mode: "insensitive" } } } },
          { serials: { some: { serialNo: { contains: search, mode: "insensitive" } } } },
        ] } : {},
        // "Return to Vendor" was renamed "Replacement": the Replacement filter also finds entries saved under the old name.
        type ? (type === "Replacement" ? { outwardType: { in: ["Replacement", "Return to Vendor"] } } : { outwardType: type }) : {},
        dateFrom || dateTo ? { createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999`) } : {}),
        } } : {},
      ],
    };

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const [rows, total] = await Promise.all([
      prisma.min.findMany({
        where,
        include: {
          items: true,
          referenceDocuments: true,
          createdBy: { select: { name: true, email: true } },
          warehouse: { select: { id: true, name: true, code: true, company: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.min.count({ where }),
    ]);

    const ids = rows.map((x) => x.id);
    const documents = ids.length ? await prisma.document.findMany({ where: { linkedType: "outward", linkedId: { in: ids } }, orderBy: { uploadedAt: "desc" } }) : [];
    const data = rows.map((row) => finishFor(req, row, documents.filter((d) => d.linkedId === row.id)));

    return res.json({ data, pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) } });
  } catch (error) {
    console.error("List outward error:", error);
    return res.status(500).json({ message: "Failed to fetch outward entries", error: error.message });
  }
}

// ---------------------------------------------------------------------------
// SUMMARY (KPI cards of the list page)
// ---------------------------------------------------------------------------
// The page used to download the 100 newest FULL entries just to count them. This
// answers with a grouped count plus (warehouse role only) the ids/categories of
// the newest 100 documents.
export async function getOutwardSummary(req, res) {
  try {
    const { warehouseId } = req.query;
    const where = {
      AND: [
        await entryScopeWhere(req),
        await warehouseFilter(req, warehouseId),
        roleWhere(req),
      ],
    };

    const isWarehouse = req.user.role === "WAREHOUSE_MANAGER";
    const [groups, latest] = await Promise.all([
      prisma.min.groupBy({ by: ["status"], where, _count: { _all: true } }),
      isWarehouse
        ? prisma.min.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 })
        : Promise.resolve([]),
    ]);

    let total = 0, pendingApproval = 0, awaitingDispatch = 0, dispatched = 0;
    for (const g of groups) {
      const n = g._count._all;
      total += n;
      if (g.status === STATUS.PENDING_APPROVAL) pendingApproval += n;
      if (APPROVED_STATUSES.includes(g.status)) awaitingDispatch += n;
      if (DISPATCHED_STATUSES.includes(g.status)) dispatched += n;
    }

    let documentsPending = 0;
    if (isWarehouse && latest.length) {
      const ids = latest.map((x) => x.id);
      const docs = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: { in: ids } }, select: { linkedId: true, docCategory: true } });
      const byEntry = new Map(ids.map((id) => [id, []]));
      for (const d of docs) byEntry.get(d.linkedId)?.push(d);
      for (const list of byEntry.values()) documentsPending += documentStatus(documentsForWarehouse(list)).pendingDocuments;
    }

    return res.json({ data: { total, pendingApproval, awaitingDispatch, dispatched, documentsPending } });
  } catch (error) {
    console.error("Outward summary error:", error);
    return res.status(500).json({ message: "Failed to fetch summary", error: error.message });
  }
}

// ---------------------------------------------------------------------------
// GET ONE
// ---------------------------------------------------------------------------
export async function getOutwardById(req, res) {
  try {
    const min = await prisma.min.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        serials: { orderBy: { createdAt: "asc" } },
        referenceDocuments: true,
        createdBy: { select: { name: true, email: true, role: true } },
        warehouse: { select: { id: true, name: true, code: true, companyId: true, Inward: true, Outward: true, company: { select: { name: true, status: true } } } },
      },
    });
    if (!min) return res.status(404).json({ message: "Outward entry not found" });
    // Access check and documents are independent, so they run together.
    const [, documents] = await Promise.all([
      assertEntryVisible(req, min),
      prisma.document.findMany({ where: { linkedType: "outward", linkedId: min.id }, orderBy: { uploadedAt: "desc" } }),
    ]);
    return res.json({ data: finishFor(req, min, documents) });
  } catch (error) {
    console.error("Get outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch outward entry" });
  }
}

/**
 * =========================================================
 * GET /api/outward/stock?warehouseId=&excludeOutwardId=
 * =========================================================
 *
 * What is in stock right now in ONE warehouse (inward minus outward, per
 * category + SKU). The outward form uses it so the SKU / model dropdown can
 * show "how many are available" and only allow picking what is in stock.
 *
 * Only rows with something available are returned - anything missing from
 * the list is out of stock.
 *
 * excludeOutwardId: when EDITING an outward entry, pass its id so the
 * quantities it already holds count as available again for that entry.
 * =========================================================
 */
export async function listOutwardStock(req, res) {
  try {
    const { warehouseId, excludeOutwardId, companyName, outwardType } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    const [stock, breakdown] = await Promise.all([
      getWarehouseStock(prisma, warehouseId, { excludeOutwardId: excludeOutwardId || undefined }),
      getWarehouseStockBreakdown(prisma, warehouseId, { excludeOutwardId: excludeOutwardId || undefined }),
    ]);
    // Quantity shown = stock of the SELECTED company, in this warehouse, from the inward types
    // (New / Service / Return ...) the selected outward type is allowed to take from.
    const company = String(companyName || "").trim().toLowerCase();
    const allowedTypes = OUTWARD_STOCK_SOURCES[canonicalOutwardType(outwardType)] || null;
    const data = Array.from(stock.values())
      .map(({ category, sku, uom }) => {
        const lines = breakdown.get(stockKey(category, sku)) || [];
        const available = lines
          .filter((l) => (!company || String(l.companyName || "").trim().toLowerCase() === company) && (!allowedTypes || allowedTypes.includes(l.type)))
          .reduce((sum, l) => sum + l.quantity, 0);
        return { category, sku, uom, available };
      })
      .filter((row) => row.available > 0)
      .sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku));
    return res.json({ data });
  } catch (error) {
    console.error("List outward stock error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch stock" });
  }
}

export async function listOutwardModels(req, res) {
  try {
    const { warehouseId } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    // Scoped the same way inward does it: key on category + companyName
    // + model name so the same model name under a different brand /
    // company doesn't collapse into one row, and nothing shows until
    // an item's Company is selected on the form.
    const [catalog, history] = await Promise.all([
      prisma.warehouseModel.findMany({ where: { warehouseId }, orderBy: [{ category: "asc" }, { companyName: "asc" }, { name: "asc" }] }),
      prisma.minItem.groupBy({
        by: ["category", "sku", "companyName"],
        where: { min: { warehouseId } },
      }),
    ]);
    const map = new Map(catalog.map((m) => [`${m.category}::${m.companyName || ""}::${m.name}`, m]));
    for (const row of history) {
      if (!row.sku) continue;
      const key = `${row.category}::${row.companyName || ""}::${row.sku}`;
      if (!map.has(key)) map.set(key, { category: row.category, name: row.sku, companyName: row.companyName || null });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch models" });
  }
}
 
export async function createOutwardModel(req, res) {
  try {
    const { warehouseId, category, name, companyName } = req.body;
    await assertWarehouseAccess(req, warehouseId, "canOutward");
    if (!category || !name?.trim()) return res.status(422).json({ message: "category and model name are required" });
    const model = await prisma.warehouseModel.create({ data: { warehouseId, category, name: name.trim(), companyName: companyName?.trim() || null } });
    return res.status(201).json({ data: model });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This model already exists in this warehouse." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create model" });
  }
}
 
/**
 * =========================================================
 * ITEM COMPANIES (brand/manufacturer tagged per item)
 * =========================================================
 *
 * Mirrors listInwardCompanies / createInwardCompany - the same
 * per-warehouse WarehouseCompany catalog is shared between inward
 * and outward, so a company added from either form shows up on both.
 * =========================================================
 */
 
export async function listOutwardCompanies(req, res) {
  try {
    const { warehouseId } = req.query;
    await assertWarehouseAccess(req, warehouseId, null);
    const [catalog, history] = await Promise.all([
      prisma.warehouseCompany.findMany({ where: { warehouseId }, orderBy: { name: "asc" } }),
      prisma.minItem.findMany({ where: { min: { warehouseId }, companyName: { not: null } }, select: { companyName: true }, distinct: ["companyName"] }),
    ]);
    const map = new Map(catalog.map((c) => [c.name, c]));
    for (const row of history) {
      if (row.companyName && !map.has(row.companyName)) map.set(row.companyName, { name: row.companyName });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List outward companies error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch companies" });
  }
}
 
// Every customer name used on an outward entry in this warehouse - shown in the Customer Name dropdown to everyone
// who can create entries for it, so a customer added by one person is available to all.
const cleanCustomerName = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Customers of a company: every name added with "+ Add" (Customer table) plus every customer name already used on an
// outward entry of any warehouse of that company. Shared by all users of the company.
export async function listOutwardCustomers(req, res) {
  try {
    const { warehouseId, companyId } = req.query;
    // "Dispatch directly" has no warehouse: the customers of the chosen company are listed instead.
    const warehouse = warehouseId ? await assertWarehouseAccess(req, warehouseId, null) : null;
    const directCompany = !warehouse && companyId ? await assertDirectCompany(req, companyId) : null;
    if (!warehouse && !directCompany) return res.status(400).json({ message: "warehouseId or companyId is required" });
    const customerCompanyId = warehouse ? warehouse.companyId : directCompany.id;
    const entryWhere = customerCompanyId
      ? { OR: [{ warehouse: { companyId: customerCompanyId } }, { directDispatch: true, companyId: customerCompanyId }] }
      : { warehouseId };
    const [saved, used] = await Promise.all([
      customerCompanyId ? prisma.customer.findMany({ where: { companyId: customerCompanyId }, select: { name: true } }) : [],
      prisma.min.findMany({ where: entryWhere, select: { customerName: true }, distinct: ["customerName"] }),
    ]);
    const seen = new Set();
    const data = [];
    for (const raw of [...saved.map((r) => r.name), ...used.map((r) => r.customerName)]) {
      const name = cleanCustomerName(raw);
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        data.push({ name });
      }
    }
    data.sort((x, y) => x.name.localeCompare(y.name));
    return res.json({ data });
  } catch (error) {
    console.error("List outward customers error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch customers" });
  }
}

// POST /api/outward/customers  { warehouseId, name } - saves a customer for the warehouse's company, once, for every user.
export async function createOutwardCustomer(req, res) {
  try {
    const { warehouseId, companyId } = req.body || {};
    const name = cleanCustomerName(req.body?.name);
    if (!name) return res.status(422).json({ message: "Customer name is required" });
    if (name.length > 150) return res.status(422).json({ message: "Customer name must be 150 characters or fewer" });
    const warehouse = warehouseId ? await assertWarehouseAccess(req, warehouseId, null) : null;
    const directCompany = !warehouse && companyId ? await assertDirectCompany(req, companyId) : null;
    if (!warehouse && !directCompany) return res.status(422).json({ message: "warehouseId or companyId is required" });
    const customerCompanyId = warehouse ? warehouse.companyId : directCompany.id;
    if (!customerCompanyId) return res.status(422).json({ message: "This warehouse has no company" });
    const nameKey = name.toLowerCase();
    const customer = await prisma.customer.upsert({
      where: { companyId_nameKey: { companyId: customerCompanyId, nameKey } },
      create: { companyId: customerCompanyId, name, nameKey, createdById: req.user.id },
      update: {},
      select: { id: true, name: true },
    });
    return res.status(201).json({ data: customer });
  } catch (error) {
    console.error("Create outward customer error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save customer" });
  }
}

// Serial numbers in stock that can be scanned for this outward entry (feeds the SR. No dropdown on the transportation form).
export async function getAvailableSerials(req, res) {
  try {
    const { id } = req.params;
    const entry = await prisma.min.findUnique({ where: { id }, select: { warehouseId: true, outwardType: true, items: true } });
    if (!entry) return res.status(404).json({ message: "Outward entry not found" });
    await assertWarehouseAccess(req, entry.warehouseId, "canOutward");
    const items = await withSerialModes(prisma, entry.items);
    const data = await listAvailableSerials(prisma, { warehouseId: entry.warehouseId, outwardType: entry.outwardType, minId: id, items });
    // `blocked`: already dispatched / added to another outward (refused at the scan). Any other serial can be scanned,
    // even when it is not on an inward entry.
    const blocked = await listBlockedSerials(prisma, { minId: id, items, available: data });
    return res.json({ data, blocked });
  } catch (error) {
    console.error("Available serials error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to fetch available serial numbers" });
  }
}

export async function createOutwardCompany(req, res) {
  try {
    const { warehouseId, name } = req.body;
    await assertWarehouseAccess(req, warehouseId, "canOutward");
    if (!name?.trim()) return res.status(422).json({ message: "warehouseId and company name are required" });
    const company = await prisma.warehouseCompany.create({ data: { warehouseId, name: name.trim() } });
    return res.status(201).json({ data: company });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This company already exists in this warehouse." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create company" });
  }
}
 
 
// ---------------------------------------------------------------------------
// Validation shared by create + update (Sales side: customer + PI + items + payment status)
// ---------------------------------------------------------------------------
function validateSalesPayload(data, items, direct = false) {
  if (!data.outwardType) return "outwardType is required";
  if (!data.customerName?.trim()) return "customerName is required";
  if (!data.companyName?.trim()) return "companyName is required";
  const piError = validatePi(data);
  if (piError) return piError;
  const partyError = validateParty(data);
  if (partyError) return partyError;
  if (!items.length) return "At least one item is required";
  for (const [index, item] of items.entries()) {
    const label = `Item ${index + 1}`;
    if (!item.category || !item.sku?.trim()) return `${label}: category and model are required`;
    // Quantity and UOM are needed for every entry. A "Dispatch directly" entry has no stock check (no warehouse).
    if (!(Number(item.quantity) > 0)) return `${label}: quantity must be greater than 0`;
    if (!item.uom) return `${label}: UOM is required`;
    const paymentError = validateItemPayment(item, label);
    if (paymentError) return paymentError;
  }
  return null;
}

// Only quantity-level facts go into audit rows that the warehouse can read.
const paymentFingerprint = (i) => JSON.stringify([i.paymentStatus || null, i.utrNumber || null, i.approvedBy || null, Boolean(i.proofFileKey)]);
const itemMatchKey = (i) => [i.category, i.sku, i.uom].join("::").toLowerCase();


// Moves proofs / the PI file that were picked before the entry existed (uploads/<id>/...) into min/<outward number>/.
// Runs in parallel; a file that fails to move simply stays where it is (it still downloads fine).
async function moveTempProofs(minId, outwardNumber) {
  const [rows, entry] = await Promise.all([
    prisma.minItem.findMany({
      where: { minId, proofFileKey: { startsWith: "uploads/" } },
      select: { id: true, proofFileKey: true },
    }),
    prisma.min.findUnique({ where: { id: minId }, select: { piFileKey: true } }),
  ]);
  const folder = outwardFolder(outwardNumber);
  // One payment proof can be shared by several item rows: move the file once, then re-point every row using it.
  const rowsByKey = new Map();
  for (const row of rows) rowsByKey.set(row.proofFileKey, [...(rowsByKey.get(row.proofFileKey) || []), row.id]);
  const jobs = [...rowsByKey.entries()].map(async ([key, ids]) => {
    const target = `${folder}${key.split("/").pop()}`;
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(key, target);
    if (error) return console.error("Proof move failed:", key, error.message);
    await prisma.minItem.updateMany({ where: { id: { in: ids } }, data: { proofFileKey: target } });
  });
  if (entry?.piFileKey?.startsWith("uploads/")) {
    jobs.push((async () => {
      const target = `${folder}${entry.piFileKey.split("/").pop()}`;
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(entry.piFileKey, target);
      if (error) return console.error("PI file move failed:", entry.piFileKey, error.message);
      await prisma.min.update({ where: { id: minId }, data: { piFileKey: target } });
    })());
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------------------
// CREATE  (Sales, Super admin)  ->  status PENDING_APPROVAL
// ---------------------------------------------------------------------------
export async function createOutward(req, res) {
  try {
    const data = req.body;
    const direct = data.directDispatch === true;
    // "Dispatch directly": no warehouse - the entry belongs to the company, and nothing is taken from warehouse stock.
    let warehouse = null;
    let directCompany = null;
    if (direct) {
      directCompany = await assertDirectCompany(req, data.companyId);
      data.companyName = directCompany.name;
    } else {
      warehouse = await assertWarehouseAccess(req, data.warehouseId, "canOutward");
      await assertCompanyForWarehouse(req, warehouse.id, data.companyId);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    const problem = validateSalesPayload(data, items, direct);
    if (problem) return res.status(422).json({ message: problem });

    // The id is chosen up front so the payment proofs could be uploaded straight into
    // min/<warehouse code>/<id>/ before the entry exists.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const newMinId = UUID_RE.test(String(data.id || "")) ? String(data.id).toLowerCase() : randomUUID();
    const proofProblem = proofKeyProblem(items, newMinId, undefined, data.piFileKey);
    if (proofProblem) return res.status(422).json({ message: proofProblem });

    const [unknownItems, outwardCount] = await Promise.all([
      findUnknownProducts(items),
      // Direct entries are numbered per company: MIN-<company code>-0001, 0002 ...
      prisma.min.count({ where: direct ? { directDispatch: true, companyId: directCompany.id } : { warehouseId: warehouse.id } }),
    ]);
    if (unknownItems.length) return res.status(422).json({ message: unknownProductsMessage(unknownItems) });

    const itemRows = items.map((item) => toItemRow(item));

    let sequence = outwardCount + 1;
    let created = null;
    const MAX_NUMBER_ATTEMPTS = 10;

    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const outwardNumber = `MIN-${direct ? directCompany.code : warehouse.code}-${String(sequence).padStart(4, "0")}`;
      try {
        created = await prisma.$transaction(async (tx) => {
          // Stock is reserved as soon as Sales submits (rejected entries release it again).
          if (!direct) {
            const stock = await getWarehouseStock(tx, warehouse.id, { onlyItems: items });
            const shortages = findShortages(items, stock);
            if (shortages.length) throw httpError(422, shortageMessage(shortages));
          }

          return tx.min.create({
            data: {
              id: newMinId,
              outwardNumber,
              warehouseId: direct ? null : warehouse.id,
              directDispatch: direct,
              companyId: direct ? directCompany.id : data.companyId || null,
              outwardType: data.outwardType,
              customerName: data.customerName.trim(),
              companyName: data.companyName.trim(),
              ...toPiColumns(data),
              ...toPartyColumns(data),
              refDocType: PLACEHOLDER,
              refDocNumber: PLACEHOLDER,
              refDocDate: data.outwardDateTime ? new Date(data.outwardDateTime) : new Date(),
              status: STATUS.PENDING_APPROVAL,
              createdById: req.user.id,
              items: { createMany: { data: itemRows } },
            },
            select: { id: true, outwardNumber: true, warehouseId: true },
          });
        }, STOCK_TRANSACTION_OPTIONS);
        break;
      } catch (err) {
        const isNumberClash = err?.code === "P2002" && String(err?.meta?.target ?? "").includes("outwardNumber");
        if (isNumberClash && attempt < MAX_NUMBER_ATTEMPTS) { sequence += 1; continue; }
        throw err;
      }
    }

    // Moving proof files in storage and writing the audit entry happen AFTER the
    // response is sent - the user no longer waits for them. (A file that fails to
    // move simply stays where it is and still downloads fine.)
    const result = await prisma.min.findUnique({ where: { id: created.id }, include: { items: true, referenceDocuments: true } });
    res.once("finish", () => {
      moveTempProofs(created.id, created.outwardNumber).catch((err) => console.error("Proof move failed:", err));
      recordAuditLog(prisma, {
        entityType: "OUTWARD",
        entityId: created.id,
        entityNumber: created.outwardNumber,
        action: "CREATED",
        description: `Outward entry ${created.outwardNumber} created${direct ? " (dispatch directly)" : ""} with ${itemRows.length} item${itemRows.length === 1 ? "" : "s"}`,
        userId: req.user.id,
        warehouseId: created.warehouseId,
      });
    });

    return res.status(201).json({ message: "Outward entry submitted for account approval", data: finishFor(req, result, []) });
  } catch (error) {
    console.error("Create outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to create outward entry" });
  }
}

// Edit lock for Sales / Account: reads the entry's documents + reference documents and applies editLockReason.
// `entry` needs id, status and transportSubmittedAt. `client` is prisma or a transaction client.
async function lockReasonFor(client, entry) {
  if (isDispatchedStatus(entry.status)) return editLockReason(entry);
  if (!isApprovedStatus(entry.status) || !entry.transportSubmittedAt) return null;
  const [docs, refs] = await Promise.all([
    client.document.findMany({ where: { linkedType: "outward", linkedId: entry.id }, select: { docCategory: true } }),
    client.minReferenceDocument.findMany({ where: { minId: entry.id }, select: { refDocType: true } }),
  ]);
  return editLockReason(entry, docs, refs);
}

// ---------------------------------------------------------------------------
// UPDATE  (Sales until dispatch, Super admin any time)
// PENDING_APPROVAL / REJECTED  -> always (re)submitted to Account.
// TRANSPORT_PENDING / DOCS_PENDING -> any update goes back to Account for approval, until the transportation
//                                 details are sent AND Account has uploaded documents (then it is locked).
// READY_FOR_DISPATCH           -> Sales can edit until Account has uploaded its documents (see editLockReason).
// DISPATCHED / DELIVERED       -> Super admin only, status unchanged.
// ---------------------------------------------------------------------------
export async function updateOutward(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    let items = Array.isArray(data.items) ? data.items : [];

    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, directDispatch: true, companyId: true, outwardNumber: true, status: true, createdById: true,
        outwardType: true, customerName: true, companyName: true,
        piNumber: true, piDate: true, piAmount: true, piFileKey: true, piFileName: true, piFileType: true,
        shipToContactPerson: true, shipToContactNo: true, shipToLocation: true,
        billToContactPerson: true, billToContactNo: true, billToEmail: true, dispatchRemarks: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true,
        dispatchMode: true, vehicleNumber: true, driverName: true, driverContact: true, remarks: true,
        transportSubmittedAt: true,
        items: true,
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });

    const isAdmin = req.user.role === "SUPER_ADMIN";
    if (!isAdmin) {
      // Any Sales user of the same company can edit the team's entries (company access is enforced below by
      // assertWarehouseAccess). The lock / status rules still apply.
      const lockReason = await lockReasonFor(prisma, existing);
      if (lockReason || !SALES_EDITABLE_STATUSES.includes(existing.status)) {
        return res.status(409).json({ message: lockReason || "This entry can no longer be edited" });
      }
    }

    const direct = Boolean(existing.directDispatch);
    let directCompany = null;
    if (direct) {
      // Dispatch directly: access and the company come from the company, there is no warehouse.
      await assertEntryVisible(req, existing);
      directCompany = await assertDirectCompany(req, data.companyId);
      data.companyName = directCompany.name;
    }
    const warehouse = direct ? null : await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    const proofProblem = proofKeyProblem(items, id, existing.outwardNumber, data.piFileKey);
    if (proofProblem) return res.status(422).json({ message: proofProblem });
    if (!direct) await assertCompanyForWarehouse(req, warehouse.id, data.companyId, true);

    // A row that still holds its old proof file says keepProof: true.
    const existingById = new Map(existing.items.map((i) => [i.id, i]));
    const normalized = items.map((item) => {
      const previous = existingById.get(item.serverId);
      return { ...item, keepProof: item.keepProof === true && Boolean(previous?.proofFileKey) };
    });

    const problem = validateSalesPayload(data, normalized, direct);
    if (problem) return res.status(422).json({ message: problem });
    const piColumns = toPiColumns(data, existing);
    const partyColumns = toPartyColumns(data);

    const unknownItems = await findUnknownProducts(normalized, existing.items);
    if (unknownItems.length) return res.status(422).json({ message: unknownProductsMessage(unknownItems) });

    const newItems = normalized.map((item) => toItemRow(item, existingById.get(item.serverId)));

    // Update after dispatch (Super admin): the same save also carries the dispatch details.
    let dispatchUpdate = null;
    if (isAdmin && isDispatchedStatus(existing.status) && data.dispatch) {
      const d = data.dispatch;
      // With a submitted transportation form (always locked by now) the vehicle / driver / transporter fields are not editable here.
      const transportFixed = Boolean(existing.transportSubmittedAt);
      if (!transportFixed) {
        if (!d.dispatchMode) return res.status(422).json({ message: "Dispatch mode is required" });
        const adminDriverProblem = validateDriver(d);
        if (adminDriverProblem) return res.status(422).json({ message: adminDriverProblem });
      }
      const refs = (Array.isArray(d.referenceDocuments) ? d.referenceDocuments : [])
        .filter((r) => r && (r.refDocNumber || r.ewayBillNumber))
        .map((r) => ({
          refDocType: String(r.refDocType || "Other").trim(),
          refDocNumber: String(r.refDocNumber || r.ewayBillNumber || "N/A").trim(),
          ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
          vehicleNumber: r.vehicleNumber ? String(r.vehicleNumber).trim() : null,
        }));
      // Reference documents are optional.
      dispatchUpdate = {
        refs,
        transportFixed,
        snapshot: {
          refDocType: refs[0]?.refDocType ?? existing.refDocType ?? "Other",
          refDocNumber: refs[0]?.refDocNumber ?? existing.refDocNumber ?? "N/A",
          ewayBillNumber: refs[0]?.ewayBillNumber ?? null,
          ...(transportFixed
            ? {}
            : {
                dispatchMode: d.dispatchMode,
                vehicleNumber: d.vehicleNumber?.trim() || null,
                driverName: d.driverName?.trim() || null,
                driverContact: d.driverContact?.trim() || null,
              }),
          remarks: d.remarks?.trim() || null,
        },
      };
    }

    const newSnapshot = {
      outwardType: data.outwardType,
      customerName: data.customerName.trim(),
      companyName: data.companyName.trim(),
    };
    const fieldChanges = diffFields(existing, newSnapshot, ["outwardType", "customerName", "companyName"]);
    const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    const piChanges = diffFields(
      { piNumber: existing.piNumber, piDate: isoDay(existing.piDate), piAmount: existing.piAmount === null ? null : Number(existing.piAmount) },
      { piNumber: piColumns.piNumber, piDate: isoDay(piColumns.piDate), piAmount: piColumns.piAmount },
      ["piNumber", "piDate", "piAmount"]
    );
    const partyChanges = diffFields(existing, partyColumns, [
      "shipToContactPerson", "shipToContactNo", "shipToLocation",
      "billToContactPerson", "billToContactNo", "billToEmail",
      "dispatchRemarks",
    ]);
    const piFileChanged = (existing.piFileKey || null) !== (piColumns.piFileKey || null);
    const itemChanges = diffItems(existing.items, newItems);

    // Payment side changes are logged in one line that warehouse managers never see.
    const oldByKey = new Map(existing.items.map((i) => [itemMatchKey(i), i]));
    const paymentChanged = newItems.some((n) => {
      const o = oldByKey.get(itemMatchKey(n));
      return !o || paymentFingerprint(o) !== paymentFingerprint(n);
    });

    let sentForApproval = false;

    await prisma.$transaction(async (tx) => {
      // Re-read the status inside the transaction: Account / warehouse may have acted meanwhile.
      const current = await tx.min.findUnique({ where: { id }, select: { id: true, status: true, transportSubmittedAt: true } });
      if (!current) throw httpError(404, "Outward entry not found");
      if (!isAdmin) {
        const lockNow = await lockReasonFor(tx, current);
        if (lockNow || !SALES_EDITABLE_STATUSES.includes(current.status)) {
          throw httpError(409, lockNow || "This entry can no longer be edited");
        }
      }
      const wasRejected = current.status === STATUS.REJECTED;
      const wasApproved = isApprovedStatus(current.status);
      const wasOnHold = current.status === STATUS.ON_HOLD;
      // ANY update (Sales or super admin) on an approved, not-yet-dispatched entry sends it back for
      // approval again. A dispatched / delivered entry edited by the super admin keeps its status.
      const resubmit = current.status === STATUS.PENDING_APPROVAL || wasRejected || wasApproved || wasOnHold;
      sentForApproval = resubmit;

      if (!direct) {
        const stock = await getWarehouseStock(tx, existing.warehouseId, { excludeOutwardId: id, onlyItems: [...newItems, ...existing.items] });
        const shortages = findShortages(newItems, stock, existing.items);
        if (shortages.length) throw httpError(422, shortageMessage(shortages));
      }

      await tx.min.update({
        where: { id },
        data: {
          outwardType: data.outwardType,
          customerName: data.customerName.trim(),
          companyName: data.companyName.trim(),
          ...(direct ? { companyId: directCompany.id } : {}),
          ...piColumns,
          ...partyColumns,
          ...(data.outwardDateTime ? { refDocDate: new Date(data.outwardDateTime) } : {}),
          ...(dispatchUpdate ? dispatchUpdate.snapshot : {}),
          ...(resubmit
            ? { status: STATUS.PENDING_APPROVAL, approvedById: null, approvedByName: null, approvedAt: null, approvalRemarks: null }
            : {}),
          items: { deleteMany: {}, create: newItems },
          ...(dispatchUpdate ? { referenceDocuments: { deleteMany: {}, create: dispatchUpdate.refs } } : {}),
        },
      });
      // Item rows were rewritten: keep the serial numbers that still match, drop the rest.
      const serialItems = await withSerialModes(tx, newItems);
      const hadSerials = (await tx.minSerial.count({ where: { minId: id } })) > 0;
      const prunedSerials = await pruneSerials(tx, id, serialItems);
      if (hadSerials) {
        // Serial numbers were already scanned: the edited items must still have all the serial numbers they need.
        const kept = await tx.minSerial.findMany({ where: { minId: id }, select: { category: true, sku: true, serialNo: true } });
        const problem = validateSerials(serialItems, kept);
        if (problem) throw httpError(422, `${problem}. Scan the serial numbers again on the Transportation page after changing the items.`);
      }

      const base = {
        entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber,
        userId: req.user.id, warehouseId: existing.warehouseId,
      };
      const entries = [];
      if (dispatchUpdate) {
        const dispatchChanges = diffFields(existing, dispatchUpdate.snapshot, dispatchUpdate.transportFixed
          ? ["refDocType", "refDocNumber", "ewayBillNumber", "remarks"]
          : ["refDocType", "refDocNumber", "ewayBillNumber", "dispatchMode", "vehicleNumber", "driverName", "driverContact", "remarks"]);
        for (const c of dispatchChanges) {
          entries.push({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c });
        }
      }
      for (const change of fieldChanges) {
        entries.push({ ...base, action: "UPDATED", description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`, changes: change });
      }
      for (const item of itemChanges.added) {
        entries.push({ ...base, action: "ITEM_ADDED", description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`, changes: plainItem(item) });
      }
      for (const item of itemChanges.removed) {
        entries.push({ ...base, action: "ITEM_REMOVED", description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`, changes: plainItem(item) });
      }
      for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
        entries.push({ ...base, action: "ITEM_UPDATED", description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`, changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity } });
      }
      for (const change of piChanges) {
        entries.push({ ...base, action: "PI_UPDATED", description: `${change.label} updated from "${change.oldValue ?? "—"}" to "${change.newValue ?? "—"}"`, changes: change });
      }
      for (const change of partyChanges) {
        entries.push({ ...base, action: "PARTY_UPDATED", description: `${change.label} updated from "${change.oldValue ?? "—"}" to "${change.newValue ?? "—"}"`, changes: change });
      }
      if (piFileChanged) entries.push({ ...base, action: "PI_UPDATED", description: piColumns.piFileKey ? "PI file attached / replaced" : "PI file removed" });
      if (paymentChanged) entries.push({ ...base, action: "PAYMENT_UPDATED", description: "Payment details updated" });
      if (wasRejected) entries.push({ ...base, action: "RESUBMITTED", description: "Resubmitted for account approval" });
      else if (wasOnHold) entries.push({ ...base, action: "RESUBMITTED", description: "Updated while on hold - sent for account approval again" });
      else if (wasApproved) entries.push({ ...base, action: "RESUBMITTED", description: "Updated after approval - sent for account approval again" });
      if (prunedSerials) entries.push({ ...base, action: "SERIALS_UPDATED", description: `${prunedSerials} serial number(s) removed because the items changed` });
      if (!entries.length) entries.push({ ...base, action: "UPDATED", description: "Outward entry saved with no field changes" });
      await recordAuditLogs(tx, entries);
    }, STOCK_TRANSACTION_OPTIONS);

    // A payment proof that was replaced or removed is deleted from storage too.
    const keptProofKeys = new Set(newItems.map((i) => i.proofFileKey).filter(Boolean));
    const droppedProofs = [...new Set(existing.items.map((i) => i.proofFileKey).filter((k) => k && !keptProofKeys.has(k)))];
    if (existing.piFileKey && existing.piFileKey !== piColumns.piFileKey) droppedProofs.push(existing.piFileKey);
    if (droppedProofs.length) {
      const { error: proofCleanupError } = await supabase.storage.from(SUPABASE_BUCKET).remove(droppedProofs);
      if (proofCleanupError) console.error("Old payment proof cleanup failed:", proofCleanupError.message);
    }

    // Same shape as GET /:id, so the client never shows a half-filled or stale entry after an edit.
    const result = await prisma.min.findUnique({
      where: { id },
      include: {
        items: true,
        serials: { orderBy: { createdAt: "asc" } },
        referenceDocuments: true,
        createdBy: { select: { name: true, email: true, role: true } },
        warehouse: { select: { id: true, name: true, code: true, companyId: true, Inward: true, Outward: true, company: { select: { name: true, status: true } } } },
      },
    });
    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, orderBy: { uploadedAt: "desc" } });
    return res.json({ message: sentForApproval ? "Outward entry saved and sent for account approval" : "Outward entry updated successfully", data: finishFor(req, result, documents) });
  } catch (error) {
    console.error("Update outward error:", error);
    if (error.code === "P2034") return res.status(409).json({ message: "Stock was just updated by someone else. Please try again." });
    return res.status(error.status || 500).json({ message: error.message || "Failed to update outward entry" });
  }
}

// ---------------------------------------------------------------------------
// APPROVE (only while PENDING_APPROVAL) / REJECT (until dispatch)  (Account, Super admin)
// ---------------------------------------------------------------------------
async function loadForDecision(req, allowedStatuses, notAllowedMessage, { enforceLock = false } = {}) {
  const min = await prisma.min.findUnique({
    where: { id: req.params.id },
    select: { id: true, outwardNumber: true, warehouseId: true, directDispatch: true, companyId: true, status: true, createdById: true, piAmount: true, transportSubmittedAt: true },
  });
  if (!min) throw httpError(404, "Outward entry not found");
  await assertEntryVisible(req, min);
  if (!allowedStatuses.includes(min.status)) throw httpError(409, notAllowedMessage);
  // Account can reject / hold until the dispatch is done; only Sales edits are locked (enforceLock is opt-in).
  if (enforceLock && req.user.role !== "SUPER_ADMIN") {
    const lockReason = await lockReasonFor(prisma, min);
    if (lockReason) throw httpError(409, lockReason);
  }
  return min;
}

export async function approveOutward(req, res) {
  try {
    const min = await loadForDecision(req, APPROVABLE_STATUSES, "This entry is not waiting for approval");
    const remarks = req.body?.remarks?.trim() || null;

    // Normally TRANSPORT_PENDING. An entry that was edited after its transportation form / documents were
    // submitted keeps that progress (DOCS_PENDING / READY_FOR_DISPATCH).
    const [docsNow, refsNow] = min.transportSubmittedAt
      ? await Promise.all([
          prisma.document.findMany({ where: { linkedType: "outward", linkedId: min.id }, select: { docCategory: true } }),
          prisma.minReferenceDocument.findMany({ where: { minId: min.id }, select: { refDocType: true } }),
        ])
      : [[], []];
    const nextStatus = deriveApprovedStatus(min, docsNow, refsNow);

    // Guard against a double click / two approvers: only flips if it is still pending.
    const { count } = await prisma.min.updateMany({
      where: { id: min.id, status: { in: APPROVABLE_STATUSES } },
      data: {
        status: nextStatus,
        approvedById: req.user.id,
        approvedByName: req.user.name,
        approvedAt: new Date(),
        approvalRemarks: remarks,
      },
    });
    if (!count) return res.status(409).json({ message: "This entry was just updated by someone else" });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: min.id, entityNumber: min.outwardNumber,
      action: "APPROVED", description: `Approved by ${req.user.name}${remarks ? ` — ${remarks}` : ""}`,
      userId: req.user.id, warehouseId: min.warehouseId,
    });
    return res.json({
      message: min.directDispatch
        ? "Approved. Upload the documents to complete this entry - it is then delivered directly."
        : nextStatus === STATUS.TRANSPORT_PENDING ? "Approved. The warehouse manager can now fill the transportation form." : "Approved.",
      data: { workflowStatus: nextStatus },
    });
  } catch (error) {
    console.error("Approve outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to approve" });
  }
}

// HOLD: Account parks the entry with a reason. Stock stays reserved; Account can approve / reject it later,
// Sales can edit it (which sends it back for approval). The warehouse manager never sees it.
export async function holdOutward(req, res) {
  try {
    const min = await loadForDecision(req, HOLDABLE_STATUSES, "This entry can no longer be put on hold (already dispatched, rejected or on hold)");
    const remarks = req.body?.remarks?.trim();
    if (!remarks) return res.status(422).json({ message: "Please give a reason for putting this on hold" });

    const { count } = await prisma.min.updateMany({
      where: { id: min.id, status: { in: HOLDABLE_STATUSES } },
      data: {
        status: STATUS.ON_HOLD,
        approvedById: req.user.id,
        approvedByName: req.user.name,
        approvedAt: new Date(),
        approvalRemarks: remarks,
      },
    });
    if (!count) return res.status(409).json({ message: "This entry was just updated by someone else" });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: min.id, entityNumber: min.outwardNumber,
      action: "ON_HOLD", description: `Put on hold by ${req.user.name} — ${remarks}`,
      userId: req.user.id, warehouseId: min.warehouseId,
    });
    return res.json({ message: "Put on hold. You can approve or reject it later." });
  } catch (error) {
    console.error("Hold outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to put on hold" });
  }
}

export async function rejectOutward(req, res) {
  try {
    const min = await loadForDecision(req, REJECTABLE_STATUSES, "This entry can no longer be rejected (already dispatched or rejected)");
    const remarks = req.body?.remarks?.trim();
    if (!remarks) return res.status(422).json({ message: "Please give a reason for rejecting" });

    const { count } = await prisma.min.updateMany({
      where: { id: min.id, status: { in: REJECTABLE_STATUSES } },
      data: {
        status: STATUS.REJECTED,
        approvedById: req.user.id,
        approvedByName: req.user.name,
        approvedAt: new Date(),
        approvalRemarks: remarks,
      },
    });
    if (!count) return res.status(409).json({ message: "This entry was just updated by someone else" });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: min.id, entityNumber: min.outwardNumber,
      action: "REJECTED", description: `Rejected by ${req.user.name} — ${remarks}`,
      userId: req.user.id, warehouseId: min.warehouseId,
    });
    return res.json({ message: "Rejected. Sales can edit and resubmit." });
  } catch (error) {
    console.error("Reject outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to reject" });
  }
}

// ---------------------------------------------------------------------------
// DISPATCH  (Warehouse manager, Super admin)
// Fills the dispatch details on an approved entry. Items / PI / payment are not touched.
// After this the entry is locked - only a Super admin can change it again.
// ---------------------------------------------------------------------------
export async function dispatchOutward(req, res) {
  try {
    const { id } = req.params;
    // JSON body, or multipart: payload (JSON string) + files + categories (JSON array, one per file).
    let data = req.body || {};
    let categories = [];
    if (typeof data.payload === "string") {
      try {
        categories = JSON.parse(data.categories || "[]");
        data = JSON.parse(data.payload);
      } catch {
        return res.status(422).json({ message: "Invalid dispatch data" });
      }
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length !== categories.length && files.length) return res.status(422).json({ message: "Each document needs a name" });
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];

    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, outwardNumber: true, status: true,
        refDocType: true, refDocNumber: true, ewayBillNumber: true,
        dispatchMode: true, vehicleNumber: true, driverName: true, driverContact: true, remarks: true,
        transportMode: true, transportSubmittedAt: true, piAmount: true,
        items: { select: { category: true, sku: true, quantity: true, uom: true } },
        _count: { select: { serials: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });

    const warehouse = await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    // The warehouse manager (and super admin) fill the dispatch details and can keep updating them
    // after dispatch: reference documents, dispatch mode, vehicle number, remarks (documents via upload).
    const allowedStatuses = [...APPROVED_STATUSES, ...DISPATCHED_STATUSES];
    if (!allowedStatuses.includes(existing.status)) {
      // Same message whatever the reason, so nothing about approval leaks to the warehouse.
      return res.status(409).json({ message: "This entry is not ready for dispatch" });
    }

    // Transportation form first, then Account's documents: only then does the dispatch form open.
    const hasTransport = Boolean(existing.transportSubmittedAt);
    const firstDispatch = isApprovedStatus(existing.status);
    if (firstDispatch) {
      if (!hasTransport) return res.status(409).json({ message: "Please submit the transportation form first" });
      // Account's documents (and the e-way bill) are optional, but Account must have pressed Submit / Save first.
      if (existing.status !== STATUS.READY_FOR_DISPATCH) return res.status(409).json({ message: "Dispatch opens once the account team has submitted its documents section" });
    }
    // Vehicle / driver / transporter come from the transportation form (read-only here). Entries dispatched
    // before that form existed keep the old behaviour and take them from this request.
    const dispatchMode = hasTransport ? existing.dispatchMode || TRANSPORT_MODE_LABEL[existing.transportMode] : data.dispatchMode;
    if (!dispatchMode) return res.status(422).json({ message: "Dispatch mode is required" });
    if (!hasTransport) {
      const driverProblem = validateDriver(data);
      if (driverProblem) return res.status(422).json({ message: driverProblem });
    }
    // Invoice / E-way bill references belong to the account team; the dispatch side only has
    // delivery challan, return note and other. Account's rows are never touched here.
    const normalizedRefs = references
      .filter((r) => r && String(r.refDocNumber || "").trim())
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber).trim(),
        ewayBillNumber: null,
      }));
    // Reference documents are optional.
    if (normalizedRefs.some((r) => isAccountRefType(r.refDocType))) {
      return res.status(422).json({ message: "Invoice and e-way bill references are added by the account team" });
    }
    if (req.user.role !== "SUPER_ADMIN" && categories.some((c) => isAccountDocCategory(c))) {
      return res.status(422).json({ message: "Invoice and e-way bill documents are added by the account team" });
    }

    // Documents (Bilty included) are optional - nothing has to be uploaded to dispatch.

    // Serial numbers are scanned on the transportation form (see saveTransportation); dispatch leaves them as they are.

    const newSnapshot = {
      refDocType: normalizedRefs[0]?.refDocType ?? existing.refDocType ?? "Other",
      refDocNumber: normalizedRefs[0]?.refDocNumber ?? existing.refDocNumber ?? "N/A",
      dispatchMode,
      vehicleNumber: hasTransport ? existing.vehicleNumber : data.vehicleNumber?.trim() || null,
      driverName: hasTransport ? existing.driverName : data.driverName?.trim() || null,
      driverContact: hasTransport ? existing.driverContact : data.driverContact?.trim() || null,
      remarks: data.remarks?.trim() || null,
    };
    const changes = !firstDispatch
      ? diffFields(existing, newSnapshot, ["refDocType", "refDocNumber", "dispatchMode", "vehicleNumber", "driverName", "driverContact", "remarks"])
      : [];

    // Files go to storage first (in parallel); the database write below then saves the dispatch
    // details and the document rows together in one go.
    const uploaded = files.length ? await storeOutwardFiles(files, categories, existing.outwardNumber) : [];
    let replaced = [];

    // Guarded write: only applies while the entry is still in a status this user may dispatch from
    // (Sales / Account may have pulled it back for re-approval in the meantime).
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.min.updateMany({
          where: { id, status: { in: allowedStatuses } },
          data: {
            ...newSnapshot,
            ...(data.outwardDateTime ? { refDocDate: new Date(data.outwardDateTime) } : {}),
            // A delivered entry stays DELIVERED when the dispatch details are corrected.
            status: existing.status === STATUS.DELIVERED ? STATUS.DELIVERED : STATUS.DISPATCHED,
            // Who / when dispatched is set once, on the first save only.
            ...(firstDispatch
              ? { dispatchedById: req.user.id, dispatchedByName: req.user.name, dispatchedAt: new Date() }
              : {}),
          },
        });
        if (!count) throw httpError(409, "This entry is not ready for dispatch");
        await tx.min.update({ where: { id }, data: { referenceDocuments: { deleteMany: { NOT: { refDocType: { in: ACCOUNT_REF_TYPES } } }, create: normalizedRefs } } });

        if (uploaded.length) {
          // A new file for a document that already exists replaces it.
          const names = new Set(uploaded.map((u) => u.docCategory.trim().toLowerCase()));
          const old = await tx.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { id: true, fileKey: true, docCategory: true } });
          replaced = old.filter((d) => names.has(String(d.docCategory || "").trim().toLowerCase()));
          if (replaced.length) await tx.document.deleteMany({ where: { id: { in: replaced.map((d) => d.id) } } });
          await tx.document.createMany({
            data: uploaded.map((u) => ({
              linkedType: "outward", linkedId: id, docCategory: u.docCategory,
              fileKey: u.fileKey, fileType: u.fileType, fileSize: u.fileSize, uploadedById: req.user.id,
            })),
          });
        }
      });
    } catch (txError) {
      if (uploaded.length) await supabase.storage.from(SUPABASE_BUCKET).remove(uploaded.map((u) => u.fileKey)).catch(() => {});
      throw txError;
    }
    if (replaced.length) {
      const { error: cleanupError } = await supabase.storage.from(SUPABASE_BUCKET).remove(replaced.map((d) => d.fileKey));
      if (cleanupError) console.error("Old document cleanup failed:", cleanupError.message);
    }

    const base = { entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber, userId: req.user.id, warehouseId: existing.warehouseId };
    const entries = firstDispatch
      ? [{ ...base, action: "DISPATCHED", description: `Dispatched (${dispatchMode}${newSnapshot.vehicleNumber ? `, ${newSnapshot.vehicleNumber}` : ""})` }]
      : changes.map((c) => ({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c }));
    for (const u of uploaded) {
      entries.push({ ...base, action: "DOCUMENT_ADDED", description: `Document added: ${u.docCategory} (${u.fileName})`, changes: { docCategory: u.docCategory, fileName: u.fileName } });
    }
    // The save already succeeded - the audit trail is written in the background.
    if (entries.length) recordAuditLogs(prisma, entries).catch((err) => console.error("Audit log (dispatch) failed:", err));

    const [result, documents] = await Promise.all([
      prisma.min.findUnique({ where: { id }, include: { items: true, serials: { orderBy: { createdAt: "asc" } }, referenceDocuments: true } }),
      prisma.document.findMany({ where: { linkedType: "outward", linkedId: id } }),
    ]);
    return res.json({ message: "Dispatch details saved", data: finishFor(req, result, documents) });
  } catch (error) {
    console.error("Dispatch outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save dispatch details" });
  }
}

// ---------------------------------------------------------------------------
// TRANSPORTATION  (Warehouse manager, Super admin) - opens once Account has approved the entry
// Vehicle type: "Dedicated vehicle" (vehicle no. + driver name + driver contact) or "Transportation" (ID + name).
// Submitting it unlocks the document upload for the account team. Can be corrected until the entry is dispatched.
// ---------------------------------------------------------------------------
export async function saveTransportation(req, res) {
  try {
    const { id } = req.params;
    const data = req.body || {};
    const existing = await prisma.min.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, outwardNumber: true, status: true, transportSubmittedAt: true,
        transportMode: true, dispatchMode: true, vehicleNumber: true, driverName: true, driverContact: true, transporterId: true, transporterName: true, transporterContact: true,
        items: true,
        outwardType: true,
        _count: { select: { serials: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });
    await assertWarehouseAccess(req, existing.warehouseId, "canOutward");

    const allowed = [...APPROVED_STATUSES, ...DISPATCHED_STATUSES];
    // Same message whatever the reason, so nothing about approval leaks to the warehouse.
    if (!allowed.includes(existing.status)) return res.status(409).json({ message: "This entry is not ready for transportation details" });

    // Once Account has uploaded its documents the submitted details are frozen (nobody can change them, Super admin included).
    if (existing.transportSubmittedAt) {
      const [docs, refs] = await Promise.all([
        prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { docCategory: true } }),
        prisma.minReferenceDocument.findMany({ where: { minId: id }, select: { refDocType: true } }),
      ]);
      if (transportLockReason(existing, docs, refs)) return res.status(409).json({ message: TRANSPORT_LOCK_MESSAGE });
    }

    const problem = validateTransport(data);
    if (problem) return res.status(422).json({ message: problem });
    const columns = toTransportColumns(data);
    const isFirstTime = !existing.transportSubmittedAt;

    // Serial numbers: one for every Pcs unit, scanned on this form and shared with the account team.
    // Same rule on first save and on update: Required items need all their serial numbers, Optional all or none.
    const serials = cleanSerials(data.serials);
    const legacyNoSerials = false;
    if (!legacyNoSerials) {
      const serialProblem = validateSerials(await withSerialModes(prisma, existing.items), serials);
      if (serialProblem) return res.status(422).json({ message: serialProblem });
      // Each serial must have come in through an inward type allowed for this outward type, and not be out already.
      const serialSourceProblem = await findSerialSourceProblem(prisma, { warehouseId: existing.warehouseId, outwardType: existing.outwardType, minId: id, serials });
      if (serialSourceProblem) return res.status(422).json({ message: serialSourceProblem });
    }

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.min.updateMany({
        where: { id, status: { in: allowed } },
        data: {
          ...columns,
          ...(isFirstTime ? { transportSubmittedById: req.user.id, transportSubmittedByName: req.user.name, transportSubmittedAt: new Date() } : {}),
        },
      });
      if (!count) throw httpError(409, "This entry was just updated by someone else");
      if (!legacyNoSerials) {
        // Re-check inside the transaction so two entries cannot take the same serial number.
        // The lock makes two saves for the same warehouse go one after the other.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.warehouseId}))`;
        const clash = await findSerialSourceProblem(tx, { warehouseId: existing.warehouseId, outwardType: existing.outwardType, minId: id, serials });
        if (clash) throw httpError(422, clash);
        await replaceSerials(tx, id, serials);
      }
    });
    // TRANSPORT_PENDING -> DOCS_PENDING (or READY_FOR_DISPATCH when the release document is already there).
    if (isFirstTime) await syncApprovedStage(prisma, id);

    const base = { entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber, userId: req.user.id, warehouseId: existing.warehouseId };
    const describe = (c) => c.mode === "DEDICATED"
      ? `Dedicated vehicle ${c.vehicleNumber} (driver ${c.driverName}, ${c.driverContact})`
      : `Transportation ${c.transporterName}${c.transporterId ? ` (ID ${c.transporterId})` : ""}${c.transporterContact ? ` (contact ${c.transporterContact})` : ""}${c.vehicleNumber ? ` (vehicle ${c.vehicleNumber})` : ""}${c.driverContact ? ` (driver contact ${c.driverContact})` : ""}`;
    const entries = isFirstTime
      ? [{ ...base, action: "TRANSPORT_SUBMITTED", description: `Transportation details submitted: ${describe({ ...columns, mode: columns.transportMode })}` }]
      : diffFields(existing, columns, ["transportMode", "dispatchMode", "vehicleNumber", "driverName", "driverContact", "transporterId", "transporterName", "transporterContact"])
          .map((c) => ({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c }));
    if (!legacyNoSerials && serials.length) {
      const via = { CAMERA: 0, SCANNER: 0, MANUAL: 0 };
      serials.forEach((x) => { via[x.source] += 1; });
      entries.push({ ...base, action: "SERIALS_UPDATED", description: `Serial numbers saved: ${serials.length} (camera ${via.CAMERA}, scanner ${via.SCANNER}, typed ${via.MANUAL})`, changes: { count: serials.length } });
    }
    if (entries.length) recordAuditLogs(prisma, entries).catch((err) => console.error("Audit log (transportation) failed:", err));

    const [result, documents] = await Promise.all([
      prisma.min.findUnique({ where: { id }, include: { items: true, serials: { orderBy: { createdAt: "asc" } }, referenceDocuments: true } }),
      prisma.document.findMany({ where: { linkedType: "outward", linkedId: id } }),
    ]);
    return res.json({
      message: isFirstTime ? "Transportation details and serial numbers submitted. The account team can now upload the documents." : "Transportation details updated",
      data: finishFor(req, result, documents),
    });
  } catch (error) {
    console.error("Save transportation error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save transportation details" });
  }
}

// ---------------------------------------------------------------------------
// RECEIVING  (Warehouse manager, Super admin) - after the entry is dispatched
// Receiving date, receiver name / contact, remarks and the receiving documents (receiving copy, photo ...).
// Same request shape as dispatch: JSON, or multipart (payload + files + categories). Can be saved again to correct it.
// ---------------------------------------------------------------------------
export async function saveReceiving(req, res) {
  try {
    const { id } = req.params;
    let data = req.body || {};
    let categories = [];
    if (typeof data.payload === "string") {
      try {
        categories = JSON.parse(data.categories || "[]");
        data = JSON.parse(data.payload);
      } catch {
        return res.status(422).json({ message: "Invalid receiving data" });
      }
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length && files.length !== categories.length) return res.status(422).json({ message: "Each document needs a name" });
    // Receiving files always live under a "Receiving ..." name, so they never mix with dispatch / account documents.
    if (categories.some((c) => !isReceivingDocCategory(c))) {
      return res.status(422).json({ message: "Receiving documents must be named Receiving ..." });
    }

    // Entry and its saved documents are read together (they do not depend on each other).
    const [existing, savedDocs] = await Promise.all([
      prisma.min.findUnique({
        where: { id },
        select: {
          id: true, warehouseId: true, outwardNumber: true, status: true, dispatchedAt: true, refDocDate: true,
          receivedAt: true, receivedDate: true, receiverName: true, receiverContact: true, receivingRemarks: true,
        },
      }),
      prisma.document.findMany({
        where: { linkedType: "outward", linkedId: id },
        select: { id: true, fileKey: true, docCategory: true },
      }),
    ]);
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });

    await assertWarehouseAccess(req, existing.warehouseId, "canOutward");
    if (!isDispatchedStatus(existing.status)) {
      return res.status(409).json({ message: "Receiving details can be added only after the entry is dispatched" });
    }

    const problem = validateReceiving(data, existing.refDocDate || existing.dispatchedAt);
    if (problem) return res.status(422).json({ message: problem });

    // Receiving documents (copy / photo / other) are optional.
    const lower = (v) => String(v || "").trim().toLowerCase();

    const snapshot = {
      receivedDate: new Date(data.receivedDate),
      receiverName: String(data.receiverName).trim(),
      receiverContact: String(data.receiverContact ?? "").trim(),
      receivingRemarks: data.receivingRemarks?.trim() || null,
    };
    const isFirstTime = !existing.receivedAt && !existing.receivedDate;
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
    const changes = isFirstTime
      ? []
      : diffFields(
          { ...existing, receivedDate: day(existing.receivedDate) },
          { ...snapshot, receivedDate: day(snapshot.receivedDate) },
          ["receivedDate", "receiverName", "receiverContact", "receivingRemarks"]
        );

    const uploaded = files.length ? await storeOutwardFiles(files, categories, existing.outwardNumber) : [];
    let replaced = [];
    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.min.updateMany({
          where: { id, status: { in: DISPATCHED_STATUSES } },
          data: {
            ...snapshot,
            status: STATUS.DELIVERED,
            ...(isFirstTime ? { receivedById: req.user.id, receivedByName: req.user.name, receivedAt: new Date() } : {}),
          },
        });
        if (!count) throw httpError(409, "Receiving details can be added only after the entry is dispatched");

        if (uploaded.length) {
          // A new file for a document that already exists replaces it.
          const names = new Set(uploaded.map((u) => u.docCategory.trim().toLowerCase()));
          replaced = savedDocs.filter((d) => names.has(lower(d.docCategory)));
          if (replaced.length) await tx.document.deleteMany({ where: { id: { in: replaced.map((d) => d.id) } } });
          await tx.document.createMany({
            data: uploaded.map((u) => ({
              linkedType: "outward", linkedId: id, docCategory: u.docCategory,
              fileKey: u.fileKey, fileType: u.fileType, fileSize: u.fileSize, uploadedById: req.user.id,
            })),
          });
        }
      });
    } catch (txError) {
      if (uploaded.length) await supabase.storage.from(SUPABASE_BUCKET).remove(uploaded.map((u) => u.fileKey)).catch(() => {});
      throw txError;
    }
    if (replaced.length) {
      const { error: cleanupError } = await supabase.storage.from(SUPABASE_BUCKET).remove(replaced.map((d) => d.fileKey));
      if (cleanupError) console.error("Old receiving document cleanup failed:", cleanupError.message);
    }

    const base = { entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber, userId: req.user.id, warehouseId: existing.warehouseId };
    const entries = isFirstTime
      ? [{ ...base, action: "RECEIVED", description: `Delivered - received by ${snapshot.receiverName} on ${day(snapshot.receivedDate)}` }]
      : changes.map((c) => ({ ...base, action: "UPDATED", description: `${c.label} updated from "${c.oldValue || "—"}" to "${c.newValue || "—"}"`, changes: c }));
    for (const u of uploaded) {
      entries.push({ ...base, action: "DOCUMENT_ADDED", description: `Document added: ${u.docCategory} (${u.fileName})`, changes: { docCategory: u.docCategory, fileName: u.fileName } });
    }
    if (entries.length) recordAuditLogs(prisma, entries).catch((err) => console.error("Audit log (receiving) failed:", err));

    // The screen goes straight back to the list, so there is no need to re-read and rebuild the whole entry.
    return res.json({ message: "Receiving details saved", data: { id, workflowStatus: STATUS.DELIVERED } });
  } catch (error) {
    console.error("Save receiving error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save receiving details" });
  }
}

// ---------------------------------------------------------------------------
// ACCOUNT DOCUMENTS  (Account, Super admin) - until the entry is dispatched
// Account's own reference documents (Invoice / E-way Bill / DC Challan / Other) and files (invoice, e-way bill, other).
// Only the account-owned reference rows are replaced; the warehouse manager's rows stay as they are.
// Same request shape as dispatch: JSON, or multipart (payload + files + categories).
// ---------------------------------------------------------------------------
export async function saveAccountDocuments(req, res) {
  try {
    const { id } = req.params;
    let data = req.body || {};
    let categories = [];
    if (typeof data.payload === "string") {
      try {
        categories = JSON.parse(data.categories || "[]");
        data = JSON.parse(data.payload);
      } catch {
        return res.status(422).json({ message: "Invalid document data" });
      }
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length && files.length !== categories.length) return res.status(422).json({ message: "Each document needs a name" });
    if (categories.some((c) => !isAccountDocCategory(c))) {
      return res.status(422).json({ message: "Account can only add invoice, e-way bill and other account documents" });
    }

    const rawRefs = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];
    const refs = [];
    for (const r of rawRefs) {
      if (!r || !(String(r.refDocNumber || "").trim() || String(r.ewayBillNumber || "").trim())) continue;
      const type = canonicalAccountRefType(r.refDocType);
      if (!type) return res.status(422).json({ message: "Account reference documents can only be Invoice, E-way Bill, DC Challan or Other" });
      const eway = String(r.ewayBillNumber || "").trim();
      refs.push({
        refDocType: type,
        refDocNumber: String(r.refDocNumber || "").trim() || eway,
        ewayBillNumber: eway || null,
        // Only a DC Challan carries a vehicle number.
        // Only a DC Challan carries a vehicle number; it defaults to the one from the transportation form.
        vehicleNumber: type === "DC Challan" ? String(r.vehicleNumber || "").trim() || "__TRANSPORT__" : null,
      });
    }

    const existing = await prisma.min.findUnique({
      where: { id },
      select: { id: true, warehouseId: true, directDispatch: true, companyId: true, outwardNumber: true, status: true, createdById: true, piAmount: true, vehicleNumber: true, transportSubmittedAt: true },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });
    await assertEntryVisible(req, existing);
    // Account can add documents only after approval AND after the warehouse manager has submitted the vehicle /
    // transportation details.
    const blocked = accountDocsBlock(existing);
    if (blocked) return res.status(409).json({ message: blocked });
    for (const r of refs) if (r.vehicleNumber === "__TRANSPORT__") r.vehicleNumber = existing.vehicleNumber || null;

    // Once any document is there, the entry is shared with the warehouse manager.
    // Above Rs. 1,00,000 the e-way bill document must be there first.
    const savedDocs = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { docCategory: true } });
    const lowerCat = (v) => String(v || "").trim().toLowerCase();
    const incoming = new Set(categories.map(lowerCat));
    const resulting = [...savedDocs.filter((d) => !incoming.has(lowerCat(d.docCategory))), ...categories.map((c) => ({ docCategory: c }))];
    const savedRefs = await prisma.minReferenceDocument.findMany({ where: { minId: id }, select: { refDocType: true } });
    const wasShared = hasReleaseDocument(savedDocs, savedRefs);
    // Dispatch directly: documents and reference numbers are optional - Account can submit with nothing attached.
    // Account's reference rows are replaced by the ones in this request; the manager's rows stay.
    const resultingRefs = [...savedRefs.filter((r) => !isAccountRefType(r.refDocType)), ...refs];
    const willShare = hasReleaseDocument(resulting, resultingRefs);

    const uploaded = files.length ? await storeOutwardFiles(files, categories, existing.outwardNumber) : [];
    let replaced = [];
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.min.findFirst({ where: { id, status: { in: ACCOUNT_DOC_STATUSES }, ...(existing.directDispatch ? {} : { transportSubmittedAt: { not: null } }) }, select: { id: true } });
        if (!current) throw httpError(409, "This entry was just updated by someone else");

        await tx.min.update({
          where: { id },
          data: { referenceDocuments: { deleteMany: { refDocType: { in: ACCOUNT_REF_TYPES } }, create: refs } },
        });

        if (uploaded.length) {
          // A new file for a document that already exists replaces it.
          const names = new Set(uploaded.map((u) => u.docCategory.trim().toLowerCase()));
          const old = await tx.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { id: true, fileKey: true, docCategory: true } });
          replaced = old.filter((d) => names.has(String(d.docCategory || "").trim().toLowerCase()));
          if (replaced.length) await tx.document.deleteMany({ where: { id: { in: replaced.map((d) => d.id) } } });
          await tx.document.createMany({
            data: uploaded.map((u) => ({
              linkedType: "outward", linkedId: id, docCategory: u.docCategory,
              fileKey: u.fileKey, fileType: u.fileType, fileSize: u.fileSize, uploadedById: req.user.id,
            })),
          });
        }
        if (existing.directDispatch) {
          // Dispatch directly: the documents complete the entry - it is delivered, no warehouse step.
          await tx.min.updateMany({ where: { id, status: { in: APPROVED_STATUSES } }, data: { status: STATUS.DELIVERED } });
        } else {
          // Account pressed Submit / Save: the entry is released to the warehouse manager (documents are optional).
          await tx.min.updateMany({ where: { id, status: { in: APPROVED_STATUSES } }, data: { status: STATUS.READY_FOR_DISPATCH } });
        }
      });
    } catch (txError) {
      if (uploaded.length) await supabase.storage.from(SUPABASE_BUCKET).remove(uploaded.map((u) => u.fileKey)).catch(() => {});
      throw txError;
    }
    if (replaced.length) {
      const { error: cleanupError } = await supabase.storage.from(SUPABASE_BUCKET).remove(replaced.map((d) => d.fileKey));
      if (cleanupError) console.error("Old document cleanup failed:", cleanupError.message);
    }

    const base = { entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber, userId: req.user.id, warehouseId: existing.warehouseId };
    const entries = [{ ...base, action: "UPDATED", description: `Account reference documents saved (${refs.length})` }];
    if (existing.directDispatch) entries.push({ ...base, action: "UPDATED", description: "Documents uploaded by Account - delivered directly (no warehouse)" });
    else if (existing.status !== STATUS.READY_FOR_DISPATCH) entries.push({ ...base, action: "UPDATED", description: "Account submitted - dispatch form opened for the warehouse manager" });
    for (const u of uploaded) {
      const isInvoice = isInvoiceDocCategory(u.docCategory);
      entries.push({ ...base, action: isInvoice ? "INVOICE_CREATED" : "DOCUMENT_ADDED", description: isInvoice ? `Invoice created by ${req.user.name}` : `Document added: ${u.docCategory} (${u.fileName})`, changes: { docCategory: u.docCategory, fileName: u.fileName } });
    }
    recordAuditLogs(prisma, entries).catch((err) => console.error("Audit log (account documents) failed:", err));

    const [result, documents] = await Promise.all([
      prisma.min.findUnique({
        where: { id },
        include: {
          items: true,
          referenceDocuments: true,
          createdBy: { select: { name: true, email: true, role: true } },
          warehouse: { select: { id: true, name: true, code: true, companyId: true, Inward: true, Outward: true, company: { select: { name: true, status: true } } } },
        },
      }),
      prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, orderBy: { uploadedAt: "desc" } }),
    ]);
    return res.json({ message: existing.directDispatch ? "Documents saved. This entry is now delivered directly." : "Documents saved", data: finishFor(req, result, documents) });
  } catch (error) {
    console.error("Save account documents error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to save documents" });
  }
}

// ---------------------------------------------------------------------------
// DELETE  (Super admin only, and only after the entry has been dispatched)
// Removes the entry, its items, reference documents and uploaded files.
// Stock is calculated from the entries, so the quantities return to stock.
// ---------------------------------------------------------------------------
export async function deleteOutward(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.min.findUnique({
      where: { id },
      select: { id: true, outwardNumber: true, warehouseId: true, status: true, piFileKey: true, items: { select: { proofFileKey: true } } },
    });
    if (!existing) return res.status(404).json({ message: "Outward entry not found" });
    if (!isDispatchedStatus(existing.status)) {
      return res.status(409).json({ message: "Only a dispatched outward entry can be deleted" });
    }

    const documents = await prisma.document.findMany({ where: { linkedType: "outward", linkedId: id }, select: { id: true, fileKey: true } });
    const fileKeys = [...documents.map((d) => d.fileKey), ...existing.items.map((i) => i.proofFileKey), existing.piFileKey].filter(Boolean);
    if (fileKeys.length) {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(fileKeys);
      if (error) return res.status(500).json({ message: "Failed to delete files from storage.", error: error.message });
    }

    await prisma.$transaction(async (tx) => {
      await tx.document.deleteMany({ where: { linkedType: "outward", linkedId: id } });
      await tx.min.update({ where: { id }, data: { items: { deleteMany: {} }, referenceDocuments: { deleteMany: {} } } });
      await tx.min.delete({ where: { id } });
    });

    await recordAuditLog(prisma, {
      entityType: "OUTWARD", entityId: id, entityNumber: existing.outwardNumber,
      action: "DELETED", description: `Outward entry ${existing.outwardNumber} deleted by ${req.user.name}`,
      userId: req.user.id, warehouseId: existing.warehouseId,
    });
    return res.json({ message: "Outward entry deleted" });
  } catch (error) {
    console.error("Delete outward error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to delete outward entry" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/outward/:id/items/:itemId/proof   (Sales, Account, Super admin only)
// ---------------------------------------------------------------------------
export async function downloadItemProof(req, res) {
  try {
    const item = await prisma.minItem.findUnique({
      where: { id: req.params.itemId },
      select: { id: true, minId: true, proofFileKey: true, proofFileName: true, min: { select: { id: true, warehouseId: true, directDispatch: true, companyId: true, createdById: true, status: true } } },
    });
    if (!item || item.minId !== req.params.id || !item.proofFileKey) return res.status(404).json({ message: "No proof file for this item" });
    await assertEntryVisible(req, item.min);

    const asDownload = req.query.download === "1" || req.query.download === "true";
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(item.proofFileKey, 60 * 5, asDownload ? { download: item.proofFileName || item.proofFileKey.split("/").pop() || "payment" } : undefined);
    if (error) return res.status(500).json({ message: "Failed to create download link.", error: error.message });
    return res.json({ data: { url: data.signedUrl } });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Failed to download proof" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/outward/:id/pi-file   (Sales, Account, Warehouse manager, Super admin)
// ---------------------------------------------------------------------------
export async function downloadPiFile(req, res) {
  try {
    const min = await prisma.min.findUnique({
      where: { id: req.params.id },
      select: { id: true, outwardNumber: true, warehouseId: true, directDispatch: true, companyId: true, createdById: true, status: true, piFileKey: true, piFileName: true },
    });
    if (!min || !min.piFileKey) return res.status(404).json({ message: "No PI file for this entry" });
    await assertEntryVisible(req, min);

    const asDownload = req.query.download === "1" || req.query.download === "true";
    const base = min.piFileKey.split("/").pop();
    // A new entry's PI waits in uploads/<id>/ and is moved to min/<outward number>/ right after the entry is created
    // (in the background), so the file can be in either place - try the saved key first, then the other folder.
    const candidates = [...new Set([
      min.piFileKey,
      `${outwardFolder(min.outwardNumber)}${base}`,
      `${tempProofFolder(min.id)}${base}`,
    ])];

    let lastError = null;
    for (const key of candidates) {
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .createSignedUrl(key, 60 * 5, asDownload ? { download: min.piFileName || "PI" } : undefined);
      if (!error && data?.signedUrl) {
        // The file was found somewhere other than the saved key: fix the saved key so the next open is direct.
        if (key !== min.piFileKey) prisma.min.update({ where: { id: min.id }, data: { piFileKey: key } }).catch(() => {});
        return res.json({ data: { url: data.signedUrl } });
      }
      lastError = error;
    }
    console.error("PI file not found in storage:", candidates, lastError?.message);
    return res.status(404).json({ message: "The PI file could not be found in storage. Please attach the PI file again.", error: lastError?.message });
  } catch (error) {
    console.error("DOWNLOAD PI FILE ERROR:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to download PI file" });
  }
}

// ---------------------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------------------
// Optional ?from= / ?to= (ISO timestamps) -> createdAt filter for the history feed. The browser sends its own
// local day boundaries, so "today" / "yesterday" are correct for the user's time zone.
function historyDateFilter(from, to) {
  const range = {};
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  if (f && !Number.isNaN(f.getTime())) range.gte = f;
  if (t && !Number.isNaN(t.getTime())) range.lte = t;
  return Object.keys(range).length ? { createdAt: range } : {};
}

export async function listOutwardHistory(req, res) {
  try {
    const { warehouseId, search = "", page = "1", pageSize = "20", from, to } = req.query;
    const scopedWarehouseIds = await getScopedWarehouseIds(req);

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const isWarehouse = req.user.role === "WAREHOUSE_MANAGER";

    // Sales sees the trail of every entry of their company; a warehouse manager only
    // the entries that reached the warehouse, minus the PI / payment / approval lines.
    let entityFilter = {};
    if (req.user.role === "SALES" || isWarehouse) {
      const mins = await prisma.min.findMany({
        where: { AND: [roleWhere(req), await entryScopeWhere(req)] },
        select: { id: true },
      });
      entityFilter = { entityId: { in: mins.map((m) => m.id) } };
    }

    // "Dispatch directly" entries have no warehouse, so their trail is found through the entry ids instead.
    let directIds = [];
    if (isFinanceSide(req.user.role)) {
      const directMins = await prisma.min.findMany({ where: { AND: [await entryScopeWhere(req), { directDispatch: true }] }, select: { id: true } });
      directIds = directMins.map((m) => m.id);
    }

    const where = {
      entityType: "OUTWARD",
      AND: [
        scopedWarehouseIds
          ? { OR: [{ warehouseId: { in: scopedWarehouseIds } }, ...(directIds.length ? [{ entityId: { in: directIds } }] : [])] }
          : {},
        warehouseId === "DIRECT" ? { entityId: { in: directIds } } : warehouseId ? { warehouseId } : {},
        entityFilter,
        isWarehouse ? { action: { notIn: HIDDEN_FROM_WAREHOUSE_ACTIONS } } : {},
        search ? { entityNumber: { contains: search, mode: "insensitive" } } : {},
        historyDateFilter(from, to),
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
        include: { user: { select: { name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Raw change payloads are not needed to render the feed; drop them for the warehouse.
    const data = isWarehouse ? rows.map(({ changes, ...r }) => r) : rows;

    return res.json({ data, pagination: { page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) } });
  } catch (error) {
    console.error("List outward history error:", error);
    return res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
}
