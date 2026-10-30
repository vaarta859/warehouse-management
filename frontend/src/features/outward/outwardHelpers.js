import {
  formatDateTime,
  getQuantity,
  getSerialCount,
  getDocumentStatus,
} from "../shared/formatters";

// -------------------------------------------------
// REQUIRED_DOCUMENTS
// -------------------------------------------------

// Warehouse manager's documents. Invoice / E-way bill now belong to the account team.
export const REQUIRED_DOCUMENTS = [
  "Delivery challan",
  "Dispatch photo",
];

// -------------------------------------------------
// Account team's side: reference documents + documents
// -------------------------------------------------
// Shown to the user as: Invoice / E-way Bill / DC Challan / Other ("Other (Accounts)" is stored under that
// name so it never clashes with the warehouse manager's "Other").
export const ACCOUNT_REF_TYPES = ["Invoice", "E-way Bill", "DC Challan", "Without Invoice", "Other (Accounts)"];
const ACCOUNT_REF_OWNED = ACCOUNT_REF_TYPES;
export const MANAGER_REF_TYPES = ["Delivery Challan", "Return Note", "Bilty", "Other"];
// No account document is compulsory to upload: each reference type chosen just gets its own (optional)
// row in the Documents section. Only the e-way bill is needed above EWAY_BILL_THRESHOLD (number OR document).
export const ACCOUNT_REQUIRED_DOCUMENTS = [];
export const refTypeLabel = (type) => (type === "Other (Accounts)" ? "Other" : type === "Without Invoice" ? "Invoice without amount" : type);
// The document row each reference type opens in the Documents section.
// Warehouse manager types open their own row too: choose Bilty -> a Bilty row to upload, and so on.
const REF_TYPE_DOCUMENT = {
  Invoice: "Invoice",
  "E-way Bill": "E-way bill",
  "DC Challan": "DC challan",
  "Without Invoice": "Without invoice",
  // Account's "Other" is stored as "Accounts other" (shown as "Other") so it never clashes with the manager's "Other".
  "Other (Accounts)": "Accounts other",
  "Delivery Challan": "Delivery challan",
  "Return Note": "Return note",
  Bilty: "Bilty",
  Other: "Other",
};
export const refTypeDocument = (type) => REF_TYPE_DOCUMENT[type] || null;
export const refNumberLabel = (type) =>
  type === "Invoice" ? "Invoice no." : type === "E-way Bill" ? "E-way bill no." : type === "DC Challan" ? "Challan no." : type === "Without Invoice" ? "Reference no." : "Reference doc no.";

// Above this PI amount (Rs.) an e-way bill number or the e-way bill document is required before approval.
export const EWAY_BILL_THRESHOLD = 100000;
// The e-way bill is never mandatory, whatever the PI amount.
export const isAboveEwayLimit = () => false;
const isEwayCategory = (category) => /^e-?way/i.test(String(category || "").trim());
// True when an e-way bill DOCUMENT (uploaded or picked) exists - the e-way bill number alone is not enough.
export const hasEwayDocument = (docs = [], staged = []) => [...docs, ...staged].some((d) => isEwayCategory(d.docCategory));
// refs = rows being edited ({ refDocType, refDocNumber, ewayBillNumber }); docs / staged = uploaded and picked files.
export const hasEwayBill = (refs = [], docs = [], staged = []) =>
  refs.some((r) => (/e-?way/i.test(String(r.refDocType || "")) && String(r.refDocNumber || "").trim()) || String(r.ewayBillNumber || "").trim()) ||
  [...docs, ...staged].some((d) => isEwayCategory(d.docCategory));
// Receiving details (filled by the warehouse manager after dispatch).
export const RECEIVING_REQUIRED_DOCUMENT = "Receiving copy";
export const RECEIVING_ADD_MENU = ["Receiving photo", "Other"];
export const RECEIVING_DOC_PREFIX = "Receiving ";
export const isReceivingDocCategory = (category) => /^receiving/i.test(String(category || "").trim());
export const isReceived = (outward) => outward?.workflowStatus === "DELIVERED" || Boolean(outward?.receivedAt || outward?.receivedDate);
export const ACCOUNT_DOC_PREFIX = "Accounts other - ";

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
export const isAccountRef = (ref) => ACCOUNT_REF_OWNED.some((t) => sameText(t, ref?.refDocType));
export const isManagerRef = (ref) => !isAccountRef(ref);
export const isAccountDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|without[ -]?invoice|accounts other)/i.test(String(category || "").trim());
// "Accounts other - GST certificate" -> "Other - GST certificate"
export const docLabel = (category) =>
  String(category || "Document").replace(/^accounts other/i, "Other").replace(/^without[ -]?invoice/i, "Invoice without amount");

