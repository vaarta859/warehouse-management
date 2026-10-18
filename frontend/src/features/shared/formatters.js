// -------------------------------------------------
// Generic, domain-agnostic formatting helpers.
// No Redux, no React - shared by inwardHelpers.js
// and outwardHelpers.js so the logic lives in one
// place instead of being copy-pasted per feature.
// -------------------------------------------------

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
      total + Number(item.quantity || item.qty || item.receivedQuantity || item.dispatchedQuantity || 0),
    0
  );
}

export function getSerialCount(items) {
  if (!Array.isArray(items)) return 0;

  return items.reduce((total, item) => {
    let serials = item.serialNumbers || item.serials || item.serial_numbers || [];
    if (!Array.isArray(serials)) serials = [];
    return total + serials.length;
  }, 0);
}

// Works for any "record" that carries required-document
// tracking - a GRN (inward) or a dispatch entry (outward) -
// as long as it exposes `documents`/`document` and,
// optionally, backend-calculated status/counts.
export function getDocumentStatus(record, requiredDocuments) {
  if (record.status === "Complete" || record.status === "Pending") {
    const backendPending = Number(record.pendingDocuments);
    const backendUploaded = Number(record.uploadedDocuments);
    const backendRequired = Number(record.requiredDocuments);

    return {
      status: record.status,
      statusType: record.status === "Complete" ? "complete" : "pending",
      pendingDocuments: Number.isFinite(backendPending)
        ? backendPending
        : record.status === "Complete"
        ? 0
        : requiredDocuments.length,
      uploadedDocuments: Number.isFinite(backendUploaded) ? backendUploaded : 0,
      requiredDocuments: Number.isFinite(backendRequired)
        ? backendRequired
        : requiredDocuments.length,
    };
  }

  const documents = Array.isArray(record.documents)
    ? record.documents
    : Array.isArray(record.document)
    ? record.document
    : [];

  const uploadedCategories = new Set(
    documents.map((doc) => String(doc.docCategory || doc.doc_category || "").trim().toLowerCase())
  );

  const pendingDocuments = requiredDocuments.filter(
    (requiredDocument) => !uploadedCategories.has(requiredDocument.toLowerCase())
  ).length;

  const uploadedDocuments = requiredDocuments.length - pendingDocuments;
  const complete = pendingDocuments === 0;

  return {
    status: complete ? "Complete" : "Pending",
    statusType: complete ? "complete" : "pending",
    pendingDocuments,
    uploadedDocuments,
    requiredDocuments: requiredDocuments.length,
  };
}
