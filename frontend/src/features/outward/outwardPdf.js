import { createPdfDocument } from "../shared/pdfExport";
import { refTypeLabel, isReceivingDocCategory, docLabel } from "./outwardHelpers";

// Builds and downloads a table-formatted PDF for a single outward
// (dispatch) record: outward info, every reference document (invoice /
// e-way bill / etc, one row each), items, and the full document
// checklist (required + any extra uploads) with upload status.
export function downloadOutwardPdf(outward, items, documentRows, currentStatus, { includeDispatch = true, includeCost = false } = {}) {
  const doc = createPdfDocument();

  doc.heading("OUTWARD DETAILS");
  doc.paragraph(`Dispatch Number: ${outward.outwardNumber || outward.id || "-"}   |   Status: ${currentStatus}`, {
    size: 10,
    gap: 20,
  });

  doc.subheading("Outward Information");
  doc.keyValueGrid([
    ["Dispatch Number", outward.outwardNumber || "-"],
    ["Customer", outward.customerName || "-"],
    ["Company", outward.companyName || outward.warehouse?.company?.name || "-"],
    ["Outward Type", outward.outwardType || "-"],
    ...(true
      ? [
          ["PI No.", outward.piNumber || "-"],
          ["PI Date", outward.piDate ? new Date(outward.piDate).toLocaleDateString("en-IN") : "-"],
          ["PI Amount", outward.piAmount === null || outward.piAmount === undefined ? "-" : Number(outward.piAmount).toLocaleString("en-IN")],
          ["Ship to - Contact Person", outward.shipToContactPerson || "-"],
          ["Ship to - Contact No.", outward.shipToContactNo || "-"],
          ["Ship to - Location", outward.shipToLocation || "-"],
          ["Bill to - Contact Person", outward.billToContactPerson || "-"],
          ["Bill to - Contact No.", outward.billToContactNo || "-"],
          ["Bill to - Email", outward.billToEmail || "-"],
          ["Dispatch Remarks (Sales)", outward.dispatchRemarks || "-"],
        ]
      : []),
    ...(includeDispatch
      ? [
          ["Dispatch Mode", outward.dispatchMode || "-"],
          ["Vehicle / AWB Number", outward.vehicleNumber || "-"],
          ["Driver Name", outward.driverName || "-"],
          ["Driver Contact", outward.driverContact || "-"],
          ...(outward.receivedDate
            ? [
                ["Receiving Date", new Date(outward.receivedDate).toLocaleDateString("en-IN")],
                ["Receiver Name", outward.receiverName || "-"],
                ["Receiver Contact", outward.receiverContact || "-"],
                ["Receiving Remarks", outward.receivingRemarks || "-"],
              ]
            : []),
        ]
      : []),
    [
      includeDispatch ? "Reference Date" : "Outward Date",
      outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-",
    ],
    ["Created By", outward.createdBy?.name || outward.createdBy?.email || "-"],
  ]);
  doc.spacer(4);

  if (includeDispatch) {
    doc.subheading("Reference Documents");
    const baseRows =
      Array.isArray(outward.referenceDocuments) && outward.referenceDocuments.length
        ? outward.referenceDocuments.map((d) => [refTypeLabel(d.refDocType) || "-", d.refDocNumber || "-"])
        : outward.refDocNumber
        ? [[refTypeLabel(outward.refDocType) || "-", outward.refDocNumber || "-"]]
        : [];
    // An uploaded receiving copy / photo is listed here too.
    const receivingRows = documentRows
      .filter((row) => row.document && isReceivingDocCategory(row.label))
      .map((row) => [docLabel(row.label), "-"]);
    doc.table({
      columns: [
        { header: "Document Type", width: 250 },
        { header: "Reference No.", width: 265 },
      ],
      rows: [...baseRows, ...receivingRows],
    });
  }

  doc.subheading("Items");
  const costLabel = { COMPLETED: "Completed", PARTIALLY_COMPLETED: "Partially completed", PENDING: "Pending", ZERO_COST: "₹ 0" };
  doc.table({
    columns: includeCost
      ? [
          { header: "#", width: 30 },
          { header: "Category", width: 105 },
          { header: "SKU / Model", width: 120 },
          { header: "Qty", width: 40 },
          { header: "UOM", width: 50 },
          { header: "Payment status", width: 85 },
          { header: "Approve By", width: 85 },
        ]
      : [
          { header: "#", width: 30 },
          { header: "Category", width: 150 },
          { header: "SKU / Model", width: 190 },
          { header: "Qty", width: 65 },
          { header: "UOM", width: 80 },
        ],
    rows: items.map((item, index) => [
      String(index + 1),
      item.category || "-",
      item.sku || "-",
      String(item.quantity || 0),
      item.uom || "-",
      ...(includeCost ? [costLabel[item.paymentStatus] || "-", item.approvedBy || "-"] : []),
    ]),
  });

  const serials = Array.isArray(outward.serials) ? outward.serials : [];
  if (serials.length) {
    doc.spacer(4);
    const groups = [...new Set(serials.map((s) => `${s.category}||${s.sku}`))];
    for (const g of groups) {
      const rows = serials.filter((s) => `${s.category}||${s.sku}` === g);
      doc.paragraph(`Serial numbers - ${rows[0].sku} (${rows.length}): ${rows.map((s) => s.serialNo).join(", ")}`, { size: 9 });
    }
  }

  if (includeDispatch) {
    doc.spacer(4);
    doc.paragraph(`Remarks: ${outward.remarks || "-"}`, { size: 9.5 });
  }

  doc.save(outward.outwardNumber || "outward-details");
}
