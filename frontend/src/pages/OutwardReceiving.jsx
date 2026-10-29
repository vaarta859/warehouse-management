import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "../components/CenterMessage";
import {
  fetchOutwardById,
  saveOutwardReceiving,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import {
  isPlaceholder,
  isReceived,
  isReceivingDocCategory,
  RECEIVING_ADD_MENU,
  RECEIVING_DOC_PREFIX,
  RECEIVING_REQUIRED_DOCUMENT,
} from "../features/outward/outwardHelpers";
import OutwardDocuments from "../components/OutwardDocuments";

/**
 * =========================================================
 * RECEIVING DETAILS  (Warehouse manager, Super admin)
 * =========================================================
 * Opens right after "Save and mark as dispatched". The manager records when and who received the
 * goods (date from a calendar, receiver name, receiver contact, remarks) and uploads the receiving
 * documents (all documents are optional).
 * "Fill later" skips the form; it can be opened again from the outward details page.
 * =========================================================
 */

const PHONE_RE = /^\d{10}$/;

const toDateInput = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return toDateInput();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function OutwardReceiving() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const detailError = useSelector(selectOutwardDetailError);

  const [receivedDate, setReceivedDate] = useState(() => toDateInput());
  const [receiverName, setReceiverName] = useState("");
  const [receiverContact, setReceiverContact] = useState("");
  const [receivingRemarks, setReceivingRemarks] = useState("");
  const [stagedDocs, setStagedDocs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState(false);

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  const dispatched = outward?.dispatchState === "Dispatched" || ["DISPATCHED", "DELIVERED"].includes(outward?.workflowStatus);
  const alreadyReceived = isReceived(outward);

  // Prefill when the receiving details were saved before (editing / correcting them).
  useEffect(() => {
    if (!outward || outward.id !== id || filled) return;
    setFilled(true);
    if (outward.receivedDate) setReceivedDate(toDateInput(outward.receivedDate));
    setReceiverName(outward.receiverName || "");
    setReceiverContact(outward.receiverContact || "");
    setReceivingRemarks(outward.receivingRemarks || "");
  }, [outward, id, filled]);

  // Receiving only exists once the entry is dispatched.
  useEffect(() => {
    if (detailStatus === "succeeded" && outward && outward.id === id && !dispatched) {
      toast.info("Dispatch this entry first, then fill the receiving details.");
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [outward, id, detailStatus, dispatched, navigate]);

  const receivingDocs = useMemo(
    () => (outward?.documents || []).filter((d) => isReceivingDocCategory(d.docCategory)),
    [outward]
  );

  const minDate = outward?.refDocDate ? toDateInput(outward.refDocDate) : undefined;
  const maxDate = toDateInput();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!receivedDate) return toast.error("Please select the receiving date.");
    if (receivedDate > maxDate) return toast.error("Receiving date cannot be in the future.");
    if (minDate && receivedDate < minDate) return toast.error("Receiving date cannot be before the dispatch date.");
    if (!receiverName.trim()) return toast.error("Please enter the receiver name.");
    if (receiverContact.trim() && !PHONE_RE.test(receiverContact.trim())) return toast.error("Please enter a receiver contact number (10 digits).");

    setSaving(true);
    const result = await dispatch(
      saveOutwardReceiving({
        id,
        files: stagedDocs.map((d) => ({ file: d.file, docCategory: d.docCategory })),
        payload: {
          receivedDate,
          receiverName: receiverName.trim(),
          receiverContact: receiverContact.trim(),
          receivingRemarks: receivingRemarks.trim() || undefined,
        },
      })
    );
    setSaving(false);
    if (saveOutwardReceiving.rejected.match(result)) {
      return toast.error(result.payload || "Failed to save receiving details.");
    }
    toast.success(alreadyReceived ? "Receiving details updated." : "Receiving details saved.");
    navigate("/outward", { replace: true });
  };

  if (detailStatus === "loading" || (detailStatus === "idle" && !outward) || (outward && outward.id !== id)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
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

  if (!dispatched) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening outward entry...
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={() => navigate("/outward")} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{alreadyReceived ? "Update receiving details" : "Receiving details"}</h1>
            <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch summary</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <InfoField label="Customer / Recipient" value={outward.customerName} />
              <InfoField label="Dispatch mode" value={isPlaceholder(outward.dispatchMode) ? "-" : outward.dispatchMode} />
              <InfoField label="Dispatched on" value={outward.refDocDate ? new Date(outward.refDocDate).toLocaleString("en-IN") : "-"} />
              <InfoField label="Vehicle / AWB number" value={outward.vehicleNumber} />
              <InfoField label="Driver name" value={outward.driverName} />
              <InfoField label="Driver contact" value={outward.driverContact} />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Receiving details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelCls}>Receiving date <span className="text-red-500">*</span></label>
                <div>
                  <input
                    type="date"
                    required
                    value={receivedDate}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Receiver name <span className="text-red-500">*</span></label>
                <input required value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Who received the goods" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Receiver contact <span className="font-normal text-gray-400">(optional)</span></label>
                <input type="tel" inputMode="numeric" maxLength={10} value={receiverContact} onChange={(e) => setReceiverContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Receiver contact no." className={inputCls} />
              </div>
            </div>
          </section>

          <OutwardDocuments
            outwardId={id}
            documents={receivingDocs}
            canManage
            deferred
            stagedFiles={stagedDocs}
            onStagedChange={setStagedDocs}
            requiredDocuments={[]}
            optionalDocuments={[RECEIVING_REQUIRED_DOCUMENT]}
            showSummary={false}
            addMenuTypes={RECEIVING_ADD_MENU}
            otherPrefix={RECEIVING_DOC_PREFIX}
            title="Receiving documents"
            subtitle="All receiving documents are optional. You can add them now or later."
          />

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <label className={labelCls}>Receiving remarks</label>
            <textarea rows={3} value={receivingRemarks} onChange={(e) => setReceivingRemarks(e.target.value)} placeholder="Condition of goods, shortage / damage notes, etc." className={`${inputCls} resize-none`} />
          </section>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
              {saving ? "Saving..." : alreadyReceived ? "Update receiving details" : "Save receiving details"}
            </button>
            <button type="button" disabled={saving} onClick={() => navigate("/outward", { replace: true })} className="w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:w-48">
              Fill later
            </button>
          </div>
        </form>
      </div>
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
