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
