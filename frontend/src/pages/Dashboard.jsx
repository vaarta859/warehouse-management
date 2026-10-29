import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BellRing,
  ChevronRight,
  Plus,
  Warehouse,
} from "lucide-react";

import {
  fetchInwardList,
  selectInwardList,
  selectInwardListStatus,
  selectInwardListPagination,
} from "../features/inward/inwardSlice";

import {
  fetchOutwardList,
  selectOutwardList,
  selectOutwardListStatus,
  selectOutwardListPagination,
} from "../features/outward/outwardSlice";

import {
  fetchWarehouses,
  selectWarehouses,
  selectSelectedWarehouse,
} from "../features/warehouse/warehouseSlice";

import { formatGrn } from "../features/inward/inwardHelpers";
import {
  formatOutwardEntry,
  getStatusStyle,
} from "../features/outward/outwardHelpers";

// =====================================================
// PALETTE
// =====================================================

const C = {
  inward: "#10B981",
  outward: "#F59E0B",
  indigo: "#6366F1",
  sky: "#0EA5E9",
  violet: "#8B5CF6",
  rose: "#F43F5E",
  teal: "#14B8A6",
  slate: "#94A3B8",
};

// Colour per outward status label (labels come from getStatusStyle)
const STATUS_COLOR = {
  "Pending approval": "#F59E0B",
  "Pending dispatch": "#3B82F6",
  "Awaiting transportation": "#0EA5E9",
  "Awaiting acc. documents": "#6366F1",
  "Invoice created": "#38BDF8",
  "Ready for dispatch": "#14B8A6",
  Shipped: "#FB923C",
  Dispatched: "#FB923C",
  Delivered: "#10B981",
  Rejected: "#F43F5E",
  "On hold": "#8B5CF6",
};

// =====================================================
// HELPERS
// =====================================================

const dayKey = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const timeText = (value) =>
  new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const num = (n) => Number(n || 0).toLocaleString("en-IN");

// Quantities of a list of items with their unit of measure, never "units": "120 Pcs · 500 Meters".
const qtyText = (items) => {
  const byUom = new Map();
  (Array.isArray(items) ? items : []).forEach((i) => {
    const qty = Number(i.quantity) || 0;
    if (!qty) return;
    const uom = i.uom || "Pcs";
    byUom.set(uom, (byUom.get(uom) || 0) + qty);
  });
  return byUom.size ? [...byUom].map(([uom, qty]) => `${num(qty)} ${uom}`).join(" · ") : "0";
};

// =====================================================
// DASHBOARD
// =====================================================

