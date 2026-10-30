import prisma from "../config/prisma.js";
import { warehouseIdsForCompanies } from "./warehouseCompanies.js";

/**
 * =========================================================
 * OUTWARD WORKFLOW HELPERS
 * =========================================================
 *
 *   SALES   --create-->  PENDING_APPROVAL
 *   ACCOUNT --approve--> PENDING_DISPATCH
 *   ACCOUNT --reject-->  REJECTED  (allowed until dispatch; Sales edits + resubmits,
 *                                    or Account approves it again directly)
 *   ACCOUNT --hold-->    ON_HOLD   (allowed until dispatch, with a reason; stock stays reserved.
 *                                    Account can approve / reject it later, Sales can edit + resubmit.
 *                                    The warehouse manager never sees it.)
 *   SALES   --edit-->    allowed until dispatch. Changing PI / payment or item details
 *                        sends the entry back to PENDING_APPROVAL; changing only
 *                        header fields (customer, type ...) keeps PENDING_DISPATCH.
 *   WAREHOUSE_MANAGER --dispatch (details + documents)--> DISPATCHED
 *
 * AFTER APPROVAL the status is SAVED in the database and moves through these steps (see syncApprovedStage):
 *
 *   TRANSPORT_PENDING   warehouse manager must fill the Transportation form (dedicated vehicle OR transporter)
 *   DOCS_PENDING        Account can now upload Invoice / E-way bill / DC Challan / Without Invoice / Other.
 *                       Every document (Invoice included) is shared with the warehouse manager.
 *                       Any document (Invoice / E-way bill / DC Challan / Without Invoice / Other) releases the entry to the warehouse.
 *   READY_FOR_DISPATCH  Dispatch form opens for the manager (vehicle / driver read-only, references, documents)
 *   DISPATCHED          Dispatch details saved ("Shipped"); Receiving form opens
 *   DELIVERED           Receiving form saved
 *
 * (PENDING_DISPATCH is the old single "approved" value. It is kept in the enum only so old rows stay valid; the
 * backfill migration moves them, and the code still treats it like an approved entry.)
 *
 * EDIT LOCK: once the transportation details are sent AND Account has uploaded its documents, Sales / Account can no
 * longer update, reject or hold the entry (see editLockReason). Only the Super admin can still change it.
 *
 * Warehouse only sees PENDING_DISPATCH / DISPATCHED entries.
 * Dispatch documents are visible to Sales / Account only once DISPATCHED.
 * After DISPATCHED Sales / Account are locked out; the WAREHOUSE_MANAGER can still update the dispatch
 * details (reference documents, mode, vehicle no., remarks) and add / delete documents.
 * SUPER_ADMIN changes everything through Update (PI details, items, payment, dispatch details).
 * SUPER_ADMIN can change everything.
 * =========================================================
 */

export const STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PENDING_DISPATCH: "PENDING_DISPATCH", // legacy "approved" value
  TRANSPORT_PENDING: "TRANSPORT_PENDING",
  DOCS_PENDING: "DOCS_PENDING",
  READY_FOR_DISPATCH: "READY_FOR_DISPATCH",
  DISPATCHED: "DISPATCHED",
  DELIVERED: "DELIVERED",
  REJECTED: "REJECTED",
  ON_HOLD: "ON_HOLD",
};

// Approved by Account, not dispatched yet (PENDING_DISPATCH = old rows).
export const APPROVED_STATUSES = [STATUS.PENDING_DISPATCH, STATUS.TRANSPORT_PENDING, STATUS.DOCS_PENDING, STATUS.READY_FOR_DISPATCH];
// Dispatched (delivery pending) or delivered.
export const DISPATCHED_STATUSES = [STATUS.DISPATCHED, STATUS.DELIVERED];
export const isDispatchedStatus = (status) => DISPATCHED_STATUSES.includes(status);
export const isApprovedStatus = (status) => APPROVED_STATUSES.includes(status);

