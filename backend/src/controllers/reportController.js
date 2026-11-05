import prisma from "../config/prisma.js";
import { warehouseIdsForCompanies } from "../utils/warehouseCompanies.js";
import { isFinanceSide, getFinanceWarehouseIds, getUserCompanyIds } from "../utils/outwardWorkflow.js";
import { INWARD, OUTWARD_SERIAL_SOURCES, canonicalInwardType, canonicalOutwardType, compareSerials } from "../utils/serialSources.js";
import { serialKey } from "../utils/serials.js";
import { transferInAt } from "../utils/transferSerials.js";
import { balancesByType, effectiveOutwardQty, outwardGroupBy } from "../utils/stock.js";
 
/**
 * =========================================================
 * REPORTS
 * =========================================================
 *
 * Powers the Reports page's Quick Summary cards and its
 * recent-transactions ledger. Everything here is computed in
 * the database (Prisma aggregates / scoped queries) rather
 * than in the browser, for the same reasons the rest of the
 * app scopes list endpoints server-side: the numbers have to
 * be correct for the caller's access level, and correctness
 * only holds if the aggregation runs where the data lives.
 * =========================================================
 */
 
const GRN_REQUIRED_DOCS = ["Vendor invoice", "E-way bill", "Delivery challan"];
const OUTWARD_REQUIRED_DOCS = ["Delivery challan", "Dispatch photo"];
 
// ---------------------------------------------------
// Same warehouse scoping rule used by listGrn / listOutward:
// SUPER_ADMIN sees everything, WAREHOUSE_MANAGER only what
// they hold a MANAGE grant on.
// ---------------------------------------------------
async function getScopedWarehouseIds(req) {
  if (req.user.role === "SUPER_ADMIN") return null; // null = unrestricted
  if (req.user.role === "WAREHOUSE_MANAGER") {
    const grants = await prisma.warehouseAccess.findMany({
      where: { userId: req.user.id, accessLevel: "MANAGE" },
      select: { warehouseId: true },
    });
    return grants.map((g) => g.warehouseId);
  }
  // Sales / Account: read-only, limited to their companies' warehouses.
  if (isFinanceSide(req.user.role)) return getFinanceWarehouseIds(req.user);
  return [];
}
 
// Resolves the effective warehouse filter for this request: a single
// warehouseId if the caller asked for one (and has access to it), the
// caller's full scoped set otherwise, or "unrestricted" for a
// SUPER_ADMIN who didn't pick one.
async function resolveWarehouseIds(req) {
  const { warehouseId } = req.query;
  const scoped = await getScopedWarehouseIds(req);
 
  if (warehouseId) {
    if (scoped && !scoped.includes(warehouseId)) {
      throw Object.assign(new Error("You don't have access to this warehouse"), { status: 403 });
    }
    return [warehouseId];
  }
 
  return scoped; // null = every warehouse, array = restricted set
}
 
function warehouseWhere(warehouseIds) {
  return warehouseIds ? { warehouseId: { in: warehouseIds } } : {};
}
 
