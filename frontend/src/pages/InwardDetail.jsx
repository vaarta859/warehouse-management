import { Fragment, useEffect, useRef, useState } from "react";
import { needsSerials, serialKey, withSerialMode } from "../features/outward/serialHelpers";
import useProducts from "../features/product/useProducts";
import {
  ArrowLeft,
  Download,
  Eye,
  Trash2,
  Upload,
  FileText,
  Loader2,
  Package,
  Calendar,
  User,
  Hash,
  Plus,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast, promptName } from "../components/CenterMessage";
import {
  fetchInwardById,
  uploadInwardDocument,
  downloadInwardDocument,
  deleteInwardDocument,
  clearCurrentInward,
  selectCurrentInward,
  selectInwardDetailStatus,
  selectInwardDetailError,
  selectDocActionStatus,
  selectUploadingDocs,
} from "../features/inward/inwardSlice";
import { REQUIRED_DOCUMENTS } from "../features/inward/inwardHelpers";
import { createPdfDocument } from "../features/shared/pdfExport";

function downloadInwardPdf(inward, items, documents) {
  const doc = createPdfDocument();
  const status = inward.status || "Pending";
  doc.heading("INWARD DETAILS");
  doc.paragraph(`GRN Number: ${inward.grnNumber || inward.id || "-"}   |   Status: ${status}`, { size: 10, gap: 20 });
  doc.subheading("Inward Information");
  doc.keyValueGrid([
    ["GRN Number", inward.grnNumber || "-"],
    ["Company", inward.companyName || inward.warehouse?.company?.name || "-"],
    ["Supplier / Customer", inward.supplierName || "-"],
    ["Inward Type", inward.inwardType || "-"],
    ["Inward Date & Time", inward.inwardDateTime ? new Date(inward.inwardDateTime).toLocaleString("en-IN") : (inward.refDocDate ? new Date(inward.refDocDate).toLocaleString("en-IN") : "-")],
    ["Created By", inward.createdBy?.name || inward.createdBy?.email || "-"],
  ]);
  const refs = Array.isArray(inward.referenceDocuments) && inward.referenceDocuments.length
    ? inward.referenceDocuments
    : (inward.refDocNumber ? [{ refDocType: inward.refDocType, refDocNumber: inward.refDocNumber }] : []);
  doc.subheading("Reference Documents");
  doc.table({
    columns: [{ header: "Reference Type", width: 220 }, { header: "Reference No.", width: 295 }],
    rows: refs.map((r) => [r.refDocType || "-", r.refDocNumber || "-"]),
  });
  doc.subheading("Items");
  doc.table({
    columns: [{ header: "#", width: 30 }, { header: "Category", width: 150 }, { header: "SKU / Model", width: 190 }, { header: "Qty", width: 65 }, { header: "UOM", width: 80 }],
    rows: items.map((x, i) => [String(i + 1), x.category || "-", x.sku || "-", String(x.quantity || 0), x.uom || "-"]),
  });
  doc.subheading("Documents");
  doc.table({
    columns: [{ header: "Document", width: 170 }, { header: "File Name", width: 260 }, { header: "Status", width: 85 }],
    rows: documents.map((x) => [x.docCategory || "Document", (x.fileName || (x.fileKey ? String(x.fileKey).split("/").pop() : "-")), "Uploaded"]),
  });
  doc.paragraph(`Remarks: ${inward.remarks || "-"}`);
  doc.save(inward.grnNumber || "inward-details");
}