// DISPATCH DIRECTLY (no warehouse): Sales picks "Dispatch directly" instead of a warehouse on the outward form.
//   SALES   --create-->  PENDING_APPROVAL   (category + model + quantity + UOM + payment; no stock check)
//   ACCOUNT --approve--> DOCS_PENDING       (no warehouse manager, no transportation / dispatch / receiving forms)
//   ACCOUNT --presses Submit--> DELIVERED   (documents / reference numbers are OPTIONAL - Submit works with nothing attached;
//                                            shown as "Delivered directly", flag Min.directDispatch = true)
//   WAREHOUSE_MANAGER can VIEW the delivered direct entries of the companies of his warehouses (read only, no forms).
// The entry belongs to a company (Min.companyId) instead of a warehouse (Min.warehouseId = null).
// (direct entries are numbered MIN-<company code>-0001; no fixed code any more)

export const PAYMENT_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "PENDING", "ZERO_COST"];
// Only these statuses carry a UTR number / payment proof.
export const paymentNeedsUtr = (status) => status === "COMPLETED" || status === "PARTIALLY_COMPLETED";

// Statuses the warehouse manager is allowed to see at all.
// The warehouse manager sees an entry (items, ship to / bill to, customer) as soon as Sales creates it - it just can't
// open any form until Account approves. Rejected entries are hidden (Sales is still fixing them).
export const WAREHOUSE_VISIBLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.ON_HOLD, ...APPROVED_STATUSES, ...DISPATCHED_STATUSES];

// Sales may edit until dispatch; Account may reject until dispatch.
// READY_FOR_DISPATCH (and DOCS_PENDING once Account has uploaded documents - see editLockReason) is locked.
export const SALES_EDITABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.ON_HOLD, STATUS.PENDING_DISPATCH, STATUS.TRANSPORT_PENDING, STATUS.DOCS_PENDING, STATUS.READY_FOR_DISPATCH];
export const REJECTABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.ON_HOLD, STATUS.PENDING_DISPATCH, STATUS.TRANSPORT_PENDING, STATUS.DOCS_PENDING, STATUS.READY_FOR_DISPATCH];
// Account can reject / hold an entry at ANY step until the dispatch is completely done (the edit lock does not apply to Account decisions).
export const HOLDABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.PENDING_DISPATCH, STATUS.TRANSPORT_PENDING, STATUS.DOCS_PENDING, STATUS.READY_FOR_DISPATCH];
// Account can approve a pending entry, or change its mind and approve a rejected / held one.
export const APPROVABLE_STATUSES = [STATUS.PENDING_APPROVAL, STATUS.REJECTED, STATUS.ON_HOLD];

// Audit-log actions the warehouse manager must NOT see (PI / payment / approval side).
// COST_UPDATED is kept so older history rows stay hidden.
export const HIDDEN_FROM_WAREHOUSE_ACTIONS = ["SUBMITTED", "RESUBMITTED", "APPROVED", "REJECTED", "COST_UPDATED", "PAYMENT_UPDATED", "PI_UPDATED", "PARTY_UPDATED", "ON_HOLD", "INVOICE_CREATED"];

export const isFinanceSide = (role) => role === "SALES" || role === "ACCOUNT";

/** Company ids the user belongs to (join table + primary company). */
export async function getUserCompanyIds(user) {
  const links = await prisma.userCompany.findMany({
    where: { userId: user.id },
    select: { companyId: true },
  });
  return [...new Set([...links.map((l) => l.companyId), ...(user.companyId ? [user.companyId] : [])])];
}

/**
 * Company ids behind the warehouses a warehouse manager manages (primary company + linked companies).
 * The manager may VIEW the "Dispatch directly" entries (delivered, view only) of these companies.
 */
export async function getManagerCompanyIds(user) {
  const rows = await prisma.warehouseAccess.findMany({
    where: { userId: user.id, accessLevel: "MANAGE" },
    select: { warehouse: { select: { companyId: true, companyLinks: { select: { companyId: true } } } } },
  });
  const ids = new Set();
  for (const r of rows) {
    if (r.warehouse?.companyId) ids.add(r.warehouse.companyId);
    for (const l of r.warehouse?.companyLinks || []) ids.add(l.companyId);
  }
  return [...ids];
}

