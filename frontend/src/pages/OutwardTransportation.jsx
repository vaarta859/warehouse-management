import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "../components/CenterMessage";
import {
  fetchOutwardById,
  saveOutwardTransportation,
  clearCurrentOutward,
  selectCurrentOutward,
  selectOutwardDetailStatus,
  selectOutwardDetailError,
} from "../features/outward/outwardSlice";
import { TRANSPORT_MODES, DISPATCH_MODES, isTransportSubmitted, formatOutwardType, SERIAL_SOURCE_TYPES } from "../features/outward/outwardHelpers";
import useSerialScanner from "../components/SerialScanner";
import apiClient from "../services/apiClient";
import { buildSerialLines, initialSerialValues, serialPayload, serialProblem } from "../features/outward/serialHelpers";

/**
 * =========================================================
 * TRANSPORTATION FORM  (Warehouse manager, Super admin)
 * =========================================================
 * Opens only after Account has approved the entry. The manager picks the vehicle type:
 *
 *   Dedicated vehicle -> Vehicle no. + Driver name + Driver contact
 *   Transportation    -> Transporter ID + Transporter name
 *
 * The same form has the Item details with the serial no. scan: one serial number for every Pcs unit
 * (typed, camera or scanner). Submitting sends the vehicle details AND the serial numbers to the account team, who can then upload Invoice / E-way bill /
 * DC Challan / Without Invoice / Other. Can be corrected until the entry is dispatched.
 * =========================================================
 */

const PHONE_RE = /^\d{10}$/;