export default function Dashboard() {
  const dispatch = useDispatch();

  const inwardRaw = useSelector(selectInwardList);
  const outwardRaw = useSelector(selectOutwardList);
  const inwardStatus = useSelector(selectInwardListStatus);
  const outwardStatus = useSelector(selectOutwardListStatus);
  const inwardPage = useSelector(selectInwardListPagination);
  const outwardPage = useSelector(selectOutwardListPagination);
  const warehouses = useSelector(selectWarehouses);
  const selectedWarehouse = useSelector(selectSelectedWarehouse);
  const user = useSelector((state) => state.auth.user);

  const role = user?.role;

  // Warehouse managers see only the warehouse they switched to in the navbar.
  const scopedWarehouseId =
    role === "WAREHOUSE_MANAGER" ? selectedWarehouse?.id : undefined;

  // ===================================================
  // FETCH DATA (newest 100 of each - enough for the dashboard)
  // ===================================================

  useEffect(() => {
    dispatch(fetchInwardList({ warehouseId: scopedWarehouseId, pageSize: 100 }));
    dispatch(fetchOutwardList({ warehouseId: scopedWarehouseId, pageSize: 100 }));
    dispatch(fetchWarehouses({ search: "" }));
  }, [dispatch, user?.companyId, role, scopedWarehouseId]);

  // ===================================================
  // PERMISSIONS
  // ===================================================

  const canInward = useMemo(() => {
    if (role === "SALES" || role === "ACCOUNT") return false;
    if (role !== "WAREHOUSE_MANAGER") return true;
    return (user?.warehouseAccess || []).some((a) =>
      typeof a.effectiveCanInward === "boolean" ? a.effectiveCanInward : !!a.canInward
    );
  }, [user, role]);

  const canOutward = useMemo(() => {
    // Only Sales and Super Admin create outward entries
    if (role === "SALES" || role === "SUPER_ADMIN") return true;
    return false;
  }, [role]);

  // ===================================================
  // DERIVED DATA
  // ===================================================

  const inward = useMemo(
    () => (inwardRaw || []).map((g, i) => formatGrn(g, i)),
    [inwardRaw]
  );
  const outward = useMemo(
    () => (outwardRaw || []).map((o, i) => formatOutwardEntry(o, i)),
    [outwardRaw]
  );

  const todayKey = dayKey(new Date());

  const kpis = useMemo(() => {
    const inToday = inward.filter((e) => dayKey(e.createdAt) === todayKey);
    const outToday = outward.filter((e) => dayKey(e.createdAt) === todayKey);
    const sum = (list) => qtyText(list.flatMap((e) => e.items || []));

    const outOpen = outward.filter((e) => {
      const label = getStatusStyle(e)?.label;
      return label !== "Delivered" && label !== "Shipped" && label !== "Dispatched";
    }).length;
    const inPending = inward.filter((e) => e.statusType === "pending").length;

    return {
      inToday: inToday.length,
      inTodayUnits: sum(inToday),
      outToday: outToday.length,
      outTodayUnits: sum(outToday),
      open: outOpen + inPending,
      outOpen,
      inPending,
    };
  }, [inward, outward, todayKey]);

  // Outward pipeline by status label
  const pipeline = useMemo(() => {
    const counts = new Map();
    outward.forEach((e) => {
      const label = getStatusStyle(e)?.label || "Other";
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([label, value], i) => ({
        label,
        value,
        color: STATUS_COLOR[label] || C.slate,
      }))
      .sort((a, b) => b.value - a.value);
  }, [outward]);

  // Recent activity (both lists merged)
  const activity = useMemo(() => {
    const a = inward.slice(0, 6).map((e) => ({
      kind: "inward",
      id: e.id,
      number: e.grnNumber,
      party: e.party,
      type: e.type,
      quantity: e.quantity,
      items: e.items,
      date: e.createdAt,
      status: e.status,
      statusType: e.statusType,
    }));
    const b = outward.slice(0, 6).map((e) => {
      const style = getStatusStyle(e);
      return {
        kind: "outward",
        id: e.id,
        number: e.outwardNumber,
        party: e.party,
        type: e.type,
        quantity: e.quantity,
        items: e.items,
        date: e.createdAt,
        status: style?.label || e.status,
        cls: style?.cls,
      };
    });
    return [...a, ...b]
      .filter((x) => x.date && !Number.isNaN(new Date(x.date).getTime()))
      .sort((x, y) => new Date(y.date) - new Date(x.date))
      .slice(0, 8);
  }, [inward, outward]);

  const loading =
    (inwardStatus === "loading" || outwardStatus === "loading") &&
    inward.length + outward.length === 0;

  const firstName = (user?.name || "").trim().split(" ")[0];
  const totalInward = inwardPage?.total ?? inward.length;
  const totalOutward = outwardPage?.total ?? outward.length;

  // ===================================================
  // RENDER
  // ===================================================

  return (
    <div className="dash-font min-h-dvh bg-[#F4F6FB] p-3 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
        {/* ---------------- HERO ---------------- */}
        <section
          className="relative overflow-hidden rounded-2xl p-5 text-slate-900 ring-1 ring-sky-200/70 sm:p-7"
          style={{
            background:
              "linear-gradient(120deg,#DBEAFE 0%,#E0F2FE 50%,#CCFBF1 100%)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-60"
            style={{ background: "radial-gradient(circle,#FFFFFF,transparent 70%)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 right-40 hidden h-56 w-56 rounded-full opacity-40 sm:block"
            style={{ background: "radial-gradient(circle,#A5F3FC,transparent 70%)" }}
          />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
                {greeting()}
                {firstName ? `, ${firstName}` : ""}
              </h1>
              <p className="mt-2 max-w-md text-sm text-slate-600">
                {loading
                  ? "Loading your latest stock movements…"
                  : `${num(totalInward)} inward and ${num(totalOutward)} outward entries on record.`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {canInward && (
                <Link
                  to="/inward/create"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <Plus size={16} /> New inward
                </Link>
              )}
              {canOutward && (
                <Link
                  to="/outward/create"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300"
                >
                  <Plus size={16} /> New outward
                </Link>
              )}
              <Link
                to="/reports"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-sky-800 ring-1 ring-sky-200 transition hover:bg-sky-50"
              >
                View reports
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------- KPI CARDS ---------------- */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
          <Kpi
            loading={loading}
            icon={Warehouse}
            label="Warehouses"
            value={warehouses.length}
            note="in your access"
            tone={{ bg: "#EEF2FF", fg: "#4F46E5", solid: "#6366F1" }}
          />
          <Kpi
            loading={loading}
            icon={ArrowDownToLine}
            label="Inward today"
            value={kpis.inToday}
            note={`${kpis.inTodayUnits} received`}
            tone={{ bg: "#ECFDF5", fg: "#047857", solid: "#10B981" }}
          />
          <Kpi
            loading={loading}
            icon={ArrowUpFromLine}
            label="Outward today"
            value={kpis.outToday}
            note={`${kpis.outTodayUnits} sent`}
            tone={{ bg: "#FFFBEB", fg: "#B45309", solid: "#F59E0B" }}
          />
          <Kpi
            loading={loading}
            icon={BellRing}
            label="Waiting for action"
            value={kpis.open}
            note={`${kpis.outOpen} outward · ${kpis.inPending} inward docs`}
            tone={{ bg: "#FFF1F2", fg: "#BE123C", solid: "#F43F5E" }}
          />
        </section>

        {/* ---------------- PIPELINE + RECENT ACTIVITY ---------------- */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-5">
          <Card title="Outward pipeline">
            <Donut data={pipeline} />
          </Card>

          <Card className="lg:col-span-2" title="Recent activity">
            {activity.length === 0 ? (
              <Empty text="No activity yet." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {activity.map((a) => (
                  <li key={`${a.kind}-${a.id}`}>
                    <Link
                      to={`/${a.kind}/${a.id}`}
                      className="group flex items-center gap-3 py-3 transition hover:bg-slate-50/70 sm:px-2"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: a.kind === "inward" ? "#ECFDF5" : "#FFFBEB",
                          color: a.kind === "inward" ? "#059669" : "#D97706",
                        }}
                      >
                        {a.kind === "inward" ? (
                          <ArrowDownToLine size={18} />
                        ) : (
                          <ArrowUpFromLine size={18} />
                        )}
                      </span>
  
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {a.number}
                          <span className="ml-2 font-normal text-slate-500">{a.party}</span>
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {a.type} · {qtyText(a.items)} · {timeText(a.date)}
                        </p>
                      </div>
  
                      <StatusChip item={a} />
                      <ChevronRight
                        size={16}
                        className="hidden shrink-0 text-slate-300 transition group-hover:text-slate-500 sm:block"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

// =====================================================
// SMALL PIECES
// =====================================================

function Card({ title, icon, right, className = "", children }) {
  return (
    <div
      className={`rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.12)] sm:p-5 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="truncate text-sm font-semibold text-slate-900 sm:text-base">
            {title}
          </h2>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, note, tone, loading }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)] sm:p-5"
      style={{ background: tone.bg }}
    >
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: tone.solid }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium sm:text-sm" style={{ color: tone.fg }}>
          {label}
        </p>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: tone.solid }}
        >
          <Icon size={18} />
        </span>
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-16 animate-pulse rounded-lg bg-white/70" />
      ) : (
        <p className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl">{num(value)}</p>
      )}
      <p className="mt-1 truncate text-xs text-slate-600">{note}</p>
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon}
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

function StatusChip({ item }) {
  if (item.kind === "outward") {
    return (
      <span
        className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-block ${
          item.cls || "bg-slate-100 text-slate-600"
        }`}
      >
        {item.status}
      </span>
    );
  }
  const done = item.statusType === "complete";
  return (
    <span
      className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-block ${
        done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {item.status}
    </span>
  );
}

// -----------------------------------------------------
// Donut (pure SVG)
// -----------------------------------------------------

function Donut({ data }) {
  const total = data.reduce((t, d) => t + d.value, 0);
  const R = 52;
  const CIRC = 2 * Math.PI * R;

  if (total === 0) return <Empty text="No outward entries yet." />;

  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="16" />
          {data.map((d) => {
            const len = (d.value / total) * CIRC;
            const el = (
              <circle
                key={d.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${Math.max(len - 2, 0)} ${CIRC - Math.max(len - 2, 0)}`}
                strokeDashoffset={-offset}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-slate-900">{num(total)}</span>
          <span className="text-[11px] text-slate-500">outward</span>
        </div>
      </div>

      <ul className="w-full space-y-1.5">
        {data.slice(0, 6).map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="font-semibold text-slate-800">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