/**
 * Warehouse ids a SALES / ACCOUNT user can see, through the companies they
 * belong to. Used for the view-only inward list / detail / reports / dashboard.
 */
export async function getFinanceWarehouseIds(user) {
  const companyIds = await getUserCompanyIds(user);
  if (!companyIds.length) return [];
  const ids = await warehouseIdsForCompanies(companyIds);
  // A Sales / Account user who was given warehouse access only gets those warehouses.
  const granted = await getSalesGrantedWarehouseIds(user);
  return granted ? ids.filter((id) => granted.includes(id)) : ids;
}

/**
 * Warehouses granted to a SALES / ACCOUNT user in the access section (WarehouseAccess rows).
 * Returns null when the user is not Sales / Account or has no grant at all - then the old rule applies
 * (every warehouse of the user's companies), so existing users keep working.
 */
export async function getSalesGrantedWarehouseIds(user) {
  if (user?.role !== "SALES" && user?.role !== "ACCOUNT") return null;
  const rows = await prisma.warehouseAccess.findMany({ where: { userId: user.id }, select: { warehouseId: true } });
  return rows.length ? rows.map((r) => r.warehouseId) : null;
}

/**
 * Removes everything the warehouse manager must not see from an outward
 * entry: payment status, UTR, proof, approval info, workflow status.
 * PI details (PI no., date, amount, file) and Ship to / Bill to / Dispatch remarks
 * are kept - the warehouse needs them.
 * Items keep only category / model (sku) / quantity / uom.
 */
export function sanitizeForWarehouse(entry) {
  if (!entry) return entry;
  const {
    approvedById, approvedByName, approvedAt, approvalRemarks, status,
    piFileKey,
    ...rest
  } = entry;
  return {
    ...rest,
    // PI details are shared with the warehouse manager. The storage key stays server-side; a flag is sent instead.
    piAmount: entry.piAmount === null || entry.piAmount === undefined ? null : Number(entry.piAmount),
    hasPiFile: Boolean(piFileKey),
    dispatchState: isDispatchedStatus(status) ? "Dispatched" : "Pending",
    items: (entry.items || []).map((i) => ({
      id: i.id,
      category: i.category,
      companyName: i.companyName,
      sku: i.sku,
      quantity: i.quantity,
      uom: i.uom,
    })),
  };
}

/** Sales / Account / Super admin view. The storage key stays server-side; a flag is sent instead. */
export function shapeItemForFinance(i) {
  const { proofFileKey, ...rest } = i;
  return {
    ...rest,
    hasProof: Boolean(proofFileKey),
  };
}

export function shapeForFinance(entry) {
  if (!entry) return entry;
  const { piFileKey, ...rest } = entry;
  return {
    ...rest,
    piAmount: entry.piAmount === null || entry.piAmount === undefined ? null : Number(entry.piAmount),
    hasPiFile: Boolean(piFileKey),
    items: (entry.items || []).map(shapeItemForFinance),
  };
}

/** Returns an error message, or null when the PI (proforma invoice) fields are valid. */
// Contact numbers are exactly 10 digits; a UTR number is exactly 12 digits.
export const PHONE_RE = /^\d{10}$/;
export const UTR_RE = /^\d{12}$/;

