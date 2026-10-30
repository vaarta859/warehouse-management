import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "../components/CenterMessage";
import {
  fetchOutwardById,
  dispatchOutward,
  rejectOutward,
  downloadItemProof,
  downloadPiFile,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import { STAGE, DISPATCH_MODES, transportModeLabel, isTransportSubmitted, isReceivingDocCategory, isPlaceholder, paymentStatusLabel, refTypeLabel, refTypeDocument, REQUIRED_DOCUMENTS, MANAGER_REF_TYPES, isAccountRef, isManagerRef, isAccountDocCategory } from "../features/outward/outwardHelpers";
import OutwardDocuments from "../components/OutwardDocuments";

import LocationLink from "../components/LocationLink";
/**
 * =========================================================
 * DISPATCH DETAILS  (Warehouse manager, Super admin)
 * =========================================================
 * Opens only after the transportation form is submitted AND the account team has shared a DC Challan / Without
 * Invoice document (stage READY_FOR_DISPATCH). Vehicle / driver / transporter details come from the transportation
 * form and are shown read-only here. Filled once; after dispatch the Super admin
 * changes everything (dispatch details included) with Update. The manager only
 * sees the item details (category, model, quantity, UOM) and fills the
 * dispatch side: reference documents, dispatch mode, vehicle / AWB number
 * and remarks. Cost, UTR and approval details are never sent to them.
 *
 * Driver name / contact are part of the dispatch details. Every reference document type chosen
 * (Delivery Challan, Return Note, Bilty, Other) opens its own row in the Documents section to upload.
 * After dispatch the manager is taken to the outward details page.
 * =========================================================
 */

const isSuperAdminUser = () => {
  try { return JSON.parse(localStorage.getItem("user"))?.role === "SUPER_ADMIN"; } catch { return false; }
};

const makeId = () => crypto.randomUUID();
const newReference = () => ({ id: makeId(), refDocType: "Bilty", refDocNumber: "" });
const PHONE_RE = /^\d{10}$/;
const toLocalInput = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return toLocalInput();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function OutwardDispatch() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const detailError = useSelector(selectOutwardDetailError);

  const [dispatchDateTime, setDispatchDateTime] = useState(() => toLocalInput());
  const [references, setReferences] = useState([newReference()]);
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  // Documents picked here are sent together with the dispatch details when the form is saved.
  const [stagedDocs, setStagedDocs] = useState([]);
  const submittingRef = useRef(false); // stops the "already dispatched" redirect firing during our own save
  const [filled, setFilled] = useState(false);
  // Super admin can reject from here (reason required); it then shows Approve again on the details page.
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Prefill once the entry is loaded (editing details that were already saved).
  useEffect(() => {
    if (!outward || filled) return;
    setFilled(true);

    // Only the dispatch side's own references (delivery challan / return note / other).
    // Invoice and e-way bill are added by the account team and shown read-only below.
    const saved = (Array.isArray(outward.referenceDocuments) ? outward.referenceDocuments : []).filter(isManagerRef);
    if (saved.length) {
      setReferences(
        saved.map((r) => ({
          ...newReference(),
          refDocType: r.refDocType || "Bilty",
          refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
        }))
      );
    }
    if (outward.dispatchMode && !isPlaceholder(outward.dispatchMode)) setDispatchMode(outward.dispatchMode);
    setVehicleNumber(outward.vehicleNumber || "");
    setDriverName(outward.driverName || "");
    setDriverContact(outward.driverContact || "");
    setRemarks(outward.remarks || "");
    if (outward.dispatchState === "Dispatched" || ["DISPATCHED", "DELIVERED"].includes(outward.workflowStatus)) {
      setDispatchDateTime(toLocalInput(outward.refDocDate));
    }
  }, [outward, filled]);

  const updateReference = (rid, field, value) => setReferences((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addReference = () => setReferences((p) => [...p, newReference()]);
  const removeReference = (rid) => setReferences((p) => (p.length === 1 ? p : p.filter((r) => r.id !== rid)));

  // One (optional) upload row for each reference document type that is chosen: Bilty -> Bilty, Return Note -> Return note ...
  const documentSlots = useMemo(() => {
    const slots = [];
    for (const r of references) {
      const slot = refTypeDocument(r.refDocType);
      if (slot && !slots.includes(slot)) slots.push(slot);
    }
    return slots;
  }, [references]);

  const alreadyDispatched = outward?.dispatchState === "Dispatched" || ["DISPATCHED", "DELIVERED"].includes(outward?.workflowStatus);
  const superAdmin = isSuperAdminUser();


  // After dispatch the Super admin uses Update (the full edit form, dispatch details included).
  // The warehouse manager stays here and can keep updating the dispatch details.
  useEffect(() => {
    if (!submittingRef.current && detailStatus === "succeeded" && outward && outward.id === id && alreadyDispatched && superAdmin) {
      navigate(`/outward/${id}/edit`, { replace: true });
    }
  }, [outward, id, detailStatus, alreadyDispatched, superAdmin, navigate]);

  // Dispatch details only exist once the entry is approved.
  useEffect(() => {
    // Only trust a freshly loaded entry (detailStatus "succeeded"), never a leftover copy from the
    // page the admin just came from - right after approving, the old copy still says "pending approval".
    if (detailStatus === "succeeded" && outward && outward.id === id && superAdmin && ["PENDING_APPROVAL", "REJECTED", "ON_HOLD"].includes(outward.workflowStatus)) {
      toast.info("Approve this entry first, then fill the dispatch details.");
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [outward, id, superAdmin, navigate, detailStatus]);

  // The dispatch form is locked until the transportation form is in and Account has shared the documents.
  useEffect(() => {
    if (
      detailStatus === "succeeded" && outward && outward.id === id &&
      outward.stage && ![STAGE.READY_FOR_DISPATCH, STAGE.DISPATCHED].includes(outward.stage)
    ) {
      toast.info(
        outward.stage === STAGE.TRANSPORT_PENDING
          ? "Fill the transportation form first."
          : "Dispatch opens once the account team has submitted its section."
      );
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [outward, id, detailStatus, navigate]);

  const submitReject = async () => {
    if (!rejectReason.trim()) return toast.error("Please give a reason for rejecting.");
    setRejecting(true);
    const result = await dispatch(rejectOutward({ id, remarks: rejectReason.trim() }));
    setRejecting(false);
    if (rejectOutward.rejected.match(result)) return toast.error(result.payload || "Failed to reject.");
    toast.success(result.payload?.message || "Rejected.");
    setRejectOpen(false);
    navigate(`/outward/${id}`, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const refs = references
      .filter((r) => r.refDocNumber.trim())
      .map((r) => ({
        refDocType: r.refDocType,
        refDocNumber: r.refDocNumber.trim(),
      }));
    // Reference documents and uploaded documents (Bilty included) are optional.
    const fromTransport = isTransportSubmitted(outward);
    if (!fromTransport) {
      if (!dispatchMode) return toast.error("Please select the dispatch mode.");
      if (driverContact.trim() && !PHONE_RE.test(driverContact.trim())) return toast.error("Please enter a driver contact number (10 digits).");
    }

    setSaving(true);
    submittingRef.current = true;

    const result = await dispatch(
      dispatchOutward({
        id,
        files: stagedDocs.map((d) => ({ file: d.file, docCategory: d.docCategory })),
        payload: {
          outwardDateTime: dispatchDateTime,
          // With a transportation form the server uses the saved vehicle / driver / transporter details.
          ...(fromTransport ? {} : {
            dispatchMode,
            vehicleNumber: vehicleNumber.trim() || undefined,
            driverName: driverName.trim() || undefined,
            driverContact: driverContact.trim() || undefined,
          }),
          remarks: remarks.trim() || undefined,
          referenceDocuments: refs,
        },
      })
    );
    setSaving(false);

    if (dispatchOutward.rejected.match(result)) {
      submittingRef.current = false;
      return toast.error(result.payload || "Failed to save dispatch details.");
    }
    if (alreadyDispatched) {
      toast.success("Dispatch details updated.");
      navigate(`/outward/${id}`, { replace: true });
      return;
    }
    // Dispatched: open the outward details page (the Delivered / receiving form stays available from there).
    toast.success("Dispatched successfully.");
    navigate(`/outward/${id}`, { replace: true });
  };

  if (detailStatus === "loading" || (detailStatus === "idle" && !outward) || (outward && outward.id !== id)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  // Approval stage (waiting for approval / rejected): no dispatch fields or documents yet.
  if (detailStatus === "succeeded" && superAdmin && ["PENDING_APPROVAL", "REJECTED", "ON_HOLD"].includes(outward?.workflowStatus)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening approval...
      </div>
    );
  }

  if (detailError || !outward) {
    return (
      <div className="min-h-dvh bg-gray-50 p-4 sm:p-6">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-gray-600"><ArrowLeft size={20} />Back</button>
        <div className="rounded-xl border border-red-200 bg-white p-6 text-red-600">{detailError || "Outward entry not found."}</div>
      </div>
    );
  }

  const fromTransportForm = isTransportSubmitted(outward);
  const items = outward.items || [];
  const accountRefs = (Array.isArray(outward.referenceDocuments) ? outward.referenceDocuments : []).filter(isAccountRef);
  // Super admin also sees the sales side (PI details, payment status, UTR, proof, approval) and can update it.
  const showCost = superAdmin;

  const handleViewPi = (mode = "view") => {
    dispatch(downloadPiFile({ outwardId: id, mode })).then((result) => {
      if (downloadPiFile.rejected.match(result)) toast.error(result.payload || "Unable to open the PI file.");
    });
  };

  const handleViewProof = (itemId) => {
    dispatch(downloadItemProof({ outwardId: id, itemId })).then((result) => {
      if (downloadItemProof.rejected.match(result)) toast.error(result.payload || "Unable to open the proof file.");
    });
  };

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
            <div>
              <h1 className="text-base font-semibold text-gray-900 md:text-lg">{superAdmin ? "Outward details" : alreadyDispatched ? "Update dispatch details" : "Dispatch details"}</h1>
              <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
            </div>
          </div>
          {superAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {!alreadyDispatched && (
                <button type="button" onClick={() => { setRejectReason(""); setRejectOpen(true); }} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 sm:text-sm">Reject</button>
              )}
              <button type="button" onClick={() => navigate(`/outward/${id}/edit`)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black sm:text-sm">Update</button>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Outward information</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <InfoField label="Outward number" value={outward.outwardNumber} />
              <InfoField label="Customer / Recipient" value={outward.customerName} />
              <InfoField label="Company" value={outward.companyName || outward.warehouse?.company?.name} />
              <InfoField label="Outward type" value={outward.outwardType} />
              <InfoField label="PI No." value={outward.piNumber} />
              <InfoField label="PI date" value={outward.piDate ? new Date(outward.piDate).toLocaleDateString("en-IN") : "-"} />
              <InfoField label="PI amount (inclusive GST)" value={outward.piAmount === null || outward.piAmount === undefined ? "-" : Number(outward.piAmount).toLocaleString("en-IN")} />
              <InfoField label="PI file" value={outward.hasPiFile ? <span className="flex items-center gap-3"><button type="button" onClick={() => handleViewPi("view")} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Paperclip size={14} /> View</button><button type="button" onClick={() => handleViewPi("download")} className="text-blue-700 hover:underline">Download</button></span> : null} />
              <InfoField label="Ship to - Contact person" value={outward.shipToContactPerson} />
              <InfoField label="Ship to - Contact no." value={outward.shipToContactNo} />
              <InfoField label="Ship to - Location" value={<LocationLink value={outward.shipToLocation} fallback={null} />} />
              <InfoField label="Bill to - Contact person" value={outward.billToContactPerson} />
              <InfoField label="Bill to - Contact no." value={outward.billToContactNo} />
              <InfoField label="Bill to - Email" value={outward.billToEmail} />
              <InfoField label="Warehouse" value={outward.warehouse?.name} />
              <InfoField label="Created by" value={outward.createdBy?.name || outward.createdBy?.email} />
              {showCost && <InfoField label="Approved by" value={outward.approvedByName} />}
              {showCost && <InfoField label="Approved on" value={outward.approvedAt ? new Date(outward.approvedAt).toLocaleString("en-IN") : "-"} />}
              {showCost && outward.approvalRemarks && <InfoField label="Approval remarks" value={outward.approvalRemarks} />}
            </div>

            {outward.dispatchRemarks && (
            <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700 sm:text-sm">Dispatch Remarks (by Sales)</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-red-700 sm:text-base">{outward.dispatchRemarks}</p>
            </div>
          )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div><label className={labelCls}>Dispatch date and time</label><input type="datetime-local" value={dispatchDateTime} onChange={(e) => setDispatchDateTime(e.target.value)} className={inputCls} /></div>
              {fromTransportForm ? (
                <>
                  <InfoField label="Dispatch mode" value={DISPATCH_MODES.includes(outward.dispatchMode) ? outward.dispatchMode : ""} />
                  <InfoField label="Vehicle type" value={transportModeLabel(outward.transportMode)} />
                  {outward.transportMode === "TRANSPORTATION" ? (
                    <>
                      <InfoField label="Transporter ID" value={outward.transporterId} />
                      <InfoField label="Transporter name" value={outward.transporterName} />
                      <InfoField label="Transporter contact" value={outward.transporterContact} />
                      <InfoField label="Vehicle no." value={outward.vehicleNumber} />
                      <InfoField label="Driver contact" value={outward.driverContact} />
                    </>
                  ) : (
                    <>
                      <InfoField label="Vehicle no." value={outward.vehicleNumber} />
                      <InfoField label="Driver name" value={outward.driverName} />
                      <InfoField label="Driver contact" value={outward.driverContact} />
                    </>
                  )}
                  {/* Locked once Account has uploaded its documents (always the case when this form is open). */}
                  {!outward.transportLocked && (
                    <div className="flex items-end">
                      <button type="button" onClick={() => navigate(`/outward/${id}/transportation`)} className="text-xs font-semibold text-blue-700 hover:underline">Edit transportation details</button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className={labelCls}>Dispatch mode</label>
                    <div className="relative">
                      <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                        <option>By Road</option><option>Courier</option><option>Customer Pickup</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    </div>
                  </div>
                  <div><label className={labelCls}>Vehicle / AWB number</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="If applicable" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Enter driver name" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver contact</label><input type="tel" inputMode="numeric" maxLength={10} value={driverContact} onChange={(e) => setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter driver contact no." className={inputCls} /></div>
                </>
              )}
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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>Reference doc type</label>
                      <div className="relative">
                        <select value={r.refDocType} onChange={(e) => updateReference(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                          {MANAGER_REF_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      </div>
                    </div>
                    <div><label className={labelCls}>{r.refDocType === "Bilty" ? "Bilty no." : "Reference doc no."}</label><input value={r.refDocNumber} onChange={(e) => updateReference(r.id, "refDocNumber", e.target.value)} placeholder={r.refDocType === "Bilty" ? "Enter bilty number" : "Enter document number"} className={inputCls} /></div>
                  </div>
                </div>
              ))}
            </div>

            {accountRefs.length > 0 && (
              <div className="mt-5 border-t pt-4">
                <span className="text-xs font-semibold text-gray-700">Shared by the account team</span>
                <div className="mt-2 overflow-x-auto rounded-lg border">
                  <table className="w-full text-[11px] sm:text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-gray-500">
                        <th className="px-3 py-2">Document type</th>
                        <th className="px-3 py-2">Reference no.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountRefs.map((r, i) => (
                        <tr key={r.id || i} className="border-b last:border-0">
                          <td className="px-3 py-2">{refTypeLabel(r.refDocType)}</td>
                          <td className="px-3 py-2">{r.refDocNumber || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {showCost && items.length > 0 && (() => {
            // Payment is done once for the whole outward and saved on every item, so it is shown once.
            const pay = items.find((i) => i.paymentStatus && (i.utrNumber || i.hasProof || i.approvedBy)) || items[0];
            const proofItem = items.find((i) => i.hasProof);
            return (
              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Payment details</h2>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
                  <div><p className="text-sm font-bold text-gray-900 sm:text-base">Payment status</p><p className="mt-1 text-sm font-normal text-gray-700 text-gray-900">{paymentStatusLabel(pay.paymentStatus)}</p></div>
                  <div><p className="text-sm font-bold text-gray-900 sm:text-base">Approve by</p><p className="mt-1 break-words text-sm font-normal text-gray-700 text-gray-900">{pay.approvedBy || "-"}</p></div>
                  <div><p className="text-sm font-bold text-gray-900 sm:text-base">UTR</p><p className="mt-1 break-all text-sm font-normal text-gray-700 text-gray-900">{pay.utrNumber || "-"}</p></div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 sm:text-base">Proof</p>
                    {proofItem ? <button type="button" onClick={() => handleViewProof(proofItem.id)} className="mt-1 inline-flex items-center gap-1 text-sm font-normal text-gray-700 text-blue-700 hover:underline"><Paperclip size={14} /> View</button> : <p className="mt-1 text-sm font-normal text-gray-700 text-gray-900">-</p>}
                  </div>
                </div>
              </section>
            );
          })()}

          <OutwardDocuments
            outwardId={id}
            documents={(outward.documents || []).filter((d) => !isReceivingDocCategory(d.docCategory))}
            canManage
            requiredDocuments={[]}
            showSummary={false}
            optionalDocuments={documentSlots}
            addMenuTypes={[...REQUIRED_DOCUMENTS, "Bilty", "Return note", "Other"]}
            subtitle="One row for each reference document above. Upload, download, replace or delete documents."
            deferred={!alreadyDispatched}
            stagedFiles={stagedDocs}
            onStagedChange={setStagedDocs}
            // Invoice / e-way bill documents come from the account team: the manager can download them, not change them.
            isLocked={(category) => !superAdmin && isAccountDocCategory(category)}
          />

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <label className={labelCls}>Dispatch remarks</label>
            <textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} />
          </section>

          <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : alreadyDispatched ? "Update dispatch details" : "Save and mark as dispatched"}
          </button>
        </form>
      </div>

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Reject this outward entry?</h3>
            <p className="mt-1 text-sm text-gray-500">It becomes Rejected. You can approve it again, or Sales can fix the details and send it again.</p>
            <label className="mt-4 mb-1.5 block text-sm font-semibold text-black">Reason for rejecting</label>
            <textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Tell Sales what needs to be corrected" className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={rejecting} onClick={() => setRejectOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={rejecting} onClick={submitReject} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{rejecting ? "Please wait..." : "Reject"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-gray-500">{label}</div>
      <div className="break-words text-sm font-medium text-gray-900">{value || "-"}</div>
    </div>
  );
}
