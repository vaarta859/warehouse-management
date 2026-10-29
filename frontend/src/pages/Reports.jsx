import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileWarning,
  PackageMinus,
  PackagePlus,
  Repeat,
  Warehouse,
} from "lucide-react";

import { selectSelectedWarehouse } from "../features/warehouse/warehouseSlice";
import {
  fetchReportSummary,
  fetchReportLedger,
  selectReportSummary,
  selectReportSummaryStatus,
  selectReportSummaryError,
  selectReportLedger,
  selectReportLedgerStatus,
} from "../features/reports/reportSlice";

// -------------------------------------------------
// Date range helpers (same convention as InwardList /
// OutwardList's local calendar filter)
// -------------------------------------------------

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getPresetRange(preset) {
  const to = new Date();

  if (preset === "today") {
    return { from: toDateInputValue(to), to: toDateInputValue(to) };
  }
  if (preset === "7d") {
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return { from: toDateInputValue(from), to: toDateInputValue(to) };
  }
  if (preset === "30d") {
    const from = new Date();
    from.setDate(from.getDate() - 29);
    return { from: toDateInputValue(from), to: toDateInputValue(to) };
  }
  if (preset === "90d") {
    const from = new Date();
    from.setDate(from.getDate() - 89);
    return { from: toDateInputValue(from), to: toDateInputValue(to) };
  }

  // "all"
  return { from: "", to: "" };
}

function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatDateRangeLabel({ preset, from, to }) {
  if (preset === "all") return "All time";
  if (preset === "today") return "Today";
  if (preset === "7d") return "Last 7 days";
  if (preset === "30d") return "Last 30 days";
  if (preset === "90d") return "Last 90 days";

  if (!from && !to) return "Select dates";
  if (from === to) return formatShortDate(from);
  return `${formatShortDate(from)} \u2013 ${formatShortDate(to)}`;
}

const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

// Same portal-positioned dropdown pattern used on the Inward /
// Outward list pages, so the date filter behaves identically
// everywhere in the app.
function DateRangeFilter({ preset, from, to, onPresetSelect, onCustomApply }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  const PANEL_WIDTH = 256;
  const VIEWPORT_MARGIN = 8;

  const openPanel = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
      setCoords({ top: rect.bottom + 8, left });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function handleClose() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open]);

  const handlePreset = (value) => {
    onPresetSelect(value);
    setOpen(false);
  };

  const handleApply = () => {
    if (!draftFrom || !draftTo) return;
    onCustomApply(draftFrom, draftTo);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-medium shadow-sm transition ${
          open || preset === "custom"
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-200 text-gray-700 hover:bg-gray-50"
        }`}
      >
        <CalendarDays size={14} className="shrink-0" />
        {formatDateRangeLabel({ preset, from, to })}
        <ChevronDown size={13} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-50 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
          >
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Quick select
            </p>
            <div className="mb-3 flex flex-col gap-1">
              {DATE_PRESETS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handlePreset(item.value)}
                  className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
                    preset === item.value ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Custom range
            </p>
            <div className="flex items-center gap-2 px-1">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-semibold text-black">From</label>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || undefined}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-semibold text-black">To</label>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleApply}
              disabled={!draftFrom || !draftTo}
              className="mt-3 w-full rounded-lg bg-[#185FA5] py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

// -------------------------------------------------
// Small building blocks
// -------------------------------------------------

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

// { Pcs: 120, Meters: 500 } -> "120 Pcs · 500 Meters": quantities are shown with their unit of measure, never as "units".
function formatByUom(byUom, fallback = 0) {
  const entries = Object.entries(byUom || {}).filter(([, qty]) => Number(qty) !== 0);
  if (!entries.length) return formatNumber(fallback);
  return entries.map(([uom, qty]) => `${formatNumber(qty)} ${uom}`).join(" · ");
}

function StatCard({ icon: Icon, iconClass, label, value, note, full }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${full ? "col-span-2" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <Icon size={17} className={iconClass} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      {note && <p className="mt-1 text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}

function TypeBadge({ type }) {
  const isIn = type === "in";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        isIn ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
      }`}
    >
      {isIn ? "Inward" : "Outward"}
    </span>
  );
}

// -------------------------------------------------
// Reports page
// -------------------------------------------------