export function validatePi(data) {
  if (!String(data.piNumber || "").trim()) return "PI number is required";
  if (!data.piDate || Number.isNaN(new Date(data.piDate).getTime())) return "PI date is required";
  const amount = data.piAmount === "" || data.piAmount === null || data.piAmount === undefined ? NaN : Number(data.piAmount);
  if (!Number.isFinite(amount) || amount < 0) return "PI amount is required and must be 0 or more";
  if (data.piFileKey && !/^(min|uploads)\//.test(String(data.piFileKey))) return "Invalid PI file";
  return null;
}

/** Returns an error message, or null when the Ship to / Bill to details are valid. */
export function validateParty(data) {
  if (!String(data.shipToContactPerson || "").trim()) return "Ship to contact person is required";
  if (!String(data.billToContactPerson || "").trim()) return "Bill to contact person is required";
  if (!String(data.shipToContactNo || "").trim()) return "Ship to contact no. is required";
  if (!String(data.billToContactNo || "").trim()) return "Bill to contact no. is required";
  if (String(data.dispatchRemarks || "").trim().length > 1000) return "Dispatch remarks must be 1000 characters or fewer";
  const email = String(data.billToEmail || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Bill to email is not a valid email address";
  for (const [key, label] of [["shipToContactNo", "Ship to contact no."], ["billToContactNo", "Bill to contact no."]]) {
    const v = String(data[key] || "").trim();
    if (v && !PHONE_RE.test(v)) return `${label} must be exactly 10 digits`;
  }
  return null;
}

/** Ship to / Bill to / Dispatch remarks columns as stored in Min. */
export function toPartyColumns(data) {
  const t = (v) => (String(v ?? "").trim() || null);
  return {
    shipToContactPerson: t(data.shipToContactPerson),
    shipToContactNo: t(data.shipToContactNo),
    shipToLocation: t(data.shipToLocation),
    billToContactPerson: t(data.billToContactPerson),
    billToContactNo: t(data.billToContactNo),
    billToEmail: t(data.billToEmail),
    // Sales' note for the warehouse (separate from the warehouse manager's own dispatch "remarks").
    dispatchRemarks: t(data.dispatchRemarks),
  };
}

/** PI columns as stored in Min. `previous` = the saved entry (to keep its PI file on edit). */
export function toPiColumns(data, previous) {
  const keep = data.keepPiFile === true && previous?.piFileKey && !data.piFileKey;
  return {
    piNumber: String(data.piNumber).trim(),
    piDate: new Date(data.piDate),
    piAmount: Number(data.piAmount),
    piFileKey: keep ? previous.piFileKey : data.piFileKey || null,
    // The PI file is always named "PI" (keeping its extension), whatever the original file was called.
    piFileName: keep ? previous.piFileName : data.piFileKey ? `PI${/\.[a-z0-9]+$/i.test(String(data.piFileKey)) ? String(data.piFileKey).match(/\.[a-z0-9]+$/i)[0].toLowerCase() : ""}` : null,
    piFileType: keep ? previous.piFileType : data.piFileKey ? data.piFileType || null : null,
  };
}

/** Returns an error message, or null when the item's payment fields are valid. */
export function validateItemPayment(item, label) {
  if (!PAYMENT_STATUSES.includes(item.paymentStatus)) {
    return `${label}: payment status must be Completed, Partially Completed, Pending or ₹ 0`;
  }
  // Approve By is needed while the payment is Pending / Partially completed (optional for Completed and ₹ 0).
  if (item.paymentStatus !== "COMPLETED" && item.paymentStatus !== "ZERO_COST" && !String(item.approvedBy || "").trim()) {
    return `${label}: Approve By is required when payment status is ${item.paymentStatus === "PENDING" ? "Pending" : "Partially Completed"}`;
  }
  if (paymentNeedsUtr(item.paymentStatus)) {
    const utr = String(item.utrNumber || "").trim();
    if (utr && !UTR_RE.test(utr)) return `${label}: UTR number must be exactly 12 digits`;
    const hasUtr = Boolean(utr);
    const hasProof = Boolean(item.proofFileKey) || item.keepProof === true;
    if (!hasUtr && !hasProof) {
      return `${label}: UTR number or a payment proof (image / file) is required when payment status is ${
        item.paymentStatus === "COMPLETED" ? "Completed" : "Partially Completed"
      }`;
    }
  }
  if (item.proofFileKey && !/^(min|uploads)\//.test(String(item.proofFileKey))) {
    return `${label}: invalid proof file`;
  }
  return null;
}

/** Item row as stored in MinItem. `previous` = the row being replaced on edit (to keep its proof). */
export function toItemRow(item, previous) {
  const paid = paymentNeedsUtr(item.paymentStatus);
  const keep = paid && item.keepProof === true && previous?.proofFileKey;
  return {
    category: item.category,
    companyName: item.companyName ? String(item.companyName).trim() || null : null,
    sku: String(item.sku).trim(),
    quantity: Number(item.quantity),
    uom: item.uom,
    paymentStatus: item.paymentStatus,
    utrNumber: paid ? String(item.utrNumber || "").trim() || null : null,
    approvedBy: item.paymentStatus !== "COMPLETED" ? String(item.approvedBy || "").trim() || null : null,
    proofFileKey: paid ? (keep ? previous.proofFileKey : item.proofFileKey || null) : null,
    // A payment proof is always named "payment" (keeping its extension), whatever the original file was called.
    proofFileName: paid ? (keep ? previous.proofFileName : item.proofFileKey ? `payment${(String(item.proofFileKey).match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase()}` : null) : null,
    proofFileType: paid ? (keep ? previous.proofFileType : item.proofFileType || null) : null,
  };
}

/**
 * Fingerprint of everything Account approves: item identity, quantity, UOM and
 * all payment fields. If it changes on an already-approved entry, approval is needed again.
 */
export function itemsFingerprint(items = []) {
  return JSON.stringify(
    items
      .map((i) => [
        String(i.category || "").toLowerCase(),
        String(i.companyName || "").trim().toLowerCase(),
        String(i.sku || "").trim().toLowerCase(),
        Number(i.quantity),
        String(i.uom || "").toLowerCase(),
        i.paymentStatus || null,
        i.utrNumber || null,
        i.approvedBy || null,
        Boolean(i.proofFileKey),
      ])
      .map((row) => JSON.stringify(row))
      .sort()
  );
}

/**
 * Storage layout (bucket warehouse-documents):
 *
 *   min/<outward number>/   payment proofs + delivery challan / e-way bill / photos ...
 *
 * A new entry has no outward number until it is saved, so a proof picked on the create form waits in
 * uploads/<outward id>/ and is moved into min/<outward number>/ as soon as the entry is created.
 */
export const outwardFolder = (outwardNumber) => `min/${String(outwardNumber).replace(/[^a-zA-Z0-9._-]/g, "_")}/`;
export const tempProofFolder = (minId) => `uploads/${String(minId).toLowerCase()}/`;

/** A proof / PI file key must sit in this entry's own folder (final or temporary) - never in someone else's. */
export function proofKeyProblem(items = [], minId, outwardNumber, piFileKey) {
  const allowed = [tempProofFolder(minId), ...(outwardNumber ? [outwardFolder(outwardNumber)] : [])];
  const inFolder = (key) => allowed.some((f) => String(key).startsWith(f));
  const bad = items.find((i) => i.proofFileKey && !inFolder(i.proofFileKey));
  if (bad) return "A payment proof does not belong to this entry. Please remove it and attach the file again.";
  if (piFileKey && !inFolder(piFileKey)) return "The PI file does not belong to this entry. Please remove it and attach the file again.";
  return null;
}


/**
 * Who owns which reference document / document.
 *
 *   ACCOUNT            Invoice, E-way Bill, Other (Accounts)          (documents: Invoice, E-way bill, Accounts other - <name>)
 *   WAREHOUSE_MANAGER  Delivery Challan, Return Note, Other           (documents: Delivery challan, Dispatch photo, ...)
 *
 * Ownership is decided by the type / category name, so no extra database column is needed.
 * Each side only ever replaces its own rows, so Account and the warehouse never overwrite each other.
 */
export const ACCOUNT_REF_TYPES = ["Invoice", "E-way Bill", "DC Challan", "Without Invoice", "Other (Accounts)"]; // shown to the user as Invoice / E-way Bill / DC Challan / Other
export const MANAGER_REF_TYPES = ["Delivery Challan", "Return Note", "Bilty", "Other"];

export const canonicalAccountRefType = (type) =>
  ACCOUNT_REF_TYPES.find((t) => t.toLowerCase() === String(type || "").trim().toLowerCase()) || null;
export const isAccountRefType = (type) => Boolean(canonicalAccountRefType(type));

export const ACCOUNT_DOC_PREFIX = "Accounts other - ";
export const isBiltyDocCategory = (category) => /^bilty/i.test(String(category || "").trim());
export const isAccountDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|without[ -]?invoice|accounts other)/i.test(String(category || "").trim());

// Account can add / replace / delete its own reference documents and files only while the entry is approved and
// waiting for dispatch, AND only after the warehouse manager has submitted the transportation form (see accountDocsBlock).
export const ACCOUNT_DOC_STATUSES = [STATUS.PENDING_DISPATCH, STATUS.DOCS_PENDING, STATUS.READY_FOR_DISPATCH];

/**
 * Above this PI amount (Rs.) the e-way bill document must be uploaded before the documents are shared with the
 * warehouse manager (it used to be checked at approval, but Account can no longer upload before the vehicle details arrive).
 */
export const EWAY_BILL_THRESHOLD = 100000;

export function ewayBillProblem() {
  // The e-way bill is never mandatory for Account, whatever the PI amount (kept as a function so callers need no change).
  return null;
}

/** Driver name / contact are optional, but a contact must look like a phone number when given. */
export function validateDriver(data) {
  const contact = String(data.driverContact || "").trim();
  if (contact && !PHONE_RE.test(contact)) return "Driver contact must be exactly 10 digits";
  return null;
}

/** Returns an error message, or null when the receiving details are valid. */
export function validateReceiving(data, dispatchedAt) {
  const name = String(data.receiverName || "").trim();
  if (!name) return "Receiver name is required";
  const contact = String(data.receiverContact || "").trim();
  if (contact && !PHONE_RE.test(contact)) return "Receiver contact must be exactly 10 digits";
  const date = data.receivedDate ? new Date(data.receivedDate) : null;
  if (!date || Number.isNaN(date.getTime())) return "Receiving date is required";
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) return "Receiving date cannot be in the future";
  if (dispatchedAt) {
    const dispatchDay = new Date(dispatchedAt);
    dispatchDay.setHours(0, 0, 0, 0);
    if (date < dispatchDay) return "Receiving date cannot be before the dispatch date";
  }
  return null;
}