export default function OutwardTransportation() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id } = useParams();

  const outward = useSelector(selectCurrentOutward);
  const detailStatus = useSelector(selectOutwardDetailStatus);
  const detailError = useSelector(selectOutwardDetailError);

  const [mode, setMode] = useState("");
  const [dispatchMode, setDispatchMode] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [transporterId, setTransporterId] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [transporterContact, setTransporterContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState(false);
  // Serial numbers: one box per Pcs unit (an item of 4 Pcs -> 4 serial numbers).
  const [serialValues, setSerialValues] = useState({});
  const serialsInitFor = useRef(null);
  const locked = Boolean(outward?.transportLocked);
  const serialLines = useMemo(() => buildSerialLines(outward?.items || []), [outward?.items]);
  // Load saved serial numbers once per entry (a later refresh must not wipe what is being scanned).
  useEffect(() => {
    if (!outward || outward.id !== id || serialsInitFor.current === id) return;
    serialsInitFor.current = id;
    setSerialValues(initialSerialValues(buildSerialLines(outward.items || []), outward.serials || []));
  }, [outward, id]);
  // Serial numbers in stock that can be chosen for each item (same inward-type rule the server enforces on submit).
  const [stockSerials, setStockSerials] = useState(null);
  useEffect(() => {
    if (!outward || outward.id !== id || locked) return undefined;
    let cancelled = false;
    apiClient
      .get(`/api/outward/${id}/available-serials`)
      .then(({ data }) => { if (!cancelled) setStockSerials(data?.data || {}); })
      .catch(() => { if (!cancelled) setStockSerials(null); }); // no list: typing / scanning still works
    return () => { cancelled = true; };
  }, [outward?.id, id, locked]);
  const serial = useSerialScanner({ items: outward?.items || [], lines: serialLines, values: serialValues, onChange: setSerialValues, disabled: locked, suggestions: stockSerials });

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  useEffect(() => {
    if (id) dispatch(fetchOutwardById(id));
    return () => dispatch(clearCurrentOutward());
  }, [dispatch, id]);

  // Prefill when the form was already submitted (correcting it).
  useEffect(() => {
    if (!outward || outward.id !== id || filled) return;
    setFilled(true);
    if (isTransportSubmitted(outward)) {
      setMode(outward.transportMode || "");
      setDispatchMode(DISPATCH_MODES.includes(outward.dispatchMode) ? outward.dispatchMode : "");
      setVehicleNumber(outward.vehicleNumber || "");
      setDriverName(outward.driverName || "");
      setDriverContact(outward.driverContact || "");
      setTransporterId(outward.transporterId || "");
      setTransporterName(outward.transporterName || "");
      setTransporterContact(outward.transporterContact || "");
    }
  }, [outward, id, filled]);

  // Only an approved entry has this form (approved = the server sends a stage).
  useEffect(() => {
    if (detailStatus === "succeeded" && outward && outward.id === id && !outward.stage) {
      toast.info("The transportation form opens after the entry is approved.");
      navigate(`/outward/${id}`, { replace: true });
    }
  }, [detailStatus, outward, id, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (outward?.transportLocked) return toast.error("The transportation details are locked because the account team has already uploaded its documents.");
    if (!mode) return toast.error("Please select the vehicle type.");
    if (mode === "DEDICATED") {
      if (!vehicleNumber.trim()) return toast.error("Please enter the vehicle number.");
      if (!driverName.trim()) return toast.error("Please enter the driver name.");
      if (!driverContact.trim()) return toast.error("Please enter the driver contact number.");
      if (!PHONE_RE.test(driverContact.trim())) return toast.error("Please enter a driver contact number (10 digits).");
    } else {
      if (!transporterId.trim()) return toast.error("Please enter the transporter ID.");
      if (!transporterName.trim()) return toast.error("Please enter the transporter name.");
      if (!transporterContact.trim()) return toast.error("Please enter the transporter contact number.");
      if (!PHONE_RE.test(transporterContact.trim())) return toast.error("Please enter a transporter contact number (10 digits).");
    }

    // Every Pcs unit needs its own serial number. Entries submitted before serial numbers moved to this form
    // can still be corrected without them (but if some are entered, all must be).
    const serials = serialPayload(serialLines, serialValues);
    const legacyNoSerials = isTransportSubmitted(outward) && !(outward.serials || []).length && serials.length === 0;
    if (!legacyNoSerials) {
      const problem = serialProblem(serialLines, serialValues);
      if (problem) return toast.error(problem);
    }

    setSaving(true);
    const result = await dispatch(
      saveOutwardTransportation({
        id,
        payload: {
          ...(mode === "DEDICATED"
            ? { transportMode: mode, dispatchMode, vehicleNumber: vehicleNumber.trim(), driverName: driverName.trim(), driverContact: driverContact.trim() }
            : { transportMode: mode, dispatchMode, transporterId: transporterId.trim(), transporterName: transporterName.trim(), transporterContact: transporterContact.trim() }),
          ...(legacyNoSerials ? {} : { serials }),
        },
      })
    );
    setSaving(false);

    if (saveOutwardTransportation.rejected.match(result)) {
      return toast.error(result.payload || "Failed to save transportation details.");
    }
    toast.success(result.payload?.message || "Transportation details saved.");
    navigate(`/outward/${id}`, { replace: true });
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
        <button onClick={() => navigate(`/outward/${id}`)} className="mb-6 flex items-center gap-2 text-gray-600"><ArrowLeft size={20} />Back</button>
        <div className="rounded-xl border border-red-200 bg-white p-6 text-red-600">{detailError || "Outward entry not found."}</div>
      </div>
    );
  }

  const submitted = isTransportSubmitted(outward);
  const items = outward.items || [];

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center gap-3 sm:mb-6">
          <button type="button" onClick={() => navigate(`/outward/${id}`)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{locked ? "Transportation details" : submitted ? "Update transportation details" : "Transportation details"}</h1>
            <p className="text-xs text-gray-400">{outward.outwardNumber}</p>
          </div>
        </div>

        {locked && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 sm:text-sm">
            These details are locked. The account team has already uploaded its documents, so the transportation details can no longer be changed.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset disabled={locked} className="min-w-0 border-0 p-0">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Vehicle</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>Dispatch mode</label>
                <div className="relative">
                  <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option value="">Select dispatch mode</option>
                    {DISPATCH_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Vehicle type</label>
                <div className="relative">
                  <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option value="">Select vehicle type</option>
                    {TRANSPORT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>

              {mode === "DEDICATED" && (
                <>
                  <div><label className={labelCls}>Vehicle no.</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="e.g. DL01AB1234" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Enter driver name" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver contact</label><input type="tel" inputMode="numeric" maxLength={10} value={driverContact} onChange={(e) => setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter driver contact no." className={inputCls} /></div>
                </>
              )}

              {mode === "TRANSPORTATION" && (
                <>
                  <div><label className={labelCls}>Transporter ID</label><input value={transporterId} onChange={(e) => setTransporterId(e.target.value)} placeholder="Enter transporter ID" className={inputCls} /></div>
                  <div><label className={labelCls}>Transporter name</label><input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="Enter transporter name" className={inputCls} /></div>
                  <div><label className={labelCls}>Transporter contact</label><input type="tel" inputMode="numeric" maxLength={10} value={transporterContact} onChange={(e) => setTransporterContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter transporter contact no." className={inputCls} /></div>
                </>
              )}
            </div>
            {!locked && (
              <p className="mt-4 text-xs text-gray-500">
                After you submit, the details and the serial numbers go to the account team. Once the account team uploads its documents, these details can no longer be changed.
              </p>
            )}
          </section>

          <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Item details</h2>
              {serial.badge}
            </div>
            <div className="rounded-lg border">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-500">
                    <th className="px-1.5 py-2 sm:px-3">#</th>
                    <th className="px-1.5 py-2 sm:px-3">Category</th>
                    <th className="px-1.5 py-2 sm:px-3">Model</th>
                    <th className="px-1.5 py-2 sm:px-3">Qty</th>
                    <th className="px-1.5 py-2 sm:px-3">UOM</th>
                    {serial.hasSerials && <th className="hidden px-3 py-2 sm:table-cell">SR. No</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <Fragment key={item.id || index}>
                      <tr {...serial.rowProps(index)} className={`${serial.hasSerials ? "border-b-0 sm:border-b" : "border-b"} text-sm last:border-0 ${serial.rowProps(index).className}`}>
                        <td className="px-1.5 py-3 sm:px-3 sm:py-2">{index + 1}</td>
                        <td className="px-1.5 py-3 sm:px-3 sm:py-2">{item.category || "-"}</td>
                        <td className="break-words px-1.5 py-3 font-medium sm:whitespace-nowrap sm:px-3 sm:py-2">{item.sku || "-"}</td>
                        <td className="px-1.5 py-3 sm:px-3 sm:py-2">{item.quantity}</td>
                        <td className="px-1.5 py-3 sm:px-3 sm:py-2">{item.uom || "-"}</td>
                        {serial.hasSerials && <td className="hidden px-3 py-1 align-middle sm:table-cell">{serial.inputCell(item, index)}</td>}
                      </tr>
                      {serial.hasSerials && serial.mobileInputRow(item, index, 5 + 1)}
                      {serial.hasSerials && serial.listRow(item, index, 5 + 1)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {serial.hasSerials && !locked && <p className="mt-2 text-xs text-gray-500">Tap an item row to select it, then type the serial no. and press Enter / Add, tap Scan for the camera, or scan with a connected Bluetooth / Wi-Fi / USB scanner. Scans go only to the selected item and are listed under it. The serial numbers are sent to the account team when you submit.</p>}
            {serial.hasSerials && !locked && SERIAL_SOURCE_TYPES[formatOutwardType(outward.outwardType)] && (
              <p className="mt-1 text-xs font-medium text-gray-700">
                {formatOutwardType(outward.outwardType)}: serial numbers must have come in through {SERIAL_SOURCE_TYPES[formatOutwardType(outward.outwardType)].join(" or ")}.
              </p>
            )}
          </section>
          </fieldset>

          {serial.camera}

          {!locked && <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : submitted ? "Update transportation details" : "Submit to account team"}
          </button>}
        </form>
      </div>
    </div>
  );
}
