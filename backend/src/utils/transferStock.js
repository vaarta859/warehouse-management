import { INWARD, canonicalInwardType, canonicalOutwardType } from "./serialSources.js";
import { balancesByType, stockKey } from "./stock.js";
import { serialKey } from "./serials.js";
import { serialWhere, transferInAt } from "./transferSerials.js";

/**
 * =========================================================
 * STOCK OF ONE COMPANY INSIDE ONE WAREHOUSE (for stock transfers)
 * =========================================================
 * Same numbers as the Stock Ledger shows for that company + warehouse:
 *
 *   available = inward + transferred in - outward - transferred out        (per category + model + stock type)
 *
 * and, for the serial numbers: which serial numbers are really in that company's stock there right now.
 *
 * Returns:
 *   rows    [{ category, sku, uom, stockType, stockTypeLabel, available, serialNos: [...] }]   (available > 0 only)
 *
 * `serialNos` are the serial numbers of that line that can be sent (they are part of `available`).
 * Units without a recorded serial number are `available - serialNos.length`.
 * =========================================================
 */
export const TYPE_LABELS = {
  [INWARD.NEW]: "New",
  [INWARD.SERVICE]: "Service",
  [INWARD.RETURN]: "Return",
  [INWARD.FAULTY]: "Faulty",
  [INWARD.REPAIR]: "Repair",
};

const eq = (name) => ({ equals: String(name || "").trim(), mode: "insensitive" });
const addTo = (map, type, qty) => map.set(type, (map.get(type) || 0) + qty);
const lower = (v) => String(v || "").trim().toLowerCase();

// Only these products (category + model), or everything when no list is given.
const productWhere = (products) =>
  products?.length ? { OR: products.map((p) => ({ category: eq(p.category), sku: eq(p.sku) })) } : {};

// withSerials: false skips the (slow) serial number lookup - the stock list opens fast and serials are loaded per model.
export async function getLocationStock(db, { warehouseId, companyName, withSerials = true, products = null }) {
  const only = productWhere(products);
  const [inwardRows, outwardRows, transferInRows, transferOutRows] = await Promise.all([
    db.grnItem.findMany({
      where: { grn: { warehouseId, companyName: eq(companyName) }, ...only },
      select: { category: true, sku: true, uom: true, quantity: true, grn: { select: { inwardType: true } } },
    }),
    db.minItem.findMany({
      where: { min: { warehouseId, companyName: eq(companyName), status: { not: "REJECTED" } }, ...only },
      select: { category: true, sku: true, uom: true, quantity: true, min: { select: { outwardType: true } } },
    }),
    db.stockTransferItem.findMany({
      where: { transfer: { toWarehouseId: warehouseId, toCompanyName: eq(companyName) }, ...only },
      select: { category: true, sku: true, uom: true, quantity: true, stockType: true },
    }),
    db.stockTransferItem.findMany({
      where: { transfer: { fromWarehouseId: warehouseId, fromCompanyName: eq(companyName) }, ...only },
      select: { category: true, sku: true, uom: true, quantity: true, stockType: true },
    }),
  ]);

  const groups = new Map();
  const groupFor = (row) => {
    const key = stockKey(row.category, row.sku);
    if (!groups.has(key)) {
      groups.set(key, {
        category: row.category,
        sku: row.sku,
        uom: row.uom,
        inward: new Map(),
        transferIn: new Map(),
        transferOut: new Map(),
        outwardList: [],
      });
    }
    return groups.get(key);
  };

  for (const row of inwardRows) {
    const qty = Number(row.quantity) || 0;
    if (qty) addTo(groupFor(row).inward, canonicalInwardType(row.grn?.inwardType) || INWARD.NEW, qty);
  }
  for (const row of transferInRows) {
    const qty = Number(row.quantity) || 0;
    if (qty) addTo(groupFor(row).transferIn, canonicalInwardType(row.stockType) || INWARD.NEW, qty);
  }
  for (const row of transferOutRows) {
    const qty = Number(row.quantity) || 0;
    if (qty) addTo(groupFor(row).transferOut, canonicalInwardType(row.stockType) || INWARD.NEW, qty);
  }
  for (const row of outwardRows) {
    const qty = Number(row.quantity) || 0;
    if (qty) groupFor(row).outwardList.push({ outwardType: canonicalOutwardType(row.min?.outwardType), qty });
  }

  const serialMap = withSerials ? await getLocationSerials(db, { warehouseId, companyName, products }) : new Map();

  const rows = [];
  for (const g of groups.values()) {
    for (const b of balancesByType(g, g.outwardList)) {
      const available = b.inward + b.transferIn - b.outward - b.transferOut;
      if (available <= 0) continue;
      const serialNos = serialMap.get(`${serialKey(g.category, g.sku)}|${b.type}`) || [];
      rows.push({
        category: g.category,
        sku: g.sku,
        uom: g.uom,
        stockType: b.type,
        stockTypeLabel: TYPE_LABELS[b.type] || b.type,
        available,
        // never more serial numbers than units
        serialNos: serialNos.slice(0, available),
      });
    }
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku) || a.stockTypeLabel.localeCompare(b.stockTypeLabel));
  return { rows };
}

