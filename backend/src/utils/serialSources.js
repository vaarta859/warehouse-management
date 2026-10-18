import { requiredSerialLines, serialKey } from "./serials.js";

// Natural, increasing order: "I2690100002" before "I2690100010" (plain text order would put "...10" before "...2").
const serialCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const compareSerials = (a, b) => serialCollator.compare(String(a), String(b));

/**
 * =========================================================
 * WHERE AN OUTWARD SERIAL NUMBER CAN COME FROM
 * =========================================================
 * A serial number scanned on an outward entry must already be in the warehouse's inward stock, and it must
 * have come in through one of the inward types allowed for that outward type:
 *
 *   Sale - Stock Out      <- Purchase - New Stock, Return of Purchase
 *   Service - Stock Out   <- Purchase - New Stock, Service/Faulty Stock from Customer
 *   Replacement           <- Purchase - Service Stock, Repair-Service Stock
 *   Damage / Scrap Out    <- Service/Faulty Stock from Customer
 *
 * A serial can leave again only if it came in again after it last left (a sold unit that the customer
 * returns as faulty stock, then goes out for service or scrap). Serials of REJECTED outward entries are free.
 * =========================================================
 */
export const INWARD = {
  NEW: "Purchase - New Stock",
  SERVICE: "Purchase - Service Stock",
  RETURN: "Return of Purchase",
  FAULTY: "Service/Faulty Stock from Customer",
  REPAIR: "Repair-Service Stock",
};

export const OUTWARD = {
  SALE: "Sale - Stock Out",
  SERVICE: "Service - Stock Out",
  REPLACEMENT: "Replacement",
  SCRAP: "Damage / Scrap Out",
};

export const OUTWARD_SERIAL_SOURCES = {
  [OUTWARD.SALE]: [INWARD.NEW, INWARD.RETURN],
  [OUTWARD.SERVICE]: [INWARD.NEW, INWARD.FAULTY],
  [OUTWARD.REPLACEMENT]: [INWARD.SERVICE, INWARD.REPAIR],
  [OUTWARD.SCRAP]: [INWARD.FAULTY],
};

/** Stored inward type text -> one of INWARD (same matching as the app's display names). */
export function canonicalInwardType(type) {
  const lower = String(type || "").trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("repair")) return INWARD.REPAIR;
  if (lower.includes("purchase") && lower.includes("new")) return INWARD.NEW;
  if (lower === "new stock" || lower === "new") return INWARD.NEW;
  if (lower.includes("purchase") && lower.includes("service")) return INWARD.SERVICE;
  if ((lower.includes("service") || lower.includes("faulty")) && lower.includes("customer")) return INWARD.FAULTY;
  if (lower.includes("service")) return INWARD.SERVICE;
  if (lower.includes("return")) return INWARD.RETURN;
  return String(type).trim();
}

/** Stored outward type text -> one of OUTWARD (the old "Return to Vendor" is now "Replacement"). */
export function canonicalOutwardType(type) {
  const lower = String(type || "").trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("sale")) return OUTWARD.SALE;
  if (lower.includes("service")) return OUTWARD.SERVICE;
  if (lower.includes("replacement") || lower.includes("return")) return OUTWARD.REPLACEMENT;
  if (lower.includes("damage") || lower.includes("scrap")) return OUTWARD.SCRAP;
  return String(type).trim();
}

const DISPATCHED_STATUSES = ["DISPATCHED", "DELIVERED"];
const sameSerial = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Error message (every serial that does not fit, up to 5 listed), or null when all serials are allowed.
 * `db` is prisma or a transaction client.
 */
