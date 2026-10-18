/**
 * =========================================================
 * AUDIT LOG HELPERS
 * =========================================================
 *
 * Small, dependency-free helpers for writing to AuditLog and for
 * diffing an inward/outward entry's editable fields + items so the
 * "history" panel on the detail pages can show a real trail of what
 * changed, when, and by whom.
 *
 * Nothing here throws — a failed audit write should never fail the
 * request it's describing, so every write is best-effort and logs
 * to the console on failure instead.
 * =========================================================
 */

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} client
 */
export async function recordAuditLog(client, {
  entityType,
  entityId,
  entityNumber,
  action,
  description,
  changes = null,
  userId,
  warehouseId,
}) {
  try {
    await client.auditLog.create({
      data: {
        entityType,
        entityId,
        entityNumber,
        action,
        description,
        changes: changes ?? undefined,
        userId,
        warehouseId,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

/**
 * Same as recordAuditLog, but writes several entries in ONE insert.
 * Used inside long transactions (editing an entry can produce many audit
 * lines) so the trail costs a single database round trip instead of one each.
 * Best-effort like recordAuditLog: it never throws.
 */
export async function recordAuditLogs(client, entries = []) {
  if (!entries.length) return;
  try {
    await client.auditLog.createMany({
      data: entries.map(({
        entityType,
        entityId,
        entityNumber,
        action,
        description,
        changes = null,
        userId,
        warehouseId,
      }) => ({
        entityType,
        entityId,
        entityNumber,
        action,
        description,
        changes: changes ?? undefined,
        userId,
        warehouseId,
      })),
    });
  } catch (err) {
    console.error("Failed to write audit logs:", err);
  }
}

// Field -> human label, used for both inward and outward "UPDATED" diffs.
const FIELD_LABELS = {
  inwardType: "Inward type",
  outwardType: "Outward type",
  supplierName: "Supplier name",
  customerName: "Customer name",
  companyName: "Company name",
  refDocType: "Reference document type",
  refDocNumber: "Reference document number",
  ewayBillNumber: "E-way bill number",
  dispatchMode: "Dispatch mode",
  transportMode: "Vehicle type",
  transporterId: "Transporter ID",
  transporterName: "Transporter name",
  transporterContact: "Transporter contact",
  vehicleNumber: "Vehicle number",
  driverName: "Driver name",
  driverContact: "Driver contact",
  receivedDate: "Receiving date",
  receiverName: "Receiver name",
  receiverContact: "Receiver contact",
  receivingRemarks: "Receiving remarks",
  remarks: "Remarks",
  piNumber: "PI number",
  piDate: "PI date",
  piAmount: "PI amount",
  shipToContactPerson: "Ship to contact person",
  shipToContactNo: "Ship to contact no.",
  shipToLocation: "Ship to location",
  billToContactPerson: "Bill to contact person",
  billToContactNo: "Bill to contact no.",
  billToEmail: "Bill to email",
  dispatchRemarks: "Dispatch remarks (Sales)",
};

/**
 * Compares the editable top-level fields of an old vs new record and
 * returns one { field, label, oldValue, newValue } entry per change.
 * Only looks at keys present in `fields` so callers can scope it to
 * whichever fields actually apply (GRN vs MIN have slightly different
 * sets).
 */
export function diffFields(oldRecord, newRecord, fields) {
  const changes = [];
  for (const field of fields) {
    const oldValue = oldRecord?.[field] ?? null;
    const newValue = newRecord?.[field] ?? null;
    if (String(oldValue || "") !== String(newValue || "")) {
      changes.push({ field, label: FIELD_LABELS[field] || field, oldValue, newValue });
    }
  }
  return changes;
}

const itemKey = (item) =>
  [item.category, item.sku, item.companyName || "", item.uom].join("::").toLowerCase();

/**
 * Diffs the item list of an update. Update endpoints replace the whole
 * item list (deleteMany + create) rather than patching rows in place,
 * so there's no stable item id to key off of — items are matched by
 * category+sku+company+uom instead. That means "quantity changed" is
 * detected for a matching item, and anything else shows up as one
 * item removed + one item added.
 */
export function diffItems(oldItems = [], newItems = []) {
  const added = [];
  const removed = [];
  const updated = [];

  const oldMap = new Map(oldItems.map((item) => [itemKey(item), item]));
  const newMap = new Map(newItems.map((item) => [itemKey(item), item]));

  for (const [key, newItem] of newMap) {
    const oldItem = oldMap.get(key);
    if (!oldItem) {
      added.push(newItem);
    } else if (Number(oldItem.quantity) !== Number(newItem.quantity)) {
      updated.push({ item: newItem, oldQuantity: oldItem.quantity, newQuantity: newItem.quantity });
    }
  }
  for (const [key, oldItem] of oldMap) {
    if (!newMap.has(key)) removed.push(oldItem);
  }

  return { added, removed, updated };
}

export function describeItem(item) {
  const brand = item.companyName ? `${item.companyName} ` : "";
  return `${brand}${item.sku} (${item.category})`;
}
