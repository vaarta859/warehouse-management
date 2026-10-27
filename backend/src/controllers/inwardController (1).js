import prisma from "../config/prisma.js";
import { recordAuditLog, diffFields, diffItems, describeItem } from "../utils/auditLog.js";
import { findUnknownProducts, unknownProductsMessage, withSerialModes } from "../utils/productCatalog.js";
import { isFinanceSide, getFinanceWarehouseIds, getUserCompanyIds } from "../utils/outwardWorkflow.js";
import { getWarehouseCompanies, allCompaniesInactive } from "../utils/warehouseCompanies.js";

// The company picked on the inward form must be one of the warehouse's linked
// companies, still Active, and (unless Super Admin) one the user belongs to.
// Returns an error message, or null when the choice is fine.
async function checkInwardCompany(user, warehouseCompanies, companyId) {
  const chosen = warehouseCompanies.find((c) => c.id === companyId);
  if (!companyId || !chosen) return "Selected company is not linked with this warehouse.";
  if (chosen.status === "Inactive") return "The selected company is inactive.";
  if (user.role !== "SUPER_ADMIN" && !(await getUserCompanyIds(user)).includes(companyId)) {
    return "You don't belong to the selected company.";
  }
  return null;
}
import { cleanSerials } from "../utils/serials.js";
import { validateInwardSerials, replaceGrnSerials, pruneGrnSerials, findInwardSerialProblem } from "../utils/inwardSerials.js";
 
/**
 * =========================================================
 * REQUIRED GRN DOCUMENTS
 * =========================================================
 */
 
const REQUIRED_DOCUMENTS = [
  "Vendor invoice",
  "E-way bill",
  "Unloading sign-off sheet",
];
 
const META_PREFIX = "__INWARD_META__";
 
function buildStoredRemarks(companyName, documentNumbers, remarks) {
  const meta = JSON.stringify({ companyName: companyName || "", documentNumbers: Array.isArray(documentNumbers) ? documentNumbers : [] });
  return `${META_PREFIX}${meta}\n${remarks || ""}`;
}
 
function parseStoredRemarks(value) {
  const text = String(value || "");
  if (!text.startsWith(META_PREFIX)) return { companyName: "", documentNumbers: [], remarks: text };
  const newline = text.indexOf("\n");
  try {
    const meta = JSON.parse(text.slice(META_PREFIX.length, newline < 0 ? undefined : newline));
    return { companyName: meta.companyName || "", documentNumbers: Array.isArray(meta.documentNumbers) ? meta.documentNumbers : [], remarks: newline < 0 ? "" : text.slice(newline + 1) };
  } catch {
    return { companyName: "", documentNumbers: [], remarks: text };
  }
}
 
/**
 * =========================================================
 * HELPER
 * =========================================================
 *
 * Calculates document status for a GRN.
 *
 * 0 documents
 * -> Pending
 * -> 3 documents pending
 *
 * 1 document
 * -> Pending
 * -> 2 documents pending
 *
 * 2 documents
 * -> Pending
 * -> 1 document pending
 *
 * 3 documents
 * -> Complete
 * -> 0 documents pending
 */
 
function calculateDocumentStatus(documents = []) {
  const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const pendingDocuments = REQUIRED_DOCUMENTS.filter((requiredDocument) => {
    const required = requiredDocument.toLowerCase();
    return !uploadedCategories.some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
  }).length;
 
  const uploadedDocuments =
    REQUIRED_DOCUMENTS.length -
    pendingDocuments;
 
  const status =
    pendingDocuments === 0
      ? "Complete"
      : "Pending";
 
  return {
    status,
 
    pendingDocuments,
 
    uploadedDocuments,
 
    requiredDocuments:
      REQUIRED_DOCUMENTS.length,
  };
}
 
/**
 * =========================================================
 * GET /api/grn
 * =========================================================
 *
 * List GRNs with:
 * - items
 * - documents
 * - createdBy
 * - document status
 * - pagination
 * - search
 * - type filter
 * - date filter
 *
 * =========================================================
 */
 
export async function listGrn(req, res) {
  try {
    const {
      search = "",
      type,
      dateFrom,
      dateTo,
      warehouseId,
      page = "1",
      pageSize = "20",
    } = req.query;
 
    // =====================================================
    // SCOPE BY ROLE / WAREHOUSE
    // (previously this endpoint returned every GRN in the system to
    // any authenticated user — a warehouse manager could browse other
    // companies' inward entries. Scope it the same way warehouses
    // themselves are scoped.)
    // =====================================================
 
    let scopedWarehouseIds = null;
 
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const grants = await prisma.warehouseAccess.findMany({
        where: { userId: req.user.id, accessLevel: "MANAGE" },
        select: { warehouseId: true },
      });
      scopedWarehouseIds = grants.map((g) => g.warehouseId);
    } else if (isFinanceSide(req.user.role)) {
      // Sales / Account: view-only, limited to their companies' warehouses.
      scopedWarehouseIds = await getFinanceWarehouseIds(req.user);
    }
    // SUPER_ADMIN: no scoping — sees everything (optionally filtered
    // by ?warehouseId= below like everyone else).
 
    // =====================================================
    // PAGINATION
    // =====================================================
 
    const pageNum = Math.max(
      parseInt(page, 10) || 1,
      1
    );
 
    const pageSizeNum = Math.min(
      Math.max(
        parseInt(pageSize, 10) || 20,
        1
      ),
      100
    );
 
    // =====================================================
    // BUILD WHERE
    // =====================================================
 
    const where = {
      AND: [
        // -------------------------------------------------
        // WAREHOUSE SCOPE
        // -------------------------------------------------
 
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
 
        warehouseId ? { warehouseId } : {},
 
        // -------------------------------------------------
        // SEARCH
        // -------------------------------------------------
 
        search
          ? {
              OR: [
                {
                  grnNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
 
                {
                  supplierName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
 
                {
                  companyName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
 
                {
                  refDocNumber: {
                    contains: search,
                    mode: "insensitive",
                  },
                },

                { items: { some: { sku: { contains: search, mode: "insensitive" } } } },

                { items: { some: { category: { contains: search, mode: "insensitive" } } } },

                { serials: { some: { serialNo: { contains: search, mode: "insensitive" } } } },
              ],
            }
          : {},
 
        // -------------------------------------------------
        // INWARD TYPE FILTER
        // -------------------------------------------------
 
        type
          ? {
              inwardType: type,
            }
          : {},
 
        // -------------------------------------------------
        // DATE FILTER
        // -------------------------------------------------
 
        dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom
                  ? {
                      gte: new Date(
                        dateFrom
                      ),
                    }
                  : {}),
 
                ...(dateTo
                  ? {
                      // dateTo arrives as a plain "YYYY-MM-DD" date with no
                      // time, which Date() parses as that day's midnight UTC.
                      // A GRN created any time later that same day would then
                      // be > the "lte" bound and get filtered out - which is
                      // why a just-created GRN wouldn't show up under
                      // "Today" / "Last 7 days" on the list page. Extend the
                      // bound to the end of that day instead.
                      lte: new Date(
                        `${dateTo}T23:59:59.999`
                      ),
                    }
                  : {}),
              },
            }
          : {},
      ],
    };
 
    // =====================================================
    // GET GRNS + TOTAL
    // =====================================================
 
    const [rows, total] =
      await Promise.all([
        prisma.grn.findMany({
          where,
 
          include: {
            items: true,
            referenceDocuments: true,
 
            createdBy: {
              select: {
                name: true,
              },
            },
 
            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                company: { select: { name: true } },
              },
            },
          },
 
          orderBy: {
            createdAt: "desc",
          },
 
          skip:
            (pageNum - 1) *
            pageSizeNum,
 
          take: pageSizeNum,
        }),
 
        prisma.grn.count({
          where,
        }),
      ]);
 
    // =====================================================
    // GET GRN IDS
    // =====================================================
 
    const grnIds = rows.map(
      (grn) => grn.id
    );
 
    // =====================================================
    // GET DOCUMENTS
    // =====================================================
 
    let documents = [];
 
    if (grnIds.length > 0) {
      documents =
        await prisma.document.findMany({
          where: {
            linkedType: "grn",
 
            linkedId: {
              in: grnIds,
            },
          },
 
          orderBy: {
            uploadedAt: "desc",
          },
        });
    }
 
    // =====================================================
    // ATTACH DOCUMENTS + STATUS
    // =====================================================
 
    const rowsWithDocuments =
      rows.map((grn) => {
        // -------------------------------------------------
        // Documents belonging to this GRN
        // -------------------------------------------------
 
        const grnDocuments =
          documents.filter(
            (doc) =>
              doc.linkedId === grn.id
          );
 
        // -------------------------------------------------
        // Calculate document status
        // -------------------------------------------------
 
        const statusData =
          calculateDocumentStatus(
            grnDocuments
          );
 
        // -------------------------------------------------
        // Return GRN
        // -------------------------------------------------
 
        return {
          ...grn,
          companyName: grn.companyName || grn.warehouse?.company?.name || "",
          documents:
            grnDocuments,
 
          status:
            statusData.status,
 
          pendingDocuments:
            statusData.pendingDocuments,
 
          uploadedDocuments:
            statusData.uploadedDocuments,
 
          requiredDocuments:
            statusData.requiredDocuments,
        };
      });
 
    // =====================================================
    // RESPONSE
    // =====================================================
 
    return res.json({
      data: rowsWithDocuments,
 
      pagination: {
        page: pageNum,
 
        pageSize:
          pageSizeNum,
 
        total,
 
        totalPages:
          Math.ceil(
            total /
              pageSizeNum
          ),
      },
    });
  } catch (error) {
    console.error(
      "List GRN error:"
    );
 
    console.error(error);
 
    return res.status(500).json({
      message:
        "Failed to fetch GRNs",
 
      error:
        error.message,
    });
  }
}
 
