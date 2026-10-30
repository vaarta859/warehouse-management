import { Fragment, useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Truck,
  Calendar,
  User,
  Hash,
  Route,
  Check,
  X,
  Pause,
  Paperclip,
  Lock,
  FileText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "../components/CenterMessage";
import {
  fetchOutwardById,
  approveOutward,
  rejectOutward,
  holdOutward,
  downloadItemProof,
  downloadPiFile,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import {
  getStatusStyle,
  STAGE,
  isTransportSubmitted,
  DISPATCH_MODES,
  transportModeLabel,
  paymentStatusLabel,
  formatMoney,
  isPlaceholder,
  isReceived,
  isApprovedStatus,
  isDispatchedStatus,
  SALES_EDITABLE_STATUSES,
  REJECTABLE_STATUSES,
  HOLDABLE_STATUSES,
  isReceivingDocCategory,
  refTypeDocument,
  ACCOUNT_EDIT_STATUSES,
  isAccountDocCategory,
  refTypeLabel,
} from "../features/outward/outwardHelpers";
import { needsSerials, serialKey, withSerialMode } from "../features/outward/serialHelpers";
import useProducts from "../features/product/useProducts";
import { downloadOutwardPdf } from "../features/outward/outwardPdf";
import OutwardDocuments from "../components/OutwardDocuments";
import AccountOutwardPanel from "../components/AccountOutwardPanel";

import LocationLink from "../components/LocationLink";
export default function OutwardDetail() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();
  const products = useProducts(); // each product's serial rule (decides which items show serial numbers)

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const error = useSelector(selectOutwardDetailError);

  const loading = detailStatus === "loading" || detailStatus === "idle";

  const user = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();
  const role = user?.role;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isSales = role === "SALES";
  const isAccount = role === "ACCOUNT";
  const isWarehouse = role === "WAREHOUSE_MANAGER";

  // Account's approve / hold / reject dialog: null | "approve" | "hold" | "reject"
  const [decision, setDecision] = useState(null);
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Super admin never stays on this page for an approved entry that is waiting for dispatch:
  // it goes straight to the dispatch form (sales info, Update, Reject and the dispatch fields).
  useEffect(() => {
    if (
      isSuperAdmin &&
      detailStatus === "succeeded" &&
      outward?.id === id &&
      outward.stage === STAGE.READY_FOR_DISPATCH
    ) {
      navigate(`/outward/${id}/dispatch`, { replace: true });
    }
  }, [isSuperAdmin, detailStatus, outward, id, navigate]);

  const openDecision = (type) => {
    setDecisionRemarks("");
    setDecision(type);
  };

  const submitDecision = async () => {
    if (decision === "reject" && !decisionRemarks.trim()) {
      toast.error("Please give a reason for rejecting.");
      return;
    }
    if (decision === "hold" && !decisionRemarks.trim()) {
      toast.error("Please give a reason for putting this on hold.");
      return;
    }
    setDeciding(true);
    const action = decision === "approve" ? approveOutward : decision === "hold" ? holdOutward : rejectOutward;
    const result = await dispatch(action({ id, remarks: decisionRemarks.trim() || undefined }));
    setDeciding(false);
    if (action.fulfilled.match(result)) {
      toast.success(result.payload?.message || (decision === "approve" ? "Approved." : decision === "hold" ? "Put on hold." : "Rejected."));
      setDecision(null);
      // Super admin: after approving, stay here - the transportation form comes first.
      if (decision === "approve" && isSuperAdmin) {
        dispatch(fetchOutwardById(id));
        return;
      }
      // Account: after approve / hold / reject go back to the outward list.
      if (isAccount) {
        navigate("/outward", { replace: true });
        return;
      }
      dispatch(fetchOutwardById(id));
    } else {
      toast.error(result.payload || "Something went wrong.");
    }
  };

  const handleViewProof = (itemId) => {
    dispatch(downloadItemProof({ outwardId: id, itemId })).then((result) => {
      if (downloadItemProof.rejected.match(result)) toast.error(result.payload || "Unable to open the proof file.");
    });
  };

  const handleViewPi = (mode = "view") => {
    dispatch(downloadPiFile({ outwardId: id, mode })).then((result) => {
      if (downloadPiFile.rejected.match(result)) toast.error(result.payload || "Unable to open the PI file.");
    });
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          Loading outward details...
        </div>
      </div>
    );
  }

  // Super admin + approved entry waiting for dispatch: the redirect to the dispatch form is on its
  // way (see the effect above). Show the same loader instead of flashing this page for a moment.
  if (isSuperAdmin && outward?.stage === STAGE.READY_FOR_DISPATCH) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
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

  if (!outward) return null;

  const documents = outward.documents || [];
  const items = withSerialMode(outward.items || [], products);
  // Serial numbers shown with their item (rows with the same SKU share one list, split by quantity).
  const serialsByRow = (() => {
    const used = {};
    return items.map((item) => {
      if (!needsSerials(item)) return [];
      const key = serialKey(item.category, item.sku);
      const offset = used[key] || 0;
      const quantity = Number(item.quantity) || 0;
      used[key] = offset + quantity;
      return (outward.serials || []).filter((x) => serialKey(x.category, x.sku) === key).slice(offset, offset + quantity);
    });
  })();

  // Warehouse managers only get "Pending" / "Dispatched" (dispatchState);
  // everyone else gets the real workflow status.
  const workflow = outward.workflowStatus;
  // "Dispatch directly": no warehouse, no transportation / dispatch / receiving forms.
  const isDirect = Boolean(outward.directDispatch);
  const dispatched = isWarehouse ? outward.dispatchState === "Dispatched" : isDispatchedStatus(workflow);
  const awaitingDispatch = isWarehouse ? outward.dispatchState === "Pending" : isApprovedStatus(workflow);
  const showCost = !isWarehouse;
  // Until dispatch: Sales can edit, Account can reject. After dispatch Sales / Account / Warehouse are locked out;
  // the Super admin's Update button does everything (sales info, cost, items and dispatch details);
  // the warehouse manager can still update the dispatch details, documents and vehicle number.
  // Sales can view entries the super admin created for their company, but only edit their own.
  // Once the transportation details are sent AND Account has uploaded its documents the entry is locked
  // (outward.editLocked, set by the server): Sales can't edit. Account can still approve / reject / hold until dispatch.
  const locked = Boolean(outward.editLocked) && !isSuperAdmin;
  const canEdit = isSuperAdmin || (isSales && !locked && SALES_EDITABLE_STATUSES.includes(workflow));
  const canApprove = (isAccount || isSuperAdmin) && ["PENDING_APPROVAL", "REJECTED", "ON_HOLD"].includes(workflow);
  const canReject = (isAccount || isSuperAdmin) && REJECTABLE_STATUSES.includes(workflow);
  const canHold = (isAccount || isSuperAdmin) && HOLDABLE_STATUSES.includes(workflow);
  // Account, and the Super admin while the entry waits for approval, get the invoice panel with Approve / Hold / Reject at the bottom.
  const showAccountPanel = isAccount || (isSuperAdmin && (["PENDING_APPROVAL", "REJECTED", "ON_HOLD"].includes(workflow) || isApprovedStatus(workflow)));
  const stage = outward.stage;
  const transportSubmitted = isTransportSubmitted(outward);
  // Account's documents unlock only after approval AND the warehouse manager's transportation form.
  const accountDocsEditable = isApprovedStatus(workflow) && (transportSubmitted || isDirect);
  const accountDocsBlockedMessage =
    isDispatchedStatus(workflow)
      ? ""
      : isApprovedStatus(workflow) && !transportSubmitted && !isDirect
      ? "Waiting for the warehouse manager to submit the vehicle / transportation details. Documents can be uploaded after that."
      : isApprovedStatus(workflow)
      ? ""
      : "Documents can be uploaded after the entry is approved and the warehouse has submitted the vehicle / transportation details.";
  // Warehouse manager / Super admin: the three forms (Transportation -> Dispatch -> Receiving).
  const showFormButtons = (isWarehouse || isSuperAdmin) && !isDirect;
  const dispatchOpen = stage === STAGE.READY_FOR_DISPATCH || stage === STAGE.DISPATCHED;
  // Documents: add / upload / replace / delete for the warehouse manager (before and after dispatch)
  // and for the Super admin. Sales / Account never see the section for editing.
  // Documents are saved only after dispatch - before that the dispatch page keeps the picked files.
  // A "Dispatch directly" entry has no warehouse: the manager can only view it.
  const canManageDocs = (isSuperAdmin || (isWarehouse && !isDirect)) && dispatched;
  // The super admin does not see the documents section at the approval stage;
  // it appears with the dispatch details and stays after dispatch.
  const docsStage = !isSuperAdmin || awaitingDispatch || dispatched;
  // The documents section is always on the detail page (empty state when nothing is uploaded).
  // Sales / Account get it once dispatched; the admin from dispatch details onwards; the warehouse manager always.
  // Sales / Account only see their own part, never the documents or dispatch details.
  // Hidden until the entry is dispatched (before that there are no dispatch documents to show).
  // Sales sees everything about the entry (view only): documents, transportation, dispatch and receiving details.
  const showDocuments = isSales || (dispatched && docsStage && (isSuperAdmin || isWarehouse) && (!isWarehouse || dispatchOpen));
  const showDispatchInfo = !isDirect && ((isWarehouse && dispatchOpen) || (isSuperAdmin && dispatched) || isSales);
  const received = isReceived(outward);
  const statusStyle = getStatusStyle(outward);

  // Documents shown = what is already uploaded (Account team / warehouse manager) plus one
  // (optional) row for each document type picked in the reference documents. No fixed rows.
  const documentRows = documents.map((doc) => ({
    key: doc.id,
    label: doc.docCategory || "Document",
    document: doc,
    required: false,
  }));
  const currentStatus = isDirect ? "Delivered directly" : isReceived(outward) ? "Delivered" : "Shipped";

  // One row per reference document added on the form (invoice, e-way
  // bill, etc). Older records without a referenceDocuments array fall
  // back to the single refDoc*/ewayBillNumber fields as one row.
  const referenceDocumentRows =
    Array.isArray(outward.referenceDocuments) && outward.referenceDocuments.length
      ? outward.referenceDocuments
      : !isPlaceholder(outward.refDocNumber)
      ? [{ id: "ref-1", refDocType: outward.refDocType, refDocNumber: outward.refDocNumber, ewayBillNumber: outward.ewayBillNumber }]
      : [];

  // An uploaded receiving copy / photo is listed under the reference documents too.
  const receivingReferenceRows = documents
    .filter((doc) => isReceivingDocCategory(doc.docCategory))
    .map((doc) => ({ id: `recv-${doc.id}`, refDocType: doc.docCategory, refDocNumber: "" }));
  const referenceTableRows = [...referenceDocumentRows, ...receivingReferenceRows];

  // Upload rows offered for the reference document types that were selected.
  const documentSlots = [
    ...new Set(referenceDocumentRows.map((ref) => refTypeDocument(ref.refDocType)).filter(Boolean)),
  ];

  return (
    <div className="min-h-dvh bg-gray-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 sm:py-5">
          <button onClick={() => navigate("/outward")} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-3 sm:gap-2 sm:text-base sm:mb-4">
            <ArrowLeft size={18} />
            Back
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start justify-between gap-2 sm:block">
              <div className="min-w-0">
                <h1 className="text-base font-bold text-gray-900 sm:text-2xl">Outward Details</h1>
                <p className="mt-0.5 break-all text-[11px] text-gray-500 sm:text-base sm:mt-1">{outward.outwardNumber || `Outward #${outward.id}`}</p>
              </div>
              {statusStyle && (
                <span className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium sm:hidden ${statusStyle.cls}`}>
                  {statusStyle.label}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end sm:gap-2">
              {canApprove && !showAccountPanel && (
                <button type="button" onClick={() => openDecision("approve")} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-semibold text-white hover:bg-green-700 sm:text-sm"><Check size={15} /> Approve</button>
              )}
              {canHold && !showAccountPanel && (
                <button type="button" onClick={() => openDecision("hold")} className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-semibold text-purple-700 hover:bg-purple-50 sm:text-sm"><Pause size={15} /> Hold</button>
              )}
              {canReject && !showAccountPanel && (
                <button type="button" onClick={() => openDecision("reject")} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-semibold text-red-600 hover:bg-red-50 sm:text-sm"><X size={15} /> Reject</button>
              )}
              {showFormButtons && (
                <>
                  <FormButton to={`/outward/${id}/transportation`} icon={<Truck size={15} />} label="Transportation" locked={!stage} lockedHint="Opens after the entry is approved" />
                  <FormButton to={`/outward/${id}/dispatch`} icon={<FileText size={15} />} label="Dispatch" locked={!dispatchOpen} lockedHint={!stage ? "Opens after the entry is approved" : !transportSubmitted ? "Submit the transportation form first" : "Opens once the account team shares the documents"} />
                  <FormButton to={`/outward/${id}/receiving`} icon={<Calendar size={15} />} label="Delivered" locked={!dispatched} lockedHint="Opens after dispatch" />
                </>
              )}
              {canEdit && (
                <button type="button" onClick={() => navigate(`/outward/${id}/edit`)} className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-semibold text-white hover:bg-black sm:text-sm">Update</button>
              )}
              {/* Download: only once the entry is fully dispatched, and only for the admin / warehouse manager. Sales and Account never get it. */}
              {dispatched && received && (isSuperAdmin || isWarehouse || isSales) && (
                <button type="button" aria-label="Download PDF" title="Download PDF" onClick={() => downloadOutwardPdf(outward, items, docsStage && showDocuments ? documentRows : [], currentStatus, { includeDispatch: showDispatchInfo || showDocuments, includeCost: showCost })} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-medium text-gray-700 hover:bg-gray-50 sm:text-sm"><Download size={15} /><span className="hidden sm:inline">Download</span></button>
              )}
            </div>

            {statusStyle && (
              <span className={`hidden shrink-0 px-2.5 py-1 rounded-full text-xs font-medium sm:inline-block sm:px-4 sm:py-2 sm:text-sm ${statusStyle.cls}`}>
                {statusStyle.label}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 sm:px-6 sm:py-6 sm:space-y-6">
        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg sm:mb-5">Outward Information</h2>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
            <Info icon={<Hash size={18} />} label="Dispatch Number" value={outward.outwardNumber || "-"} />
            <Info icon={<User size={18} />} label="Customer" value={outward.customerName || "-"} />
            <Info icon={<User size={18} />} label="Company" value={outward.companyName || outward.warehouse?.company?.name || "-"} />
            {isDirect && <Info icon={<Truck size={18} />} label="Warehouse" value="Dispatch directly (no warehouse)" />}
            <Info icon={<Truck size={18} />} label="Outward Type" value={outward.outwardType || "-"} />
            {(
              <>
                <Info icon={<Hash size={18} />} label="PI No." value={outward.piNumber || "-"} />
                <Info icon={<Calendar size={18} />} label="PI Date" value={outward.piDate ? new Date(outward.piDate).toLocaleDateString("en-IN") : "-"} />
                <Info label="PI Amount" value={formatMoney(outward.piAmount)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1 sm:gap-2 sm:text-sm"><Paperclip size={18} />PI File</div>
                  {outward.hasPiFile ? (
                    <span className="flex items-center gap-3"><button type="button" onClick={() => handleViewPi("view")} className="text-sm font-medium text-blue-700 hover:underline sm:text-base">View</button><button type="button" onClick={() => handleViewPi("download")} className="text-sm font-medium text-blue-700 hover:underline sm:text-base">Download</button></span>
                  ) : (
                    <div className="text-sm font-medium text-gray-900 sm:text-base">-</div>
                  )}
                </div>
              </>
            )}
            <Info label="Ship to - Contact Person" value={outward.shipToContactPerson || "-"} />
            <Info label="Ship to - Contact No." value={outward.shipToContactNo || "-"} />
            <Info label="Ship to - Location" value={<LocationLink value={outward.shipToLocation} />} />
            <Info label="Bill to - Contact Person" value={outward.billToContactPerson || "-"} />
            <Info label="Bill to - Contact No." value={outward.billToContactNo || "-"} />
            <Info label="Bill to - Email" value={outward.billToEmail || "-"} />
            <Info
              icon={<Calendar size={18} />}
              label={dispatched && (isSuperAdmin || isWarehouse || isSales) ? "Dispatch Date" : "Outward Date"}
              value={outward.refDocDate ? new Date(outward.refDocDate).toLocaleDateString("en-IN") : "-"}
            />
            {showDispatchInfo && (
              <>
                <Info icon={<Route size={18} />} label="Dispatch Mode" value={isPlaceholder(outward.dispatchMode) ? "-" : outward.dispatchMode} />
                {!transportSubmitted && (
                  <>
                    <Info icon={<Truck size={18} />} label="Vehicle / AWB Number" value={outward.vehicleNumber || "-"} />
                    <Info icon={<User size={18} />} label="Driver Name" value={outward.driverName || "-"} />
                    <Info label="Driver Contact" value={outward.driverContact || "-"} />
                  </>
                )}
              </>
            )}
            <Info label="Created By" value={outward.createdBy?.name || outward.createdBy?.email || "-"} />
            {showDispatchInfo && <Info label="Remarks" value={outward.remarks || "-"} />}
          </div>

          {/* Reference documents — one row per invoice/e-way bill/etc the
              user added on the form. Falls back to the single refDoc*
              fields for older records saved before referenceDocuments
              existed. */}
          {showDispatchInfo && (
          <div className="mt-5 pt-5 border-t">
            <p className="text-sm font-semibold text-black mb-3">Reference Documents</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[11px] sm:text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="py-2 px-3">Document Type</th>
                    <th className="py-2 px-3">Reference No.</th>
                  </tr>
                </thead>
                <tbody>
                  {referenceTableRows.map((ref, index) => (
                    <tr key={ref.id || index} className="border-b last:border-0">
                      <td className="py-2 px-3">{refTypeLabel(ref.refDocType) || "-"}</td>
                      <td className="py-2 px-3">{ref.refDocNumber || "-"}</td>
                    </tr>
                  ))}
                  {referenceTableRows.length === 0 && (
                    <tr>
                      <td colSpan="2" className="text-center py-4 text-gray-500">
                        No reference documents
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {outward.dispatchRemarks && (
            <div className="mt-5 rounded-lg border border-red-300 bg-red-50 p-3 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700 sm:text-sm">Dispatch Remarks (by Sales)</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-red-700 sm:text-base">{outward.dispatchRemarks}</p>
            </div>
          )}
        </div>

        {/* Transportation details: warehouse manager, Account and Super admin (not Sales). */}
        {transportSubmitted && (
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <h2 className="mb-4 text-base font-semibold text-gray-900 sm:text-lg">Transportation</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
              <Info icon={<Route size={18} />} label="Dispatch Mode" value={DISPATCH_MODES.includes(outward.dispatchMode) ? outward.dispatchMode : "-"} />
              <Info icon={<Truck size={18} />} label="Vehicle Type" value={transportModeLabel(outward.transportMode) || "-"} />
              {outward.transportMode === "TRANSPORTATION" ? (
                <>
                  <Info label="Transporter ID" value={outward.transporterId || "-"} />
                  <Info icon={<User size={18} />} label="Transporter Name" value={outward.transporterName || "-"} />
                  <Info label="Transporter Contact" value={outward.transporterContact || "-"} />
                  <Info label="Vehicle No." value={outward.vehicleNumber || "-"} />
                  <Info label="Driver Contact" value={outward.driverContact || "-"} />
                </>
              ) : (
                <>
                  <Info label="Vehicle No." value={outward.vehicleNumber || "-"} />
                  <Info icon={<User size={18} />} label="Driver Name" value={outward.driverName || "-"} />
                  <Info label="Driver Contact" value={outward.driverContact || "-"} />
                </>
              )}
              {outward.transportSubmittedByName && <Info label="Submitted By" value={outward.transportSubmittedByName} />}
              {outward.transportSubmittedAt && <Info label="Submitted On" value={new Date(outward.transportSubmittedAt).toLocaleString("en-IN")} />}
            </div>
          </div>
        )}

        {/* Receiving details - shown only once the warehouse manager has filled them. */}
        {dispatched && showDispatchInfo && received && (
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <h2 className="mb-4 text-base font-semibold text-gray-900 sm:text-lg">Receiving</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
              <Info icon={<Calendar size={18} />} label="Receiving Date" value={outward.receivedDate ? new Date(outward.receivedDate).toLocaleDateString("en-IN") : "-"} />
              <Info icon={<User size={18} />} label="Receiver Name" value={outward.receiverName || "-"} />
              <Info label="Receiver Contact" value={outward.receiverContact || "-"} />
              <Info label="Receiving Remarks" value={outward.receivingRemarks || "-"} />
              {outward.receivedByName && <Info label="Recorded By" value={outward.receivedByName} />}
            </div>
          </div>
        )}

        {/* Approval details - Sales / Account / Super admin only. Never sent to the warehouse. */}
        {showCost && (workflow === "REJECTED" || workflow === "ON_HOLD" || outward.approvedByName || dispatched) && (
          <div className={`rounded-xl border p-4 sm:p-6 ${workflow === "REJECTED" ? "border-red-200 bg-red-50" : workflow === "ON_HOLD" ? "border-purple-200 bg-purple-50" : "bg-white"}`}>
            <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg">Approval</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
              <Info label={workflow === "REJECTED" ? "Rejected By" : workflow === "ON_HOLD" ? "Put On Hold By" : "Approved By"} value={outward.approvedByName || "-"} />
              <Info label={workflow === "REJECTED" ? "Rejected On" : workflow === "ON_HOLD" ? "Put On Hold On" : "Approved On"} value={outward.approvedAt ? new Date(outward.approvedAt).toLocaleString("en-IN") : "-"} />
              <Info label={workflow === "REJECTED" || workflow === "ON_HOLD" ? "Reason" : "Remarks"} value={outward.approvalRemarks || "-"} />
              {dispatched && isSuperAdmin && <Info label="Dispatched By" value={outward.dispatchedByName || "-"} />}
              {dispatched && isSuperAdmin && <Info label="Dispatched On" value={outward.dispatchedAt ? new Date(outward.dispatchedAt).toLocaleString("en-IN") : "-"} />}
            </div>
            {workflow === "ON_HOLD" && (
              <p className="mt-3 text-xs text-purple-700">This entry is on hold. Account can approve or reject it later, or Sales can edit it and send it for approval again.</p>
            )}
            {workflow === "REJECTED" && (
              <p className="mt-3 text-xs text-red-600">Sales can edit this entry and send it for approval again, or Account can approve it again.</p>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border p-4 sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg sm:mb-5">Items</h2>
          <table className="w-full text-[11px] sm:text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 px-1 w-6 sm:py-3 sm:px-3 sm:w-auto">#</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">Category</th>
                <th className="py-2 px-1 sm:py-3 sm:px-3">{isWarehouse ? "Model" : "SKU"}</th>
                {!isDirect && <th className="py-2 px-1 sm:py-3 sm:px-3">Qty</th>}
                {!isDirect && <th className="py-2 px-1 sm:py-3 sm:px-3">UOM</th>}
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
                      {!isDirect && <td className="py-2 px-1 sm:py-4 sm:px-3">{item.quantity || 0}</td>}
                      {!isDirect && <td className="py-2 px-1 break-words sm:py-4 sm:px-3">{item.uom || "-"}</td>}
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
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showCost && items.length > 0 && (() => {
          // Payment is done once for the whole outward and saved on every item, so it is shown once here.
          const pay = items.find((i) => i.paymentStatus && (i.utrNumber || i.hasProof || i.approvedBy)) || items[0];
          const proofItem = items.find((i) => i.hasProof);
          const badge = pay.paymentStatus === "COMPLETED" ? "bg-green-100 text-green-700" : pay.paymentStatus === "PARTIALLY_COMPLETED" ? "bg-blue-100 text-blue-700" : pay.paymentStatus === "ZERO_COST" ? "bg-gray-100 text-gray-700" : "bg-amber-100 text-amber-700";
          return (
            <div className="bg-white rounded-xl border p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4 sm:text-lg sm:mb-5">Payment details</h2>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
                <div>
                  <p className="text-sm font-bold text-gray-900 sm:text-base">Payment status</p>
                  <span className={`mt-1 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold sm:text-xs ${badge}`}>{paymentStatusLabel(pay.paymentStatus)}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 sm:text-base">Approve by</p>
                  <p className="mt-1 break-words text-sm font-normal text-gray-700 text-gray-900">{pay.approvedBy || "-"}</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 sm:text-base">UTR</p>
                  <p className="mt-1 break-all text-sm font-normal text-gray-700 text-gray-900">{pay.utrNumber || "-"}</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 sm:text-base">Proof</p>
                  {proofItem ? (
                    <button type="button" onClick={() => handleViewProof(proofItem.id)} className="mt-1 inline-flex items-center gap-1 text-sm font-normal text-gray-700 text-blue-700 hover:underline"><Paperclip size={14} /> View</button>
                  ) : (
                    <p className="mt-1 text-sm font-normal text-gray-700 text-gray-900">-</p>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Account: its own reference documents + documents (invoice / e-way bill / other), editable until dispatch. */}
        {showAccountPanel && (
          <AccountOutwardPanel
            outwardId={id}
            outward={outward}
            editable={ACCOUNT_EDIT_STATUSES.includes(workflow) && accountDocsEditable}
            docsBlockedMessage={accountDocsBlockedMessage}
            // Reference documents appear only once the transportation details are in (or after dispatch).
            showReferences={transportSubmitted || isDirect || isDispatchedStatus(workflow)}
            canApprove={canApprove}
            canReject={canReject}
            canHold={canHold}
            onDecision={openDecision}
          />
        )}

        {showDocuments && (
          <OutwardDocuments
            outwardId={id}
            documents={documents}
            canManage={canManageDocs}
            requiredDocuments={[]}
            optionalDocuments={documentSlots}
            showSummary={false}
            // Invoice / e-way bill belong to the account team: the manager only downloads them.
            isLocked={(category) => isWarehouse && isAccountDocCategory(category)}
          />
        )}
      </div>


      {/* Approve / reject dialog (Account, Super admin) */}
      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              {decision === "approve" ? "Approve this outward entry?" : decision === "hold" ? "Put this outward entry on hold?" : "Reject this outward entry?"}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {decision === "approve" && isDirect
                ? "The payment details will be marked approved. There is no warehouse step: after approval you upload the documents and the entry is delivered directly."
                : decision === "approve"
                ? "The payment details will be marked approved and the entry goes to the warehouse manager for dispatch."
                : decision === "hold"
                ? "It stays with Account and is not sent to the warehouse. You can approve or reject it later."
                : "It goes back to Sales, who can fix the details and send it again."}
            </p>
            <label className="mt-4 mb-1.5 block text-sm font-semibold text-black">
              {decision === "approve" ? "Remarks (optional)" : decision === "hold" ? "Reason for holding" : "Reason for rejecting"}
            </label>
            <textarea
              rows={3}
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder={decision === "approve" ? "Any note for the record" : decision === "hold" ? "Why is this on hold?" : "Tell Sales what needs to be corrected"}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={deciding} onClick={() => setDecision(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button
                type="button"
                disabled={deciding}
                onClick={submitDecision}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${decision === "approve" ? "bg-green-600 hover:bg-green-700" : decision === "hold" ? "bg-purple-600 hover:bg-purple-700" : "bg-red-600 hover:bg-red-700"}`}
              >
                {deciding ? "Please wait..." : decision === "approve" ? "Approve" : decision === "hold" ? "Hold" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
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

function FormButton({ to, icon, label, locked, lockedHint }) {
  const cls = "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 font-semibold sm:text-sm";
  if (locked) {
    return (
      <span title={lockedHint} aria-disabled="true" className={`${cls} cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400`}>
        <Lock size={14} /> {label}
      </span>
    );
  }
  return (
    <Link to={to} className={`${cls} border border-gray-900 bg-white text-gray-900 hover:bg-gray-900 hover:text-white`}>
      {icon} {label}
    </Link>
  );
}
