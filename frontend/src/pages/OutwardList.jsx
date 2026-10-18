import FilterSelect from "../components/FilterSelect";
import useSummaryEntries from "../features/shared/useSummaryEntries";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Search,
  CalendarDays,
  ChevronRight,
  Truck,
  Clock3,
  FileWarning,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { selectSelectedWarehouse } from "../features/warehouse/warehouseSlice";
import { getWarehousePermissions } from "../features/warehouse/warehousePermissions";
import {
  fetchOutwardList,
  fetchOutwardHistory,
  selectOutwardList,
  selectOutwardListStatus,
  selectOutwardListError,
  selectOutwardListPagination,
  selectOutwardHistory,
  selectOutwardHistoryStatus,
} from "../features/outward/outwardSlice";
import { formatOutwardEntry, getStatusStyle, formatMoney } from "../features/outward/outwardHelpers";
import HistoryPanel from "../features/shared/HistoryPanel";

const filters = ["All types", "Sales", "Service", "Replacement", "Damage/Scrap"];

// Maps the filter chips to the exact outwardType value the backend expects
// (?type=...), so filtering happens in the database query instead of after
// downloading every row.
const FILTER_TO_OUTWARD_TYPE = {
  Sales: "Sale - Stock Out",
  Service: "Service - Stock Out",
  Replacement: "Replacement",
  "Damage/Scrap": "Damage / Scrap Out",
};

// How long to wait after the user stops typing before hitting the API.
const SEARCH_DEBOUNCE_MS = 350;

// -------------------------------------------------
// Date range helpers (local calendar filter)
// -------------------------------------------------

// yyyy-mm-dd in LOCAL time (avoids the UTC day-shift
// you get from toISOString() near midnight).
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

  if (!from && !to) return "Select dates";
  if (from === to) return formatShortDate(from);
  return `${formatShortDate(from)} \u2013 ${formatShortDate(to)}`;
}

