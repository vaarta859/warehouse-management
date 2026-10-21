import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Minus, Plus, X, Zap, ZapOff } from "lucide-react";
import { startScanner, decodeImageFile } from "../features/scanner/barcodeEngine";
import { toast } from "./CenterMessage";
import { cleanSerialInput, countFilled, serialKey, needsSerials, sortSerials, resolveScannedSerial } from "../features/outward/serialHelpers";

/**
 * Serial numbers inside the Item details table.
 *
 * Every Pcs item row has ONE input (SR.NO + Scan button): type the serial no. and press Enter / Add, or tap the camera
 * icon to scan, or scan with a connected Bluetooth / USB / Wi-Fi scanner (it "types" the code + Enter,
 * so nothing has to be set up). Each serial that is entered or scanned is listed (no numbering) in a row under that item.
 * An item of 4 Pcs needs 4 serial numbers; when they are all added the input is replaced by a tick.
 *
 * const serial = useSerialScanner({ items, lines, values, onChange });
 *   serial.inputCell(item, rowIndex)      -> SR.NO input + Scan button (cell on the item's row)
 *   serial.listRow(item, rowIndex, cols)  -> <tr> under the item listing its serial numbers
 *   serial.badge                 -> "Serial no. x / y" badge for the table heading
 *   serial.camera                -> camera pop-up, render once in the page
 */

// No scan box: the WHOLE camera picture is read, so a barcode is picked up the moment it is in view (no aligning).

const cameraErrorMessage = (err) => {
  const name = err?.name || String(err || "");
  if (!window.isSecureContext) return "Camera needs a secure (https) page. Open the site with https, or type / use a scanner instead.";
  if (/NotAllowed|Permission/i.test(name)) return "Camera permission is blocked. Allow camera access for this site in the browser settings, then tap Scan again.";
  if (/NotFound|DevicesNotFound/i.test(name)) return "No camera found on this device.";
  if (/NotReadable|TrackStart|AbortError/i.test(name)) return "Camera is busy in another app / tab. Close it and try again.";
  return "Camera could not be opened. Allow camera access, or type / use a scanner instead.";
};
const SCAN_MAX_GAP_MS = 35; // a scanner types far faster than a person
const SCAN_MIN_LENGTH = 4;

const isTypingTarget = (el) => {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
};

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 90);
    }
  } catch { /* sound is optional */ }
  navigator.vibrate?.(60);
}

// CAMERA only. Hidden control characters are removed, then the serial is matched against the serials in stock for
// the item exactly like a Bluetooth scan (whole text, one of its words, or contained in it) - so a label
// "SG33CX-P2-V124 I2690100027" finds the stock serial. With nothing in stock to match (e.g. inward form) the WHOLE
// text is kept (spaces removed). The model name is never cut off.
const cameraSerial = (raw, stock) => {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return resolveScannedSerial(text, { sku: "", stock });
};

const SOURCE_LABEL = { CAMERA: "camera", SCANNER: "scanner", MANUAL: "typed" };

