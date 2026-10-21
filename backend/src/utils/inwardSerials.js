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
    if (!lines.has(key)) return `Serial number "${s.serialNo}" does not belong to an item of this entry that takes serial numbers (${s.sku}: serial no. is Not required, or the item is not counted in Pcs)`;
    const unique = s.serialNo.toLowerCase();
    if (seen.has(unique)) return `Serial number "${s.serialNo}" is entered more than once`;
    seen.add(unique);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const [key, line] of lines) {
    const have = counts.get(key) || 0;
    // OPTIONAL: all units or none. REQUIRED: all units.
    if (line.serialMode === "OPTIONAL" && have === 0) continue;
    if (have !== line.quantity) {
      return `${line.sku}: ${line.quantity} serial number${line.quantity === 1 ? "" : "s"} needed, ${have} entered`;
    }
  }
  return null;
}

const LEFT_STATUSES = ["DISPATCHED", "DELIVERED"];

/**
 * A serial number that is already in stock cannot be received again. It may come in again only after the
 * unit has really left (its outward entry is dispatched) since it last came in - e.g. a sold unit that
 * returns as faulty stock. Serials already saved on this entry are not checked again when it is edited.
 * Error message, or null. `db` is prisma or a transaction client.
 */
export async function findInwardSerialProblem(db, { grnId = null, serials }) {
  if (!serials.length) return null;
  const match = serials.map((s) => ({ serialNo: { equals: s.serialNo, mode: "insensitive" } }));

  const [received, left, own] = await Promise.all([
    db.grnSerial.findMany({
      where: { OR: match, ...(grnId ? { grnId: { not: grnId } } : {}) },
      select: { serialNo: true, category: true, sku: true, grn: { select: { grnNumber: true, createdAt: true } } },
    }),
    db.minSerial.findMany({
      where: { OR: match, min: { status: { in: LEFT_STATUSES } } },
      select: { serialNo: true, category: true, sku: true, min: { select: { createdAt: true, dispatchedAt: true } } },
    }),
    grnId ? db.grnSerial.findMany({ where: { grnId }, select: { serialNo: true, category: true, sku: true } }) : [],
  ]);

  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const ownKeys = new Set(own.map((o) => `${serialKey(o.category, o.sku)}|${o.serialNo.toLowerCase()}`));
  const problems = [];

  for (const s of serials) {
    const key = serialKey(s.category, s.sku);
    if (ownKeys.has(`${key}|${s.serialNo.toLowerCase()}`)) continue; // already on this entry

    const earlier = received.filter((r) => same(r.serialNo, s.serialNo) && serialKey(r.category, r.sku) === key);
    if (!earlier.length) continue;
    const lastIn = earlier.reduce((a, b) => (new Date(b.grn.createdAt) > new Date(a.grn.createdAt) ? b : a));

    const wentOutAfter = left.some(
      (l) =>
        same(l.serialNo, s.serialNo) &&
        serialKey(l.category, l.sku) === key &&
        new Date(l.min.dispatchedAt || l.min.createdAt) > new Date(lastIn.grn.createdAt)
    );
    if (!wentOutAfter) problems.push(`"${s.serialNo}" is already in stock (inward ${lastIn.grn.grnNumber})`);
  }

  if (!problems.length) return null;
  const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : "";
  return `${problems.slice(0, 5).join("; ")}${more}. A serial number can come in again only after it has been dispatched.`;
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