export async function findSerialSourceProblem(db, { warehouseId, outwardType, minId, serials }) {
  if (!serials.length) return null;
  const outwardLabel = canonicalOutwardType(outwardType);
  const allowed = OUTWARD_SERIAL_SOURCES[outwardLabel];
  if (!allowed) return null; // an outward type with no source rule

  const match = serials.map((s) => ({ serialNo: { equals: s.serialNo, mode: "insensitive" } }));
  const [inwardRows, outwardRows] = await Promise.all([
    db.grnSerial.findMany({
      where: { OR: match, grn: { warehouseId } },
      select: { serialNo: true, category: true, sku: true, grn: { select: { inwardType: true, createdAt: true } } },
    }),
    db.minSerial.findMany({
      where: { minId: { not: minId }, OR: match, min: { status: { not: "REJECTED" } } },
      select: { serialNo: true, category: true, sku: true, min: { select: { outwardNumber: true, createdAt: true, status: true } } },
    }),
  ]);

  const problems = [];
  for (const s of serials) {
    const key = serialKey(s.category, s.sku);
    const received = inwardRows.filter((r) => sameSerial(r.serialNo, s.serialNo) && serialKey(r.category, r.sku) === key);
    if (!received.length) {
      problems.push(`"${s.serialNo}" is not in this warehouse's inward stock for ${s.sku}`);
      continue;
    }
    const eligible = received.filter((r) => allowed.includes(canonicalInwardType(r.grn.inwardType)));
    if (!eligible.length) {
      const cameAs = [...new Set(received.map((r) => canonicalInwardType(r.grn.inwardType)))].join(" / ");
      problems.push(`"${s.serialNo}" came in as ${cameAs}`);
      continue;
    }
    // Only the same serial of the SAME product counts: another model that happens to have the same number is a different unit.
    const used = outwardRows.filter((r) => sameSerial(r.serialNo, s.serialNo) && serialKey(r.category, r.sku) === key);
    if (used.length) {
      const last = used.reduce((a, b) => (new Date(b.min.createdAt) > new Date(a.min.createdAt) ? b : a));
      const cameInAgain = eligible.some((r) => new Date(r.grn.createdAt) > new Date(last.min.createdAt));
      if (!cameInAgain) {
        problems.push(
          DISPATCHED_STATUSES.includes(last.min.status)
            ? `"${s.serialNo}" is already dispatched in outward ${last.min.outwardNumber}`
            : `"${s.serialNo}" is already added to outward ${last.min.outwardNumber}, which is not dispatched yet`
        );
      }
    }
  }

  if (!problems.length) return null;
  const shown = problems.slice(0, 5).join("; ");
  const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : "";
  return `${outwardLabel} accepts serial numbers only from ${allowed.join(" or ")}: ${shown}${more}`;
}

/**
 * Serial numbers that can be scanned right now for the items of an outward entry: in this warehouse's inward stock,
 * under the item's category + model, received through an inward type allowed for the outward type, and not out
 * already (unless they came in again after they last left). Returns { [serialKey(category, sku)]: [serialNo, ...] }.
 */
export async function listAvailableSerials(db, { warehouseId, outwardType, minId, items }) {
  const allowed = OUTWARD_SERIAL_SOURCES[canonicalOutwardType(outwardType)];
  const lines = [...requiredSerialLines(items).values()];
  const result = {};
  lines.forEach((l) => { result[serialKey(l.category, l.sku)] = []; });
  if (!lines.length) return result;

  const inwardRows = await db.grnSerial.findMany({
    where: {
      grn: { warehouseId },
      OR: lines.map((l) => ({ category: { equals: l.category, mode: "insensitive" }, sku: { equals: l.sku, mode: "insensitive" } })),
    },
    select: { serialNo: true, category: true, sku: true, grn: { select: { inwardType: true, createdAt: true } } },
    orderBy: { serialNo: "asc" },
    take: 20000,
  });
  const eligible = inwardRows.filter((r) => !allowed || allowed.includes(canonicalInwardType(r.grn.inwardType)));
  if (!eligible.length) return result;

  const usedRows = await db.minSerial.findMany({
    where: { minId: { not: minId }, serialNo: { in: [...new Set(eligible.map((r) => r.serialNo))] }, min: { status: { not: "REJECTED" } } },
    select: { serialNo: true, category: true, sku: true, min: { select: { createdAt: true } } },
  });
  // keyed by product + serial: the same number on another model is a different unit
  const lastOut = new Map();
  for (const u of usedRows) {
    const k = `${serialKey(u.category, u.sku)}|${u.serialNo.toLowerCase()}`;
    const at = new Date(u.min.createdAt).getTime();
    if (!lastOut.has(k) || at > lastOut.get(k)) lastOut.set(k, at);
  }

  const seen = new Set();
  for (const r of eligible) {
    const k = r.serialNo.toLowerCase();
    const key = serialKey(r.category, r.sku);
    const out = lastOut.get(`${key}|${k}`);
    if (out != null && !(new Date(r.grn.createdAt).getTime() > out)) continue; // left already and has not come in again
    if (!result[key]) continue;
    const dedupe = `${key}|${k}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    result[key].push(r.serialNo);
  }
  Object.values(result).forEach((list) => list.sort(compareSerials));
  return result;
}