/** GET /api/grn/summary - KPI card numbers without downloading full entries. */
export async function getGrnSummary(req, res) {
  try {
    const { warehouseId, todayFrom } = req.query;

    let scopedWarehouseIds = null;
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const grants = await prisma.warehouseAccess.findMany({
        where: { userId: req.user.id, accessLevel: "MANAGE" },
        select: { warehouseId: true },
      });
      scopedWarehouseIds = grants.map((g) => g.warehouseId);
    } else if (isFinanceSide(req.user.role)) {
      scopedWarehouseIds = await getFinanceWarehouseIds(req.user);
    }

    const where = {
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
      ],
    };

    const todayDate = todayFrom ? new Date(todayFrom) : null;
    const validToday = todayDate && !Number.isNaN(todayDate.getTime());
    const [total, todays, latest] = await Promise.all([
      prisma.grn.count({ where }),
      validToday ? prisma.grn.count({ where: { AND: [where, { createdAt: { gte: todayDate } }] } }) : Promise.resolve(0),
      // Same sample the cards always used: the 100 newest entries - but only their ids.
      prisma.grn.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);

    const ids = latest.map((g) => g.id);
    const docs = ids.length
      ? await prisma.document.findMany({ where: { linkedType: "grn", linkedId: { in: ids } }, select: { linkedId: true, docCategory: true } })
      : [];
    const byGrn = new Map(ids.map((id) => [id, []]));
    for (const d of docs) byGrn.get(d.linkedId)?.push(d);

    let documentsPending = 0;
    let completed = 0;
    for (const list of byGrn.values()) {
      const s = calculateDocumentStatus(list);
      documentsPending += s.pendingDocuments;
      if (s.status === "Complete") completed += 1;
    }

    return res.json({ data: { total, todaysInward: todays, documentsPending, completed } });
  } catch (error) {
    console.error("GRN summary error:", error);
    return res.status(500).json({ message: "Failed to fetch summary", error: error.message });
  }
}

/**
 * =========================================================
 * GET /api/grn/:id
 * =========================================================
 *
 * Get one GRN with:
 * - items
 * - documents
 * - createdBy
 * - document status
 *
 * =========================================================
 */
 
export async function getGrnById(req, res) {
  try {
    const { id } = req.params;
 
    // =====================================================
    // GET GRN
    // =====================================================
 
    const grn =
      await prisma.grn.findUnique({
        where: {
          id,
        },
 
        include: {
          items: true,
          serials: { orderBy: { createdAt: "asc" } },
          referenceDocuments: true,
 
          createdBy: {
            select: {
              name: true,
              role: true,
            },
          },
 
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
              companyId: true,
              Inward: true,
              Outward: true,
              company: { select: { name: true, status: true } },
            },
          },
        },
      });
 
    // =====================================================
    // CHECK GRN
    // =====================================================
 
    if (!grn) {
      return res.status(404).json({
        message:
          "GRN not found",
      });
    }
 
    // =====================================================
    // SCOPE CHECK — same warehouse scoping as listGrn
    // =====================================================
 
 
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: {
          userId_warehouseId: { userId: req.user.id, warehouseId: grn.warehouseId },
        },
      });
      if (!access || access.accessLevel !== "MANAGE") {
        return res.status(403).json({ message: "You don't have access to this GRN's warehouse" });
      }
    }
    if (isFinanceSide(req.user.role)) {
      const allowed = await getFinanceWarehouseIds(req.user);
      if (!allowed.includes(grn.warehouseId)) {
        return res.status(403).json({ message: "You don't have access to this GRN's warehouse" });
      }
    }
 
    // =====================================================
    // GET DOCUMENTS
    // =====================================================
 
    const documents =
      await prisma.document.findMany({
        where: {
          linkedType: "grn",
 
          linkedId: grn.id,
        },
 
        orderBy: {
          uploadedAt: "desc",
        },
      });
 
    // =====================================================
    // CALCULATE STATUS
    // =====================================================
 
    const statusData =
      calculateDocumentStatus(
        documents
      );
 
    // =====================================================
    // RESPONSE
    // =====================================================
 
    return res.json({
      data: {
        ...grn,
        companyName: grn.companyName || grn.warehouse?.company?.name || "",
        documents,
 
        status:
          statusData.status,
 
        pendingDocuments:
          statusData.pendingDocuments,
 
        uploadedDocuments:
          statusData.uploadedDocuments,
 
        requiredDocuments:
          statusData.requiredDocuments,
      },
    });
  } catch (error) {
    console.error(
      "Get GRN error:"
    );
 
    console.error(error);
 
    return res.status(500).json({
      message:
        "Failed to fetch GRN",
 
      error:
        error.message,
    });
  }
}
 
/**
 * =========================================================
 * POST /api/grn
 * =========================================================
 *
 * Create GRN.
 *
 * Documents are OPTIONAL.
 *
 * If no documents are provided:
 *
 * documents = []
 *
 * GRN is still created.
 *
 * =========================================================
 */
 
 