/** Receiving documents (copy / photo ...) are stored under names starting with "Receiving". */
export const RECEIVING_DOC_PREFIX = "Receiving";
export const RECEIVING_REQUIRED_DOC = "Receiving copy";
export const isReceivingDocCategory = (category) => /^receiving/i.test(String(category || "").trim());


// ---------------------------------------------------------------------------
// TRANSPORTATION  (warehouse manager) -> DOCUMENTS (account) -> DISPATCH (warehouse manager)
// ---------------------------------------------------------------------------
export const TRANSPORT_MODES = ["DEDICATED", "TRANSPORTATION"];
export const TRANSPORT_MODE_LABEL = { DEDICATED: "Dedicated Vehicle", TRANSPORTATION: "Transportation" };
// Dispatch mode picked on the transportation form (optional).
export const DISPATCH_MODES = ["By Road", "Courier", "Customer Pickup"];

export const STAGE = {
  TRANSPORT_PENDING: "TRANSPORT_PENDING",
  DOCS_PENDING: "DOCS_PENDING",
  READY_FOR_DISPATCH: "READY_FOR_DISPATCH",
  DISPATCHED: "DISPATCHED",
};

/** Returns an error message, or null when the transportation form is valid. */
export function validateTransport(data) {
  const mode = String(data.transportMode || "").trim().toUpperCase();
  if (!TRANSPORT_MODES.includes(mode)) return "Select the vehicle type: Dedicated vehicle or Transportation";
  const has = (k) => Boolean(String(data[k] || "").trim());
  if (has("dispatchMode") && !DISPATCH_MODES.includes(String(data.dispatchMode).trim())) return "Select a valid dispatch mode: By Road, Courier or Customer Pickup";
  if (mode === "DEDICATED") {
    if (!has("vehicleNumber")) return "Vehicle number is required";
    if (!has("driverName")) return "Driver name is required";
    if (!has("driverContact")) return "Driver contact is required";
    if (!PHONE_RE.test(String(data.driverContact).trim())) return "Driver contact must be exactly 10 digits";
  } else {
    // Only the transporter name is mandatory; ID and contact are optional (a contact, when given, must be 10 digits).
    if (!has("transporterName")) return "Transporter name is required";
    if (has("transporterContact") && !PHONE_RE.test(String(data.transporterContact).trim())) return "Transporter contact must be exactly 10 digits";
    // Vehicle no. and driver contact are optional for a transporter (a driver contact, when given, must be 10 digits).
    if (has("driverContact") && !PHONE_RE.test(String(data.driverContact).trim())) return "Driver contact must be exactly 10 digits";
  }
  return null;
}

