import { useEffect, useRef, useState } from "react";
import { CalendarDays, History as HistoryIcon, Loader2, X } from "lucide-react";
import { formatDateTime } from "./formatters";

// Small badge shown per entry - color-coded by action so the panel
// is scannable at a glance (created vs. edited vs. removed).
const ACTION_STYLES = {
  CREATED: "bg-green-100 text-green-700",
  UPDATED: "bg-blue-100 text-blue-700",
  ITEM_ADDED: "bg-green-100 text-green-700",
  ITEM_UPDATED: "bg-blue-100 text-blue-700",
  ITEM_REMOVED: "bg-red-100 text-red-700",
  DOCUMENT_ADDED: "bg-green-100 text-green-700",
  INVOICE_CREATED: "bg-sky-100 text-sky-700",
  DOCUMENT_REMOVED: "bg-red-100 text-red-700",
  DELETED: "bg-red-100 text-red-700",
  SUBMITTED: "bg-amber-100 text-amber-700",
  RESUBMITTED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  ON_HOLD: "bg-purple-100 text-purple-700",
  COST_UPDATED: "bg-blue-100 text-blue-700",
  DISPATCHED: "bg-green-100 text-green-700",
  RECEIVED: "bg-green-100 text-green-700",
};

const ACTION_LABELS = {
  CREATED: "Created",
  UPDATED: "Updated",
  ITEM_ADDED: "Item added",
  ITEM_UPDATED: "Item updated",
  ITEM_REMOVED: "Item removed",
  DOCUMENT_ADDED: "Document added",
  INVOICE_CREATED: "Invoice created",
  DOCUMENT_REMOVED: "Document removed",
  DELETED: "Deleted",
  SUBMITTED: "Submitted",
  RESUBMITTED: "Resubmitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ON_HOLD: "On hold",
  COST_UPDATED: "Cost updated",
  DISPATCHED: "Dispatched",
  RECEIVED: "Delivered",
};

// An entry carries an explicit "before / after" only when its
// `changes` payload actually has an oldValue/newValue pair - a field
// edit (UPDATED) or a quantity change (ITEM_UPDATED). CREATED,
// ITEM_ADDED/REMOVED and DOCUMENT_ADDED/REMOVED don't have a
// meaningful "before", so they just show the message.
function hasBeforeAfter(changes) {
  return (
    changes &&
    typeof changes === "object" &&
    (changes.oldValue !== undefined || changes.newValue !== undefined)
  );
}

function BeforeAfter({ changes }) {
  const label = changes.label || changes.field || (changes.item ? `${changes.item} quantity` : "Value");
  const before = changes.oldValue;
  const after = changes.newValue;
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
      <p className="mb-1 font-medium text-gray-500">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-400">
          {before === null || before === undefined || before === "" ? "—" : String(before)}
        </span>
        <span className="text-gray-400">→</span>
        <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-700">
          {after === null || after === undefined || after === "" ? "—" : String(after)}
        </span>
      </div>
    </div>
  );
}

// Local-day boundaries (the server may be in another time zone) as ISO timestamps.
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const dayEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const toInputValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInputValue = (v) => {
  const [y, m, d] = String(v).split("-").map(Number);
  return new Date(y, m - 1, d);
};

function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  if (preset === "yesterday") {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { from: dayStart(y).toISOString(), to: dayEnd(y).toISOString() };
  }
  if (preset === "custom") {
    // A single date is enough: "to" falls back to "from" (and the other way round).
    const f = customFrom || customTo;
    const t = customTo || customFrom;
    if (!f) return { from: dayStart(now).toISOString(), to: dayEnd(now).toISOString() };
    const a = fromInputValue(f);
    const b = fromInputValue(t);
    const [start, end] = a <= b ? [a, b] : [b, a];
    return { from: dayStart(start).toISOString(), to: dayEnd(end).toISOString() };
  }
  return { from: dayStart(now).toISOString(), to: dayEnd(now).toISOString() };
}

/**
 * Activity history panel: a clock-icon button that opens a dropdown
 * listing the audit trail across ALL inward/outward entries the user
 * can see (newest first). Each row shows the GRN/MIN number, the
 * action, the message, and - when the entry is an edit - an explicit
 * before → after block.
 *
 * Used identically by InwardList and OutwardList - both just pass the
 * feed their slice already fetched.
 */
export default function HistoryPanel({ entries = [], status = "idle", onRangeChange }) {
  const [open, setOpen] = useState(false);
  // Date filter: Today (default) / Yesterday / a date or date range picked from the calendar.
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    if (onRangeChange) onRangeChange(rangeFor(preset, customFrom, customTo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo]);

  const today = toInputValue(new Date());
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const loading = status === "loading";

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[11px] font-medium text-gray-700 hover:bg-gray-50 sm:px-3 sm:text-xs"
      >
        <HistoryIcon size={14} />
        <span className="hidden sm:inline">Activity history</span>
        <span className="sm:hidden">History</span>
      </button>

      {open && (
        <div className="fixed inset-x-3 top-20 z-40 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:z-30 sm:mt-2 sm:w-[26rem]">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Activity history</p>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700">
              <X size={16} />
            </button>
          </div>

          {/* Date filter */}
          <div className="border-b bg-gray-50 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                ["today", "Today"],
                ["yesterday", "Yesterday"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreset(key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    preset === key ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset("custom")}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                  preset === "custom" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                <CalendarDays size={12} /> Pick date
              </button>
            </div>

            {preset === "custom" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] font-medium text-gray-500">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || today}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="text-[11px] font-medium text-gray-500">
                  To
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    max={today}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto sm:max-h-[26rem]">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Loading history...
              </div>
            )}

            {!loading && entries.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-500">No activity recorded for this date.</div>
            )}

            {!loading && entries.length > 0 && (
              <ul className="divide-y">
                {entries.map((entry) => {
                  const { date, time } = formatDateTime(entry.createdAt);
                  return (
                    <li key={entry.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{entry.entityNumber || "—"}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {date} · {time}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            ACTION_STYLES[entry.action] || "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {ACTION_LABELS[entry.action] || entry.action}
                        </span>
                        <span className="text-[11px] text-gray-500">{entry.user?.name || "Someone"}</span>
                      </div>

                      <p className="mt-1.5 text-sm text-gray-800">{entry.description}</p>

                      {hasBeforeAfter(entry.changes) && <BeforeAfter changes={entry.changes} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