export async function updateGrn(req, res) {
  try {
    const { id } = req.params;
    const data = req.body;
    const items = Array.isArray(data.items) ? data.items : [];
    const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];
 
    const existing = await prisma.grn.findUnique({
      where: { id },
      select: {
        id: true, warehouseId: true, grnNumber: true,
        inwardType: true, supplierName: true, companyName: true,
        refDocType: true, refDocNumber: true, remarks: true,
        items: { select: { category: true, sku: true, companyName: true, quantity: true, uom: true } },
        _count: { select: { serials: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: "GRN not found" });
 
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: existing.warehouseId },
      select: { id: true, companyId: true, Inward: true },
    });
    if (!warehouse) return res.status(404).json({ message: "Warehouse not found" });
    const warehouseCompanies = await getWarehouseCompanies(warehouse.id);
    if (allCompaniesInactive(warehouseCompanies) || warehouse.Inward !== "Active") {
      return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
    }
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({
        where: { userId_warehouseId: { userId: req.user.id, warehouseId: existing.warehouseId } },
      });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) {
        return res.status(403).json({ message: "You don't have permission to update this inward entry." });
      }
    }
 
    if (!data.inwardType || !data.supplierName?.trim() || !data.companyName?.trim()) {
      return res.status(422).json({ message: "Inward type, supplier and company name are required." });
    }
    const companyError = await checkInwardCompany(req.user, warehouseCompanies, data.companyId);
    if (companyError) return res.status(400).json({ message: companyError });
    if (!items.length) return res.status(422).json({ message: "At least one item is required." });
    for (const item of items) {
      if (!item.category || !item.sku?.trim() || Number(item.quantity) <= 0 || !item.uom) {
        return res.status(422).json({ message: "Every item must have category, model, quantity and UOM." });
      }
    }
 
    // Items new to this entry must exist in the product master
    // (items it already had are allowed even if the product was deleted since).
    const unknownItems = await findUnknownProducts(items, existing.items);
    if (unknownItems.length) {
      return res.status(422).json({ message: unknownProductsMessage(unknownItems) });
    }
 
    const normalizedRefs = references
      .filter((r) => r && r.refDocNumber)
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber).trim(),
      }));

    // Reference documents are optional: with none entered, an empty reference is stored.
    const firstRef = normalizedRefs[0] || { refDocType: "Other", refDocNumber: "" };

    // Snapshot the "new" values in the same shape as `existing` so we can
    // diff them below, both for top-level fields and for the item list.
    const newSnapshot = {
      inwardType: data.inwardType,
      supplierName: data.supplierName.trim(),
      companyName: data.companyName.trim(),
      refDocType: firstRef.refDocType,
      refDocNumber: firstRef.refDocNumber,
      remarks: data.remarks?.trim() || null,
    };
    const newItems = items.map((item) => ({
      category: item.category, sku: item.sku.trim(),
      quantity: Number(item.quantity), uom: item.uom,
      companyName: item.companyName ? String(item.companyName).trim() || null : null,
    }));
    // Serial numbers: when the client sends them they replace the saved ones; otherwise the saved ones are kept
    // (and trimmed if the items changed).
    const serialsProvided = Array.isArray(data.serials);
    const serials = cleanSerials(data.serials);
    // Each product's serial rule (Required / Not required / Optional) decides which items take serial numbers.
    const serialItems = await withSerialModes(prisma, newItems);
    // Same rule as when creating: a Required item must have all its serial numbers, also when updating.
    // (Not sent = the form did not include them, which only passes when no item needs serial numbers.)
    {
      const serialProblem = validateInwardSerials(serialItems, serialsProvided ? serials : []);
      if (serialProblem) return res.status(422).json({ message: serialProblem });
      // A serial that is already in stock (not dispatched since it came in) cannot be received again.
      if (serialsProvided) {
        const inStock = await findInwardSerialProblem(prisma, { grnId: id, serials });
        if (inStock) return res.status(422).json({ message: inStock });
      }
    }
    const fieldChanges = diffFields(existing, newSnapshot, [
      "inwardType", "supplierName", "companyName", "refDocType", "refDocNumber", "remarks",
    ]);
    const itemChanges = diffItems(existing.items, newItems);
 
    const result = await prisma.$transaction(async (tx) => {
      await tx.grn.update({
        where: { id },
        data: {
          inwardType: data.inwardType,
          supplierName: data.supplierName.trim(),
          companyName: data.companyName.trim(),
          refDocType: firstRef.refDocType,
          refDocNumber: firstRef.refDocNumber,
          refDocDate: data.refDocDate ? new Date(data.refDocDate) : new Date(),
          remarks: data.remarks?.trim() || null,
          items: {
            deleteMany: {},
            create: newItems,
          },
          referenceDocuments: {
            deleteMany: {},
            create: normalizedRefs,
          },
        },
      });
 
      let serialsChanged = false;
      if (serialsProvided) {
        await replaceGrnSerials(tx, id, serials);
        serialsChanged = serials.length !== existing._count.serials;
      } else {
        serialsChanged = (await pruneGrnSerials(tx, id, serialItems)) > 0;
      }

      // -------------------------------------------------
      // AUDIT TRAIL
      // -------------------------------------------------
      const auditBase = {
        entityType: "INWARD",
        entityId: id,
        entityNumber: existing.grnNumber,
        userId: req.user.id,
        warehouseId: existing.warehouseId,
      };
      if (serialsChanged) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "SERIALS_UPDATED",
          description: serialsProvided ? `Serial numbers saved: ${serials.length}` : "Serial numbers removed because the items changed",
          changes: { count: serials.length },
        });
      }
      for (const change of fieldChanges) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "UPDATED",
          description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`,
          changes: change,
        });
      }
      for (const item of itemChanges.added) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_ADDED",
          description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const item of itemChanges.removed) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_REMOVED",
          description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
          changes: item,
        });
      }
      for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "ITEM_UPDATED",
          description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`,
          changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity },
        });
      }
      if (!serialsChanged && !fieldChanges.length && !itemChanges.added.length && !itemChanges.removed.length && !itemChanges.updated.length) {
        await recordAuditLog(tx, {
          ...auditBase,
          action: "UPDATED",
          description: "Inward entry saved with no field changes",
        });
      }
 
      return tx.grn.findUnique({ where: { id }, include: { items: true, serials: { orderBy: { createdAt: "asc" } }, referenceDocuments: true } });
    });
    return res.json({ message: "Inward entry updated successfully", data: result });
  } catch (error) {
    console.error("Update GRN error:", error);
    return res.status(error.status || 500).json({ message: error.message || "Failed to update GRN" });
  }
}
 
export async function createGrn(req, res) {
  try {
    // =====================================================
    // REQUEST DATA
    // =====================================================
 
    const data = req.body;
 
    // =====================================================
    // BASIC DEFAULTS
    // =====================================================
 
    const items =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];
 
    const documents =
      Array.isArray(
        data.documents
      )
        ? data.documents
        : [];
 
    // =====================================================
    // BASIC REQUIRED FIELD VALIDATION
    // =====================================================
 
    if (!data.warehouseId) {
      return res.status(422).json({
        message:
          "warehouseId is required",
      });
    }
 
    if (!data.inwardType) {
      return res.status(422).json({
        message:
          "inwardType is required",
      });
    }
 
    if (!data.supplierName) {
      return res.status(422).json({
        message:
          "supplierName is required",
      });
    }
 
    if (!data.companyName) {
      return res.status(422).json({ message: "companyName is required" });
    }
 
    if (!data.companyId) {
      return res.status(422).json({ message: "companyId is required" });
    }
 
    const transactionWarehouse = await prisma.warehouse.findUnique({
      where: { id: data.warehouseId },
      select: {
        id: true, code: true, companyId: true, Inward: true,
      },
    });
    if (!transactionWarehouse) return res.status(404).json({ message: "Warehouse not found" });
    const transactionCompanies = await getWarehouseCompanies(transactionWarehouse.id);
    if (allCompaniesInactive(transactionCompanies) || transactionWarehouse.Inward !== "Active") {
      return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
    }
    const companyError = await checkInwardCompany(req.user, transactionCompanies, data.companyId);
    if (companyError) return res.status(400).json({ message: companyError });
 
    if (items.length === 0) {
      return res.status(422).json({
        message:
          "At least one item is required",
      });
    }
 
    // =====================================================
    // VALIDATE ITEMS
    // =====================================================
 
    for (const item of items) {
      if (!item.category) {
        return res.status(422).json({
          message:
            "Item category is required",
        });
      }
 
      if (!item.sku) {
        return res.status(422).json({
          message:
            "Item SKU is required",
        });
      }
 
      const quantity =
        Number(
          item.quantity
        ) || 0;
 
      if (quantity <= 0) {
        return res.status(422).json({
          message:
            `Item "${item.sku}" must have a valid quantity`,
        });
      }
 
      if (!item.uom) {
        return res.status(422).json({
          message:
            `Item "${item.sku}" UOM is required`,
        });
      }
    }
 
    // Every item must exist in the product master managed by the admin.
    // Product check and GRN count don't depend on each other, so run them together
    // (one round trip of waiting instead of two).
    const [unknownItems, grnCount, managerAccess] = await Promise.all([
      findUnknownProducts(items),
      prisma.grn.count({ where: { warehouseId: data.warehouseId } }),
      req.user.role === "WAREHOUSE_MANAGER"
        ? prisma.warehouseAccess.findUnique({
            where: { userId_warehouseId: { userId: req.user.id, warehouseId: data.warehouseId } },
          })
        : Promise.resolve(true),
    ]);
    if (
      req.user.role === "WAREHOUSE_MANAGER" &&
      (!managerAccess || managerAccess.accessLevel !== "MANAGE" || !managerAccess.canInward)
    ) {
      return res.status(403).json({ message: "You don't have permission to create inward in this warehouse." });
    }
    if (unknownItems.length) {
      return res.status(422).json({
        message: unknownProductsMessage(unknownItems),
      });
    }
 
    // =====================================================
    // GENERATE GRN NUMBER
    // =====================================================
    // The warehouse was already loaded above (transactionWarehouse) - reuse it
    // instead of querying again. Each query is a network round trip to the
    // database, so every query removed here is time saved.
 
    const warehouse = transactionWarehouse;
 
    let grnSequence = grnCount + 1;
    const buildGrnNumber = (n) => `GRN-${warehouse.code}-${String(n).padStart(4, "0")}`;
 
    // =====================================================
    // CREATE (writes only inside the transaction)
    // =====================================================
    // Inside the transaction we do ONLY the inserts. The re-read of the saved
    // GRN, the audit log and the document list all happen AFTER it commits, so
    // the transaction stays short and can't run into the time limit.
    // Items / reference documents / documents use createMany = ONE insert each
    // (instead of one insert per row).
 
    const referenceDocumentRows = (
      Array.isArray(data.referenceDocuments)
        ? data.referenceDocuments
        : [{ refDocType: data.refDocType, refDocNumber: data.refDocNumber }]
    )
      .filter((r) => r && r.refDocNumber)
      .map((r) => ({
        refDocType: String(r.refDocType || "Other").trim(),
        refDocNumber: String(r.refDocNumber).trim(),
      }));
 
    const itemRows = items.map((item) => ({
      category: item.category,
      sku: item.sku,
      quantity: Number(item.quantity) || 0,
      uom: item.uom,
      companyName: item.companyName ? String(item.companyName).trim() || null : null,
    }));
 
    const documentRows = documents.filter((doc) => {
      if (!doc) return false;
      if (!doc.fileKey) {
        console.log("Skipping document without fileKey:", doc);
        return false;
      }
      return true;
    });
 
    // Serial numbers: one for every Pcs unit (an item of 5 Pcs needs 5).
    const serials = cleanSerials(data.serials);
    const serialProblem = validateInwardSerials(await withSerialModes(prisma, itemRows), serials);
    if (serialProblem) return res.status(422).json({ message: serialProblem });
    // A serial that is already in stock (not dispatched since it came in) cannot be received again.
    const inStockProblem = await findInwardSerialProblem(prisma, { serials });
    if (inStockProblem) return res.status(422).json({ message: inStockProblem });

    let createdGrn = null;
    const MAX_NUMBER_ATTEMPTS = 10;
 
    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const grnNumber = buildGrnNumber(grnSequence);
      console.log("Generated GRN number:", grnNumber);
 
      try {
        createdGrn = await prisma.$transaction(
          async (tx) => {
            const grn = await tx.grn.create({
              data: {
                grnNumber,
                warehouseId: data.warehouseId,
                inwardType: data.inwardType,
                supplierName: data.supplierName,
                companyName: data.companyName || null,
                refDocType: data.refDocType || "Other",
                refDocNumber: data.refDocNumber ? String(data.refDocNumber).trim() : "",
                refDocDate: data.refDocDate ? new Date(data.refDocDate) : new Date(),
                remarks: data.remarks || null,
                createdById: req.user.id,
                items: { createMany: { data: itemRows } },
                ...(referenceDocumentRows.length
                  ? { referenceDocuments: { createMany: { data: referenceDocumentRows } } }
                  : {}),
              },
              // Only what we need - no include, so Prisma skips the extra re-read queries.
              select: { id: true, grnNumber: true, warehouseId: true },
            });
 
            if (serials.length) {
              await tx.grnSerial.createMany({
                data: serials.map((s) => ({ grnId: grn.id, category: s.category, sku: s.sku, serialNo: s.serialNo, source: s.source })),
              });
            }

            if (documentRows.length) {
              await tx.document.createMany({
                data: documentRows.map((doc) => ({
                  linkedType: "grn",
                  linkedId: grn.id,
                  docCategory: doc.docCategory || "Other",
                  fileKey: doc.fileKey,
                  fileType: doc.fileType || "unknown",
                  fileSize: Number(doc.fileSize) || 0,
                  uploadedById: req.user.id,
                })),
              });
            }
 
            return grn;
          },
          // The default limit is 5000 ms - too tight while the database is slow to answer.
          { maxWait: 10000, timeout: 30000 }
        );
        break;
      } catch (err) {
        // Two people created a GRN at the same moment and got the same number:
        // the unique constraint on grnNumber rejected the second one. Take the
        // next number and try again (replaces the old "check if it exists" query).
        const isNumberClash =
          err?.code === "P2002" && String(err?.meta?.target ?? "").includes("grnNumber");
        if (isNumberClash && attempt < MAX_NUMBER_ATTEMPTS) {
          grnSequence += 1;
          continue;
        }
        throw err;
      }
    }
 
    // =====================================================
    // AFTER COMMIT: read back + audit trail (in parallel)
    // =====================================================
 
    // The saved data is already in memory, so there is no need to read it back.
    // The audit entry is written AFTER the response is sent (it never throws),
    // so the user doesn't wait for it.
    const auditEntry = {
      entityType: "INWARD",
      entityId: createdGrn.id,
      entityNumber: createdGrn.grnNumber,
      action: "CREATED",
      description: `Inward entry ${createdGrn.grnNumber} created with ${itemRows.length} item${itemRows.length === 1 ? "" : "s"}${serials.length ? ` and ${serials.length} serial number${serials.length === 1 ? "" : "s"}` : ""}`,
      userId: req.user.id,
      warehouseId: createdGrn.warehouseId,
    };
    res.once("finish", () => { recordAuditLog(prisma, auditEntry); });

    const result = {
      id: createdGrn.id,
      grnNumber: createdGrn.grnNumber,
      warehouseId: createdGrn.warehouseId,
      inwardType: data.inwardType,
      supplierName: data.supplierName,
      companyName: data.companyName || null,
      items: itemRows,
      documents: documentRows.map((doc) => ({ docCategory: doc.docCategory || "Other", fileKey: doc.fileKey })),
    };

    // =====================================================
    // CALCULATE DOCUMENT STATUS
    // =====================================================
 
    const statusData =
      calculateDocumentStatus(
        result.documents
      );
 
    // =====================================================
    // SUCCESS RESPONSE
    // =====================================================
 
    return res.status(201).json({
      message:
        "GRN created successfully",
 
      data: {
        ...result,
 
        status:
          statusData.status,
 
        pendingDocuments:
          statusData.pendingDocuments,
 
        uploadedDocuments:
          statusData.uploadedDocuments,
 
        requiredDocuments:
          statusData.requiredDocuments,
      },
    });
  } catch (error) {
    // =====================================================
    // ERROR
    // =====================================================
 
    console.error(
      "Create GRN error:"
    );
 
    console.error(error);
 
    return res.status(500).json({
      message:
        "Failed to create GRN",
 
      error:
        error.message,
    });
  }
}
 