// Account may add / replace / delete its documents until the entry is dispatched.
// Only while approved + waiting for dispatch, and only once the warehouse manager has submitted the transportation form.
export const ACCOUNT_EDIT_STATUSES = ["PENDING_DISPATCH", "DOCS_PENDING", "READY_FOR_DISPATCH"];

// -------------------------------------------------
// Saved workflow statuses (the server stores every step; PENDING_DISPATCH is the old "approved" value)
// -------------------------------------------------
export const APPROVED_STATUSES = ["PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING", "READY_FOR_DISPATCH"];
export const DISPATCHED_STATUSES = ["DISPATCHED", "DELIVERED"];
export const isApprovedStatus = (status) => APPROVED_STATUSES.includes(status);
export const isDispatchedStatus = (status) => DISPATCHED_STATUSES.includes(status);
// Sales can edit until the entry is locked (the server also sends `editLocked`).
// Account can reject / hold / approve at any step until the dispatch is done (the lock does not apply to Account).
export const SALES_EDITABLE_STATUSES = ["PENDING_APPROVAL", "REJECTED", "ON_HOLD", "PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING", "READY_FOR_DISPATCH"];
export const REJECTABLE_STATUSES = ["PENDING_APPROVAL", "ON_HOLD", "PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING", "READY_FOR_DISPATCH"];
export const HOLDABLE_STATUSES = ["PENDING_APPROVAL", "PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING", "READY_FOR_DISPATCH"];

// -------------------------------------------------
// Stages after approval (sent by the server as `stage`)
//   TRANSPORT_PENDING -> DOCS_PENDING -> READY_FOR_DISPATCH -> DISPATCHED (then receiving)
// -------------------------------------------------
export const STAGE = {
  TRANSPORT_PENDING: "TRANSPORT_PENDING",
  DOCS_PENDING: "DOCS_PENDING",
  READY_FOR_DISPATCH: "READY_FOR_DISPATCH",
  DISPATCHED: "DISPATCHED",
};
export const STAGE_STYLE = {
  TRANSPORT_PENDING: { label: "Awaiting transportation", cls: "bg-blue-100 text-blue-700" },
  DOCS_PENDING: { label: "Awaiting acc. documents", cls: "bg-indigo-100 text-indigo-700" },
  READY_FOR_DISPATCH: { label: "Ready for dispatch", cls: "bg-teal-100 text-teal-700" },
};
export const isTransportSubmitted = (outward) => Boolean(outward?.transportSubmittedAt);
export const TRANSPORT_MODES = [
  { value: "DEDICATED", label: "Dedicated vehicle" },
  { value: "TRANSPORTATION", label: "Transportation" },
];
export const transportModeLabel = (value) => TRANSPORT_MODES.find((m) => m.value === value)?.label || "";
// Dispatch mode picked on the transportation form (optional).
export const DISPATCH_MODES = ["By Road", "Courier", "Customer Pickup"];
// Every account document (Invoice included) is shared with the warehouse manager and releases the entry to them.
export const isReleaseDocCategory = (category) => /^(invoice|e-?way|dc[ -]?challan|without[ -]?invoice|accounts other)/i.test(String(category || "").trim());
export const isInvoiceDocCategory = (category) => /^invoice/i.test(String(category || "").trim());
// Every account reference type (Invoice included) releases the entry to the warehouse manager.
export const isReleaseRefType = (type) => Boolean(String(type || "").trim());

const totalCostOf = (items) => items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