export default function Reports() {
  const dispatch = useDispatch();

  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const user = useSelector((state) => state.auth.user);

  const summary = useSelector(selectReportSummary);
  const summaryStatus = useSelector(selectReportSummaryStatus);
  const summaryError = useSelector(selectReportSummaryError);

  const ledger = useSelector(selectReportLedger);
  const ledgerStatus = useSelector(selectReportLedgerStatus);

  // Warehouse managers only ever see their own warehouse; admins see
  // every warehouse combined unless they've switched the navbar to a
  // specific one (same rule Dashboard.jsx uses).
  const scopedWarehouseId =
    user?.role === "WAREHOUSE_MANAGER" ? selectedWarehouse?.id : undefined;

  const [datePreset, setDatePreset] = useState("30d");
  const [dateRange, setDateRange] = useState(() => getPresetRange("30d"));

  const handleDatePresetSelect = (preset) => {
    setDatePreset(preset);
    setDateRange(getPresetRange(preset));
  };

  const handleDateCustomApply = (from, to) => {
    setDatePreset("custom");
    setDateRange({ from, to });
  };

  useEffect(() => {
    const params = { warehouseId: scopedWarehouseId, dateFrom: dateRange.from, dateTo: dateRange.to };
    dispatch(fetchReportSummary(params));
    dispatch(fetchReportLedger({ ...params, limit: 8 }));
  }, [dispatch, scopedWarehouseId, dateRange.from, dateRange.to]);

  const loadingSummary = summaryStatus === "loading";
  const loadingLedger = ledgerStatus === "loading";

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Reports</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:mt-1 sm:text-sm">{scopedWarehouseId ? selectedWarehouse?.name : "All warehouses"}</p>
        </div>

        <DateRangeFilter
          preset={datePreset}
          from={dateRange.from}
          to={dateRange.to}
          onPresetSelect={handleDatePresetSelect}
          onCustomApply={handleDateCustomApply}
        />
      </div>

      <div className="mx-auto max-w-5xl">
        {/* =================================================
            STOCK LEDGER ENTRY
        ================================================= */}

        <Link
          to="/stock-ledger"
          className="mb-6 flex items-center gap-3.5 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
            <ClipboardList size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Stock Ledger Summary</h3>
            <p className="text-xs text-gray-500">View stock levels, inwards and outwards with detailed ledger.</p>
          </div>
          <ChevronRight size={17} className="shrink-0 text-amber-500" />
        </Link>

        {/* =================================================
            QUICK SUMMARY
        ================================================= */}

        {summaryStatus === "failed" && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-600">{summaryError}</p>
            <button
              type="button"
              onClick={() => dispatch(fetchReportSummary({ warehouseId: scopedWarehouseId, dateFrom: dateRange.from, dateTo: dateRange.to }))}
              className="mt-3 rounded-lg bg-[#185FA5] px-4 py-2 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        )}

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Quick summary</p>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4">
          <StatCard
            full
            icon={Warehouse}
            iconClass="text-purple-600"
            label="Total Stock"
            value={loadingSummary ? "—" : formatByUom(summary?.stockByUom, summary?.totalStock)}
            note="on hand"
          />

          <StatCard
            icon={Repeat}
            iconClass="text-blue-600"
            label="Total Transactions"
            value={loadingSummary ? "—" : formatNumber(summary?.totalTransactions)}
            note="in this period"
          />
          <StatCard
            icon={PackagePlus}
            iconClass="text-green-600"
            label="Total Inwards"
            value={loadingSummary ? "—" : formatByUom(summary?.inwardByUom, summary?.totalInwardUnits)}
            note="received"
          />

          <StatCard
            icon={PackageMinus}
            iconClass="text-amber-600"
            label="Total Outwards"
            value={loadingSummary ? "—" : formatByUom(summary?.outwardByUom, summary?.totalOutwardUnits)}
            note="issued"
          />
          <StatCard
            icon={FileWarning}
            iconClass="text-pink-600"
            label="Documents Pending"
            value={loadingSummary ? "—" : formatNumber(summary?.documentsPending)}
            note={
              loadingSummary
                ? undefined
                : `${formatNumber(summary?.pendingGrnCount)} GRNs, ${formatNumber(summary?.pendingOutwardCount)} delivery challans`
            }
          />
        </div>

        {/* =================================================
            RECENT LEDGER ENTRIES
        ================================================= */}

        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Recent ledger entries</p>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">Latest Transactions</h3>
            <Link to="/inward" className="text-xs font-semibold text-[#185FA5] hover:underline">
              Open full ledger
            </Link>
          </div>

          {loadingLedger && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-500">Loading recent transactions...</p>
            </div>
          )}

          {!loadingLedger && ledger.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-gray-500">No transactions in this period.</p>
            </div>
          )}

          {!loadingLedger && ledger.length > 0 && (
            <div className="overflow-x-auto">
              <table className="mobile-cards w-full min-w-[560px] text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reference</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Item</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ledger.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3.5 text-xs text-gray-700">
                        {new Date(row.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-medium text-gray-800">{row.ref}</td>
                      <td className="px-5 py-3.5 text-xs text-gray-700">
                        {Array.isArray(row.items) && row.items.length > 0 ? (
                          <div className="space-y-1">
                            {row.items.slice(0, 2).map((it, idx) => (
                              <div key={idx}>
                                <span className="font-semibold text-gray-900">{it.category || "Item"}</span>
                                {it.sku && <span className="text-gray-600"> · {it.sku}</span>}
                              </div>
                            ))}
                            {row.items.length > 2 && (
                              <span className="text-[11px] text-gray-400">+{row.items.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          row.item
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <TypeBadge type={row.type} />
                      </td>
                      <td
                        className={`px-5 py-3.5 text-right text-sm font-semibold tabular-nums ${
                          row.type === "in" ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {row.type === "in" ? "+" : "-"}
                        {formatNumber(row.qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
