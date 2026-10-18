import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Download, Eye, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast, promptName } from "../components/CenterMessage";
import {
  fetchOutwardById,
  dispatchOutward,
  uploadOutwardDocument,
  downloadOutwardDocument,
  deleteOutwardDocument,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardUploadingDocs,
  selectOutwardDocActionStatus,
} from "../features/outward/outwardSlice";

/**
 * Outward entry - WAREHOUSE side.
 *
 * The warehouse manager sees only the customer and the item details
 * (category, model, quantity, UOM) - never cost, approval or UTR - and fills
 * the dispatch details: reference documents, dispatch mode, vehicle, documents
 * and remarks. Super admin can use it too.
 */

const makeId = () => crypto.randomUUID();
const newReference = () => ({ id: makeId(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });
const DEFAULT_DOCS = ["Delivery challan", "E-way bill", "Dispatch photo"];
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const getDateTimeLocal = (value) => {
  const d = value ? new Date(value) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function OutwardDispatchForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const uploadingDocs = useSelector(selectOutwardUploadingDocs);
  const docActionStatus = useSelector(selectOutwardDocActionStatus);

  const [dispatchDateTime, setDispatchDateTime] = useState(getDateTimeLocal());
  const [references, setReferences] = useState([newReference()]);
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [extraDocNames, setExtraDocNames] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  useEffect(() => {
    dispatch(fetchOutwardById(id)).then((result) => {
      if (!fetchOutwardById.fulfilled.match(result)) {
        toast.error(result.payload || "Unable to load outward entry.");
        navigate("/outward", { replace: true });
      }
    });
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id, navigate]);

  // Prefill once the entry arrives (dispatch details already saved are editable).
  useEffect(() => {
    if (!outward || outward.id !== id || loaded) return;
    const realRefs = (outward.referenceDocuments || []).filter((r) => r.refDocNumber && r.refDocNumber !== "Pending");
    if (realRefs.length) {
      setReferences(realRefs.map((r) => ({ ...newReference(), refDocType: r.refDocType || "Invoice", refDocNumber: r.refDocNumber || "", ewayBillNumber: r.ewayBillNumber || "" })));
    }
    if (outward.dispatchMode) setDispatchMode(outward.dispatchMode);
    setVehicleNumber(outward.vehicleNumber || "");
    setRemarks(outward.remarks || "");
    if (outward.dispatchState === "Dispatched" && outward.refDocDate) setDispatchDateTime(getDateTimeLocal(outward.refDocDate));
    setExtraDocNames(
      (outward.documents || [])
        .map((d) => d.docCategory)
        .filter((name) => name && !DEFAULT_DOCS.some((def) => def.toLowerCase() === String(name).trim().toLowerCase()))
    );
    setLoaded(true);
  }, [outward, id, loaded]);

  const documentRows = useMemo(() => {
    const docs = outward?.documents || [];
    const find = (label) => docs.find((d) => String(d.docCategory || "").trim().toLowerCase() === label.toLowerCase());
    return [...DEFAULT_DOCS, ...extraDocNames].map((label) => ({ label, document: find(label), required: DEFAULT_DOCS.includes(label) }));
  }, [outward, extraDocNames]);

  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? p : p.filter((r) => r.id !== rid)));

  const handleUpload = (label, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File size must be less than 10 MB.");
    if (!ALLOWED_TYPES.includes(file.type)) return toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");
    dispatch(uploadOutwardDocument({ outwardId: id, file, docCategory: label })).then((result) => {
      if (uploadOutwardDocument.fulfilled.match(result)) toast.success(`${label} uploaded.`);
      else toast.error(result.payload?.message || `${label} could not be uploaded.`);
    });
  };

  const handleDownload = (documentId, mode = "download") =>
    dispatch(downloadOutwardDocument({ documentId, mode })).then((r) => {
      if (downloadOutwardDocument.rejected.match(r)) toast.error(r.payload?.message || "Unable to download file.");
    });

  const handleDelete = (documentId) => {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    dispatch(deleteOutwardDocument({ documentId })).then((r) => {
      if (deleteOutwardDocument.fulfilled.match(r)) {
        toast.success("Document deleted.");
      } else toast.error(r.payload?.message || "Delete failed.");
    });
  };

  const addExtraDocument = async () => {
    setShowDocumentMenu(false);
    const name = (await promptName("Name this document", { label: "Document name", placeholder: "e.g. GST certificate" }))?.trim();
    if (!name) return;
    if (documentRows.some((row) => row.label.toLowerCase() === name.toLowerCase())) return toast.info("That document is already in the list.");
    setExtraDocNames((p) => [...p, name]);
  };

  const refsPayload = references
    .filter((r) => r.refDocNumber.trim() || r.ewayBillNumber.trim())
    .map((r) => ({ refDocType: r.refDocType, refDocNumber: r.refDocNumber.trim(), ewayBillNumber: r.ewayBillNumber.trim() || undefined }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!refsPayload.length) return toast.error("Please enter at least one reference document number or E-way bill number.");
    if (!dispatchMode) return toast.error("Please select the dispatch mode.");

    setSaving(true);
    const result = await dispatch(
      dispatchOutward({
        id,
        payload: {
          outwardDateTime: dispatchDateTime,
          referenceDocuments: refsPayload,
          dispatchMode,
          vehicleNumber: vehicleNumber.trim() || undefined,
          remarks: remarks.trim() || undefined,
        },
      })
    );
    setSaving(false);
    if (dispatchOutward.rejected.match(result)) return toast.error(result.payload?.message || "Failed to save dispatch details.");
    toast.success("Dispatch details saved.");
    navigate("/outward", { replace: true });
  };

  if (detailStatus === "loading" || !outward || outward.id !== id) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  const items = outward.items || [];
  const alreadyDispatched = outward.dispatchState === "Dispatched" || ["DISPATCHED", "DELIVERED"].includes(outward.workflowStatus);

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{alreadyDispatched ? "Update dispatch details" : "Dispatch details"}</h1>
            <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Read-only: what is being sent, and to whom. No cost / approval / UTR here. */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Order</h2>
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-gray-500">Customer</p><p className="font-medium text-gray-900">{outward.customerName || "-"}</p></div>
              <div><p className="text-xs text-gray-500">Outward type</p><p className="font-medium text-gray-900">{outward.outwardType || "-"}</p></div>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Quantity</th><th className="px-3 py-2">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id || index} className="border-b last:border-0">
                      <td className="px-3 py-2">{index + 1}</td>
                      <td className="px-3 py-2">{item.category || "-"}</td>
                      <td className="px-3 py-2 font-medium">{item.sku || "-"}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">{item.uom || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelCls}>Dispatch date and time</label>
                <input type="datetime-local" value={dispatchDateTime} onChange={(e) => setDispatchDateTime(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Dispatch mode</label>
                <div className="relative">
                  <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option>By Road</option><option>Courier</option><option>Customer Pickup</option>
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Vehicle / AWB number</label>
                <input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="If applicable" className={inputCls} />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Reference documents</span>
              <button type="button" onClick={addReference} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={13} />Add document</button>
            </div>
            <div className="mt-2 space-y-4">
              {references.map((r, index) => (
                <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                  {references.length > 1 && (
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-black">Reference document {index + 1}</span>
                      <button type="button" onClick={() => removeReference(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelCls}>Reference doc type</label>
                      <div className="relative">
                        <select value={r.refDocType} onChange={(e) => updateReference(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                          <option>Invoice</option><option>E-way Bill</option><option>Delivery Challan</option><option>Return Note</option><option>Other</option>
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      </div>
                    </div>
                    <div><label className={labelCls}>Reference doc no.</label><input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} /></div>
                    <div><label className={labelCls}>E-way bill number</label><input value={r.ewayBillNumber} onChange={(e) => updateReference(r.id, "ewayBillNumber", e.target.value)} placeholder="If above threshold" className={inputCls} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Documents</h2>
                <p className="mt-1 text-xs text-gray-400">Files upload as soon as you pick them. Documents are optional.</p>
              </div>
              <div className="relative shrink-0">
                <button type="button" onClick={() => setShowDocumentMenu((v) => !v)} className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={14} />Add document</button>
                {showDocumentMenu && (
                  <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    <button type="button" onClick={addExtraDocument} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"><FileText size={16} className="text-gray-400" />Other</button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {documentRows.map(({ label, document }) => {
                const uploading = uploadingDocs?.[label] === true;
                const downloading = document && docActionStatus[document.id] === "downloading";
                const deleting = document && docActionStatus[document.id] === "deleting";
                return (
                  <div key={label} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${document ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}><FileText size={20} /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{label}</p>
                        <p className={`truncate text-xs ${document ? "text-gray-500" : "text-red-500"}`}>{document ? document.fileName || String(document.fileKey || "").split("/").pop() : "Not uploaded"}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <label className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                        <Upload size={16} />{uploading ? "Uploading..." : document ? "Replace" : "Upload"}
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => { handleUpload(label, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {document && (
                        <>
                          <button type="button" title="View" disabled={downloading} onClick={() => handleDownload(document.id, "view")} className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-gray-500 hover:bg-gray-50 disabled:opacity-50"><Eye size={16} /></button>
                          <button type="button" title="Download" disabled={downloading} onClick={() => handleDownload(document.id, "download")} className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-gray-500 hover:bg-gray-50 disabled:opacity-50"><Download size={16} /></button>
                          <button type="button" title="Delete" disabled={deleting} onClick={() => handleDelete(document.id)} className="flex h-10 items-center rounded-lg border border-red-200 px-3 text-red-500 hover:bg-red-50 disabled:opacity-50"><Trash2 size={16} /></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <label className={labelCls}>Dispatch remarks</label>
            <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} />
          </section>

          <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : alreadyDispatched ? "Update dispatch details" : "Save and mark as dispatched"}
          </button>
        </form>
      </div>
    </div>
  );
}