// Workflow status of an entry, step by step:
// Pending approval -> Awaiting transportation -> Awaiting acc. documents -> Ready for dispatch -> Dispatched.
function WorkflowBadge({ item }) {
  const style = getStatusStyle(item);
  if (!style) return null;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.cls}`}>
      {style.label}
    </span>
  );
}

// Status chips per role (value = ?status= sent to the API).
const STATUS_FILTERS_FULL = [
  { value: "", label: "All status" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "TRANSPORT_PENDING", label: "Awaiting transportation" },
  { value: "DOCS_PENDING", label: "Awaiting acc. documents" },
  { value: "READY_FOR_DISPATCH", label: "Ready for dispatch" },
  { value: "DISPATCHED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "REJECTED", label: "Rejected" },
];
const STATUS_FILTERS_WAREHOUSE = [
  { value: "", label: "All status" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "TRANSPORT_PENDING", label: "Awaiting transportation" },
  { value: "DOCS_PENDING", label: "Awaiting acc. documents" },
  { value: "READY_FOR_DISPATCH", label: "Ready for dispatch" },
  { value: "DISPATCHED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
];

const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function DateRangeFilter({ preset, from, to, onPresetSelect, onCustomApply }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  // Keep the draft inputs in sync whenever the applied
  // range changes from outside (e.g. a preset click).
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  const PANEL_WIDTH = 256; // matches w-64
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

  // Close on outside click, and reposition/close on scroll or
  // resize so the panel never drifts away from the button.
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
        className={`flex w-full min-w-0 items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition sm:w-auto sm:justify-start sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs ${
          open || preset === "custom"
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        }`}
      >
        <CalendarDays size={13} className="shrink-0" />
        {formatDateRangeLabel({ preset, from, to })}
        <ChevronDown size={12} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
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
                    preset === item.value
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
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

export default function Outward() {
  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
  })();
  const warehousePermissions = getWarehousePermissions(currentUser, selectedWarehouse);
  const role = currentUser?.role;
  const isWarehouseRole = role === "WAREHOUSE_MANAGER";
  // Warehouse managers see only the warehouse they've switched to in the
  // navbar. Other roles keep the scope the backend already gives them.
  const scopedWarehouseId = isWarehouseRole ? selectedWarehouse?.id : undefined;
  // Don't fire an unscoped request (all warehouses) before the navbar has
  // loaded the manager's warehouse.
  const waitingForWarehouse = isWarehouseRole && !scopedWarehouseId;
  // Sales (and the super admin) create outward entries; Account approves; the warehouse dispatches.
  const canCreate = role === "SALES" || (role === "SUPER_ADMIN" && warehousePermissions.canOutward);
  const showCost = !isWarehouseRole;
  const statusFilters = isWarehouseRole ? STATUS_FILTERS_WAREHOUSE : STATUS_FILTERS_FULL;
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const rawList = useSelector(selectOutwardList);
  const listStatus = useSelector(selectOutwardListStatus);
  const listError = useSelector(selectOutwardListError);
  const history = useSelector(selectOutwardHistory);
  const historyStatus = useSelector(selectOutwardHistoryStatus);
  const pagination = useSelector(selectOutwardListPagination);
  const loading = listStatus === "loading";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All types");
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  // Date range filter - defaults to the last 7 days.
  const [datePreset, setDatePreset] = useState("all");
  const [dateRange, setDateRange] = useState(() => getPresetRange("all"));
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change starts back at page 1.
  useEffect(() => {
    setPage(1);
  }, [scopedWarehouseId, debouncedSearch, activeFilter, statusFilter, datePreset, dateRange.from, dateRange.to]);

  const handleDatePresetSelect = (preset) => {
    setDatePreset(preset);
    setDateRange(getPresetRange(preset));
  };

  const handleDateCustomApply = (from, to) => {
    setDatePreset("custom");
    setDateRange({ from, to });
  };

  const queryParams = useMemo(
    () => ({
      warehouseId: scopedWarehouseId,
      search: debouncedSearch || undefined,
      type: FILTER_TO_OUTWARD_TYPE[activeFilter],
      status: statusFilter || undefined,
      dateFrom: datePreset !== "all" ? dateRange.from || undefined : undefined,
      dateTo: datePreset !== "all" ? dateRange.to || undefined : undefined,
      page,
      pageSize: 20,
    }),
    [scopedWarehouseId, debouncedSearch, activeFilter, statusFilter, datePreset, dateRange.from, dateRange.to, page]
  );

  useEffect(() => {
    if (waitingForWarehouse) return;
    dispatch(fetchOutwardList(queryParams));
  }, [dispatch, queryParams, waitingForWarehouse]);

  // Activity history date range (set by the date filter inside the history panel; starts as "Today").
  const [historyRange, setHistoryRange] = useState(null);
  useEffect(() => {
    if (waitingForWarehouse || !historyRange) return;
    dispatch(fetchOutwardHistory({ warehouseId: scopedWarehouseId, from: historyRange.from, to: historyRange.to, pageSize: 100 }));
  }, [dispatch, scopedWarehouseId, waitingForWarehouse, historyRange]);

  const outwardData = useMemo(() => rawList.map(formatOutwardEntry), [rawList]);

  // KPI cards use the unfiltered entries, so searching only changes the list below.
  const summary = useSummaryEntries("/api/outward", scopedWarehouseId, waitingForWarehouse);

  // Search / type / date are now applied server-side (see queryParams above).
  // "Pending docs" only filters within the page currently on screen.
  const filteredData = outwardData.filter((item) =>
    showPendingOnly && isWarehouseRole ? item.statusType !== "complete" : true
  );

  const groupedData = filteredData.reduce((groups, item) => {
    if (!groups[item.date]) groups[item.date] = [];
    groups[item.date].push(item);
    return groups;
  }, {});

  const totalEntries = summary.data?.total ?? 0;
  const documentsPending = summary.data?.documentsPending ?? 0;
  const awaitingApproval = summary.data?.pendingApproval ?? 0;
  // Approved but not dispatched yet = every step between approval and dispatch.
  const awaitingDispatch = summary.data?.awaitingDispatch ?? 0;
  const dispatchedCount = summary.data?.dispatched ?? 0;

  const goToPage = (next) => {
    const clamped = Math.min(Math.max(next, 1), pagination.totalPages || 1);
    setPage(clamped);
  };

  const openOutward = (item) => {
    if (!item.id) {
      alert("Outward ID is missing");
      return;
    }
    // Every entry opens its details page. For the warehouse manager and the super admin that page is the hub of the
    // three forms (Transportation -> Dispatch -> Receiving); the super admin lands on the dispatch form directly
    // once it is open (see OutwardDetail).
    navigate(`/outward/${item.id}`);
  };

  return (
    <div className="min-h-dvh bg-[#F1EFE8]">
      <main className="mx-auto max-w-[1200px] px-3 py-4 pb-24 sm:px-6 sm:py-5 lg:px-8">
        <div className="mb-4 flex items-center justify-between sm:mb-5">
          <div>
            <h1 className="text-lg font-bold text-gray-900 sm:text-2xl">Outward entries</h1>
            <p className="mt-0.5 text-[11px] text-gray-500 sm:mt-1 sm:text-sm">
              {role === "ACCOUNT"
                ? "Review the payment details and approve outgoing stock"
                : isWarehouseRole
                ? "Entries from approval to dispatch"
                : "View and manage all outgoing stock"}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <HistoryPanel entries={history} status={historyStatus} onRangeChange={setHistoryRange} />

            {!canCreate ? null : (
              <Link
                to="/outward/create"
                className="flex items-center gap-1 rounded-lg bg-[#185FA5] px-2.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#124c88] sm:gap-1.5 sm:px-4 sm:py-2.5 sm:text-sm"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New outward</span>
                <span className="sm:hidden">New</span>
              </Link>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-5 sm:grid-cols-4 sm:gap-3">
          <SummaryCard title="Total entries" value={!summary.ready ? "—" : totalEntries} icon={Truck} />
          {isWarehouseRole ? (
            <>
              <SummaryCard title="Pending dispatch" value={!summary.ready ? "—" : awaitingDispatch} icon={Clock3} />
              <SummaryCard title="Documents pending" value={!summary.ready ? "—" : documentsPending} icon={FileWarning} danger />
              <SummaryCard title="Dispatched" value={!summary.ready ? "—" : dispatchedCount} icon={CheckCircle2} />
            </>
          ) : (
            <>
              <SummaryCard title="Pending approval" value={!summary.ready ? "—" : awaitingApproval} icon={Clock3} danger={awaitingApproval > 0} />
              <SummaryCard title="Pending dispatch" value={!summary.ready ? "—" : awaitingDispatch} icon={FileWarning} />
              <SummaryCard title="Dispatched" value={!summary.ready ? "—" : dispatchedCount} icon={CheckCircle2} />
            </>
          )}
        </div>

        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-2.5 sm:mb-5 sm:p-4">
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search MIN no., DC no., invoice, customer, model or serial no."
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:py-2.5 sm:pl-9 sm:text-sm"
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
            <DateRangeFilter
              preset={datePreset}
              from={dateRange.from}
              to={dateRange.to}
              onPresetSelect={handleDatePresetSelect}
              onCustomApply={handleDateCustomApply}
            />

            <FilterSelect ariaLabel="Type" value={activeFilter} onChange={setActiveFilter} options={filters.map((f) => ({ value: f, label: f }))} />
            <FilterSelect ariaLabel="Status" value={statusFilter} onChange={setStatusFilter} options={statusFilters} />
          </div>

        </div>

        {loading && rawList.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center">
            <p className="text-sm text-gray-500">Loading outward entries...</p>
          </div>
        )}

        {!loading && listError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-medium text-red-600">{listError}</p>
            <button
              type="button"
              onClick={() => dispatch(fetchOutwardList({ ...queryParams, force: true }))}
              className="mt-3 rounded-lg bg-[#185FA5] px-4 py-2 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        )}

        {(!loading || rawList.length > 0) && !listError && (
          <div className={`hidden overflow-hidden rounded-2xl border border-gray-200 bg-white transition-opacity md:block ${loading ? "opacity-60" : ""}`}>
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Outward history</h2>
              <p className="mt-0.5 text-xs text-gray-500">{pagination.total} entries found</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">w-id</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Outward type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Customer</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quantity</th>
                    {showCost && <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">PI amount</th>}
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date & time</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {filteredData.map((item) => (
                    <tr key={item.id} onClick={() => openOutward(item)} className="cursor-pointer transition hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-gray-900">{item.outward}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs text-gray-700">{item.type}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-medium text-gray-800">{item.party}</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm font-semibold text-gray-800">{item.quantity}</span>
                        <span className="ml-1 text-[11px] text-gray-400">pcs</span>
                      </td>
                      {showCost && (
                        <td className="px-5 py-4">
                          <span className="text-sm font-medium text-gray-800">{formatMoney(item.piAmount)}</span>
                        </td>
                      )}
                      <td className="px-5 py-4">
                        <p className="text-xs text-gray-700">{item.date}</p>
                        <p className="text-[11px] text-gray-400">{item.time}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-start gap-1">
                          <WorkflowBadge item={item} />
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <ChevronRight size={17} className="text-gray-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredData.length === 0 && (
              <div className="p-10 text-center">
                <Truck size={30} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm font-medium text-gray-700">No outward entries found</p>
                <p className="mt-1 text-xs text-gray-400">Try changing your search or filters.</p>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">
                Showing{" "}
                {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}
                –{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  Previous
                </button>

                {Array.from({ length: pagination.totalPages || 1 }, (_, i) => i + 1)
                  .filter(
                    (n) =>
                      n === 1 ||
                      n === pagination.totalPages ||
                      Math.abs(n - pagination.page) <= 1
                  )
                  .reduce((acc, n) => {
                    if (acc.length && n - acc[acc.length - 1] > 1) acc.push("…");
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((n, i) =>
                    n === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-xs text-gray-400">
                        …
                      </span>
                    ) : (
                      <button
                        key={n}
                        type="button"
                        onClick={() => goToPage(n)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          n === pagination.page
                            ? "bg-[#185FA5] text-white"
                            : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {n}
                      </button>
                    )
                  )}

                <button
                  type="button"
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={pagination.page >= (pagination.totalPages || 1)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {(!loading || rawList.length > 0) && !listError && (
          <div className={`space-y-4 transition-opacity md:hidden ${loading ? "opacity-60" : ""}`}>
            {Object.entries(groupedData).map(([date, items]) => (
              <section key={date}>
                <div className="mb-1.5 px-1">
                  <p className="text-[11px] font-medium text-gray-500">{date}</p>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {items.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openOutward(item)}
                      className={`flex w-full items-center gap-2.5 px-3 py-3 text-left transition active:bg-gray-50 ${
                        index !== items.length - 1 ? "border-b border-gray-200" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-gray-900">{item.outward}</p>
                          <WorkflowBadge item={item} />
                        </div>

                        <p className="mt-1 truncate text-xs text-gray-700">
                          {item.type} · {item.party}
                        </p>

                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-gray-400">
                          <span>{item.time}</span>
                          <span>·</span>
                          <span>{item.quantity} pcs</span>
                          {showCost && (
                            <>
                              <span>·</span>
                              <span>{formatMoney(item.piAmount)}</span>
                            </>
                          )}
                          {item.serials > 0 && (
                            <>
                              <span>·</span>
                              <span>{item.serials} serials</span>
                            </>
                          )}
                        </div>
                      </div>

                      <ChevronRight size={17} className="shrink-0 text-gray-400" />
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {filteredData.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                <Truck size={30} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm font-medium text-gray-700">No outward entries found</p>
                <p className="mt-1 text-xs text-gray-400">Try changing your search or filters.</p>
              </div>
            )}
          </div>
        )}
      </main>

     
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, danger = false }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5 sm:p-4">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[10px] font-medium text-gray-500 sm:text-xs">{title}</p>
        <Icon size={15} className={`shrink-0 ${danger ? "text-red-500" : "text-blue-500"}`} />
      </div>
      <p className={`mt-1.5 text-lg font-bold sm:mt-2 sm:text-xl ${danger ? "text-red-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}



