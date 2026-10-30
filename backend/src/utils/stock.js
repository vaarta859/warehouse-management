import { INWARD, OUTWARD, canonicalInwardType, canonicalOutwardType } from "./serialSources.js";

/**
 * Which inward stock types the outward form's SKU list counts for each outward type.
 * Each outward type shows its own stock: Service Stock Out no longer shows New (sale) stock.
 * (Serial-number scanning keeps its own rules in serialSources.js.)
 */
export const OUTWARD_STOCK_SOURCES = {
  [OUTWARD.SALE]: [INWARD.NEW, INWARD.RETURN],
  [OUTWARD.SERVICE]: [INWARD.SERVICE, INWARD.FAULTY],
  [OUTWARD.REPLACEMENT]: [INWARD.SERVICE, INWARD.REPAIR],
  [OUTWARD.SCRAP]: [INWARD.FAULTY],
};

/**
 * =========================================================
 * STOCK HELPERS
 * =========================================================
 *
 * Stock is NOT stored anywhere - it is always worked out from the
 * entries, the same way the Stock Ledger report does it:
 *
 *      available = total inward (GRN items) - total outward (MIN items)
 *
 * per warehouse, per category + SKU / model.
 *
 * Used by:
 *   - GET  /api/outward/stock  (fills the outward form's SKU dropdown)
 *   - createOutward / updateOutward (refuse an outward that needs more
 *     than what is available)
 *
 * Both use the same function so what the dropdown shows and what the
 * server enforces can never disagree.
 * =========================================================
 */

// Category + SKU compared case-insensitively and ignoring stray spaces, so
// "Router" / "router " count as the same product (like the product master does).
export const stockKey = (category, sku) =>
  `${String(category || "").trim().toLowerCase()}::${String(sku || "").trim().toLowerCase()}`;

/**
 * Current stock of every category + SKU in one warehouse.
 *
 * `db` is `prisma` or a transaction client (`tx`) - pass `tx` when calling
 * from inside a transaction so the numbers are read in the same snapshot
 * the outward is then written in.
 *
 * `excludeOutwardId`: leave this outward entry's own items out of the
 * outward total. Used when EDITING an entry - its current quantities are
 * being replaced, so they must not count against itself.
 *
 * Returns Map<stockKey, { category, sku, uom, inward, outward, available }>.
 */
export async function getWarehouseStock(db, warehouseId, { excludeOutwardId, onlyItems } = {}) {
  // Create / edit only need the models being requested - reading the whole warehouse history is wasted time.
  // (Matched case-insensitively and loosely, so stray spaces in old rows still count; exact keys are compared afterwards.)
  const skuFilter = Array.isArray(onlyItems) && onlyItems.length
    ? { OR: [...new Set(onlyItems.map((i) => String(i.sku || "").trim()).filter(Boolean))].map((sku) => ({ sku: { contains: sku, mode: "insensitive" } })) }
    : {};
  // Sequential on purpose: inside an interactive transaction the queries
  // share one connection anyway.
  const inwardGroups = await db.grnItem.groupBy({
    by: ["category", "sku", "uom"],
    where: { grn: { warehouseId }, ...skuFilter },
    _sum: { quantity: true },
  });
  const outwardGroups = await db.minItem.groupBy({
    by: ["category", "sku", "uom"],
    where: {
      ...skuFilter,
      min: {
        warehouseId,
        // A rejected entry never leaves the warehouse, so it holds no stock.
        status: { not: "REJECTED" },
        ...(excludeOutwardId ? { id: { not: excludeOutwardId } } : {}),
      },
    },
    _sum: { quantity: true },
  });

  // Stock moved between companies / warehouses by a transfer: counts as inward where it arrives, outward where it leaves.
  const transferInGroups = await db.stockTransferItem.groupBy({
    by: ["category", "sku", "uom"],
    where: { transfer: { toWarehouseId: warehouseId }, ...skuFilter },
    _sum: { quantity: true },
  });
  const transferOutGroups = await db.stockTransferItem.groupBy({
    by: ["category", "sku", "uom"],
    where: { transfer: { fromWarehouseId: warehouseId }, ...skuFilter },
    _sum: { quantity: true },
  });

  const stock = new Map();
  const add = (row, field) => {
    const key = stockKey(row.category, row.sku);
    const qty = Number(row._sum.quantity) || 0;
    const existing = stock.get(key);
    if (existing) {
      existing[field] += qty;
    } else {
      stock.set(key, {
        category: row.category,
        sku: row.sku,
        uom: row.uom,
        inward: field === "inward" ? qty : 0,
        outward: field === "outward" ? qty : 0,
      });
    }
  };
  for (const row of inwardGroups) add(row, "inward");
  for (const row of outwardGroups) add(row, "outward");
  for (const row of transferInGroups) add(row, "inward");
  for (const row of transferOutGroups) add(row, "outward");

  for (const row of stock.values()) row.available = row.inward - row.outward;
  return stock;
}