/** Transportation columns as stored in Min. The fields of the other vehicle type are cleared. */
export function toTransportColumns(data) {
  const mode = String(data.transportMode).trim().toUpperCase();
  const t = (v) => String(v ?? "").trim() || null;
  const dedicated = mode === "DEDICATED";
  return {
    transportMode: mode,
    dispatchMode: DISPATCH_MODES.includes(String(data.dispatchMode || "").trim()) ? String(data.dispatchMode).trim() : null,
    vehicleNumber: t(data.vehicleNumber), // optional for a transporter

    driverName: dedicated ? t(data.driverName) : null,
    driverContact: t(data.driverContact), // optional for a transporter
    transporterId: dedicated ? null : t(data.transporterId),
    transporterName: dedicated ? null : t(data.transporterName),
    transporterContact: dedicated ? null : t(data.transporterContact),
  };
}

// Account documents that open the dispatch form for the warehouse manager.
// Every Account document (Invoice, E-way bill, DC Challan, Without Invoice, Other) releases the entry to the warehouse manager.
export const isReleaseDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|without[ -]?invoice|accounts other)/i.test(String(category || "").trim());
export const isInvoiceDocCategory = (category) => /^invoice/i.test(String(category || "").trim());
export const isInvoiceRefType = (type) => String(type || "").trim().toLowerCase() === "invoice";
// Account reference types that release the entry: every account reference (Invoice included).
export const isReleaseRefType = (type) => isAccountRefType(type);
// An entry is released to the warehouse manager when Account has added ANY document (file) OR
// ANY reference (Invoice / E-way Bill / DC Challan / Without Invoice / Other).
export const hasReleaseDocument = (docs = [], refs = []) =>
  docs.some((d) => isReleaseDocCategory(d.docCategory)) || refs.some((r) => isReleaseRefType(r.refDocType));

