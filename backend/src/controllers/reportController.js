import prisma from "../config/prisma.js";
import { isFinanceSide, getFinanceWarehouseIds } from "../utils/outwardWorkflow.js";
 
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
 
const GRN_REQUIRED_DOCS = ["Vendor invoice", "E-way bill", "Unloading sign-off sheet"];
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
  return items.reduce((total, item) => total + Number(item.quantity || 0), 0);
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
    quantity: Number(item.quantity || 0),
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
    const [stockIn, stockOut] = await Promise.all([
      prisma.grnItem.aggregate({ _sum: { quantity: true }, where: scopeGrn }),
      prisma.minItem.aggregate({ _sum: { quantity: true }, where: scopeMin }),
    ]);
    const totalStock = (stockIn._sum.quantity || 0) - (stockOut._sum.quantity || 0);
 
    // ---- entries within the selected period ----
    // Sum in the database instead of pulling every GRN/outward row (with its
    // full item list) into Node just to add them up - this used to fetch
    // every transaction ever made in the selected range on every summary
    // load, which only got slower as the business grew.
    const [inwardAgg, outwardAgg, grnCount, minCount] = await Promise.all([
      prisma.grnItem.aggregate({
        _sum: { quantity: true },
        where: { grn: { ...warehouseWhere(warehouseIds), ...period } },
      }),
      prisma.minItem.aggregate({
        _sum: { quantity: true },
        where: { min: { ...warehouseWhere(warehouseIds), ...period } },
      }),
      prisma.grn.count({ where: { ...warehouseWhere(warehouseIds), ...period } }),
      prisma.min.count({ where: { ...warehouseWhere(warehouseIds), ...period } }),
    ]);

    const totalInwardUnits = inwardAgg._sum.quantity || 0;
    const totalOutwardUnits = outwardAgg._sum.quantity || 0;
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
        select: { id: true, outwardNumber: true, createdAt: true, items: { select: { category: true, sku: true, companyName: true, uom: true, quantity: true } } },
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
 *   - companyId only      -> every warehouse of that company
 *   - neither             -> total stock: every warehouse the caller can see
 *                            (all of them for SUPER_ADMIN, only the ones a
 *                            WAREHOUSE_MANAGER holds a MANAGE grant on)
 * A manager asking for a warehouse they don't manage gets a 403.
 * =========================================================
 */
export async function getStockLedger(req, res) {
  try {
    const { warehouseId, companyId, search = "", page = "1", pageSize = "20" } = req.query;

    // One warehouse, or (no warehouse chosen) everything the caller may see.
    // Throws a 403 if a manager asks for a warehouse they don't manage.
    let warehouseIds = await resolveWarehouseIds(req);

    // Company chosen but no warehouse: narrow to that company's warehouses
    // (still only ones the caller may see).
    if (!warehouseId && companyId) {
      const companyWarehouses = await prisma.warehouse.findMany({
        where: { companyId, ...(warehouseIds ? { id: { in: warehouseIds } } : {}) },
        select: { id: true },
      });
      warehouseIds = companyWarehouses.map((w) => w.id);
    }
 
    const searchWhere = search
      ? {
          OR: [
            { sku: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};
 
    const [inwardGroups, outwardGroups] = await Promise.all([
      prisma.grnItem.groupBy({
        by: ["category", "sku", "uom"],
        where: { grn: warehouseWhere(warehouseIds), ...searchWhere },
        _sum: { quantity: true },
      }),
      prisma.minItem.groupBy({
        by: ["category", "sku", "uom"],
        where: { min: warehouseWhere(warehouseIds), ...searchWhere },
        _sum: { quantity: true },
      }),
    ]);
 
    // Merge on category + sku (across warehouses too, when more than one is in
    // scope, so "total stock" shows one row per model). Items no longer carry a company, and older
    // entries that still have one must land in the same row as newer ones,
    // otherwise stock would show up split (inward under a brand, outward under "-").
    const key = (row) => `${row.category}::${row.sku}`;
    const merged = new Map();

    const addRow = (row, field) => {
      const k = key(row);
      const existing = merged.get(k);
      const qty = row._sum.quantity || 0;
      if (existing) {
        existing[field] += qty;
      } else {
        merged.set(k, {
          category: row.category,
          sku: row.sku,
          uom: row.uom,
          inward: field === "inward" ? qty : 0,
          outward: field === "outward" ? qty : 0,
        });
      }
    };

    for (const row of inwardGroups) addRow(row, "inward");
    for (const row of outwardGroups) addRow(row, "outward");

    const allRows = Array.from(merged.values())
      .map((row) => ({ ...row, currentStock: row.inward - row.outward }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku));
 
    const totals = allRows.reduce(
      (acc, row) => {
        acc.totalInward += row.inward;
        acc.totalOutward += row.outward;
        acc.currentStock += row.currentStock;
        return acc;
      },
      { totalInward: 0, totalOutward: 0, currentStock: 0 }
    );
 
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