/** Map<stockKey, total quantity> for a list of items (same model on two rows adds up). */
export function sumQuantitiesByKey(items = []) {
  const totals = new Map();
  for (const item of items) {
    const key = stockKey(item.category, item.sku);
    totals.set(key, (totals.get(key) || 0) + (Number(item.quantity) || 0));
  }
  return totals;
}

/**
 * Which requested items need more than is available?
 *
 * Quantities are added up per category + SKU first, so two rows of the same
 * model can't each squeeze under the limit and together go over it.
 *
 * `existingItems` (editing only): the quantities this entry already had. An
 * entry is never blocked for keeping (or lowering) a quantity it already
 * dispatched, even if the stock has since dropped - only an INCREASE beyond
 * what is available is refused.
 *
 * Returns [{ category, sku, requested, available }].
 */
export function findShortages(items, stock, existingItems = []) {
  const requested = sumQuantitiesByKey(items);
  const existing = sumQuantitiesByKey(existingItems);

  const shortages = [];
  for (const [key, qty] of requested) {
    const available = stock.get(key)?.available ?? 0;
    const allowed = Math.max(available, existing.get(key) || 0);
    if (qty > allowed) {
      const sample = items.find((i) => stockKey(i.category, i.sku) === key);
      shortages.push({
        category: sample.category,
        sku: String(sample.sku).trim(),
        requested: qty,
        available: Math.max(allowed, 0),
      });
    }
  }
  return shortages;
}

export function shortageMessage(shortages) {
  const lines = shortages.map((s) =>
    s.available <= 0
      ? `"${s.sku}" (${s.category}) is out of stock`
      : `"${s.sku}" (${s.category}): requested ${s.requested}, only ${s.available} available`
  );
  return `Not enough stock - ${lines.join("; ")}.`;
}

const companyKeyOf = (name) => String(name || "").trim().toLowerCase();

/**
 * Stock of one warehouse split up for DISPLAY: per category + SKU, then per company, then per inward type
 * (New, Service, Return, Faulty, Repair). There is no grand total on purpose.
 *
 * Inward is counted per company + inward type. Outward is not stored against an inward type, so each
 * outward entry is taken from the inward types its outward type may use (same rules as the serial sources:
 * Sale <- New / Return, Service <- New / Faulty, Replacement <- Service / Repair, Scrap <- Faulty),
 * in that order. Rejected entries hold no stock. This is for showing only - the stock check when saving
 * still uses getWarehouseStock.
 *
 * Returns Map<stockKey, [{ companyName, type, quantity }]> (only quantities above 0).
 */
