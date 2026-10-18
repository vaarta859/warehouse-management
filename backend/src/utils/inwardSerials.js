import { requiredSerialLines, serialKey } from "./serials.js";

/**
 * =========================================================
 * INWARD SERIAL NUMBERS
 * =========================================================
 * The warehouse records the serial number of every Pcs unit it receives (typed, camera or scanner),
 * the same way the outward side does. Stored per inward entry (GRN) + category + SKU.
 *
 * Rules:
 *   - only countable items (UOM "Pcs", not AC / DC cables) carry serials
 *   - a serial is used once inside one entry
 *   - every Pcs unit needs its own serial number: an item of 5 Pcs needs 5 serial numbers
 *     (an older entry saved before serials existed may still be edited without any)
 *   - the same serial may come in again on a LATER entry (a returned or repaired unit re-enters stock),
 *     so, unlike outward, it is not blocked by other entries
 * =========================================================
 */
const MAX_SERIAL_LENGTH = 100;

/** Error message, or null when the serials fit the items. */
export function validateInwardSerials(items, serials, { allowEmpty = false } = {}) {
  if (allowEmpty && serials.length === 0) return null;
  const lines = requiredSerialLines(items);
  const seen = new Set();
  const counts = new Map();

  for (const s of serials) {
    if (s.serialNo.length > MAX_SERIAL_LENGTH) return `Serial number "${s.serialNo.slice(0, 20)}..." is too long`;
    if (/\s/.test(s.serialNo)) return `Serial number "${s.serialNo}" must not contain spaces`;
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

/** Replaces all serials of an inward entry. */
export async function replaceGrnSerials(tx, grnId, serials) {
  await tx.grnSerial.deleteMany({ where: { grnId } });
  if (serials.length) {
    await tx.grnSerial.createMany({
      data: serials.map((s) => ({ grnId, category: s.category, sku: s.sku, serialNo: s.serialNo, source: s.source })),
    });
  }
}

/** After an item edit that sent no serials: drop the serials of removed items / above a reduced quantity. */
export async function pruneGrnSerials(tx, grnId, items) {
  const lines = requiredSerialLines(items);
  const saved = await tx.grnSerial.findMany({ where: { grnId }, orderBy: { createdAt: "asc" }, select: { id: true, category: true, sku: true } });
  const used = new Map();
  const drop = [];
  for (const s of saved) {
    const key = serialKey(s.category, s.sku);
    const allowed = lines.get(key)?.quantity || 0;
    const n = used.get(key) || 0;
    if (n >= allowed) drop.push(s.id);
    else used.set(key, n + 1);
  }
  if (drop.length) await tx.grnSerial.deleteMany({ where: { id: { in: drop } } });
  return drop.length;
}