export function formatOutwardType(type) {
  if (!type) return "-";

  const value = String(type).trim();
  const lower = value.toLowerCase();

  if (lower.includes("sale")) {
    return "Sale - Stock Out";
  }
  if (lower.includes("service") && lower.includes("customer")) {
    return "Service - Stock Out to Customer";
  }
  if (lower.includes("service")) {
    return "Service - Stock Out";
  }
  // "Return to Vendor" was renamed "Replacement"; entries saved with the old name show the new one.
  if (lower.includes("replacement") || lower.includes("return")) {
    return "Replacement";
  }
  if (lower.includes("damage") || lower.includes("scrap")) {
    return "Damage / Scrap Out";
  }

  return value;
}

export function getStatus(outward) {
  return getDocumentStatus(outward, REQUIRED_DOCUMENTS);
}

// Maps a raw outward/dispatch object from the API into
// the flat shape the list page renders.
export function formatOutwardEntry(outward, index) {
  const items = Array.isArray(outward.items) ? outward.items : [];

  const outwardNumber =
    outward.outwardNumber ||
    outward.outward_number ||
    outward.dcNumber ||
    outward.dc_number ||
    outward.number ||
    outward.outward ||
    `MIN-${index + 1}`;

  const outwardType = outward.outwardType || outward.outward_type || outward.type || "-";

  const party =
    outward.customerName ||
    outward.customer_name ||
    outward.partyName ||
    outward.party_name ||
    outward.recipientName ||
    outward.recipient_name ||
    outward.customer?.name ||
    outward.vendor?.name ||
    "-";

  const companyName = String(outward.companyName || outward.company_name || outward.company?.name || "").trim();

  const createdAt =
    outward.createdAt ||
    outward.created_at ||
    outward.outwardDate ||
    outward.outward_date ||
    outward.date ||
    outward.createdOn ||
    outward.created_on;

  const { date, time } = formatDateTime(createdAt);
  const quantity = getQuantity(items);
  const serials = getSerialCount(items);
  const statusData = getStatus(outward);

  const documents = Array.isArray(outward.documents)
    ? outward.documents
    : Array.isArray(outward.document)
    ? outward.document
    : [];

  return {
    id: outward.id,
    outwardNumber,
    outward: outwardNumber,
    type: formatOutwardType(outwardType),
    party,
    companyName,
    time,
    date,
    quantity,
    serials,
    status: statusData.status,
    statusType: statusData.statusType,
    pendingDocuments: statusData.pendingDocuments,
    uploadedDocuments: statusData.uploadedDocuments,
    requiredDocuments: statusData.requiredDocuments,
    items,
    workflowStatus: outward.workflowStatus || null,
    // "Dispatch directly": no warehouse, delivered as soon as Account uploads the documents.
    directDispatch: Boolean(outward.directDispatch),
    companyId: outward.companyId || null,
    stage: outward.stage || null,
    invoiceCreated: Boolean(outward.invoiceCreated),
    editLocked: Boolean(outward.editLocked),
    editLockReason: outward.editLockReason || null,
    dispatchState: outward.dispatchState || null,
    totalCost: totalCostOf(items),
    piNumber: outward.piNumber || "",
    piAmount: outward.piAmount ?? null,
    piDate: outward.piDate || null,
    hasPiFile: Boolean(outward.hasPiFile),
    dispatchRemarks: outward.dispatchRemarks || "",
    shipToContactPerson: outward.shipToContactPerson || "",
    shipToContactNo: outward.shipToContactNo || "",
    shipToLocation: outward.shipToLocation || "",
    billToContactPerson: outward.billToContactPerson || "",
    billToContactNo: outward.billToContactNo || "",
    billToEmail: outward.billToEmail || "",
    refDocType: outward.refDocType || outward.ref_doc_type || "",
    refDocNumber: outward.refDocNumber || outward.ref_doc_number || "",
    refDocDate: outward.refDocDate || outward.ref_doc_date || "",
    ewayBillNumber: outward.ewayBillNumber || outward.eway_bill_number || "",
    dispatchMode: outward.dispatchMode || outward.dispatch_mode || "",
    vehicleNumber: outward.vehicleNumber || outward.vehicle_number || "",
    driverName: outward.driverName || "",
    driverContact: outward.driverContact || "",
    transportMode: outward.transportMode || "",
    transporterId: outward.transporterId || "",
    transporterName: outward.transporterName || "",
    transporterContact: outward.transporterContact || "",
    receivedDate: outward.receivedDate || null,
    receivedAt: outward.receivedAt || null,
    remarks: outward.remarks || "",
    documents,
    createdAt,
  };
}