export async function getWarehouseStockBreakdown(db, warehouseId, { excludeOutwardId } = {}) {
  const inwardRows = await db.grnItem.findMany({
    where: { grn: { warehouseId } },
    select: { category: true, sku: true, quantity: true, companyName: true, grn: { select: { inwardType: true, companyName: true } } },
  });
  const outwardRows = await db.minItem.findMany({
    where: {
      min: {
        warehouseId,
        status: { not: "REJECTED" },
        ...(excludeOutwardId ? { id: { not: excludeOutwardId } } : {}),
      },
    },
    select: { category: true, sku: true, quantity: true, min: { select: { outwardType: true, companyName: true } } },
  });

  const transferRows = await db.stockTransferItem.findMany({
    where: { transfer: { OR: [{ toWarehouseId: warehouseId }, { fromWarehouseId: warehouseId }] } },
    select: {
      category: true, sku: true, quantity: true, stockType: true,
      transfer: { select: { toWarehouseId: true, toCompanyName: true, fromWarehouseId: true, fromCompanyName: true } },
    },
  });

  // key -> companyKey -> { companyName, types: Map<type, qty> }
  const groups = new Map();
  const groupFor = (key, companyName) => {
    if (!groups.has(key)) groups.set(key, new Map());
    const byCompany = groups.get(key);
    const ck = companyKeyOf(companyName);
    if (!byCompany.has(ck)) byCompany.set(ck, { companyName: String(companyName || "").trim(), types: new Map(), outward: [] });
    return byCompany.get(ck);
  };

  for (const row of inwardRows) {
    const qty = Number(row.quantity) || 0;
    if (!qty) continue;
    const type = canonicalInwardType(row.grn?.inwardType) || INWARD.NEW;
    const group = groupFor(stockKey(row.category, row.sku), row.grn?.companyName || row.companyName);
    group.types.set(type, (group.types.get(type) || 0) + qty);
  }
  // Transfers: arriving stock is added to the receiving company; leaving stock is taken from the sending company
  // (from the exact stock type that was sent).
  for (const row of transferRows) {
    const qty = Number(row.quantity) || 0;
    if (!qty) continue;
    const type = canonicalInwardType(row.stockType) || INWARD.NEW;
    const key = stockKey(row.category, row.sku);
    if (row.transfer.toWarehouseId === warehouseId) {
      const group = groupFor(key, row.transfer.toCompanyName);
      group.types.set(type, (group.types.get(type) || 0) + qty);
    }
  }
  for (const row of transferRows) {
    const qty = Number(row.quantity) || 0;
    if (!qty || row.transfer.fromWarehouseId !== warehouseId) continue;
    const type = canonicalInwardType(row.stockType) || INWARD.NEW;
    const group = groups.get(stockKey(row.category, row.sku))?.get(companyKeyOf(row.transfer.fromCompanyName));
    if (group) group.types.set(type, (group.types.get(type) || 0) - qty);
  }
  for (const row of outwardRows) {
    const qty = Number(row.quantity) || 0;
    if (!qty) continue;
    const key = stockKey(row.category, row.sku);
    // Outward of a company that has no inward row of its own is ignored here (nothing to take it from).
    const group = groups.get(key)?.get(companyKeyOf(row.min?.companyName));
    if (group) group.outward.push({ outwardType: canonicalOutwardType(row.min?.outwardType), qty });
  }

  const result = new Map();
  for (const [key, byCompany] of groups) {
    const lines = [];
    for (const group of byCompany.values()) {
      for (const { outwardType, qty } of group.outward) {
        let left = qty;
        const preferred = OUTWARD_STOCK_SOURCES[outwardType] || [];
        const order = [...preferred, ...[...group.types.keys()].filter((t) => !preferred.includes(t))];
        for (const type of order) {
          if (left <= 0) break;
          const have = group.types.get(type) || 0;
          const take = Math.min(have, left);
          if (take > 0) { group.types.set(type, have - take); left -= take; }
        }
      }
      for (const [type, quantity] of group.types) {
        if (quantity > 0) lines.push({ companyName: group.companyName, type, quantity });
      }
    }
    lines.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.type.localeCompare(b.type));
    result.set(key, lines);
  }
  return result;
}


/**
 * Splits one company + warehouse + product into stock types (New / Service / Return / Faulty / Repair).
 *
 *   inward, transferIn, transferOut : Map<type, qty>
 *   outwardList                     : [{ outwardType, qty }]
 *
 * Transfers name their stock type exactly. Outward entries do not, so each is taken from the types its outward
 * type may use (OUTWARD_STOCK_SOURCES) - after the stock that already left by transfer is set aside.
 * Returns [{ type, inward, transferIn, transferOut, outward }].
 */
export function balancesByType({ inward, transferIn = new Map(), transferOut = new Map() }, outwardList = []) {
  const outwardByType = new Map();
  const have = (type) =>
    (inward.get(type) || 0) + (transferIn.get(type) || 0) - (transferOut.get(type) || 0) - (outwardByType.get(type) || 0);
  const knownTypes = [...new Set([...inward.keys(), ...transferIn.keys()])];

  for (const { outwardType, qty } of outwardList) {
    let left = qty;
    const preferred = OUTWARD_STOCK_SOURCES[outwardType] || [];
    const order = [...preferred, ...knownTypes.filter((t) => !preferred.includes(t))];
    for (const type of order) {
      if (left <= 0) break;
      const take = Math.min(Math.max(have(type), 0), left);
      if (take > 0) { outwardByType.set(type, (outwardByType.get(type) || 0) + take); left -= take; }
    }
    // More went out than came in: show it against the type this outward normally takes from (negative stock).
    if (left > 0) {
      const type = preferred[0] || INWARD.NEW;
      outwardByType.set(type, (outwardByType.get(type) || 0) + left);
    }
  }

  const types = new Set([...inward.keys(), ...transferIn.keys(), ...transferOut.keys(), ...outwardByType.keys()]);
  return [...types].map((type) => ({
    type,
    inward: inward.get(type) || 0,
    transferIn: transferIn.get(type) || 0,
    transferOut: transferOut.get(type) || 0,
    outward: outwardByType.get(type) || 0,
  }));
}