/**
 * The status an approved, not-yet-dispatched entry should have, from what has been submitted so far:
 * no transportation form -> TRANSPORT_PENDING; form in, no release document -> DOCS_PENDING; both -> READY_FOR_DISPATCH.
 */
export function deriveApprovedStatus(entry, docs = [], refs = []) {
  // Dispatch directly: no warehouse, so no transportation step - Account uploads the documents right after approval.
  if (entry.directDispatch) return STATUS.DOCS_PENDING;
  if (!entry.transportSubmittedAt) return STATUS.TRANSPORT_PENDING;
  // Account's documents are optional, but the dispatch form opens only once Account has pressed Submit / Save after the
  // transportation form (saveAccountDocuments sets READY_FOR_DISPATCH). Once ready, it stays ready.
  return entry.status === STATUS.READY_FOR_DISPATCH ? STATUS.READY_FOR_DISPATCH : STATUS.DOCS_PENDING;
}

/** Which stage an entry is in. null for entries that are not approved yet (use `status`). */
export function outwardStage(entry, docs = [], refs = []) {
  if (isDispatchedStatus(entry.status)) return STAGE.DISPATCHED;
  if (!isApprovedStatus(entry.status)) return null;
  // The saved status is the truth; legacy rows (PENDING_DISPATCH) are worked out from what exists.
  if (entry.status === STATUS.PENDING_DISPATCH) return deriveApprovedStatus(entry, docs, refs);
  return entry.status;
}

