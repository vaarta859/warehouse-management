/**
 * =========================================================
 * OUTWARD SERIAL NUMBERS
 * =========================================================
 * The warehouse manager records one serial number for every unit that leaves
 * the warehouse. An item of 4 Pcs needs exactly 4 serial numbers.
 *
 * Only countable items (UOM "Pcs") carry serials - Meters / Bundles do not.
 * Serials are stored per outward entry + category + SKU (not per item row id),
 * because an update rewrites the item rows and would otherwise lose them.
 * =========================================================
 */

export const SERIAL_UOM = "Pcs";
export const SERIAL_SOURCES = ["MANUAL", "CAMERA", "SCANNER"];
const MAX_SERIAL_LENGTH = 100;

// AC / DC cables are measured by length, so they never carry serial numbers (even if the UOM is changed to Pcs).
export const isCableCategory = (category) => {
  const text = String(category || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return /\bcable\b/.test(text) && /\b(ac|dc)\b/.test(text);
};
export const needsSerials = (item) =>
  !isCableCategory(item?.category) && String(item?.uom || "").trim().toLowerCase() === SERIAL_UOM.toLowerCase();
export const serialKey = (category, sku) =>
  `${String(category || "").trim().toLowerCase()}||${String(sku || "").trim().toLowerCase()}`;
export const normalizeSerial = (value) => String(value ?? "").trim();

/** category + SKU -> { category, sku, quantity } for every item that needs serials (same SKU on two rows is added up). */
export function requiredSerialLines(items = []) {
  const lines = new Map();
  for (const item of items) {
    if (!needsSerials(item)) continue;
    const key = serialKey(item.category, item.sku);
    const line = lines.get(key) || { category: item.category, sku: item.sku, quantity: 0 };
    line.quantity += Number(item.quantity) || 0;
    lines.set(key, line);
  }
  return lines;
}

/** Cleans the payload: trims, drops blanks, keeps only known sources. */
export function cleanSerials(serials) {
  if (!Array.isArray(serials)) return [];
  return serials
    .map((s) => ({
      category: String(s?.category || "").trim(),
      sku: String(s?.sku || "").trim(),
      serialNo: normalizeSerial(s?.serialNo),
      source: SERIAL_SOURCES.includes(s?.source) ? s.source : "MANUAL",
    }))
    .filter((s) => s.serialNo);
}

/** Returns an error message, or null when the serials match the items exactly. */
export function validateSerials(items, serials) {
  const lines = requiredSerialLines(items);
  const seen = new Set();
  const counts = new Map();

  for (const s of serials) {
    if (s.serialNo.length > MAX_SERIAL_LENGTH) return `Serial number "${s.serialNo.slice(0, 20)}..." is too long`;
    if (/[\s]/.test(s.serialNo)) return `Serial number "${s.serialNo}" must not contain spaces`;
    const key = serialKey(s.category, s.sku);
    if (!lines.has(key)) return `Serial number "${s.serialNo}" does not belong to any Pcs item of this entry`;
    const unique = s.serialNo.toLowerCase();
    if (seen.has(unique)) return `Serial number "${s.serialNo}" is entered more than once`;
    seen.add(unique);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const [key, line] of lines) {
    const have = counts.get(key) || 0;
    if (have !== line.quantity) {
      return `${line.sku}: ${line.quantity} serial number${line.quantity === 1 ? "" : "s"} needed, ${have} entered`;
    }
  }
  return null;
}

/** A serial can leave the warehouse only once - returns the first one already used by ANOTHER outward entry. */
export async function findSerialConflict(db, minId, serials) {
  if (!serials.length) return null;
  const clash = await db.minSerial.findFirst({
    where: {
      minId: { not: minId },
      OR: serials.map((s) => ({ serialNo: { equals: s.serialNo, mode: "insensitive" } })),
    },
    select: { serialNo: true, min: { select: { outwardNumber: true } } },
  });
  return clash ? `Serial number "${clash.serialNo}" is already used in outward ${clash.min?.outwardNumber || "another entry"}` : null;
}

/** Replaces all serials of an entry. */
export async function replaceSerials(tx, minId, serials) {
  await tx.minSerial.deleteMany({ where: { minId } });
  if (serials.length) {
    await tx.minSerial.createMany({
      data: serials.map((s) => ({ minId, category: s.category, sku: s.sku, serialNo: s.serialNo, source: s.source })),
    });
  }
}

/** After an item edit: drop serials of removed items / the ones above a reduced quantity. */
export async function pruneSerials(tx, minId, items) {
  const lines = requiredSerialLines(items);
  const saved = await tx.minSerial.findMany({ where: { minId }, orderBy: { createdAt: "asc" }, select: { id: true, category: true, sku: true } });
  const used = new Map();
  const drop = [];
  for (const s of saved) {
    const key = serialKey(s.category, s.sku);
    const allowed = lines.get(key)?.quantity || 0;
    const n = used.get(key) || 0;
    if (n >= allowed) drop.push(s.id);
    else used.set(key, n + 1);
  }
  if (drop.length) await tx.minSerial.deleteMany({ where: { id: { in: drop } } });
  return drop.length;
}