export default function useSerialScanner({ items = [], lines = [], values = {}, onChange, disabled = false, suggestions = null, blocked = null }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScan, setLastScan] = useState("");
  const [camInfo, setCamInfo] = useState(null); // small status line: reader type, frames checked
  const [camNote, setCamNote] = useState(null); // what the camera just read and why it was / was not added
  const [drafts, setDrafts] = useState({}); // rowIndex -> text in the input
  const [dropOpen, setDropOpen] = useState(null); // rowIndex whose "in stock" dropdown is open
  const [camTools, setCamTools] = useState({ torch: false, torchOn: false, zoom: null, zoomValue: 1 });

  const inputRefs = useRef({}); // rowIndex -> input element
  const keyStats = useRef({ start: 0, last: 0, count: 0 });
  const lastDecoded = useRef({ text: "", at: 0 });
  const activeRow = useRef(null); // item that receives scans (camera / Bluetooth / Wi-Fi / USB scanner)
  const [selected, setSelected] = useState(null);
  const selectRow = (i) => { activeRow.current = i; setSelected(i); };
  const trackRef = useRef(null);
  const readerRef = useRef(null); // div the camera picture is put into
  const photoInputRef = useRef(null);

  // Rows that need serials: where their serials sit inside the line's slots (rows with the same SKU share one line).
  const rows = useMemo(() => {
    const used = {};
    return items.map((item) => {
      if (!needsSerials(item)) return null;
      const key = serialKey(item.category, item.sku);
      const quantity = Number(item.quantity) || 0;
      const offset = used[key] || 0;
      used[key] = offset + quantity;
      return { key, offset, quantity };
    });
  }, [items]);

  const live = useRef({});
  live.current = { lines, values, onChange, rows, items, suggestions, blocked };

  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const filled = lines.reduce((n, l) => n + countFilled(values, l.key), 0);
  const allDone = total > 0 && filled === total;

  const rowSlots = (row, vals = values) => (vals[row.key] || []).slice(row.offset, row.offset + row.quantity);
  const rowFilled = (row, vals = values) => rowSlots(row, vals).filter((s) => cleanSerialInput(s.serialNo)).length;

  /**
   * Adds a serial no. to the first empty place. Starts at `startRow` (the item the person is working
   * on), goes on to the next items when that one is full - unless `onlyRow` is set (typed into one item).
   */
  const addSerial = (raw, source, startRow = activeRow.current, onlyRow = false) => {
    const { lines: L, values: V, onChange: change, rows: R, items: I, suggestions: S, blocked: B } = live.current;
    // A label barcode can hold "MODEL SERIAL": keep only the serial (checked against what is in stock for the item).
    const target = startRow != null ? R[startRow] : null;
    const stockForScan = target && S ? S[target.key] : null;
    const serialNo = source === "CAMERA"
      ? cameraSerial(raw, stockForScan)
      : resolveScannedSerial(raw, { sku: startRow != null ? I[startRow]?.sku : "", stock: stockForScan });
    if (!serialNo) return false;
    // Dispatch: only serials that are really available (in this warehouse's stock for the item and not already dispatched
    // in another outward entry) can be added. Anything else is refused right at the scan.
    // A serial that is not on an inward entry can still be scanned and sent; only one that is already dispatched /
    // added to another outward is refused (the server checks again on save).
    const blockedForRow = target && B ? B[target.key] : null;
    if (blockedForRow && blockedForRow.some((sn) => cleanSerialInput(sn).toLowerCase() === serialNo.toLowerCase())) {
      toast.warn(`${serialNo} cannot be added: it is already dispatched, or already added to another outward.`);
      return false;
    }
    const exists = L.some((l) => (V[l.key] || []).some((s) => cleanSerialInput(s.serialNo).toLowerCase() === serialNo.toLowerCase()));
    if (exists) {
      toast.warn(`${serialNo} is already entered.`);
      return false;
    }
    const valid = R.map((r, i) => (r ? i : -1)).filter((i) => i !== -1);
    if (!valid.length) return false;
    if (startRow == null || !R[startRow]) return false;
    const at = Math.max(0, valid.indexOf(startRow));
    const order = onlyRow ? [startRow] : [...valid.slice(at), ...valid.slice(0, at)];
    for (const i of order) {
      const row = R[i];
      if (!row) continue;
      const slots = [...(V[row.key] || [])];
      const idx = slots.slice(row.offset, row.offset + row.quantity).findIndex((s) => !cleanSerialInput(s.serialNo));
      if (idx === -1) continue;
      slots[row.offset + idx] = { serialNo, source };
      change({ ...V, [row.key]: slots });
      activeRow.current = i;
      setLastScan(serialNo);
      return true;
    }
    toast.info(onlyRow ? "All serial numbers of this item are already added." : "All serial numbers are already added.");
    return false;
  };
  /**
   * Camera and Bluetooth / Wi-Fi / USB scanner: the serial goes ONLY to the item that is selected (tap its row or its
   * Scan button), never on to another item - so scans can never get mixed up between items.
   */
  const addToSelected = (text, source) => {
    const { rows: R } = live.current;
    const valid = R.map((r, i) => (r ? i : -1)).filter((i) => i !== -1);
    let target = activeRow.current;
    if (target == null || !R[target]) {
      if (valid.length !== 1) {
        toast.warn("Select an item first (tap its row) so the serial goes to the right item.");
        return false;
      }
      target = valid[0];
      selectRow(target);
    }
    return addSerial(text, source, target, true);
  };
  const addToSelectedRef = useRef(addToSelected);
  addToSelectedRef.current = addToSelected;

  const removeSerial = (row, i) => {
    const slots = [...(values[row.key] || [])];
    slots[row.offset + i] = { serialNo: "", source: "MANUAL" };
    // keep the filled ones at the front of this item so new entries fill the gap
    const mine = slots.slice(row.offset, row.offset + row.quantity).filter((s) => cleanSerialInput(s.serialNo));
    for (let k = 0; k < row.quantity; k += 1) slots[row.offset + k] = mine[k] || { serialNo: "", source: "MANUAL" };
    onChange({ ...values, [row.key]: slots });
  };

  const focusInput = (rowIndex) => setTimeout(() => inputRefs.current[rowIndex]?.focus(), 0);

  const submitDraft = (rowIndex, source) => {
    const text = drafts[rowIndex] || "";
    if (!cleanSerialInput(text)) return;
    if (addSerial(text, source, rowIndex, true)) setDrafts((d) => ({ ...d, [rowIndex]: "" }));
    focusInput(rowIndex);
  };

  const handleKeyDown = (e, rowIndex) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Enter (also sent by scanners) must never submit the form
      const { start, last, count } = keyStats.current;
      const gap = count > 1 ? (last - start) / (count - 1) : Infinity;
      keyStats.current = { start: 0, last: 0, count: 0 };
      submitDraft(rowIndex, count >= SCAN_MIN_LENGTH && gap <= SCAN_MAX_GAP_MS ? "SCANNER" : "MANUAL");
      return;
    }
    if (e.key.length === 1) {
      const now = Date.now();
      const s = keyStats.current;
      keyStats.current = now - s.last > 100 ? { start: now, last: now, count: 1 } : { start: s.start, last: now, count: s.count + 1 };
    }
  };

  // Hardware scanner with nothing focused: catch the fast keystroke burst that ends with Enter.
  useEffect(() => {
    if (disabled || !lines.length) return undefined;
    let buffer = "";
    let start = 0;
    let last = 0;
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (e.key === "Enter") {
        const gap = buffer.length > 1 ? (last - start) / (buffer.length - 1) : Infinity;
        if (buffer.length >= SCAN_MIN_LENGTH && gap <= SCAN_MAX_GAP_MS) {
          e.preventDefault(); // do not "click" a focused button
          e.stopPropagation();
          addToSelectedRef.current(buffer, "SCANNER");
        }
        buffer = "";
        return;
      }
      if (e.key.length !== 1) return;
      if (now - last > 100) { buffer = ""; start = now; }
      buffer += e.key;
      last = now;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [disabled, lines.length]);

  // Cursor goes to the first item that still needs serials, so a connected scanner works straight away.
  useEffect(() => {
    if (disabled || !lines.length) return undefined;
    const t = setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      // Only when there is a single item to scan for; with several items the person picks the item first.
      const needing = rows.map((r, i) => (r ? i : -1)).filter((i) => i !== -1);
      if (needing.length === 1 && rowFilled(rows[needing[0]]) < rows[needing[0]].quantity) {
        selectRow(needing[0]);
        inputRefs.current[needing[0]]?.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, disabled]);

  // Camera (continuous): each code is added; closes when everything is filled.
  useEffect(() => {
    if (!cameraOpen) return undefined;
    let cancelled = false;
    let engine = null;

    const onDecoded = (text) => {
      const now = Date.now();
      if (text === lastDecoded.current.text && now - lastDecoded.current.at < 2000) return;
      lastDecoded.current = { text, at: now };
      // Shown INSIDE the camera pop-up (the centre messages can sit behind it), so it is always clear what was read.
      const { rows: R, suggestions: S, blocked: B } = live.current;
      const t = activeRow.current;
      const stock = t != null && R[t] && S ? S[R[t].key] : null;
      const serial = cameraSerial(text, stock);
      const notInStock = t != null && R[t] && B && (B[R[t].key] || []).some((sn) => cleanSerialInput(sn).toLowerCase() === serial.toLowerCase());
      if (addToSelectedRef.current(text, "CAMERA")) {
        setCamNote({ ok: true, text: `Read: ${serial}` });
        beep();
      } else {
        setCamNote({ ok: false, text: notInStock ? `Read: ${serial} - NOT added: it is already dispatched, or already added to another outward.` : `Read: ${serial} - not added (already entered, or the item is full).` });
      }
    };

    // Picks up focus / zoom / torch of the running camera track.
    const setupTrack = async (track) => {
      if (!track) return;
      trackRef.current = track;
      const caps = track.getCapabilities?.() || {};
      try {
        if (caps.focusMode?.includes?.("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      } catch { /* focus control is optional */ }
      // clear, bright picture (the preview looked dim on some phones)
      try {
        const adv = {};
        if (caps.exposureMode?.includes?.("continuous")) adv.exposureMode = "continuous";
        if (caps.whiteBalanceMode?.includes?.("continuous")) adv.whiteBalanceMode = "continuous";
        if (caps.exposureCompensation && Number.isFinite(caps.exposureCompensation.max)) {
          adv.exposureCompensation = Math.min(caps.exposureCompensation.max, (caps.exposureCompensation.step || 0.5) * 2);
        }
        if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
      } catch { /* exposure control is optional */ }
      const z = caps.zoom && Number.isFinite(caps.zoom.max) && caps.zoom.max > caps.zoom.min
        ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1 }
        : null;
      if (!cancelled) setCamTools({ torch: !!caps.torch, torchOn: false, zoom: z, zoomValue: z ? z.min : 1 });
    };

    (async () => {
      try {
        engine = await startScanner({ container: readerRef.current, onDecoded, onStatus: (info) => { if (!cancelled) setCamInfo(info); } });
        if (cancelled) { engine.stop(); engine = null; return; }
        await setupTrack(engine.track);
      } catch (err) {
        if (!cancelled) {
          toast.error(cameraErrorMessage(err));
          setCameraOpen(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      trackRef.current = null;
      setCamTools({ torch: false, torchOn: false, zoom: null, zoomValue: 1 });
      engine?.stop();
    };
  }, [cameraOpen]);

  // "Photo": take / pick a picture with the phone's own camera app (autofocus, full resolution) and read it.
  const scanPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await decodeImageFile(file);
    if (!text) return toast.warn("No barcode found in the photo. Take it closer, flat, sharp and well lit, then try again.");
    lastDecoded.current = { text, at: Date.now() };
    if (addToSelectedRef.current(text, "CAMERA")) { setCamNote({ ok: true, text: `Read: ${cameraSerial(text, null)}` }); beep(); }
    else setCamNote({ ok: false, text: `Read: ${cameraSerial(text, null)} - not added (already dispatched, already entered, or the item is full).` });
  };

  // Tap the picture: focus again on that spot (phones that support it), then back to continuous focus.
  const refocus = async () => {
    const track = trackRef.current;
    const caps = track?.getCapabilities?.() || {};
    try {
      if (caps.focusMode?.includes?.("single-shot")) {
        await track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
        setTimeout(() => track?.applyConstraints?.({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}), 1200);
      }
    } catch { /* focus control is optional */ }
  };

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track || !camTools.torch) return toast.info("Flash is not supported by this camera / browser.");
    const next = !camTools.torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setCamTools((t) => ({ ...t, torchOn: next }));
    } catch { toast.info("Flash is not available on this camera."); }
  };

  const setZoom = async (value) => {
    const track = trackRef.current;
    const z = camTools.zoom;
    if (!track || !z) return;
    const next = Math.min(z.max, Math.max(z.min, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] });
      setCamTools((t) => ({ ...t, zoomValue: next }));
    } catch { /* zoom is optional */ }
  };

  const selectedRowInfo = selected != null ? rows[selected] : null;
  const selectedDone = Boolean(selectedRowInfo) && rowFilled(selectedRowInfo) >= selectedRowInfo.quantity;
  useEffect(() => {
    if (cameraOpen && selectedDone) {
      setCameraOpen(false);
      toast.success("All serial numbers of this item are scanned.");
    }
  }, [cameraOpen, selectedDone]);

  const openCamera = (rowIndex) => {
    selectRow(rowIndex);
    lastDecoded.current = { text: "", at: 0 };
    setLastScan("");
    setCamNote(null);
    setCamInfo(null);
    setCameraOpen(true);
  };

  /** Table cell on the item's own row: SR.NO input + Scan button. */
  const inputCell = (item, rowIndex, mobile = false) => {
    const row = rows[rowIndex];
    if (!row) return <span className="text-xs text-gray-400">Not needed</span>;
    const count = rowFilled(row);
    if (count >= row.quantity) {
      return <span className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-green-700"><CheckCircle2 size={14} />{count} / {row.quantity} added</span>;
    }
    if (disabled) return <span className="text-xs text-gray-400">-</span>;
    // Serial numbers in stock for this item (not entered yet), narrowed by what is typed.
    const stockList = suggestions ? suggestions[row.key] || [] : null;
    const typed = (drafts[rowIndex] || "").toLowerCase();
    const entered = new Set(lines.flatMap((l) => (values[l.key] || []).map((s) => cleanSerialInput(s.serialNo).toLowerCase())).filter(Boolean));
    const available = stockList ? sortSerials(stockList).filter((sn) => !entered.has(sn.toLowerCase()) && (!typed || sn.toLowerCase().includes(typed))) : [];
    const pick = (sn) => {
      addSerial(sn, "MANUAL", rowIndex, true);
      setDrafts((d) => ({ ...d, [rowIndex]: "" }));
      focusInput(rowIndex);
    };
    return (
      <div className={`flex items-center ${mobile ? "w-full gap-1.5 py-0" : "min-w-[330px] gap-2 py-1"}`}>
        <div className="relative min-w-0 flex-1">
        <input
          ref={(el) => { inputRefs.current[rowIndex] = el; }}
          value={drafts[rowIndex] || ""}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={stockList ? `SR. No (${stockList.length} in stock)` : "SR. No"}
          onFocus={() => { selectRow(rowIndex); setDropOpen(rowIndex); }}
          onClick={() => setDropOpen(rowIndex)}
          onBlur={() => setTimeout(() => setDropOpen((o) => (o === rowIndex ? null : o)), 150)}
          onChange={(e) => { setDrafts((d) => ({ ...d, [rowIndex]: cleanSerialInput(e.target.value) })); setDropOpen(rowIndex); }}
          onKeyDown={(e) => { if (e.key === "Escape") setDropOpen(null); handleKeyDown(e, rowIndex); }}
          className={`w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-white outline-none focus:border-gray-300 focus:ring-0 ${mobile ? "px-2.5 py-1.5 text-sm" : "px-3 py-2 text-sm"}`}
        />
        {stockList && dropOpen === rowIndex && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {available.length ? `In stock (${available.length})` : stockList.length ? "No matching serial no. in stock - you can still type or scan it" : "No serial no. in stock - scan or type to add"}
            </div>
            {available.slice(0, 60).map((sn) => (
              <button
                key={sn}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(sn)}
                className="block w-full px-3 py-1.5 text-left font-mono text-sm text-gray-800 hover:bg-blue-50"
              >
                {sn}
              </button>
            ))}
            {available.length > 60 && <div className="px-3 py-1 text-xs text-gray-400">Type to narrow down {available.length - 60} more...</div>}
          </div>
        )}
        </div>
        <button type="button" title="Add" onClick={() => submitDraft(rowIndex, "MANUAL")} className={`flex shrink-0 items-center gap-1 rounded-lg bg-gray-900 font-semibold text-white hover:bg-black ${mobile ? "h-9 px-2.5 text-xs" : "h-9 px-3 text-xs"}`}>
          <Plus size={14} />Add
        </button>
        <button type="button" onClick={() => openCamera(rowIndex)} className={`flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700 ${mobile ? "h-9 px-2.5 text-xs" : "h-9 px-3 text-xs"}`}>
          <Camera size={14} />Scan
        </button>
      </div>
    );
  };

  /** Full-width table row right under the item: every serial no. entered / scanned, side by side (no numbering). */
  const listRow = (item, rowIndex, colSpan) => {
    const row = rows[rowIndex];
    if (!row) return null;
    const slots = rowSlots(row).filter((s) => cleanSerialInput(s.serialNo));
    if (!slots.length) return null;
    const dupCount = (text) => lines.reduce((n, l) => n + (values[l.key] || []).filter((x) => cleanSerialInput(x.serialNo).toLowerCase() === text).length, 0);
    return (
      <tr className={`border-b last:border-0 ${selected === rowIndex ? "bg-gray-100" : ""}`}>
        <td colSpan={colSpan} className="px-2 pb-4 pt-2 sm:px-3 sm:pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {slots.map((s, i) => {
              const dup = dupCount(cleanSerialInput(s.serialNo).toLowerCase()) > 1;
              return (
                <span key={`${s.serialNo}-${i}`} title={SOURCE_LABEL[s.source] || "typed"} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs sm:px-2 sm:py-1 ${dup ? "border-red-300 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                  {s.serialNo}
                  {!disabled && <button type="button" title="Remove" onClick={() => removeSerial(row, i)} className="text-blue-400 hover:text-red-500"><X size={13} /></button>}
                </span>
              );
            })}
          </div>
        </td>
      </tr>
    );
  };

  /** Mobile only: full-width row under the item (2nd row): SR. No input + Add + Scan. The entered serials
   *  show in the next row (3rd row) via listRow. */
  const mobileInputRow = (item, rowIndex, colSpan) => {
    if (!rows[rowIndex]) return null;
    const hasChips = rowSlots(rows[rowIndex]).some((s) => cleanSerialInput(s.serialNo));
    return (
      <tr className={`sm:hidden ${hasChips ? "" : "border-b last:border-0"} ${selected === rowIndex ? "bg-gray-100" : ""}`}>
        <td colSpan={colSpan} className="px-2 pb-3 pt-1">{inputCell(item, rowIndex, true)}</td>
      </tr>
    );
  };

  const badge = total > 0 && (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${allDone ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
      {allDone && <CheckCircle2 size={13} />}Serial no. {filled} / {total}
    </span>
  );

  const camera = cameraOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3">
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Scan serial number</h3>
            <p className="text-xs text-gray-500">{selectedRowInfo ? `${items[selected]?.sku || "Item"}: ${rowFilled(selectedRowInfo)} / ${selectedRowInfo.quantity} added` : `${filled} / ${total} added`}</p>
          </div>
          <button type="button" onClick={() => setCameraOpen(false)} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"><X size={16} /></button>
        </div>
        {/* Clear picture, nothing dims it. Tap the picture to focus. */}
        <div onClick={refocus} className="relative h-64 w-full overflow-hidden rounded-lg bg-black sm:h-72">
          <div ref={readerRef} className="h-full w-full" />
          {/* Scan rectangle: fit the barcode inside the corners */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[42%] w-[92%] drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
              <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-md border-l-4 border-t-4 border-white" />
              <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-md border-r-4 border-t-4 border-white" />
              <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-white" />
              <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-md border-b-4 border-r-4 border-white" />
            </div>
          </div>
        </div>
        {camTools.zoom && (
          <div className="mt-3 flex items-center gap-2">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom(camTools.zoomValue - 0.5)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-700"><Minus size={16} /></button>
            <input
              type="range"
              aria-label="Zoom"
              min={camTools.zoom.min}
              max={camTools.zoom.max}
              step={camTools.zoom.step}
              value={camTools.zoomValue}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="min-w-0 flex-1"
            />
            <button type="button" aria-label="Zoom in" onClick={() => setZoom(camTools.zoomValue + 0.5)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-700"><Plus size={16} /></button>
            <span className="w-10 shrink-0 text-right text-xs font-semibold text-gray-600">{camTools.zoomValue.toFixed(1)}x</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleTorch} className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ${camTools.torchOn ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-300 bg-white text-gray-700"}`}>
            {camTools.torchOn ? <Zap size={16} /> : <ZapOff size={16} />}Flash {camTools.torchOn ? "ON" : "OFF"}
          </button>
        </div>
        {camInfo && <p className="mt-2 text-center text-[11px] text-gray-400">{camInfo.video} · {camInfo.reader} · checked {camInfo.frames} frames</p>}
        {camNote && <p className={`mt-3 break-all rounded-lg px-3 py-2 text-center text-sm font-semibold ${camNote.ok ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>{camNote.text}</p>}
        <p className="mt-3 min-h-5 text-center text-sm font-medium text-green-700">{lastScan ? `Last scanned: ${lastScan}` : "Put the barcode inside the frame (use zoom if you have to stay back so it stays sharp). Keep it flat and well lit; switch Flash on if it is dark."}</p>
        <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={scanPhoto} />
        <button type="button" onClick={() => photoInputRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <ImagePlus size={16} />Can't scan? Take a photo of the barcode
        </button>
        <button type="button" onClick={() => setCameraOpen(false)} className="mt-3 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-black">Done</button>
      </div>
    </div>
  );

  /** Props for the item's main <tr>: tap the row to make it the item that scanners write to. */
  const rowProps = (rowIndex) => ({
    onClick: () => { if (rows[rowIndex]) selectRow(rowIndex); },
    className: rows[rowIndex] ? `cursor-pointer ${selected === rowIndex ? "bg-gray-100 [&>td:first-child]:shadow-[inset_4px_0_0_#111827]" : "hover:bg-gray-50"}` : "",
    "aria-selected": selected === rowIndex,
  });

  return { inputCell, mobileInputRow, listRow, rowProps, badge, camera, selected, hasSerials: lines.length > 0 };
}