/**
 * Serial numbers that are in this company's stock in this warehouse right now.
 * Map<`${serialKey(category, sku)}|${stockType}`, serialNo[]>
 *
 * A serial is "here" when it came in here (inward entry of this company, or a transfer into this company +
 * warehouse) and has not left since (an outward entry, or a transfer out) - the same rule the outward form uses.
 */
async function getLocationSerials(db, { warehouseId, companyName, products = null }) {
  const only = productWhere(products);
  const [grnSerials, transferSerials] = await Promise.all([
    db.grnSerial.findMany({
      where: { grn: { warehouseId, companyName: eq(companyName) }, ...only },
      select: { serialNo: true, category: true, sku: true, grn: { select: { inwardType: true, createdAt: true } } },
    }),
    db.stockTransferSerial.findMany({
      where: { transfer: { toWarehouseId: warehouseId, toCompanyName: eq(companyName) }, ...only },
      select: { serialNo: true, category: true, sku: true, stockType: true, transfer: { select: { createdAt: true } } },
    }),
  ]);

  // latest arrival of each serial (per product)
  const arrivals = new Map(); // key|serial -> { serialNo, category, sku, type, at }
  const arrive = (row, type, at) => {
    const k = `${serialKey(row.category, row.sku)}|${lower(row.serialNo)}`;
    const time = new Date(at).getTime();
    const existing = arrivals.get(k);
    if (!existing || time > existing.at) arrivals.set(k, { serialNo: row.serialNo, category: row.category, sku: row.sku, type, at: time });
  };
  for (const r of grnSerials) arrive(r, canonicalInwardType(r.grn?.inwardType) || INWARD.NEW, r.grn.createdAt);
  for (const r of transferSerials) arrive(r, canonicalInwardType(r.stockType) || INWARD.NEW, transferInAt(r.transfer.createdAt));
  if (!arrivals.size) return new Map();

  const candidates = [...arrivals.values()].map((a) => ({ serialNo: a.serialNo }));
  const [outward, transferredOut] = await Promise.all([
    db.minSerial.findMany({
      where: { ...serialWhere(candidates), ...only, min: { status: { not: "REJECTED" } } },
      select: { serialNo: true, category: true, sku: true, min: { select: { createdAt: true } } },
    }),
    db.stockTransferSerial.findMany({
      where: { ...serialWhere(candidates), ...only },
      select: { serialNo: true, category: true, sku: true, transfer: { select: { createdAt: true } } },
    }),
  ]);

  const lastOut = new Map();
  const leave = (row, at) => {
    const k = `${serialKey(row.category, row.sku)}|${lower(row.serialNo)}`;
    const time = new Date(at).getTime();
    if (!lastOut.has(k) || time > lastOut.get(k)) lastOut.set(k, time);
  };
  for (const r of outward) leave(r, r.min.createdAt);
  for (const r of transferredOut) leave(r, r.transfer.createdAt);

  const result = new Map();
  for (const [k, a] of arrivals) {
    const out = lastOut.get(k);
    if (out != null && !(a.at > out)) continue; // it left and has not come in again
    const bucket = `${serialKey(a.category, a.sku)}|${a.type}`;
    if (!result.has(bucket)) result.set(bucket, []);
    result.get(bucket).push(a.serialNo);
  }
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  for (const list of result.values()) list.sort((x, y) => collator.compare(x, y));
  return result;
}