function periodWhere(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return {};
  return {
    createdAt: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999`) } : {}),
    },
  };
}
 
function sumQuantity(items = []) {
  // An outward item counts with its final quantity once the warehouse manager has filled it (GRN items have none).
  return items.reduce((total, item) => total + Number(item.finalQuantity ?? item.quantity ?? 0), 0);
}
 
// True if any required document is missing from the uploaded set —
// mirrors calculateDocumentStatus()/documentStatus() in the inward
// and outward controllers.
function hasMissingDocs(requiredDocs, documents) {
  const uploaded = new Set(documents.map((d) => String(d.docCategory || "").trim().toLowerCase()));
  return requiredDocs.some((label) => {
    const required = label.toLowerCase();
    return ![...uploaded].some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
  });
}
 
function describeItems(items = []) {
  if (!items.length) return "-";
  const first = items[0];
  const label = [first.category, first.sku].filter(Boolean).join(" · ") || "Item";
  return items.length > 1 ? `${label} +${items.length - 1} more` : label;
}
 
// Full item list for the ledger row so the UI can show
// category (e.g. Inverters) + model (sku) + brand per item.
function ledgerItems(items = []) {
  return items.map((item) => ({
    category: item.category || null,
    sku: item.sku || null,
    companyName: item.companyName || null,
    quantity: Number(item.finalQuantity ?? item.quantity ?? 0),
    uom: item.uom || null,
  }));
}
 
/**
 * =========================================================
 * GET /api/reports/summary?warehouseId=&dateFrom=&dateTo=
 * =========================================================
 *
 * - totalStock is all-time (units on hand right now), not
 *   limited to the date range: it's every unit ever received
 *   into scope minus every unit ever issued out of it.
 * - totalTransactions / totalInwardUnits / totalOutwardUnits /
 *   documentsPending are scoped to the requested date range.
 * =========================================================
 */
export async function getReportSummary(req, res) {
  try {
    const { dateFrom, dateTo } = req.query;
    const warehouseIds = await resolveWarehouseIds(req);
    const scopeGrn = { grn: warehouseWhere(warehouseIds) };
    const scopeMin = { min: warehouseWhere(warehouseIds) };
    const period = periodWhere(dateFrom, dateTo);
 
    // ---- units currently on hand (all-time) ----
    const [stockIn0, stockOut0, transferIn, transferOut] = await Promise.all([
      prisma.grnItem.groupBy({ by: ["uom"], _sum: { quantity: true }, where: scopeGrn }),
      outwardGroupBy(prisma, { by: ["uom"], where: scopeMin }),
      // Stock transfers: arriving stock counts where it arrives, leaving stock where it leaves.
      prisma.stockTransferItem.groupBy({
        by: ["uom"],
        _sum: { quantity: true },
        where: { transfer: warehouseIds ? { toWarehouseId: { in: warehouseIds } } : {} },
      }),
      prisma.stockTransferItem.groupBy({
        by: ["uom"],
        _sum: { quantity: true },
        where: { transfer: warehouseIds ? { fromWarehouseId: { in: warehouseIds } } : {} },
      }),
    ]);
    const stockIn = [...stockIn0, ...transferIn];
    const stockOut = [...stockOut0, ...transferOut];
    // Quantities are kept per unit of measure (Pcs, Meters ...) - cables are not "units".
    const byUom = (groups) => {
      const out = {};
      for (const g of groups) out[g.uom || "Pcs"] = (out[g.uom || "Pcs"] || 0) + (g._sum.quantity || 0);
      return out;
    };
    const sumOf = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
    const inwardAll = byUom(stockIn);
    const outwardAll = byUom(stockOut);
    const stockByUom = {};
    for (const u of new Set([...Object.keys(inwardAll), ...Object.keys(outwardAll)])) {
      stockByUom[u] = (inwardAll[u] || 0) - (outwardAll[u] || 0);
    }
    const totalStock = sumOf(stockByUom);

    // ---- entries within the selected period ----
    // Sum in the database instead of pulling every GRN/outward row (with its
    // full item list) into Node just to add them up - this used to fetch
    // every transaction ever made in the selected range on every summary
    // load, which only got slower as the business grew.
    const [inwardAgg, outwardAgg, grnCount, minCount] = await Promise.all([
      prisma.grnItem.groupBy({
        by: ["uom"],
        _sum: { quantity: true },
        where: { grn: { ...warehouseWhere(warehouseIds), ...period } },
      }),
      outwardGroupBy(prisma, {
        by: ["uom"],
        where: { min: { ...warehouseWhere(warehouseIds), ...period } },
      }),
      prisma.grn.count({ where: { ...warehouseWhere(warehouseIds), ...period } }),
      prisma.min.count({ where: { ...warehouseWhere(warehouseIds), ...period } }),
    ]);

    const inwardByUom = byUom(inwardAgg);
    const outwardByUom = byUom(outwardAgg);
    const totalInwardUnits = sumOf(inwardByUom);
    const totalOutwardUnits = sumOf(outwardByUom);
    const totalTransactions = grnCount + minCount;

    // ---- documents pending, across this period's entries ----
    // Only need ids here (not the full item detail above), so this stays a
    // lightweight query even when the period covers a lot of entries.
    const [grnRows, outwardRows] = await Promise.all([
      prisma.grn.findMany({
        where: { ...warehouseWhere(warehouseIds), ...period },
        select: { id: true },
      }),
      prisma.min.findMany({
        where: { ...warehouseWhere(warehouseIds), ...period },
        select: { id: true },
      }),
    ]);
    const grnIds = grnRows.map((g) => g.id);
    const outwardIds = outwardRows.map((o) => o.id);
 
    const [grnDocs, outwardDocs] = await Promise.all([
      grnIds.length
        ? prisma.document.findMany({ where: { linkedType: "grn", linkedId: { in: grnIds } }, select: { linkedId: true, docCategory: true } })
        : [],
      outwardIds.length
        ? prisma.document.findMany({ where: { linkedType: "outward", linkedId: { in: outwardIds } }, select: { linkedId: true, docCategory: true } })
        : [],
    ]);
 
    const pendingGrnCount = grnIds.filter((id) =>
      hasMissingDocs(GRN_REQUIRED_DOCS, grnDocs.filter((d) => d.linkedId === id))
    ).length;
    const pendingOutwardCount = outwardIds.filter((id) =>
      hasMissingDocs(OUTWARD_REQUIRED_DOCS, outwardDocs.filter((d) => d.linkedId === id))
    ).length;
 
    return res.json({
      data: {
        totalStock,
        stockByUom,
        inwardByUom,
        outwardByUom,
        totalTransactions,
        totalInwardUnits,
        totalOutwardUnits,
        documentsPending: pendingGrnCount + pendingOutwardCount,
        pendingGrnCount,
        pendingOutwardCount,
      },
    });
  } catch (error) {
    console.error("Report summary error:", error);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to build report summary",
      error: error.message,
    });
  }
}
 
/**
 * =========================================================
 * GET /api/reports/ledger?warehouseId=&dateFrom=&dateTo=&limit=
 * =========================================================
 *
 * Most recent GRNs + outward entries in scope, merged into one
 * chronological ledger. `limit` caps the merged result (default
 * 10, max 50) - it is NOT split per source, so e.g. limit=10
 * can return anywhere from 0 to 10 inward/outward rows combined.
 * =========================================================
 */
export async function getReportLedger(req, res) {
  try {
    const { dateFrom, dateTo, limit = "10" } = req.query;
    const warehouseIds = await resolveWarehouseIds(req);
    const period = periodWhere(dateFrom, dateTo);
    const take = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
 
    const [grns, outwards] = await Promise.all([
      prisma.grn.findMany({
        where: { ...warehouseWhere(warehouseIds), ...period },
        select: { id: true, grnNumber: true, createdAt: true, items: { select: { category: true, sku: true, companyName: true, uom: true, quantity: true } } },
        orderBy: { createdAt: "desc" },
        take,
      }),
      prisma.min.findMany({
        where: { ...warehouseWhere(warehouseIds), ...period },
        select: { id: true, outwardNumber: true, createdAt: true, items: { select: { category: true, sku: true, companyName: true, uom: true, quantity: true, finalQuantity: true } } },
        orderBy: { createdAt: "desc" },
        take,
      }),
    ]);
 
    const rows = [
      ...grns.map((g) => ({
        id: `grn-${g.id}`,
        date: g.createdAt,
        ref: g.grnNumber,
        item: describeItems(g.items),
        items: ledgerItems(g.items),
        type: "in",
        qty: sumQuantity(g.items),
      })),
      ...outwards.map((o) => ({
        id: `min-${o.id}`,
        date: o.createdAt,
        ref: o.outwardNumber,
        item: describeItems(o.items),
        items: ledgerItems(o.items),
        type: "out",
        qty: sumQuantity(o.items),
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, take);
 
    return res.json({ data: rows });
  } catch (error) {
    console.error("Report ledger error:", error);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to build report ledger",
      error: error.message,
    });
  }
}
 
/**
 * =========================================================
 * GET /api/reports/stock-ledger?warehouseId=&companyId=&search=&page=&pageSize=
 * =========================================================
 *
 * Per-item stock ledger: every distinct (category, model/SKU) that has
 * ever moved through inward or outward, with its lifetime inward total,
 * outward total, and current balance — the detail behind the "Stock
 * Ledger Summary" card.
 *
 * What it covers depends on what is asked for:
 *   - warehouseId         -> that one warehouse
 *   - companyId only      -> that company's stock in all its warehouses
 *   - company + warehouse -> that company's stock in that one warehouse
 *   - neither             -> total stock: every warehouse the caller can see (Sales / Account only get
 *                            the entries of their own companies)
 *                            (all of them for SUPER_ADMIN, only the ones a
 *                            WAREHOUSE_MANAGER holds a MANAGE grant on)
 * A manager asking for a warehouse they don't manage gets a 403.
 * =========================================================
 */
export async function getStockLedger(req, res) {
  try {
    const { warehouseId, companyId, stockType = "", search = "", page = "1", pageSize = "20" } = req.query;

    // One warehouse, or (no warehouse chosen) everything the caller may see.
    // Throws a 403 if a manager asks for a warehouse they don't manage.
    let warehouseIds = await resolveWarehouseIds(req);

    // Company chosen but no warehouse: narrow to that company's warehouses
    // (still only ones the caller may see).
    // A warehouse can be shared by several companies, so a company's stock is the entries made for that
    // company (not everything inside its warehouses). Sales / Account / Warehouse manager only ever see
    // the companies they belong to; the super admin sees every company.
    const restricted = req.user.role !== "SUPER_ADMIN";
    const myCompanyIds = restricted ? await getUserCompanyIds(req.user) : null;

    if (companyId && restricted && !myCompanyIds.includes(companyId)) {
      return res.status(403).json({ message: "You don't have access to this company" });
    }

    let companyFilter = {};
    let companyNames = null; // null = no company limit (used for the stock transfer rows)
    // Sales / Account are limited to their companies' entries even with no company chosen. A warehouse
    // manager looking at a warehouse they manage sees that whole warehouse (unless they pick a company).
    if (companyId || isFinanceSide(req.user.role)) {
      const ids = companyId ? [companyId] : myCompanyIds;
      const companies = await prisma.company.findMany({ where: { id: { in: ids } }, select: { name: true } });
      if (companyId && !companies.length) {
        return res.status(404).json({ message: "Company not found" });
      }
      companyFilter = {
        OR: companies.map((c) => ({ companyName: { equals: c.name.trim(), mode: "insensitive" } })),
      };
      companyNames = companies.map((c) => c.name.trim());
      // Company chosen but no warehouse: narrow to that company's warehouses (still only ones the caller may see).
      if (companyId && !warehouseId) {
        warehouseIds = await warehouseIdsForCompanies([companyId], warehouseIds);
      }
    }

    const searchWhere = search
      ? {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};
 
    // Stock is split by company, warehouse and stock type (New / Service / Return / Faulty / Repair).
    // Outward entries don't record which inward type they were taken from, so each one is taken from the
    // types its outward type uses (Sale <- New / Return, Service <- Service / Faulty, Replacement <- Service /
    // Repair, Scrap <- Faulty) - the same rule as the outward form's stock list.
    const transferCompanyWhere = (field) =>
      companyNames ? { OR: companyNames.map((name) => ({ [field]: { equals: name, mode: "insensitive" } })) } : {};
    const transferSelect = { category: true, sku: true, uom: true, quantity: true, stockType: true };
    const [inwardRows, outwardRows, transferInRows, transferOutRows] = await Promise.all([
      prisma.grnItem.findMany({
        where: { grn: { AND: [warehouseWhere(warehouseIds), companyFilter] }, ...searchWhere },
        select: { category: true, sku: true, uom: true, quantity: true, companyName: true, grn: { select: { warehouseId: true, inwardType: true, companyName: true } } },
      }),
      prisma.minItem.findMany({
        // A rejected outward never leaves the warehouse, so it is not counted (same rule as the outward form).
        where: { min: { AND: [warehouseWhere(warehouseIds), companyFilter], status: { not: "REJECTED" } }, ...searchWhere },
        select: { category: true, sku: true, uom: true, quantity: true, finalQuantity: true, min: { select: { warehouseId: true, outwardType: true, companyName: true } } },
      }),
      prisma.stockTransferItem.findMany({
        where: {
          transfer: { AND: [warehouseIds ? { toWarehouseId: { in: warehouseIds } } : {}, transferCompanyWhere("toCompanyName")] },
          ...searchWhere,
        },
        select: { ...transferSelect, transfer: { select: { toWarehouseId: true, toCompanyName: true } } },
      }),
      prisma.stockTransferItem.findMany({
        where: {
          transfer: { AND: [warehouseIds ? { fromWarehouseId: { in: warehouseIds } } : {}, transferCompanyWhere("fromCompanyName")] },
          ...searchWhere,
        },
        select: { ...transferSelect, transfer: { select: { fromWarehouseId: true, fromCompanyName: true } } },
      }),
    ]);

    const TYPE_LABELS = {
      [INWARD.NEW]: "New",
      [INWARD.SERVICE]: "Service",
      [INWARD.RETURN]: "Return",
      [INWARD.FAULTY]: "Faulty",
      [INWARD.REPAIR]: "Repair",
    };
    const norm = (v) => String(v || "").trim().toLowerCase();
    const groups = new Map(); // company | warehouse | category | sku -> { ..., inward: Map<type, qty>, outward: [...] }
    const groupFor = (row, warehouseId, companyName) => {
      const k = [norm(companyName), warehouseId, norm(row.category), norm(row.sku)].join("::");
      if (!groups.has(k)) {
        groups.set(k, {
          companyName: String(companyName || "").trim(),
          warehouseId,
          category: row.category,
          sku: row.sku,
          uom: row.uom,
          inward: new Map(),
          transferIn: new Map(),
          transferOut: new Map(),
          outwardList: [],
        });
      }
      return groups.get(k);
    };

    for (const row of inwardRows) {
      const qty = Number(row.quantity) || 0;
      if (!qty) continue;
      const g = groupFor(row, row.grn?.warehouseId, row.grn?.companyName || row.companyName);
      const type = canonicalInwardType(row.grn?.inwardType) || INWARD.NEW;
      g.inward.set(type, (g.inward.get(type) || 0) + qty);
    }
    for (const row of transferInRows) {
      const qty = Number(row.quantity) || 0;
      if (!qty) continue;
      const g = groupFor(row, row.transfer.toWarehouseId, row.transfer.toCompanyName);
      const type = canonicalInwardType(row.stockType) || INWARD.NEW;
      g.transferIn.set(type, (g.transferIn.get(type) || 0) + qty);
    }
    for (const row of transferOutRows) {
      const qty = Number(row.quantity) || 0;
      if (!qty) continue;
      const g = groupFor(row, row.transfer.fromWarehouseId, row.transfer.fromCompanyName);
      const type = canonicalInwardType(row.stockType) || INWARD.NEW;
      g.transferOut.set(type, (g.transferOut.get(type) || 0) + qty);
    }
    for (const row of outwardRows) {
      const qty = effectiveOutwardQty(row);
      if (!qty) continue;
      const g = groupFor(row, row.min?.warehouseId, row.min?.companyName);
      g.outwardList.push({ outwardType: canonicalOutwardType(row.min?.outwardType), qty });
    }

    const warehouseIdsInUse = [...new Set([...groups.values()].map((g) => g.warehouseId).filter(Boolean))];
    const warehouseRows = warehouseIdsInUse.length
      ? await prisma.warehouse.findMany({ where: { id: { in: warehouseIdsInUse } }, select: { id: true, name: true, code: true } })
      : [];
    const warehouseNames = new Map(warehouseRows.map((w) => [w.id, w.name]));

    const ledgerRows = [];
    for (const g of groups.values()) {
      for (const b of balancesByType(g, g.outwardList)) {
        ledgerRows.push({
          companyName: g.companyName,
          warehouseId: g.warehouseId,
          warehouseName: warehouseNames.get(g.warehouseId) || "",
          category: g.category,
          sku: g.sku,
          uom: g.uom,
          stockType: TYPE_LABELS[b.type] || b.type,
          inward: b.inward,
          outward: b.outward,
          transferIn: b.transferIn,
          transferOut: b.transferOut,
          currentStock: b.inward + b.transferIn - b.outward - b.transferOut,
        });
      }
    }

    // Optional stock type filter (New / Service / Return / Faulty / Repair) - totals and pages follow it.
    const wantedType = String(stockType).trim().toLowerCase();
    const allRows = (wantedType ? ledgerRows.filter((r) => r.stockType.toLowerCase() === wantedType) : ledgerRows).sort(
      (a, b) =>
        a.companyName.localeCompare(b.companyName) ||
        a.warehouseName.localeCompare(b.warehouseName) ||
        a.category.localeCompare(b.category) ||
        a.sku.localeCompare(b.sku) ||
        a.stockType.localeCompare(b.stockType)
    );
 
    const totals = allRows.reduce(
      (acc, row) => {
        acc.totalInward += row.inward;
        acc.totalOutward += row.outward;
        acc.totalTransferIn += row.transferIn;
        acc.totalTransferOut += row.transferOut;
        acc.currentStock += row.currentStock;
        return acc;
      },
      { totalInward: 0, totalOutward: 0, totalTransferIn: 0, totalTransferOut: 0, currentStock: 0 }
    );
    // Same totals per unit of measure, so meters and pieces are never added together.
    const totalsByUom = {};
    for (const row of allRows) {
      const u = row.uom || "Pcs";
      const t = (totalsByUom[u] ||= { totalInward: 0, totalOutward: 0, totalTransferIn: 0, totalTransferOut: 0, currentStock: 0 });
      t.totalInward += row.inward;
      t.totalOutward += row.outward;
      t.totalTransferIn += row.transferIn;
      t.totalTransferOut += row.transferOut;
      t.currentStock += row.currentStock;
    }
    totals.byUom = totalsByUom;
 
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const start = (pageNum - 1) * pageSizeNum;
    const pageRows = allRows.slice(start, start + pageSizeNum);
 
    return res.json({
      data: pageRows,
      totals,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total: allRows.length,
        totalPages: Math.ceil(allRows.length / pageSizeNum) || 1,
      },
    });
  } catch (error) {
    console.error("Stock ledger error:", error);
    return res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Failed to build stock ledger", error: error.message });
  }
}


/**
 * =========================================================
 * SERIAL NUMBER DRILL-DOWN OF THE STOCK LEDGER
 * =========================================================
 * Stock Ledger row (category + model) -> its serial numbers -> IN (inward entry) / OUT (outward entry).
 *
 * A serial's life is a timeline of events: inward (IN), stock transfer in (IN), outward (OUT), stock transfer
 * out (OUT). Its status is its LAST event. A serial that has an OUT but no IN in scope was scanned on an
 * outward without ever being received on an inward ("out without inward") - it is still listed and found by
 * the serial search, and flagged.
 *
 *   GET /api/reports/stock-ledger/serials              serials of one product (or a serial search)
 *   GET /api/reports/stock-ledger/inward/:grnId        one inward entry's serials + where each one went out
 * =========================================================
 */
const SERIAL_TYPE_LABELS = {
  [INWARD.NEW]: "New",
  [INWARD.SERVICE]: "Service",
  [INWARD.RETURN]: "Return",
  [INWARD.FAULTY]: "Faulty",
  [INWARD.REPAIR]: "Repair",
};
const OUT_OF_SCOPE = { id: "__none__" };

// Same visibility rules as getStockLedger (warehouse access + company limits), plus an optional exact company name.
async function resolveLedgerScope(req) {
  const { warehouseId, companyId, companyName } = req.query;
  let warehouseIds = await resolveWarehouseIds(req);

  const restricted = req.user.role !== "SUPER_ADMIN";
  const myCompanyIds = restricted ? await getUserCompanyIds(req.user) : null;
  if (companyId && restricted && !myCompanyIds.includes(companyId)) {
    throw Object.assign(new Error("You don't have access to this company"), { status: 403 });
  }

  let names = null; // null = no company limit
  if (companyId || isFinanceSide(req.user.role)) {
    const ids = companyId ? [companyId] : myCompanyIds;
    const companies = await prisma.company.findMany({ where: { id: { in: ids } }, select: { name: true } });
    if (companyId && !companies.length) throw Object.assign(new Error("Company not found"), { status: 404 });
    names = companies.map((c) => c.name.trim());
    if (companyId && !warehouseId) warehouseIds = await warehouseIdsForCompanies([companyId], warehouseIds);
  }
  if (companyName) {
    const wanted = String(companyName).trim().toLowerCase();
    names = names ? names.filter((n) => n.toLowerCase() === wanted) : [String(companyName).trim()];
  }

  const companyFilter = names ? (names.length ? { OR: names.map((n) => ({ companyName: { equals: n, mode: "insensitive" } })) } : OUT_OF_SCOPE) : {};
  return { warehouseIds, companyFilter, names };
}

const transferNameWhere = (field, names) =>
  names ? (names.length ? { OR: names.map((n) => ({ [field]: { equals: n, mode: "insensitive" } })) } : OUT_OF_SCOPE) : {};

export async function getStockLedgerSerials(req, res) {
  try {
    const { category = "", sku = "", stockType = "", search = "", status = "", page = "1", pageSize = "50" } = req.query;
    const scope = await resolveLedgerScope(req);
    const { warehouseIds, companyFilter, names } = scope;

    const product = {
      ...(category ? { category: { equals: String(category).trim(), mode: "insensitive" } } : {}),
      ...(sku ? { sku: { equals: String(sku).trim(), mode: "insensitive" } } : {}),
      ...(search ? { serialNo: { contains: String(search).trim(), mode: "insensitive" } } : {}),
    };
    // Without a product the caller must be searching for a serial number.
    if (!category && !sku && !String(search).trim()) {
      return res.status(400).json({ message: "Choose an item from the ledger or enter a serial number to search" });
    }

    const [grnRows, minRows, tIn, tOut] = await Promise.all([
      prisma.grnSerial.findMany({
        where: { ...product, grn: { AND: [warehouseWhere(warehouseIds), companyFilter] } },
        select: { serialNo: true, category: true, sku: true, grn: { select: { id: true, grnNumber: true, createdAt: true, inwardType: true, warehouseId: true, companyName: true } } },
        take: 20000,
      }),
      prisma.minSerial.findMany({
        where: { ...product, min: { AND: [warehouseWhere(warehouseIds), companyFilter], status: { not: "REJECTED" } } },
        select: { serialNo: true, category: true, sku: true, min: { select: { id: true, outwardNumber: true, createdAt: true, status: true, outwardType: true, warehouseId: true, companyName: true } } },
        take: 20000,
      }),
      prisma.stockTransferSerial.findMany({
        where: { ...product, transfer: { AND: [warehouseIds ? { toWarehouseId: { in: warehouseIds } } : {}, transferNameWhere("toCompanyName", names)] } },
        select: { serialNo: true, category: true, sku: true, stockType: true, transfer: { select: { id: true, transferNumber: true, createdAt: true, toWarehouseId: true, toCompanyName: true } } },
        take: 20000,
      }),
      prisma.stockTransferSerial.findMany({
        where: { ...product, transfer: { AND: [warehouseIds ? { fromWarehouseId: { in: warehouseIds } } : {}, transferNameWhere("fromCompanyName", names)] } },
        select: { serialNo: true, category: true, sku: true, stockType: true, transfer: { select: { id: true, transferNumber: true, createdAt: true, fromWarehouseId: true, fromCompanyName: true } } },
        take: 20000,
      }),
    ]);

    const serials = new Map(); // product + serial -> { serialNo, category, sku, events: [] }
    const serialFor = (r) => {
      const key = `${serialKey(r.category, r.sku)}||${String(r.serialNo).trim().toLowerCase()}`;
      if (!serials.has(key)) serials.set(key, { key, serialNo: r.serialNo, category: r.category, sku: r.sku, events: [] });
      return serials.get(key);
    };

    for (const r of grnRows) {
      serialFor(r).events.push({
        dir: "IN", kind: "INWARD", id: r.grn.id, number: r.grn.grnNumber, at: r.grn.createdAt,
        type: canonicalInwardType(r.grn.inwardType) || INWARD.NEW, warehouseId: r.grn.warehouseId, companyName: r.grn.companyName,
      });
    }
    for (const r of tIn) {
      serialFor(r).events.push({
        dir: "IN", kind: "TRANSFER_IN", id: r.transfer.id, number: r.transfer.transferNumber, at: transferInAt(r.transfer.createdAt),
        type: canonicalInwardType(r.stockType) || INWARD.NEW, warehouseId: r.transfer.toWarehouseId, companyName: r.transfer.toCompanyName,
      });
    }
    for (const r of minRows) {
      serialFor(r).events.push({
        dir: "OUT", kind: "OUTWARD", id: r.min.id, number: r.min.outwardNumber, at: r.min.createdAt,
        outwardType: canonicalOutwardType(r.min.outwardType), status: r.min.status, warehouseId: r.min.warehouseId, companyName: r.min.companyName,
      });
    }
    for (const r of tOut) {
      serialFor(r).events.push({
        dir: "OUT", kind: "TRANSFER_OUT", id: r.transfer.id, number: r.transfer.transferNumber, at: r.transfer.createdAt,
        warehouseId: r.transfer.fromWarehouseId, companyName: r.transfer.fromCompanyName,
      });
    }

    const wantedType = String(stockType).trim().toLowerCase();
    const list = [];
    for (const s of serials.values()) {
      s.events.sort((a, b) => new Date(a.at) - new Date(b.at));
      const ins = s.events.filter((e) => e.dir === "IN");
      const outs = s.events.filter((e) => e.dir === "OUT");
      const last = s.events[s.events.length - 1];
      const lastIn = ins[ins.length - 1] || null;
      const lastOut = outs[outs.length - 1] || null;
      const inStock = last.dir === "IN";
      const outWithoutInward = ins.length === 0;

      // Stock type = how it last came in; an out-without-inward serial has none, so it matches the types its outward type may use.
      if (wantedType) {
        const matches = lastIn
          ? (SERIAL_TYPE_LABELS[lastIn.type] || lastIn.type).toLowerCase() === wantedType
          : outs.some((o) => (OUTWARD_SERIAL_SOURCES[o.outwardType] || []).some((t) => (SERIAL_TYPE_LABELS[t] || t).toLowerCase() === wantedType));
        if (!matches) continue;
      }

      list.push({
        key: s.key,
        serialNo: s.serialNo,
        category: s.category,
        sku: s.sku,
        status: inStock ? "IN_STOCK" : "OUT",
        outWithoutInward,
        stockType: lastIn ? SERIAL_TYPE_LABELS[lastIn.type] || lastIn.type : null,
        inward: lastIn && { kind: lastIn.kind, id: lastIn.id, number: lastIn.number, at: lastIn.at, type: lastIn.type, warehouseId: lastIn.warehouseId },
        // The OUT that matters is the one after the last IN (an older OUT of a unit that came back in is history).
        outward: lastOut && (!lastIn || new Date(lastOut.at) >= new Date(lastIn.at)) ? lastOut : null,
        timesIn: ins.length,
        timesOut: outs.length,
      });
    }

    const counts = list.reduce(
      (c, r) => {
        c.total += 1;
        if (r.status === "IN_STOCK") c.inStock += 1;
        else c.out += 1;
        if (r.outWithoutInward) c.outWithoutInward += 1;
        return c;
      },
      { total: 0, inStock: 0, out: 0, outWithoutInward: 0 }
    );

    const wantedStatus = String(status).trim().toLowerCase();
    const filtered = list
      .filter((r) => {
        if (wantedStatus === "in") return r.status === "IN_STOCK";
        if (wantedStatus === "out") return r.status === "OUT";
        if (wantedStatus === "no_inward") return r.outWithoutInward;
        return true;
      })
      .sort((a, b) => compareSerials(a.serialNo, b.serialNo));

    const warehouseIdsInUse = [...new Set(filtered.flatMap((r) => [r.inward?.warehouseId, r.outward?.warehouseId]).filter(Boolean))];
    const whRows = warehouseIdsInUse.length ? await prisma.warehouse.findMany({ where: { id: { in: warehouseIdsInUse } }, select: { id: true, name: true } }) : [];
    const whNames = new Map(whRows.map((w) => [w.id, w.name]));

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSizeNum = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
    const start = (pageNum - 1) * pageSizeNum;
    const rows = filtered.slice(start, start + pageSizeNum).map((r) => ({
      ...r,
      warehouseName: whNames.get(r.inward?.warehouseId || r.outward?.warehouseId) || "",
    }));

    return res.json({
      data: rows,
      counts,
      pagination: { page: pageNum, pageSize: pageSizeNum, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSizeNum) || 1 },
    });
  } catch (error) {
    console.error("Stock ledger serials error:", error);
    return res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Failed to load serial numbers", error: error.message });
  }
}

export async function getInwardSerialTrail(req, res) {
  try {
    const { grnId } = req.params;
    const { category = "", sku = "" } = req.query;
    const { warehouseIds, companyFilter } = await resolveLedgerScope({ ...req, query: { ...req.query, companyId: undefined, warehouseId: undefined } });

    const grn = await prisma.grn.findFirst({
      where: { id: grnId, AND: [warehouseWhere(warehouseIds), companyFilter] },
      select: { id: true, grnNumber: true, createdAt: true, inwardType: true, companyName: true, warehouseId: true, warehouse: { select: { name: true } } },
    });
    if (!grn) return res.status(404).json({ message: "Inward entry not found" });

    const product = {
      ...(category ? { category: { equals: String(category).trim(), mode: "insensitive" } } : {}),
      ...(sku ? { sku: { equals: String(sku).trim(), mode: "insensitive" } } : {}),
    };
    const own = await prisma.grnSerial.findMany({ where: { grnId, ...product }, select: { serialNo: true, category: true, sku: true } });
    if (!own.length) {
      return res.json({ inward: { id: grn.id, grnNumber: grn.grnNumber, createdAt: grn.createdAt, inwardType: canonicalInwardType(grn.inwardType), companyName: grn.companyName, warehouseName: grn.warehouse?.name || "" }, data: [], counts: { total: 0, out: 0, inStock: 0 } });
    }

    const match = own.map((s) => ({ serialNo: { equals: s.serialNo, mode: "insensitive" } }));
    const [laterIns, outs] = await Promise.all([
      prisma.grnSerial.findMany({
        where: { OR: match, grnId: { not: grnId }, grn: { warehouseId: grn.warehouseId, createdAt: { gt: grn.createdAt } } },
        select: { serialNo: true, category: true, sku: true, grn: { select: { createdAt: true } } },
      }),
      prisma.minSerial.findMany({
        where: { OR: match, min: { warehouseId: grn.warehouseId, status: { not: "REJECTED" }, createdAt: { gte: grn.createdAt } } },
        select: { serialNo: true, category: true, sku: true, min: { select: { id: true, outwardNumber: true, createdAt: true, status: true, outwardType: true } } },
      }),
    ]);

    const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    const rows = own.map((s) => {
      const key = serialKey(s.category, s.sku);
      const nextIn = laterIns
        .filter((r) => same(r.serialNo, s.serialNo) && serialKey(r.category, r.sku) === key)
        .map((r) => new Date(r.grn.createdAt))
        .sort((a, b) => a - b)[0];
      // The first outward after THIS inward (and before the unit came in again, if it did).
      const out = outs
        .filter((r) => same(r.serialNo, s.serialNo) && serialKey(r.category, r.sku) === key && (!nextIn || new Date(r.min.createdAt) < nextIn))
        .sort((a, b) => new Date(a.min.createdAt) - new Date(b.min.createdAt))[0];
      return {
        serialNo: s.serialNo,
        category: s.category,
        sku: s.sku,
        outward: out ? { id: out.min.id, number: out.min.outwardNumber, at: out.min.createdAt, status: out.min.status, outwardType: canonicalOutwardType(out.min.outwardType) } : null,
      };
    });
    rows.sort((a, b) => compareSerials(a.serialNo, b.serialNo));

    const out = rows.filter((r) => r.outward).length;
    return res.json({
      inward: { id: grn.id, grnNumber: grn.grnNumber, createdAt: grn.createdAt, inwardType: canonicalInwardType(grn.inwardType), companyName: grn.companyName, warehouseName: grn.warehouse?.name || "" },
      data: rows,
      counts: { total: rows.length, out, inStock: rows.length - out },
    });
  } catch (error) {
    console.error("Inward serial trail error:", error);
    return res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Failed to load inward serial numbers", error: error.message });
  }
}