export default function InwardDetail() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();
  const products = useProducts(); // each product's serial rule (decides which items show serial numbers)

  const inward = useSelector(selectCurrentInward);
  // Sales / Account can view inward details and download documents, nothing more.
  const viewOnly = useSelector((state) => ["SALES", "ACCOUNT"].includes(state.auth.user?.role));
  const detailStatus = useSelector(selectInwardDetailStatus);
  const error = useSelector(selectInwardDetailError);
  const docActionStatus = useSelector(selectDocActionStatus);
  const uploadingDocs = useSelector(selectUploadingDocs);

  const loading = detailStatus === "loading";

  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const pendingCategoryRef = useRef(null);
  const addDocInputRef = useRef(null);

  useEffect(() => {
    if (id) dispatch(fetchInwardById(id));
    return () => dispatch(clearCurrentInward());
  }, [dispatch, id]);

  const handleUpload = (event, docCategory) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");
      event.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Maximum file size is 10 MB.");
      event.target.value = "";
      return;
    }

    dispatch(uploadInwardDocument({ grnId: id, file, docCategory })).then((result) => {
      if (uploadInwardDocument.fulfilled.match(result)) {
        toast.success(`${docCategory} uploaded successfully.`);
      } else {
        toast.error(result.payload?.message || "Upload failed.");
      }
    });

    event.target.value = "";
  };

  // Add document menu — lets the user pick one of the three known
  // document types (to attach a 2nd/3rd copy of it) or "Other" for a
  // custom-named document. Picking a type immediately opens the file
  // picker for it; the chosen file uploads as soon as it's selected,
  // landing in the unified document list below as its own row.
  const handleAddDocumentClick = async (type, documents) => {
    setShowDocumentMenu(false);

    let label = type;
    if (type === "Other") {
      const name = await promptName("Name this document", { label: "Document name", placeholder: "e.g. GST certificate" });
      if (!name?.trim()) return;
      label = name.trim();
    }

    const existingCount = documents.filter((doc) =>
      String(doc.docCategory || "").trim().toLowerCase().startsWith(label.toLowerCase())
    ).length;

    pendingCategoryRef.current = existingCount > 0 ? `${label} #${existingCount + 1}` : label;
    addDocInputRef.current?.click();
  };

  const handlePendingUpload = (event) => {
    const category = pendingCategoryRef.current;
    if (!category) return;
    handleUpload(event, category);
  };

  const handleDownload = (documentId, mode = "download") => {
    if (!documentId) {
      toast.error("Document ID is missing.");
      return;
    }
    dispatch(downloadInwardDocument({ documentId, mode })).then((result) => {
      if (downloadInwardDocument.rejected.match(result)) {
        toast.error(result.payload?.message || "Unable to download file.");
      }
    });
  };

  const handleDelete = (documentId) => {
    if (!documentId) {
      toast.error("Document ID is missing.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    dispatch(deleteInwardDocument({ documentId })).then((result) => {
      if (deleteInwardDocument.fulfilled.match(result)) {
        toast.success("Document deleted successfully.");
      } else {
        toast.error(result.payload?.message || "Delete failed.");
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          Loading inward details...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-gray-50 p-4 sm:p-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 mb-6">
          <ArrowLeft size={20} />
          Back
        </button>
        <div className="bg-white border border-red-200 rounded-xl p-6 text-red-600">{error}</div>
      </div>
    );
  }

  if (!inward) return null;

  const documents = inward.documents || [];
  const items = withSerialMode(inward.items || [], products);
  // Serial numbers shown with their item (rows with the same SKU share one list, split by quantity).
  const serialsByRow = (() => {
    const used = {};
    return items.map((item) => {
      if (!needsSerials(item)) return [];
      const key = serialKey(item.category, item.sku);
      const offset = used[key] || 0;
      const quantity = Number(item.quantity) || 0;
      used[key] = offset + quantity;
      return (inward.serials || []).filter((x) => serialKey(x.category, x.sku) === key).slice(offset, offset + quantity);
    });
  })();

  const uploadedCategories = documents.map((doc) => String(doc.docCategory || "").trim().toLowerCase());
  const allDocumentsUploaded = REQUIRED_DOCUMENTS.every((requiredDocument) => {
    const required = requiredDocument.toLowerCase();
    return uploadedCategories.some((value) => value === required || value.startsWith(`${required} #`) || value.startsWith(`${required} `));
  });

  const currentStatus = allDocumentsUploaded ? "Complete" : "Pending";

  // One unified list of document rows: the three required types always
  // appear first (uploaded or not), followed by anything else that's
  // been uploaded (duplicates of a required type, or custom "Other"
  // documents) — all rendered with the exact same row layout, so there's
  // no separate "Additional documents" section.
  const requiredLower = REQUIRED_DOCUMENTS.map((label) => label.toLowerCase());
  const extraDocuments = documents.filter(
    (doc) => !requiredLower.includes(String(doc.docCategory || "").trim().toLowerCase())
  );

  const documentRows = [
    ...REQUIRED_DOCUMENTS.map((label) => ({
      key: label,
      label,
      document: documents.find((doc) => String(doc.docCategory || "").trim().toLowerCase() === label.toLowerCase()),
      required: true,
    })),
    ...extraDocuments.map((doc) => ({
      key: doc.id,
      label: doc.docCategory || "Document",
      document: doc,
      required: false,
    })),
  ];

  return (
    <div className="min-h-dvh bg-gray-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 sm:py-5">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3 sm:gap-2 sm:text-base sm:mb-4">
            <ArrowLeft size={18} />
            Back
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-base font-bold text-gray-900 sm:text-2xl">Inward Details</h1>
              <p className="break-all text-[11px] text-gray-500 mt-0.5 sm:text-base sm:mt-1">{inward.grnNumber || `Inward #${inward.id}`}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!viewOnly && (
              <button type="button" onClick={() => navigate(`/inward/${id}/edit`)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">Update</button>
              )}
              <button type="button" onClick={() => downloadInwardPdf(inward, items, documents)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"><Download size={15} /> Download</button>
            </div>

            <span
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium sm:px-4 sm:py-2 sm:text-sm ${
                currentStatus === "Complete" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {currentStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 py-3 space-y-3 sm:px-6 sm:py-6 sm:space-y-6">
        <div className="bg-white rounded-xl border p-3 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 sm:text-lg sm:mb-5">Inward Information</h2>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 sm:gap-5">
            <Info icon={<Hash size={18} />} label="GRN Number" value={inward.grnNumber || "-"} />
            <Info icon={<User size={18} />} label="Company" value={inward.companyName || inward.warehouse?.company?.name || "-"} />
            <Info icon={<User size={18} />} label="Supplier" value={inward.supplierName || "-"} />
            <Info icon={<Package size={18} />} label="Inward Type" value={inward.inwardType || "-"} />
            <Info icon={<Calendar size={18} />} label="Inward Date & Time" value={inward.inwardDateTime ? new Date(inward.inwardDateTime).toLocaleString("en-IN") : (inward.refDocDate ? new Date(inward.refDocDate).toLocaleString("en-IN") : "-")} />

            <Info label="Created By" value={inward.createdBy?.name || inward.createdBy?.email || "-"} />
            <Info label="Remarks" value={inward.remarks || "-"} />
          </div>
          <div className="mt-5 border-t pt-5">
            <p className="mb-3 text-sm font-semibold text-gray-700">Reference Documents</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs sm:text-sm">
                <thead><tr className="border-b bg-gray-50 text-left text-gray-500"><th className="px-3 py-2">Reference Type</th><th className="px-3 py-2">Reference No.</th></tr></thead>
                <tbody>
                  {(Array.isArray(inward.referenceDocuments) && inward.referenceDocuments.length ? inward.referenceDocuments : (inward.refDocNumber ? [{ refDocType: inward.refDocType, refDocNumber: inward.refDocNumber }] : [])).map((ref, index) => (
                    <tr key={ref.id || index} className="border-b last:border-0"><td className="px-3 py-2">{ref.refDocType || "-"}</td><td className="px-3 py-2">{ref.refDocNumber || "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-3 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 sm:text-lg sm:mb-5">Items</h2>

          <table className="w-full text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 px-1 w-6 sm:py-3 sm:px-3 sm:w-auto">#</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Category</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">SKU</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Qty</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">UOM</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const rowSerials = serialsByRow[index] || [];
                return (
                  <Fragment key={item.id || index}>
                    <tr className={`${rowSerials.length ? "border-b-0" : "border-b"} last:border-0`}>
                      <td className="py-2 px-1 sm:py-4 sm:px-3">{index + 1}</td>
                      <td className="py-2 px-1 break-words sm:py-4 sm:px-3">{item.category || "-"}</td>
                      <td className="py-2 px-1 break-words font-medium sm:py-4 sm:px-3">{item.sku || "-"}</td>
                      <td className="py-2 px-1 sm:py-4 sm:px-3">{item.quantity || 0}</td>
                      <td className="py-2 px-1 break-words sm:py-4 sm:px-3">{item.uom || "-"}</td>
                    </tr>
                    {rowSerials.length > 0 && (
                      <tr className="border-b last:border-0">
                        <td />
                        <td colSpan={4} className="pb-3 px-1 sm:px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-gray-900">SR. No -</span>
                            {rowSerials.map((x) => (
                              <span key={x.id || x.serialNo} className="rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-medium text-blue-700 sm:text-xs">{x.serialNo}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center py-8 text-gray-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border p-3 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-3 sm:mb-5 sm:gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 sm:text-lg">Documents</h2>
              <p className="text-sm text-gray-500 mt-1">{viewOnly ? "Download documents" : "Upload, download or delete required documents"}</p>
            </div>

            {!viewOnly && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowDocumentMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg bg-black px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                <Plus size={14} /> Add document
              </button>

              {showDocumentMenu && (
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {["Vendor invoice", "E-way bill", "Unloading sign-off sheet", "Other"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleAddDocumentClick(type, documents)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileText size={16} className="text-gray-400" />
                      {type}
                    </button>
                  ))}
                </div>
              )}

              {/* Hidden input driven by the menu above — the chosen
                  category is passed via pendingCategoryRef so it's
                  never a stale closure value by the time a file is picked. */}
              <input
                ref={addDocInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handlePendingUpload}
              />
            </div>
            )}
          </div>

          <div className="space-y-3">
            {documentRows.map((row) => {
              const { label, document, required, key } = row;

              const isUploadingThis = uploadingDocs[label] === true;
              const isDownloading = document && docActionStatus[document.id] === "downloading";
              const isDeleting = document && docActionStatus[document.id] === "deleting";

              return (
                <div key={key} className="border rounded-lg p-2.5 sm:rounded-xl sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-2.5 min-w-0 sm:gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 sm:w-10 sm:h-10 ${
                          document ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        <FileText size={18} className="sm:hidden" />
                        <FileText size={20} className="hidden sm:block" />
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 sm:text-base">{label}</p>

                        {document ? (
                          <p className="text-[11px] text-gray-500 truncate mt-1 sm:text-xs">
                            {document.fileName || (document.fileKey ? String(document.fileKey).split("/").pop() : "Document")} {" • "} {document.fileType || "File"} {" • "}
                            {(Number(document.fileSize || 0) / 1024).toFixed(1)} {" KB"}
                          </p>
                        ) : (
                          <p className="text-[11px] text-red-500 mt-1 sm:text-xs">Not uploaded</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {document ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDownload(document.id, "view")}
                            disabled={isDownloading || isDeleting}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="View"
                          >
                            <Eye size={16} />
                            <span className="hidden sm:inline">View</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownload(document.id, "download")}
                            disabled={isDownloading || isDeleting}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border hover:bg-gray-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Download"
                          >
                            {isDownloading ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Download size={16} className="sm:hidden" />}
                            {isDownloading ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Download size={18} className="hidden sm:block" />}
                            <span className="hidden sm:inline">Download</span>
                          </button>

                          {!viewOnly && (
                          <button
                            type="button"
                            onClick={() => handleDelete(document.id)}
                            disabled={isDeleting || isDownloading}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                            title="Delete"
                          >
                            {isDeleting ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Trash2 size={16} className="sm:hidden" />}
                            {isDeleting ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Trash2 size={18} className="hidden sm:block" />}
                            <span className="hidden sm:inline">Delete</span>
                          </button>

                          )}
                        </>
                      ) : required && !viewOnly ? (
                        <label
                          className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-black text-white hover:bg-gray-800 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                            isUploadingThis ? "opacity-50 pointer-events-none" : ""
                          }`}
                        >
                          {isUploadingThis ? <Loader2 size={16} className="animate-spin sm:hidden" /> : <Upload size={16} className="sm:hidden" />}
                          {isUploadingThis ? <Loader2 size={18} className="hidden animate-spin sm:block" /> : <Upload size={18} className="hidden sm:block" />}
                          <span>Upload</span>
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            onChange={(event) => handleUpload(event, label)}
                            disabled={isUploadingThis}
                          />
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t">
            {currentStatus === "Complete" ? (
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                All required documents uploaded
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Some required documents are still pending
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, value }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1 sm:gap-2 sm:text-sm">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-gray-900 break-words sm:text-base">{value}</div>
    </div>
  );
}