export async function listInwardModels(req, res) {
  try {
    const { warehouseId } = req.query;
    if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });
 
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
    }
    if (isFinanceSide(req.user.role) && !(await getFinanceWarehouseIds(req.user)).includes(warehouseId)) {
      return res.status(403).json({ message: "You don't have access to this warehouse" });
    }
 
    const [catalog, history] = await Promise.all([
      prisma.warehouseModel.findMany({ where: { warehouseId }, orderBy: [{ category: "asc" }, { companyName: "asc" }, { name: "asc" }] }),
      prisma.grnItem.groupBy({
        by: ["category", "sku", "companyName"],
        where: { grn: { warehouseId } },
      }),
    ]);
    // Key on category + companyName + model name so the same model name
    // under a different brand/company doesn't collapse into one row.
    const map = new Map(catalog.map((m) => [`${m.category}::${m.companyName || ""}::${m.name}`, m]));
    for (const row of history) {
      if (!row.sku) continue;
      const key = `${row.category}::${row.companyName || ""}::${row.sku}`;
      if (!map.has(key)) map.set(key, { category: row.category, name: row.sku, companyName: row.companyName || null });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List inward models error:", error);
    return res.status(500).json({ message: "Failed to fetch models", error: error.message });
  }
}
 
export async function createInwardModel(req, res) {
  try {
    const { warehouseId, category, name, companyName } = req.body;
    if (!warehouseId || !category || !name?.trim()) return res.status(422).json({ message: "warehouseId, category and model name are required" });
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
    }
    const model = await prisma.warehouseModel.create({
      data: { warehouseId, category, name: name.trim(), companyName: companyName?.trim() || null },
    });
    return res.status(201).json({ data: model });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This model already exists in this warehouse." });
    return res.status(500).json({ message: "Failed to create model", error: error.message });
  }
}
 
/**
 * =========================================================
 * ITEM COMPANIES (brand/manufacturer tagged per item)
 * =========================================================
 *
 * Separate from the tenant "Company" (the account that owns
 * warehouses, managed by SUPER_ADMIN only). This is a small,
 * per-warehouse catalog of company/brand names used to tag
 * individual GRN items, the same way WarehouseModel catalogs
 * models per category.
 * =========================================================
 */
 
export async function listInwardCompanies(req, res) {
  try {
    const { warehouseId } = req.query;
    if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });
 
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
    }
    if (isFinanceSide(req.user.role) && !(await getFinanceWarehouseIds(req.user)).includes(warehouseId)) {
      return res.status(403).json({ message: "You don't have access to this warehouse" });
    }
 
    const [catalog, history] = await Promise.all([
      prisma.warehouseCompany.findMany({ where: { warehouseId }, orderBy: { name: "asc" } }),
      prisma.grnItem.findMany({ where: { grn: { warehouseId }, companyName: { not: null } }, select: { companyName: true }, distinct: ["companyName"] }),
    ]);
    const map = new Map(catalog.map((c) => [c.name, c]));
    for (const row of history) {
      if (row.companyName && !map.has(row.companyName)) map.set(row.companyName, { name: row.companyName });
    }
    return res.json({ data: Array.from(map.values()) });
  } catch (error) {
    console.error("List inward companies error:", error);
    return res.status(500).json({ message: "Failed to fetch companies", error: error.message });
  }
}
 
export async function createInwardCompany(req, res) {
  try {
    const { warehouseId, name } = req.body;
    if (!warehouseId || !name?.trim()) return res.status(422).json({ message: "warehouseId and company name are required" });
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
      if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
    }
    const company = await prisma.warehouseCompany.create({ data: { warehouseId, name: name.trim() } });
    return res.status(201).json({ data: company });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This company already exists in this warehouse." });
    return res.status(500).json({ message: "Failed to create company", error: error.message });
  }
}
 
/**
 * =========================================================
 * GET /api/grn/:id/history
 * =========================================================
 *
 * Chronological audit trail for one GRN: created, updated,
 * items added/updated/removed, documents added/removed.
 * Newest first.
 * =========================================================
 */
 
/**
 * =========================================================
 * GET /api/grn/history
 * =========================================================
 *
 * Activity feed across ALL GRNs the caller can see (same
 * warehouse scoping as listGrn) - "GRN-XXXX created", "GRN-XXXX
 * updated: Supplier name changed from A to B", etc. Newest first.
 * This is what the Inward list page's "Activity history" panel
 * reads from - it's not scoped to one GRN.
 * =========================================================
 */
 
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

