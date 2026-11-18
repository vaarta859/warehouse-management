import { OUTWARD_STOCK_SOURCES, getWarehouseStockBreakdown, stockKey } from "./stock.js";
import { canonicalOutwardType, listAvailableSerials } from "./serialSources.js";
import { serialKey } from "./serials.js";

/**
 * EXTRA SERIAL NUMBERS (serial numbers that are not on any inward entry)
 * ---------------------------------------------------------------------
 * For one model, stock quantity = serial numbers already recorded on inward (still in stock) + units that came in without
 * serial numbers. So a serial number that is NOT on the inward list can be scanned / added only for the units that have
 * none recorded yet:
 *
 *      extra allowed = stock quantity - serial numbers recorded in stock          (never below 0)
 *
 * Equal -> no extra serial number can be added (only the listed ones can be picked). Stock higher -> that many extra can.
 * `lines` = [{ category, sku }]. Returns { allowance: { [serialKey(category, sku)]: number }, listed: <listAvailableSerials result> }.
 */
export async function extraSerialAllowance(db, { warehouseId, outwardType, minId, companyName, lines }) {
  const result = {};
  if (!lines.length) return { allowance: result, listed: {} };
  const items = lines.map((l) => ({ category: l.category, sku: l.sku, quantity: 1, uom: "Pcs" }));
  const [listedByKey, breakdown] = await Promise.all([
    listAvailableSerials(db, { warehouseId, outwardType, minId, items, companyName }),
    getWarehouseStockBreakdown(db, warehouseId, { excludeOutwardId: minId || undefined }),
  ]);
  const company = String(companyName || "").trim().toLowerCase();
  const allowedTypes = OUTWARD_STOCK_SOURCES[canonicalOutwardType(outwardType)] || null;
  for (const l of lines) {
    const key = serialKey(l.category, l.sku);
    const stock = (breakdown.get(stockKey(l.category, l.sku)) || [])
      .filter((x) => (!company || String(x.companyName || "").trim().toLowerCase() === company) && (!allowedTypes || allowedTypes.includes(x.type)))
      .reduce((sum, x) => sum + x.quantity, 0);
    result[key] = Math.max(0, stock - (listedByKey[key] || []).length);
  }
  return { allowance: result, listed: listedByKey };
}

/**
 * Error text when more serial numbers outside the inward list are submitted than the stock leaves room for, else null.
 * `serials` = [{ category, sku, serialNo }].
 */
export async function findExtraSerialProblem(db, { warehouseId, outwardType, minId, companyName, serials }) {
  if (!serials.length) return null;
  const lines = [...new Map(serials.map((s) => [serialKey(s.category, s.sku), { category: s.category, sku: s.sku }])).values()];
  const { allowance, listed } = await extraSerialAllowance(db, { warehouseId, outwardType, minId, companyName, lines });
  const problems = [];
  for (const l of lines) {
    const key = serialKey(l.category, l.sku);
    const inList = new Set((listed[key] || []).map((x) => String(x).trim().toLowerCase()));
    const unlisted = serials.filter((s) => serialKey(s.category, s.sku) === key && !inList.has(String(s.serialNo).trim().toLowerCase()));
    if (unlisted.length > (allowance[key] || 0)) {
      const shown = unlisted.slice(0, 3).map((s) => `"${s.serialNo}"`).join(", ");
      problems.push(
        allowance[key]
          ? `${l.sku}: only ${allowance[key]} serial number(s) outside the stock list can be added, but ${unlisted.length} were entered (${shown}...)`
          : `${l.sku}: ${shown} is not in the stock list, and every unit in stock already has its serial number, so no extra serial number can be added. Pick from the list`
      );
    }
  }
  return problems.length ? problems.join(". ") : null;
}