// -------------------------------------------------
// Approval workflow (Sales -> Account -> Warehouse)
// -------------------------------------------------

export const COST_STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "PARTIALLY_COMPLETED", label: "Partially completed" },
  { value: "PENDING", label: "Pending" },
];

export const paymentStatusLabel = (value) =>
  COST_STATUS_OPTIONS.find((o) => o.value === value)?.label || "-";

export const WORKFLOW_STATUS = {
  PENDING_APPROVAL: { label: "Pending approval", cls: "bg-amber-100 text-amber-700" },
  PENDING_DISPATCH: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  TRANSPORT_PENDING: { label: "Awaiting transportation", cls: "bg-blue-100 text-blue-700" },
  DOCS_PENDING: { label: "Awaiting acc. documents", cls: "bg-indigo-100 text-indigo-700" },
  READY_FOR_DISPATCH: { label: "Ready for dispatch", cls: "bg-teal-100 text-teal-700" },
  DISPATCHED: { label: "Shipped", cls: "bg-amber-100 text-amber-700" },
  DELIVERED: { label: "Delivered", cls: "bg-green-100 text-green-700" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-600" },
  ON_HOLD: { label: "On hold", cls: "bg-purple-100 text-purple-700" },
};

// The warehouse manager never receives the real workflow status - only
// "Pending" / "Dispatched" (dispatchState).
export const DISPATCH_STATE = {
  Pending: { label: "Pending dispatch", cls: "bg-blue-100 text-blue-700" },
  Dispatched: { label: "Dispatched", cls: "bg-green-100 text-green-700" },
};

// Once dispatched, EVERY role sees the receiving state instead of plain "Dispatched":
// "Shipped" until the receiving form is filled, then "Delivered".
export const RECEIVING_STATE = {
  pending: { label: "Shipped", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Delivered", cls: "bg-green-100 text-green-700" },
};

// "Dispatch directly" entries have no receiving step: they are delivered as soon as Account uploads the documents.
export const DIRECT_DELIVERED_STYLE = { label: "Delivered directly", cls: "bg-green-100 text-green-700" };
export const DIRECT_DISPATCH_LABEL = "Dispatch directly";

export const INVOICE_CREATED_STYLE = { label: "Invoice created", cls: "bg-sky-100 text-sky-700" };

export const getStatusStyle = (outward) => {
  if (!outward) return null;
  const dispatched = outward.workflowStatus
    ? isDispatchedStatus(outward.workflowStatus)
    : outward.dispatchState === "Dispatched";
  if (dispatched && outward.directDispatch) return DIRECT_DELIVERED_STYLE;
  if (dispatched) return isReceived(outward) ? RECEIVING_STATE.completed : RECEIVING_STATE.pending;
  // Account created the invoice (never sent to the warehouse manager): the status moves on from "Awaiting acc. documents".
  if (outward.invoiceCreated && outward.stage === "DOCS_PENDING") return INVOICE_CREATED_STYLE;
  if (outward.stage && STAGE_STYLE[outward.stage]) return STAGE_STYLE[outward.stage];
  return outward.workflowStatus ? WORKFLOW_STATUS[outward.workflowStatus] : DISPATCH_STATE[outward.dispatchState];
};

export const isPlaceholder = (value) => !value || String(value).trim().toLowerCase() === "pending";

export const formatMoney = (value) =>
  value === null || value === undefined || value === ""
    ? "-"
    : `\u20B9${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const totalCost = (items = []) =>
  items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);

// Which inward types an outward type's serial numbers can be scanned from (the server enforces the same rule).
export const SERIAL_SOURCE_TYPES = {
  "Sale - Stock Out": ["Purchase - New Stock", "Return of Purchase"],
  "Service - Stock Out": ["Purchase - New Stock", "Service/Faulty Stock from Customer"],
  "Service - Stock Out to Customer": ["Purchase - New Stock", "Service/Faulty Stock from Customer"],
  Replacement: ["Purchase - Service Stock", "Repair-Service Stock"],
  "Damage / Scrap Out": ["Service/Faulty Stock from Customer"],
};
