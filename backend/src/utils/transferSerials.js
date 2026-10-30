import { serialKey } from "./serials.js";

/**
 * =========================================================
 * SERIAL NUMBERS MOVED BY STOCK TRANSFERS
 * =========================================================
 * A transfer takes a serial out of (fromCompany, fromWarehouse) and puts it into (toCompany, toWarehouse).
 * The inward / outward serial rules compare dates, so the two halves of a transfer get two moments:
 *
 *   OUT at transfer.createdAt
 *   IN  at transfer.createdAt + 1 ms   (so the serial counts as "came in again after it left")
 *
 * The rows below are shaped like the rows of grnSerial / minSerial, so serialSources.js can simply add them
 * to the inward / outward rows it already works with.
 * =========================================================
 */
export const TRANSFER_IN_OFFSET_MS = 1;

export const transferInAt = (createdAt) => new Date(new Date(createdAt).getTime() + TRANSFER_IN_OFFSET_MS);

// A few serials: matched ignoring case. A big list (a whole warehouse's serials): one exact `in` match, because
// thousands of OR conditions would be slow.
export const serialWhere = (serials) =>
  serials.length > 200
    ? { serialNo: { in: serials.map((s) => s.serialNo) } }
    : { OR: serials.map((s) => ({ serialNo: { equals: s.serialNo, mode: "insensitive" } })) };

/** Transfer-in rows (as inward rows) for these serials into one warehouse. */
export async function transferInSerialRows(db, { warehouseId, serials }) {
  if (!serials.length) return [];
  const rows = await db.stockTransferSerial.findMany({
    where: { ...serialWhere(serials), transfer: { toWarehouseId: warehouseId } },
    select: { serialNo: true, category: true, sku: true, stockType: true, transfer: { select: { createdAt: true } } },
  });
  return rows.map((r) => ({
    serialNo: r.serialNo,
    category: r.category,
    sku: r.sku,
    grn: { inwardType: r.stockType, createdAt: transferInAt(r.transfer.createdAt) },
  }));
}

/** Transfer-out rows (as outward rows) for these serials, from any warehouse. */
export async function transferOutSerialRows(db, { serials }) {
  if (!serials.length) return [];
  const rows = await db.stockTransferSerial.findMany({
    where: serialWhere(serials),
    select: { serialNo: true, category: true, sku: true, transfer: { select: { transferNumber: true, createdAt: true } } },
  });
  return rows.map((r) => ({
    serialNo: r.serialNo,
    category: r.category,
    sku: r.sku,
    min: { outwardNumber: `${r.transfer.transferNumber} (transfer)`, createdAt: r.transfer.createdAt, status: "DISPATCHED" },
  }));
}

/** Same as transferInSerialRows but for every product line of an outward form (category + sku pairs). */
export async function transferInSerialRowsForLines(db, { warehouseId, lines }) {
  if (!lines.length) return [];
  const rows = await db.stockTransferSerial.findMany({
    where: {
      transfer: { toWarehouseId: warehouseId },
      OR: lines.map((l) => ({ category: { equals: l.category, mode: "insensitive" }, sku: { equals: l.sku, mode: "insensitive" } })),
    },
    select: { serialNo: true, category: true, sku: true, stockType: true, transfer: { select: { createdAt: true } } },
    take: 20000,
  });
  return rows.map((r) => ({
    serialNo: r.serialNo,
    category: r.category,
    sku: r.sku,
    grn: { inwardType: r.stockType, createdAt: transferInAt(r.transfer.createdAt) },
  }));
}

export { serialKey };