export async function listGrnHistory(req, res) {
  try {
    const {
      warehouseId,
      search = "",
      page = "1",
      pageSize = "20",
      from,
      to,
    } = req.query;
 
    let scopedWarehouseIds = null;
    if (req.user.role === "WAREHOUSE_MANAGER") {
      const grants = await prisma.warehouseAccess.findMany({
        where: { userId: req.user.id, accessLevel: "MANAGE" },
        select: { warehouseId: true },
      });
      scopedWarehouseIds = grants.map((g) => g.warehouseId);
    } else if (isFinanceSide(req.user.role)) {
      // Sales / Account: view-only, limited to their companies' warehouses.
      scopedWarehouseIds = await getFinanceWarehouseIds(req.user);
    }
 
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
 
    const where = {
      entityType: "INWARD",
      AND: [
        scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
        warehouseId ? { warehouseId } : {},
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
 
    return res.json({
      data: rows,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (error) {
    console.error("List GRN history error:", error);
    return res.status(500).json({ message: "Failed to fetch history", error: error.message });
  }
}
// import prisma from "../config/prisma.js";
// import { recordAuditLog, diffFields, diffItems, describeItem } from "../utils/auditLog.js";
// import { findUnknownProducts, unknownProductsMessage } from "../utils/productCatalog.js";

// /**
//  * =========================================================
//  * REQUIRED GRN DOCUMENTS
//  * =========================================================
//  */

// const REQUIRED_DOCUMENTS = [
//   "Vendor invoice",
//   "E-way bill",
//   "Unloading sign-off sheet",
// ];

// const META_PREFIX = "__INWARD_META__";

// function buildStoredRemarks(companyName, documentNumbers, remarks) {
//   const meta = JSON.stringify({ companyName: companyName || "", documentNumbers: Array.isArray(documentNumbers) ? documentNumbers : [] });
//   return `${META_PREFIX}${meta}\n${remarks || ""}`;
// }

// function parseStoredRemarks(value) {
//   const text = String(value || "");
//   if (!text.startsWith(META_PREFIX)) return { companyName: "", documentNumbers: [], remarks: text };
//   const newline = text.indexOf("\n");
//   try {
//     const meta = JSON.parse(text.slice(META_PREFIX.length, newline < 0 ? undefined : newline));
//     return { companyName: meta.companyName || "", documentNumbers: Array.isArray(meta.documentNumbers) ? meta.documentNumbers : [], remarks: newline < 0 ? "" : text.slice(newline + 1) };
//   } catch {
//     return { companyName: "", documentNumbers: [], remarks: text };
//   }
// }

// /**
//  * =========================================================
//  * HELPER
//  * =========================================================
//  *
//  * Calculates document status for a GRN.
//  *
//  * 0 documents
//  * -> Pending
//  * -> 3 documents pending
//  *
//  * 1 document
//  * -> Pending
//  * -> 2 documents pending
//  *
//  * 2 documents
//  * -> Pending
//  * -> 1 document pending
//  *
//  * 3 documents
//  * -> Complete
//  * -> 0 documents pending
//  */

// function calculateDocumentStatus(documents = []) {
//   const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
//   const pendingDocuments = REQUIRED_DOCUMENTS.filter((requiredDocument) => {
//     const required = requiredDocument.toLowerCase();
//     return !uploadedCategories.some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
//   }).length;

//   const uploadedDocuments =
//     REQUIRED_DOCUMENTS.length -
//     pendingDocuments;

//   const status =
//     pendingDocuments === 0
//       ? "Complete"
//       : "Pending";

//   return {
//     status,

//     pendingDocuments,

//     uploadedDocuments,

//     requiredDocuments:
//       REQUIRED_DOCUMENTS.length,
//   };
// }

// /**
//  * =========================================================
//  * GET /api/grn
//  * =========================================================
//  *
//  * List GRNs with:
//  * - items
//  * - documents
//  * - createdBy
//  * - document status
//  * - pagination
//  * - search
//  * - type filter
//  * - date filter
//  *
//  * =========================================================
//  */

// export async function listGrn(req, res) {
//   try {
//     const {
//       search = "",
//       type,
//       dateFrom,
//       dateTo,
//       warehouseId,
//       page = "1",
//       pageSize = "20",
//     } = req.query;

//     // =====================================================
//     // SCOPE BY ROLE / WAREHOUSE
//     // (previously this endpoint returned every GRN in the system to
//     // any authenticated user — a warehouse manager could browse other
//     // companies' inward entries. Scope it the same way warehouses
//     // themselves are scoped.)
//     // =====================================================

//     let scopedWarehouseIds = null;

//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const grants = await prisma.warehouseAccess.findMany({
//         where: { userId: req.user.id, accessLevel: "MANAGE" },
//         select: { warehouseId: true },
//       });
//       scopedWarehouseIds = grants.map((g) => g.warehouseId);
//     }
//     // SUPER_ADMIN: no scoping — sees everything (optionally filtered
//     // by ?warehouseId= below like everyone else).

//     // =====================================================
//     // PAGINATION
//     // =====================================================

//     const pageNum = Math.max(
//       parseInt(page, 10) || 1,
//       1
//     );

//     const pageSizeNum = Math.min(
//       Math.max(
//         parseInt(pageSize, 10) || 20,
//         1
//       ),
//       100
//     );

//     // =====================================================
//     // BUILD WHERE
//     // =====================================================

//     const where = {
//       AND: [
//         // -------------------------------------------------
//         // WAREHOUSE SCOPE
//         // -------------------------------------------------

//         scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},

//         warehouseId ? { warehouseId } : {},

//         // -------------------------------------------------
//         // SEARCH
//         // -------------------------------------------------

//         search
//           ? {
//               OR: [
//                 {
//                   grnNumber: {
//                     contains: search,
//                     mode: "insensitive",
//                   },
//                 },

//                 {
//                   supplierName: {
//                     contains: search,
//                     mode: "insensitive",
//                   },
//                 },

//                 {
//                   companyName: {
//                     contains: search,
//                     mode: "insensitive",
//                   },
//                 },

//                 {
//                   refDocNumber: {
//                     contains: search,
//                     mode: "insensitive",
//                   },
//                 },
//               ],
//             }
//           : {},

//         // -------------------------------------------------
//         // INWARD TYPE FILTER
//         // -------------------------------------------------

//         type
//           ? {
//               inwardType: type,
//             }
//           : {},

//         // -------------------------------------------------
//         // DATE FILTER
//         // -------------------------------------------------

//         dateFrom || dateTo
//           ? {
//               createdAt: {
//                 ...(dateFrom
//                   ? {
//                       gte: new Date(
//                         dateFrom
//                       ),
//                     }
//                   : {}),

//                 ...(dateTo
//                   ? {
//                       // dateTo arrives as a plain "YYYY-MM-DD" date with no
//                       // time, which Date() parses as that day's midnight UTC.
//                       // A GRN created any time later that same day would then
//                       // be > the "lte" bound and get filtered out - which is
//                       // why a just-created GRN wouldn't show up under
//                       // "Today" / "Last 7 days" on the list page. Extend the
//                       // bound to the end of that day instead.
//                       lte: new Date(
//                         `${dateTo}T23:59:59.999`
//                       ),
//                     }
//                   : {}),
//               },
//             }
//           : {},
//       ],
//     };

//     // =====================================================
//     // GET GRNS + TOTAL
//     // =====================================================

//     const [rows, total] =
//       await Promise.all([
//         prisma.grn.findMany({
//           where,

//           include: {
//             items: true,
//             referenceDocuments: true,

//             createdBy: {
//               select: {
//                 name: true,
//               },
//             },

//             warehouse: {
//               select: {
//                 id: true,
//                 name: true,
//                 code: true,
//                 company: { select: { name: true } },
//               },
//             },
//           },

//           orderBy: {
//             createdAt: "desc",
//           },

//           skip:
//             (pageNum - 1) *
//             pageSizeNum,

//           take: pageSizeNum,
//         }),

//         prisma.grn.count({
//           where,
//         }),
//       ]);

//     // =====================================================
//     // GET GRN IDS
//     // =====================================================

//     const grnIds = rows.map(
//       (grn) => grn.id
//     );

//     // =====================================================
//     // GET DOCUMENTS
//     // =====================================================

//     let documents = [];

//     if (grnIds.length > 0) {
//       documents =
//         await prisma.document.findMany({
//           where: {
//             linkedType: "grn",

//             linkedId: {
//               in: grnIds,
//             },
//           },

//           orderBy: {
//             uploadedAt: "desc",
//           },
//         });
//     }

//     // =====================================================
//     // ATTACH DOCUMENTS + STATUS
//     // =====================================================

//     const rowsWithDocuments =
//       rows.map((grn) => {
//         // -------------------------------------------------
//         // Documents belonging to this GRN
//         // -------------------------------------------------

//         const grnDocuments =
//           documents.filter(
//             (doc) =>
//               doc.linkedId === grn.id
//           );

//         // -------------------------------------------------
//         // Calculate document status
//         // -------------------------------------------------

//         const statusData =
//           calculateDocumentStatus(
//             grnDocuments
//           );

//         // -------------------------------------------------
//         // Return GRN
//         // -------------------------------------------------

//         return {
//           ...grn,
//           companyName: grn.companyName || grn.warehouse?.company?.name || "",
//           documents:
//             grnDocuments,

//           status:
//             statusData.status,

//           pendingDocuments:
//             statusData.pendingDocuments,

//           uploadedDocuments:
//             statusData.uploadedDocuments,

//           requiredDocuments:
//             statusData.requiredDocuments,
//         };
//       });

//     // =====================================================
//     // RESPONSE
//     // =====================================================

//     return res.json({
//       data: rowsWithDocuments,

//       pagination: {
//         page: pageNum,

//         pageSize:
//           pageSizeNum,

//         total,

//         totalPages:
//           Math.ceil(
//             total /
//               pageSizeNum
//           ),
//       },
//     });
//   } catch (error) {
//     console.error(
//       "List GRN error:"
//     );

//     console.error(error);

//     return res.status(500).json({
//       message:
//         "Failed to fetch GRNs",

//       error:
//         error.message,
//     });
//   }
// }

// /**
//  * =========================================================
//  * GET /api/grn/:id
//  * =========================================================
//  *
//  * Get one GRN with:
//  * - items
//  * - documents
//  * - createdBy
//  * - document status
//  *
//  * =========================================================
//  */

// export async function getGrnById(req, res) {
//   try {
//     const { id } = req.params;

//     // =====================================================
//     // GET GRN
//     // =====================================================

//     const grn =
//       await prisma.grn.findUnique({
//         where: {
//           id,
//         },

//         include: {
//           items: true,
//           referenceDocuments: true,

//           createdBy: {
//             select: {
//               name: true,
//               role: true,
//             },
//           },

//           warehouse: {
//             select: {
//               id: true,
//               name: true,
//               code: true,
//               companyId: true,
//               Inward: true,
//               Outward: true,
//               company: { select: { name: true, status: true } },
//             },
//           },
//         },
//       });

//     // =====================================================
//     // CHECK GRN
//     // =====================================================

//     if (!grn) {
//       return res.status(404).json({
//         message:
//           "GRN not found",
//       });
//     }

//     // =====================================================
//     // SCOPE CHECK — same warehouse scoping as listGrn
//     // =====================================================


//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({
//         where: {
//           userId_warehouseId: { userId: req.user.id, warehouseId: grn.warehouseId },
//         },
//       });
//       if (!access || access.accessLevel !== "MANAGE") {
//         return res.status(403).json({ message: "You don't have access to this GRN's warehouse" });
//       }
//     }

//     // =====================================================
//     // GET DOCUMENTS
//     // =====================================================

//     const documents =
//       await prisma.document.findMany({
//         where: {
//           linkedType: "grn",

//           linkedId: grn.id,
//         },

//         orderBy: {
//           uploadedAt: "desc",
//         },
//       });

//     // =====================================================
//     // CALCULATE STATUS
//     // =====================================================

//     const statusData =
//       calculateDocumentStatus(
//         documents
//       );

//     // =====================================================
//     // RESPONSE
//     // =====================================================

//     return res.json({
//       data: {
//         ...grn,
//         companyName: grn.companyName || grn.warehouse?.company?.name || "",
//         documents,

//         status:
//           statusData.status,

//         pendingDocuments:
//           statusData.pendingDocuments,

//         uploadedDocuments:
//           statusData.uploadedDocuments,

//         requiredDocuments:
//           statusData.requiredDocuments,
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Get GRN error:"
//     );

//     console.error(error);

//     return res.status(500).json({
//       message:
//         "Failed to fetch GRN",

//       error:
//         error.message,
//     });
//   }
// }

// /**
//  * =========================================================
//  * POST /api/grn
//  * =========================================================
//  *
//  * Create GRN.
//  *
//  * Documents are OPTIONAL.
//  *
//  * If no documents are provided:
//  *
//  * documents = []
//  *
//  * GRN is still created.
//  *
//  * =========================================================
//  */


// export async function updateGrn(req, res) {
//   try {
//     const { id } = req.params;
//     const data = req.body;
//     const items = Array.isArray(data.items) ? data.items : [];
//     const references = Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [];

//     const existing = await prisma.grn.findUnique({
//       where: { id },
//       select: {
//         id: true, warehouseId: true, grnNumber: true,
//         inwardType: true, supplierName: true, companyName: true,
//         refDocType: true, refDocNumber: true, remarks: true,
//         items: { select: { category: true, sku: true, companyName: true, quantity: true, uom: true } },
//       },
//     });
//     if (!existing) return res.status(404).json({ message: "GRN not found" });

//     const warehouse = await prisma.warehouse.findUnique({
//       where: { id: existing.warehouseId },
//       select: { id: true, companyId: true, Inward: true, company: { select: { status: true } } },
//     });
//     if (!warehouse) return res.status(404).json({ message: "Warehouse not found" });
//     if (warehouse.company?.status === "Inactive" || warehouse.Inward !== "Active") {
//       return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
//     }
//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({
//         where: { userId_warehouseId: { userId: req.user.id, warehouseId: existing.warehouseId } },
//       });
//       if (!access || access.accessLevel !== "MANAGE" || !access.canInward) {
//         return res.status(403).json({ message: "You don't have permission to update this inward entry." });
//       }
//     }

//     if (!data.inwardType || !data.supplierName?.trim() || !data.companyName?.trim()) {
//       return res.status(422).json({ message: "Inward type, supplier/customer and company name are required." });
//     }
//     if (!data.companyId || data.companyId !== warehouse.companyId) {
//       return res.status(400).json({ message: "Selected company does not match this warehouse." });
//     }
//     if (!references.length || !references.some((r) => r?.refDocNumber)) {
//       return res.status(422).json({ message: "At least one reference document is required." });
//     }
//     if (!items.length) return res.status(422).json({ message: "At least one item is required." });
//     for (const item of items) {
//       if (!item.category || !item.sku?.trim() || Number(item.quantity) <= 0 || !item.uom) {
//         return res.status(422).json({ message: "Every item must have category, model, quantity and UOM." });
//       }
//     }

//     // Items new to this entry must exist in the product master
//     // (items it already had are allowed even if the product was deleted since).
//     const unknownItems = await findUnknownProducts(items, existing.items);
//     if (unknownItems.length) {
//       return res.status(422).json({ message: unknownProductsMessage(unknownItems) });
//     }

//     const normalizedRefs = references
//       .filter((r) => r && r.refDocNumber)
//       .map((r) => ({
//         refDocType: String(r.refDocType || "Other").trim(),
//         refDocNumber: String(r.refDocNumber).trim(),
//         ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
//       }));

//     // Snapshot the "new" values in the same shape as `existing` so we can
//     // diff them below, both for top-level fields and for the item list.
//     const newSnapshot = {
//       inwardType: data.inwardType,
//       supplierName: data.supplierName.trim(),
//       companyName: data.companyName.trim(),
//       refDocType: firstRef.refDocType,
//       refDocNumber: firstRef.refDocNumber,
//       ewayBillNumber: normalizedRefs[0].ewayBillNumber,
//       remarks: data.remarks?.trim() || null,
//     };
//     const newItems = items.map((item) => ({
//       category: item.category, sku: item.sku.trim(),
//       quantity: Number(item.quantity), uom: item.uom,
//       companyName: item.companyName ? String(item.companyName).trim() || null : null,
//     }));
//     const fieldChanges = diffFields(existing, newSnapshot, [
//       "inwardType", "supplierName", "companyName", "refDocType", "refDocNumber", "remarks",
//     ]);
//     const itemChanges = diffItems(existing.items, newItems);

//     const result = await prisma.$transaction(async (tx) => {
//       await tx.grn.update({
//         where: { id },
//         data: {
//           inwardType: data.inwardType,
//           supplierName: data.supplierName.trim(),
//           companyName: data.companyName.trim(),
//           refDocType: firstRef.refDocType,
//           refDocNumber: firstRef.refDocNumber,
//           refDocDate: data.refDocDate ? new Date(data.refDocDate) : new Date(),
//           ewayBillNumber: normalizedRefs[0].ewayBillNumber,
//           remarks: data.remarks?.trim() || null,
//           items: {
//             deleteMany: {},
//             create: newItems,
//           },
//           referenceDocuments: {
//             deleteMany: {},
//             create: normalizedRefs,
//           },
//         },
//       });

//       // -------------------------------------------------
//       // AUDIT TRAIL
//       // -------------------------------------------------
//       const auditBase = {
//         entityType: "INWARD",
//         entityId: id,
//         entityNumber: existing.grnNumber,
//         userId: req.user.id,
//         warehouseId: existing.warehouseId,
//       };
//       for (const change of fieldChanges) {
//         await recordAuditLog(tx, {
//           ...auditBase,
//           action: "UPDATED",
//           description: `${change.label} updated from "${change.oldValue || "—"}" to "${change.newValue || "—"}"`,
//           changes: change,
//         });
//       }
//       for (const item of itemChanges.added) {
//         await recordAuditLog(tx, {
//           ...auditBase,
//           action: "ITEM_ADDED",
//           description: `Item added: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
//           changes: item,
//         });
//       }
//       for (const item of itemChanges.removed) {
//         await recordAuditLog(tx, {
//           ...auditBase,
//           action: "ITEM_REMOVED",
//           description: `Item removed: ${describeItem(item)} — qty ${item.quantity} ${item.uom}`,
//           changes: item,
//         });
//       }
//       for (const { item, oldQuantity, newQuantity } of itemChanges.updated) {
//         await recordAuditLog(tx, {
//           ...auditBase,
//           action: "ITEM_UPDATED",
//           description: `Quantity updated for ${describeItem(item)} from ${oldQuantity} to ${newQuantity} ${item.uom}`,
//           changes: { field: "quantity", item: describeItem(item), oldValue: oldQuantity, newValue: newQuantity },
//         });
//       }
//       if (!fieldChanges.length && !itemChanges.added.length && !itemChanges.removed.length && !itemChanges.updated.length) {
//         await recordAuditLog(tx, {
//           ...auditBase,
//           action: "UPDATED",
//           description: "Inward entry saved with no field changes",
//         });
//       }

//       return tx.grn.findUnique({ where: { id }, include: { items: true, referenceDocuments: true } });
//     });
//     return res.json({ message: "Inward entry updated successfully", data: result });
//   } catch (error) {
//     console.error("Update GRN error:", error);
//     return res.status(error.status || 500).json({ message: error.message || "Failed to update GRN" });
//   }
// }

// export async function createGrn(req, res) {
//   try {
//     // =====================================================
//     // REQUEST DATA
//     // =====================================================

//     const data = req.body;

//     console.log(
//       "Creating GRN with payload:"
//     );

//     console.log(
//       JSON.stringify(
//         data,
//         null,
//         2
//       )
//     );

//     // =====================================================
//     // BASIC DEFAULTS
//     // =====================================================

//     const items =
//       Array.isArray(
//         data.items
//       )
//         ? data.items
//         : [];

//     const documents =
//       Array.isArray(
//         data.documents
//       )
//         ? data.documents
//         : [];

//     // =====================================================
//     // BASIC REQUIRED FIELD VALIDATION
//     // =====================================================

//     if (!data.warehouseId) {
//       return res.status(422).json({
//         message:
//           "warehouseId is required",
//       });
//     }

//     if (!data.inwardType) {
//       return res.status(422).json({
//         message:
//           "inwardType is required",
//       });
//     }

//     if (!data.supplierName) {
//       return res.status(422).json({
//         message:
//           "supplierName is required",
//       });
//     }

//     if (!data.companyName) {
//       return res.status(422).json({ message: "companyName is required" });
//     }

//     if (!data.companyId) {
//       return res.status(422).json({ message: "companyId is required" });
//     }

//     const transactionWarehouse = await prisma.warehouse.findUnique({
//       where: { id: data.warehouseId },
//       select: {
//         id: true, code: true, companyId: true, Inward: true,
//         company: { select: { id: true, name: true, status: true } },
//       },
//     });
//     if (!transactionWarehouse) return res.status(404).json({ message: "Warehouse not found" });
//     if (transactionWarehouse.companyId !== data.companyId) {
//       return res.status(400).json({ message: "Selected warehouse does not belong to the selected company" });
//     }
//     if (transactionWarehouse.company?.status === "Inactive" || transactionWarehouse.Inward !== "Active") {
//       return res.status(403).json({ message: "Inward is disabled for this warehouse/company." });
//     }
//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({
//         where: { userId_warehouseId: { userId: req.user.id, warehouseId: data.warehouseId } },
//       });
//       if (!access || access.accessLevel !== "MANAGE" || !access.canInward) {
//         return res.status(403).json({ message: "You don't have permission to create inward in this warehouse." });
//       }
//     }

//     if (!data.refDocNumber && !Array.isArray(data.otherDocumentNumbers)) {
//       return res.status(422).json({ message: "At least one document number is required" });
//     }

//     if (items.length === 0) {
//       return res.status(422).json({
//         message:
//           "At least one item is required",
//       });
//     }

//     // =====================================================
//     // VALIDATE ITEMS
//     // =====================================================

//     for (const item of items) {
//       if (!item.category) {
//         return res.status(422).json({
//           message:
//             "Item category is required",
//         });
//       }

//       if (!item.sku) {
//         return res.status(422).json({
//           message:
//             "Item SKU is required",
//         });
//       }

//       const quantity =
//         Number(
//           item.quantity
//         ) || 0;

//       if (quantity <= 0) {
//         return res.status(422).json({
//           message:
//             `Item "${item.sku}" must have a valid quantity`,
//         });
//       }

//       if (!item.uom) {
//         return res.status(422).json({
//           message:
//             `Item "${item.sku}" UOM is required`,
//         });
//       }
//     }

//     // Every item must exist in the product master managed by the admin.
//     const unknownItems = await findUnknownProducts(items);
//     if (unknownItems.length) {
//       return res.status(422).json({
//         message: unknownProductsMessage(unknownItems),
//       });
//     }

//     // =====================================================
//     // GENERATE GRN NUMBER
//     // =====================================================

//     const warehouse = await prisma.warehouse.findUnique({
//       where: { id: data.warehouseId },
//       select: { id: true, code: true },
//     });
//     if (!warehouse) return res.status(404).json({ message: "Warehouse not found" });

//     const grnCount = await prisma.grn.count({ where: { warehouseId: warehouse.id } });
//     let grnNumber = `GRN-${warehouse.code}-${String(grnCount + 1).padStart(4, "0")}`;
//     let existingGrn = await prisma.grn.findUnique({ where: { grnNumber }, select: { id: true } });
//     let grnSequence = grnCount + 1;
//     while (existingGrn) {
//       grnSequence += 1;
//       grnNumber = `GRN-${warehouse.code}-${String(grnSequence).padStart(4, "0")}`;
//       existingGrn = await prisma.grn.findUnique({ where: { grnNumber }, select: { id: true } });
//     }

//     console.log(
//       "Generated GRN number:",
//       grnNumber
//     );

//     // =====================================================
//     // CREATE TRANSACTION
//     // =====================================================

//     const result =
//       await prisma.$transaction(
//         async (tx) => {
//           // =============================================
//           // CREATE GRN
//           // =============================================

//           const grn =
//             await tx.grn.create({
//               data: {
//                 grnNumber,

//                 warehouseId:
//                   data.warehouseId,

//                 inwardType:
//                   data.inwardType,

//                 supplierName:
//                   data.supplierName,

//                 companyName:
//                   data.companyName || null,

//                 refDocType:
//                   data.refDocType,

//                 refDocNumber:
//                   data.refDocNumber,

//                 refDocDate:
//                   data.refDocDate
//                     ? new Date(
//                         data.refDocDate
//                       )
//                     : new Date(),

//                 ewayBillNumber:
//                   data.ewayBillNumber ||
//                   null,

//                 remarks:
//                   data.remarks || null,

//                 createdById:
//                   req.user.id,

//                 // =======================================
//                 // CREATE ITEMS
//                 // =======================================

//                 items: {
//                   create:
//                     items.map(
//                       (item) => ({
//                         category:
//                           item.category,

//                         sku:
//                           item.sku,

//                         quantity:
//                           Number(
//                             item.quantity
//                           ) || 0,

//                         uom:
//                           item.uom,

//                         companyName:
//                           item.companyName
//                             ? String(item.companyName).trim() || null
//                             : null,
//                       })
//                     ),
//                 },

//                 referenceDocuments: {
//                   create: (Array.isArray(data.referenceDocuments) ? data.referenceDocuments : [{ refDocType: data.refDocType, refDocNumber: data.refDocNumber }])
//                     .filter((r) => r && r.refDocNumber)
//                     .map((r) => ({
//                       refDocType: String(r.refDocType || "Other").trim(),
//                       refDocNumber: String(r.refDocNumber).trim(),
//                       ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : null,
//                     })),
//                 },
//               },

//               include: {
//                 items: true,
//                 referenceDocuments: true,
//               },
//             });

//           // =============================================
//           // CREATE DOCUMENTS
//           // =============================================

//           for (
//             const doc of documents
//           ) {
//             // -----------------------------------------
//             // Ignore empty document
//             // -----------------------------------------

//             if (!doc) {
//               continue;
//             }

//             // -----------------------------------------
//             // Ignore document without fileKey
//             // -----------------------------------------

//             if (
//               !doc.fileKey
//             ) {
//               console.log(
//                 "Skipping document without fileKey:",
//                 doc
//               );

//               continue;
//             }

//             // -----------------------------------------
//             // Create Document
//             // -----------------------------------------

//             await tx.document.create({
//               data: {
//                 linkedType:
//                   "grn",

//                 linkedId:
//                   grn.id,

//                 docCategory:
//                   doc.docCategory ||
//                   "Other",

//                 fileKey:
//                   doc.fileKey,

//                 fileType:
//                   doc.fileType ||
//                   "unknown",

//                 fileSize:
//                   Number(
//                     doc.fileSize
//                   ) || 0,

//                 uploadedById:
//                   req.user.id,
//               },
//             });
//           }

//           // =============================================
//           // AUDIT TRAIL
//           // =============================================

//           await recordAuditLog(tx, {
//             entityType: "INWARD",
//             entityId: grn.id,
//             entityNumber: grn.grnNumber,
//             action: "CREATED",
//             description: `Inward entry ${grn.grnNumber} created with ${grn.items.length} item${grn.items.length === 1 ? "" : "s"}`,
//             userId: req.user.id,
//             warehouseId: grn.warehouseId,
//           });



//           // =============================================
//           // GET CREATED DOCUMENTS
//           // =============================================

//           const createdDocuments =
//             await tx.document.findMany(
//               {
//                 where: {
//                   linkedType:
//                     "grn",

//                   linkedId:
//                     grn.id,
//                 },

//                 orderBy: {
//                   uploadedAt:
//                     "desc",
//                 },
//               }
//             );

//           // =============================================
//           // RETURN CREATED GRN
//           // =============================================

//           return {
//             ...grn,

//             documents:
//               createdDocuments,
//           };
//         }
//       );

//     // =====================================================
//     // CALCULATE DOCUMENT STATUS
//     // =====================================================

//     const statusData =
//       calculateDocumentStatus(
//         result.documents
//       );

//     // =====================================================
//     // SUCCESS RESPONSE
//     // =====================================================

//     return res.status(201).json({
//       message:
//         "GRN created successfully",

//       data: {
//         ...result,

//         status:
//           statusData.status,

//         pendingDocuments:
//           statusData.pendingDocuments,

//         uploadedDocuments:
//           statusData.uploadedDocuments,

//         requiredDocuments:
//           statusData.requiredDocuments,
//       },
//     });
//   } catch (error) {
//     // =====================================================
//     // ERROR
//     // =====================================================

//     console.error(
//       "Create GRN error:"
//     );

//     console.error(error);

//     return res.status(500).json({
//       message:
//         "Failed to create GRN",

//       error:
//         error.message,
//     });
//   }
// }

// export async function listInwardModels(req, res) {
//   try {
//     const { warehouseId } = req.query;
//     if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });

//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
//       if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
//     }

//     const [catalog, history] = await Promise.all([
//       prisma.warehouseModel.findMany({ where: { warehouseId }, orderBy: [{ category: "asc" }, { companyName: "asc" }, { name: "asc" }] }),
//       prisma.grnItem.groupBy({
//         by: ["category", "sku", "companyName"],
//         where: { grn: { warehouseId } },
//       }),
//     ]);
//     // Key on category + companyName + model name so the same model name
//     // under a different brand/company doesn't collapse into one row.
//     const map = new Map(catalog.map((m) => [`${m.category}::${m.companyName || ""}::${m.name}`, m]));
//     for (const row of history) {
//       if (!row.sku) continue;
//       const key = `${row.category}::${row.companyName || ""}::${row.sku}`;
//       if (!map.has(key)) map.set(key, { category: row.category, name: row.sku, companyName: row.companyName || null });
//     }
//     return res.json({ data: Array.from(map.values()) });
//   } catch (error) {
//     console.error("List inward models error:", error);
//     return res.status(500).json({ message: "Failed to fetch models", error: error.message });
//   }
// }

// export async function createInwardModel(req, res) {
//   try {
//     const { warehouseId, category, name, companyName } = req.body;
//     if (!warehouseId || !category || !name?.trim()) return res.status(422).json({ message: "warehouseId, category and model name are required" });
//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
//       if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
//     }
//     const model = await prisma.warehouseModel.create({
//       data: { warehouseId, category, name: name.trim(), companyName: companyName?.trim() || null },
//     });
//     return res.status(201).json({ data: model });
//   } catch (error) {
//     if (error.code === "P2002") return res.status(409).json({ message: "This model already exists in this warehouse." });
//     return res.status(500).json({ message: "Failed to create model", error: error.message });
//   }
// }

// /**
//  * =========================================================
//  * ITEM COMPANIES (brand/manufacturer tagged per item)
//  * =========================================================
//  *
//  * Separate from the tenant "Company" (the account that owns
//  * warehouses, managed by SUPER_ADMIN only). This is a small,
//  * per-warehouse catalog of company/brand names used to tag
//  * individual GRN items, the same way WarehouseModel catalogs
//  * models per category.
//  * =========================================================
//  */

// export async function listInwardCompanies(req, res) {
//   try {
//     const { warehouseId } = req.query;
//     if (!warehouseId) return res.status(422).json({ message: "warehouseId is required" });

//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
//       if (!access || access.accessLevel !== "MANAGE") return res.status(403).json({ message: "You don't have access to this warehouse" });
//     }

//     const [catalog, history] = await Promise.all([
//       prisma.warehouseCompany.findMany({ where: { warehouseId }, orderBy: { name: "asc" } }),
//       prisma.grnItem.findMany({ where: { grn: { warehouseId }, companyName: { not: null } }, select: { companyName: true }, distinct: ["companyName"] }),
//     ]);
//     const map = new Map(catalog.map((c) => [c.name, c]));
//     for (const row of history) {
//       if (row.companyName && !map.has(row.companyName)) map.set(row.companyName, { name: row.companyName });
//     }
//     return res.json({ data: Array.from(map.values()) });
//   } catch (error) {
//     console.error("List inward companies error:", error);
//     return res.status(500).json({ message: "Failed to fetch companies", error: error.message });
//   }
// }

// export async function createInwardCompany(req, res) {
//   try {
//     const { warehouseId, name } = req.body;
//     if (!warehouseId || !name?.trim()) return res.status(422).json({ message: "warehouseId and company name are required" });
//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const access = await prisma.warehouseAccess.findUnique({ where: { userId_warehouseId: { userId: req.user.id, warehouseId } } });
//       if (!access || access.accessLevel !== "MANAGE" || !access.canInward) return res.status(403).json({ message: "You don't have permission for this warehouse" });
//     }
//     const company = await prisma.warehouseCompany.create({ data: { warehouseId, name: name.trim() } });
//     return res.status(201).json({ data: company });
//   } catch (error) {
//     if (error.code === "P2002") return res.status(409).json({ message: "This company already exists in this warehouse." });
//     return res.status(500).json({ message: "Failed to create company", error: error.message });
//   }
// }

// /**
//  * =========================================================
//  * GET /api/grn/:id/history
//  * =========================================================
//  *
//  * Chronological audit trail for one GRN: created, updated,
//  * items added/updated/removed, documents added/removed.
//  * Newest first.
//  * =========================================================
//  */

// /**
//  * =========================================================
//  * GET /api/grn/history
//  * =========================================================
//  *
//  * Activity feed across ALL GRNs the caller can see (same
//  * warehouse scoping as listGrn) - "GRN-XXXX created", "GRN-XXXX
//  * updated: Supplier name changed from A to B", etc. Newest first.
//  * This is what the Inward list page's "Activity history" panel
//  * reads from - it's not scoped to one GRN.
//  * =========================================================
//  */

// export async function listGrnHistory(req, res) {
//   try {
//     const {
//       warehouseId,
//       search = "",
//       page = "1",
//       pageSize = "20",
//     } = req.query;

//     let scopedWarehouseIds = null;
//     if (req.user.role === "WAREHOUSE_MANAGER") {
//       const grants = await prisma.warehouseAccess.findMany({
//         where: { userId: req.user.id, accessLevel: "MANAGE" },
//         select: { warehouseId: true },
//       });
//       scopedWarehouseIds = grants.map((g) => g.warehouseId);
//     }

//     const pageNum = Math.max(parseInt(page, 10) || 1, 1);
//     const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

//     const where = {
//       entityType: "INWARD",
//       AND: [
//         scopedWarehouseIds ? { warehouseId: { in: scopedWarehouseIds } } : {},
//         warehouseId ? { warehouseId } : {},
//         search ? { entityNumber: { contains: search, mode: "insensitive" } } : {},
//       ],
//     };

//     const [rows, total] = await Promise.all([
//       prisma.auditLog.findMany({
//         where,
//         orderBy: { createdAt: "desc" },
//         skip: (pageNum - 1) * pageSizeNum,
//         take: pageSizeNum,
//         include: { user: { select: { name: true, role: true } } },
//       }),
//       prisma.auditLog.count({ where }),
//     ]);

//     return res.json({
//       data: rows,
//       pagination: {
//         page: pageNum,
//         pageSize: pageSizeNum,
//         total,
//         totalPages: Math.ceil(total / pageSizeNum),
//       },
//     });
//   } catch (error) {
//     console.error("List GRN history error:", error);
//     return res.status(500).json({ message: "Failed to fetch history", error: error.message });
//   }
// }
