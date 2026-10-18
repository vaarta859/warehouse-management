// -------------------------------------------------
// REQUIRED_DOCUMENTS
// Shared between the list page (status badge) and
// the detail page (which docs to render as rows).
// -------------------------------------------------

export const REQUIRED_DOCUMENTS = [
  "Vendor invoice",
  "E-way bill",
  "Unloading sign-off sheet",
];

export function formatInwardType(type) {
  if (!type) return "-";

  const value = String(type).trim();
  const lower = value.toLowerCase();

  if (lower.includes("repair")) {
    return "Repair-Service Stock";
  }
  if (lower.includes("purchase") && lower.includes("new")) {
    return "Purchase - New Stock";
  }
  if (lower === "new stock" || lower === "new") {
    return "Purchase - New Stock";
  }
  if (lower.includes("purchase") && lower.includes("service")) {
    return "Purchase - Service Stock";
  }
  if (lower.includes("service") && lower.includes("customer")) {
    return "Service/Faulty Stock from Customer";
  }
  if (lower.includes("service")) {
    return "Purchase - Service Stock";
  }
  if (lower.includes("return") || lower.includes("returns")) {
    return "Return of Purchase";
  }

  return value;
}

export function formatDateTime(value) {
  if (!value) return { date: "-", time: "-" };

  const dateObject = new Date(value);
  if (Number.isNaN(dateObject.getTime())) {
    return { date: "-", time: "-" };
  }

  const now = new Date();

  const today =
    dateObject.getDate() === now.getDate() &&
    dateObject.getMonth() === now.getMonth() &&
    dateObject.getFullYear() === now.getFullYear();

  const yesterdayObject = new Date();
  yesterdayObject.setDate(yesterdayObject.getDate() - 1);

  const yesterday =
    dateObject.getDate() === yesterdayObject.getDate() &&
    dateObject.getMonth() === yesterdayObject.getMonth() &&
    dateObject.getFullYear() === yesterdayObject.getFullYear();

  let date;
  if (today) {
    date = "Today";
  } else if (yesterday) {
    date = "Yesterday";
  } else {
    date = dateObject.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  const time = dateObject.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return { date, time };
}

export function getQuantity(items) {
  if (!Array.isArray(items)) return 0;

  return items.reduce(
    (total, item) =>
      total + Number(item.quantity || item.qty || item.receivedQuantity || 0),
    0
  );
}

export function getSerialCount() { return 0; }

export function getStatus(grn) {
  if (grn.status === "Complete" || grn.status === "Pending") {
    const backendPending = Number(grn.pendingDocuments);
    const backendUploaded = Number(grn.uploadedDocuments);
    const backendRequired = Number(grn.requiredDocuments);

    return {
      status: grn.status,
      statusType: grn.status === "Complete" ? "complete" : "pending",
      pendingDocuments: Number.isFinite(backendPending)
        ? backendPending
        : grn.status === "Complete"
        ? 0
        : REQUIRED_DOCUMENTS.length,
      uploadedDocuments: Number.isFinite(backendUploaded) ? backendUploaded : 0,
      requiredDocuments: Number.isFinite(backendRequired)
        ? backendRequired
        : REQUIRED_DOCUMENTS.length,
    };
  }

  const documents = Array.isArray(grn.documents)
    ? grn.documents
    : Array.isArray(grn.document)
    ? grn.document
    : [];

  const uploadedCategories = documents.map((doc) => String(doc.docCategory || doc.doc_category || "").trim().toLowerCase());
  const hasCategory = (requiredDocument) => uploadedCategories.some((value) => value === requiredDocument.toLowerCase() || value.startsWith(`${requiredDocument.toLowerCase()} #`) || value.startsWith(`${requiredDocument.toLowerCase()} `));

  const pendingDocuments = REQUIRED_DOCUMENTS.filter((requiredDocument) => !hasCategory(requiredDocument)).length;

  const uploadedDocuments = REQUIRED_DOCUMENTS.length - pendingDocuments;
  const complete = pendingDocuments === 0;

  return {
    status: complete ? "Complete" : "Pending",
    statusType: complete ? "complete" : "pending",
    pendingDocuments,
    uploadedDocuments,
    requiredDocuments: REQUIRED_DOCUMENTS.length,
  };
}

// Maps a raw GRN object from the API into the flat
// shape the list page renders. Used by the inward
// list thunk's consumer (Inward.jsx).
export function formatGrn(grn, index) {
  const items = Array.isArray(grn.items) ? grn.items : [];

  const grnNumber =
    grn.grnNumber ||
    grn.grn_number ||
    grn.grnNo ||
    grn.grn_no ||
    grn.number ||
    grn.grn ||
    `GRN-${index + 1}`;

  const inwardType = grn.inwardType || grn.inward_type || grn.type || "-";

  const party =
    grn.supplierName ||
    grn.supplier_name ||
    grn.customerName ||
    grn.customer_name ||
    grn.partyName ||
    grn.party_name ||
    grn.supplier?.name ||
    grn.customer?.name ||
    "-";

  const createdAt =
    grn.createdAt ||
    grn.created_at ||
    grn.inwardDate ||
    grn.inward_date ||
    grn.date ||
    grn.createdOn ||
    grn.created_on;

  const { date, time } = formatDateTime(createdAt);
  const quantity = getQuantity(items);
  const serials = getSerialCount(items);
  const statusData = getStatus(grn);

  const documents = Array.isArray(grn.documents)
    ? grn.documents
    : Array.isArray(grn.document)
    ? grn.document
    : [];

  return {
    id: grn.id,
    grnNumber,
    grn: grnNumber,
    type: formatInwardType(inwardType),
    party,
    companyName: grn.companyName || grn.company_name || grn.warehouse?.company?.name || "-",
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
    refDocType: grn.refDocType || grn.ref_doc_type || "",
    refDocNumber: grn.refDocNumber || grn.ref_doc_number || "",
    refDocDate: grn.refDocDate || grn.ref_doc_date || "",
    remarks: grn.remarks || "",
    documents,
    otherDocumentNumbers: grn.otherDocumentNumbers || grn.other_document_numbers || [],
    inwardDateTime: grn.inwardDateTime || grn.inward_date_time || grn.refDocDate || grn.ref_doc_date || createdAt,
    createdAt,
  };
}