/**
 * Keeps the SAVED status of an approved entry in step with the transportation form and Account's documents.
 * Call it after anything that adds / removes either. `client` is prisma or a transaction client.
 * Returns the status the entry has afterwards (null when it is not in an approved, undispatched status).
 */
export async function syncApprovedStage(client, minId) {
  const min = await client.min.findUnique({ where: { id: minId }, select: { status: true, transportSubmittedAt: true, piAmount: true, directDispatch: true } });
  if (!min || !isApprovedStatus(min.status)) return null;
  const docs = await client.document.findMany({ where: { linkedType: "outward", linkedId: minId }, select: { docCategory: true } });
  const refs = await client.minReferenceDocument.findMany({ where: { minId }, select: { refDocType: true } });
  const target = deriveApprovedStatus(min, docs, refs);
  if (target !== min.status) {
    await client.min.updateMany({ where: { id: minId, status: { in: APPROVED_STATUSES } }, data: { status: target } });
  }
  return target;
}

/**
 * Why Sales / Account can no longer update (edit, reject, hold) this entry. null = still open.
 * Locked once the transportation details are sent AND Account has uploaded its documents, and always after dispatch.
 * `docs` = the entry's documents, `refs` = its reference documents (either one counts as "Account uploaded").
 * The Super admin ignores this lock.
 */
export function editLockReason(entry, docs = [], refs = []) {
  if (isDispatchedStatus(entry.status)) return "This entry has been dispatched and can no longer be edited";
  const message = "The transportation details and the account documents are already submitted, so this entry can no longer be updated";
  if (isApprovedStatus(entry.status) && entry.transportSubmittedAt) {
    const accountUploaded = docs.some((d) => isAccountDocCategory(d.docCategory)) || refs.some((r) => isAccountRefType(r.refDocType));
    if (accountUploaded) return message;
  }
  return null;
}

/**
 * Why the transportation details can no longer be changed (null = still editable).
 * Locked as soon as the details were submitted AND Account has uploaded anything (a document or a reference).
 * Applies to EVERY role (warehouse manager, Super admin) and every screen: transportation form, dispatch form,
 * the admin update form.
 */
export const TRANSPORT_LOCK_MESSAGE = "The transportation details can no longer be changed because the account team has already uploaded its documents";
export function transportLockReason(entry, docs = [], refs = []) {
  if (!entry?.transportSubmittedAt) return null;
  const accountUploaded = docs.some((d) => isAccountDocCategory(d.docCategory)) || refs.some((r) => isAccountRefType(r.refDocType));
  return accountUploaded ? TRANSPORT_LOCK_MESSAGE : null;
}

// Every document is shared with the warehouse manager the moment it exists - the Invoice included.
export const isReleasedStage = (stage) => stage === STAGE.READY_FOR_DISPATCH || stage === STAGE.DISPATCHED;

export function documentsForWarehouse(docs = []) {
  return docs;
}

export function referencesForWarehouse(refs = []) {
  return refs;
}

/** True when Account has created an invoice (document or reference). */
export const hasInvoice = (docs = [], refs = []) =>
  docs.some((d) => isInvoiceDocCategory(d.docCategory)) || refs.some((r) => isInvoiceRefType(r.refDocType));

/** Why Account cannot add documents right now (null = it can). */
export function accountDocsBlock(entry) {
  if (isDispatchedStatus(entry.status)) return "Documents can no longer be changed after dispatch";
  if (!isApprovedStatus(entry.status)) return "Documents can be added only after the entry is approved";
  // Dispatch directly has no warehouse / transportation step.
  if (entry.directDispatch) return null;
  if (!entry.transportSubmittedAt) return "Documents can be added only after the warehouse has submitted the vehicle / transportation details";
  return null;
}
