import { useEffect, useMemo, useState } from "react";
import usePersistedState, { useResetPageOnChange } from "../features/shared/usePersistedState";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowLeftRight, ChevronDown, PackageMinus, PackagePlus, Search, Warehouse } from "lucide-react";

import { fetchWarehouses, selectWarehouses, selectSelectedWarehouse } from "../features/warehouse/warehouseSlice";
import {
  fetchStockLedger,
  selectStockLedger,
  selectStockLedgerTotals,
  selectStockLedgerPagination,
  selectStockLedgerStatus,
  selectStockLedgerError,
} from "../features/reports/reportSlice";

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

// { Pcs: 120, Meters: 500 } -> "120 Pcs · 500 Meters": quantities are shown with their unit of measure, never as "units".
function formatByUom(byUom, fallback = 0) {
  const entries = Object.entries(byUom || {}).filter(([, qty]) => Number(qty) !== 0);
  if (!entries.length) return formatNumber(fallback);
  return entries.map(([uom, qty]) => `${formatNumber(qty)} ${uom}`).join(" · ");
}

const CARD_TONES = {
  purple: { card: "border-purple-200 bg-gradient-to-br from-purple-100 via-purple-50 to-white", icon: "bg-purple-600 text-white", label: "text-purple-700", value: "text-purple-900" },
  green: { card: "border-green-200 bg-gradient-to-br from-green-100 via-emerald-50 to-white", icon: "bg-green-600 text-white", label: "text-green-700", value: "text-green-900" },
  amber: { card: "border-amber-200 bg-gradient-to-br from-amber-100 via-orange-50 to-white", icon: "bg-amber-500 text-white", label: "text-amber-700", value: "text-amber-900" },
};

// Category-wise list for a totals card: "Inverter ........ 120 Pcs". `field` is the totals key to show
// (currentStock / totalInward / totalOutward). Falls back to the old single line if the server sends no categories.
function TotalCard({ icon: Icon, tone = "purple", label, items, field, fallback, wide }) {
  const t = CARD_TONES[tone];
  const list = (items || []).filter((c) => Number(c[field]) !== 0);
  return (
    <div className={`flex h-full flex-col rounded-xl border p-3 shadow-sm sm:p-4 ${wide ? "col-span-2 sm:col-span-1" : ""} ${t.card}`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-semibold ${t.label}`}>{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon size={16} />
        </span>
      </div>

      {items ? (
        list.length ? (
          <ul className="mt-2 max-h-40 divide-y divide-black/5 sm:max-h-56 overflow-y-auto pr-0.5">
            {list.map((c) => (
              <li key={`${c.category}-${c.uom}`} className="flex items-baseline justify-between gap-2 py-1">
                <span className={`min-w-0 truncate text-xs font-medium ${t.label}`}>{c.category}</span>
                <span className={`shrink-0 text-xs font-bold tabular-nums ${t.value}`}>
                  {formatNumber(c[field])} {c.uom}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 text-xs ${t.label}`}>No stock</p>
        )
      ) : (
        <p className={`mt-2 break-words text-base font-bold sm:text-xl ${t.value}`}>{fallback}</p>
      )}
    </div>
  );
}

const STOCK_TYPE_CHIP = {
  New: "bg-blue-50 text-blue-700 ring-blue-200",
  Service: "bg-amber-50 text-amber-700 ring-amber-200",
  Return: "bg-teal-50 text-teal-700 ring-teal-200",
  Faulty: "bg-red-50 text-red-700 ring-red-200",
  Repair: "bg-purple-50 text-purple-700 ring-purple-200",
};

function Stat({ label, value, tone }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-1.5 py-1.5 text-center">
      <p className="truncate text-[10px] font-medium text-gray-500">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

// Phone layout: one card per ledger row (the wide table is only for tablets and desktops).
function LedgerCard({ row, onOpen }) {
  const negative = Number(row.currentStock) < 0;
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="block w-full rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition active:bg-blue-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400">{row.category}</p>
          <p className="mt-0.5 break-words text-sm font-semibold leading-snug text-gray-900">{row.sku}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xl font-bold leading-none tabular-nums ${negative ? "text-red-600" : "text-gray-900"}`}>{formatNumber(row.currentStock)}</p>
          <p className="mt-1 text-[11px] text-gray-500">{row.uom || "in stock"}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {row.stockType && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STOCK_TYPE_CHIP[row.stockType] || "bg-gray-50 text-gray-700 ring-gray-200"}`}>
            {row.stockType}
          </span>
        )}
        <span className="min-w-0 truncate text-xs text-gray-500">
          {[row.companyName, row.warehouseName].filter(Boolean).join(" · ") || "-"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <Stat label="Inward" value={`+${formatNumber(row.inward)}`} tone="text-green-700" />
        <Stat label="Outward" value={`-${formatNumber(row.outward)}`} tone="text-red-600" />
        <Stat label="Transfer in" value={row.transferIn ? `+${formatNumber(row.transferIn)}` : "-"} tone="text-blue-700" />
        <Stat label="Transfer out" value={row.transferOut ? `-${formatNumber(row.transferOut)}` : "-"} tone="text-purple-700" />
      </div>
    </button>
  );
}

export default function StockLedger() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const warehouses = useSelector(selectWarehouses);
  const user = useSelector((state) => state.auth.user);
  const navbarWarehouse = useSelector(selectSelectedWarehouse);

  // A warehouse manager sees only the warehouse chosen in the navbar; switching it there switches the
  // stock shown here. Everyone else picks company / warehouse on this page.
  const isManager = user?.role === "WAREHOUSE_MANAGER";
  const rows = useSelector(selectStockLedger);
  const totals = useSelector(selectStockLedgerTotals);
  const pagination = useSelector(selectStockLedgerPagination);
  const status = useSelector(selectStockLedgerStatus);
  const error = useSelector(selectStockLedgerError);
  const loading = status === "loading";

  const [search, setSearch] = usePersistedState("ledger.search", "");
  const [page, setPage] = usePersistedState("ledger.page", 1);
  const [stockType, setStockType] = usePersistedState("ledger.stockType", ""); // "" = all stock types (New / Service / Return / Faulty / Repair)

  // Company -> warehouse. Both empty = total stock across everything the user
  // can see. These are local to this page (they don't change the navbar's warehouse).
  const [companyId, setCompanyId] = usePersistedState("ledger.companyId", "");
  const [warehouseId, setWarehouseId] = usePersistedState("ledger.warehouseId", "");

  // The server already limits this list by role (a manager only gets the
  // warehouses they manage), so the dropdowns can't offer anything off-limits.
  useEffect(() => {
    dispatch(fetchWarehouses({}));
  }, [dispatch]);

  // Super admin: every company. Sales / Account / Warehouse manager: only the companies they belong to
  // (a warehouse they use may also be linked with other companies, which they must not see).
  const myCompanyIds = useMemo(() => {
    if (user?.role === "SUPER_ADMIN") return null;
    return new Set([...(user?.companies || []).map((c) => c.id), user?.companyId].filter(Boolean));
  }, [user]);

  const companyOptions = useMemo(() => {
    const seen = new Map();
    warehouses.forEach((w) => {
      const linked = w.companies?.length ? w.companies : w.company?.id ? [w.company] : [];
      linked.forEach((c) => {
        if (!c?.id || seen.has(c.id)) return;
        if (myCompanyIds && myCompanyIds.size && !myCompanyIds.has(c.id)) return;
        seen.set(c.id, { id: c.id, name: c.name || "Company" });
      });
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [warehouses, myCompanyIds]);

  const warehouseOptions = useMemo(() => {
    if (!companyId) return [];
    return warehouses
      .filter((w) => (w.companyIds?.length ? w.companyIds : [w.companyId || w.company?.id]).includes(companyId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [warehouses, companyId]);

  const selectedCompany = companyOptions.find((c) => c.id === companyId);
  const selectedWarehouse = warehouseOptions.find((w) => w.id === warehouseId);

  const scopeLabel = isManager
    ? navbarWarehouse
      ? `${navbarWarehouse.name}${navbarWarehouse.code ? ` (${navbarWarehouse.code})` : ""}`
      : "Select a warehouse"
    : selectedWarehouse
    ? `${selectedCompany ? `${selectedCompany.name} - ` : ""}${selectedWarehouse.name}${selectedWarehouse.code ? ` (${selectedWarehouse.code})` : ""}`
    : selectedCompany
      ? `${selectedCompany.name} - all warehouses`
      : "Total stock - all warehouses";

  const handleCompanyChange = (id) => {
    setCompanyId(id);
    setWarehouseId(""); // the old warehouse belongs to the previous company
    setPage(1);
  };

  const handleWarehouseChange = (id) => {
    setWarehouseId(id);
    setPage(1);
  };

  const scopeWarehouseId = isManager ? navbarWarehouse?.id : warehouseId || undefined;
  const scopeCompanyId = isManager ? undefined : companyId || undefined;

  const ledgerParams = {
    warehouseId: scopeWarehouseId,
    companyId: scopeCompanyId,
    stockType,
    search,
    page,
    pageSize: 20,
  };

  // Reset to page 1 whenever the search term changes.
  useResetPageOnChange(JSON.stringify([search]), () => setPage(1));

  // Debounce search so every keystroke doesn't fire a request. Always loads:
  // with no company / warehouse chosen it is the total stock.
  useEffect(() => {
    // A manager's warehouse is not known yet: wait (never fall back to "all warehouses").
    if (isManager && !scopeWarehouseId) return undefined;
    const timer = setTimeout(() => {
      dispatch(
        fetchStockLedger({
          warehouseId: scopeWarehouseId,
          companyId: scopeCompanyId,
          stockType,
          search,
          page,
          pageSize: 20,
        })
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [dispatch, isManager, scopeWarehouseId, scopeCompanyId, stockType, search, page]);

  // Switching warehouse in the navbar starts again from page 1.
  useResetPageOnChange(JSON.stringify([navbarWarehouse?.id]), () => setPage(1));

  // A ledger row opens the serial numbers of that item (scoped to the row's company / warehouse / stock type).
  const openSerials = (row) => {
    const q = new URLSearchParams({ category: row.category || "", sku: row.sku || "" });
    if (row.companyName) q.set("companyName", row.companyName);
    if (row.warehouseId) q.set("warehouseId", row.warehouseId);
    if (row.stockType) q.set("stockType", row.stockType);
    // The ledger quantity, so the serial page can explain any difference from its own serial count.
    q.set("ledgerStock", String(row.currentStock ?? 0));
    navigate(`/stock-ledger/serials?${q.toString()}`);
  };

  const selectCls =
    "w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-8 text-xs sm:py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";


  const stockTypeField = (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-black">Stock type</label>
      <div className="relative">
        <select
          value={stockType}
          onChange={(e) => { setStockType(e.target.value); setPage(1); }}
          className={selectCls}
        >
          <option value="">All stock types</option>
          <option value="New">New</option>
          <option value="Service">Service</option>
          <option value="Return">Return</option>
          <option value="Faulty">Faulty</option>
          <option value="Repair">Repair</option>
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-3 sm:p-6">
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mx-auto max-w-5xl">
        <Link to="/reports" replace className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Reports
        </Link>

        <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Stock Ledger Summary</h1>
            <p className="mt-0.5 break-words text-xs text-gray-500 sm:mt-1 sm:text-sm">{scopeLabel}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative order-first w-full sm:order-last sm:w-64">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search category or model"
                className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 sm:py-2"
              />
            </div>
            <div className="flex gap-2">
              <Link
                to="/stock-ledger/serials"
                className="flex min-h-10 flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none"
              >
                Search serial no.
              </Link>
              <Link
                to="/stock-ledger/transfers"
                className="flex min-h-10 flex-1 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none"
              >
                Transfers
              </Link>
              {(user?.role === "ACCOUNT" || user?.role === "SUPER_ADMIN") && (
                <Link
                  to="/stock-ledger/transfer"
                  className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#185FA5] px-3 py-2 text-xs font-semibold text-white sm:flex-none"
                >
                  <ArrowLeftRight size={14} />
                  Transfer
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* =================================================
            COMPANY -> WAREHOUSE
            Nothing chosen = total stock.
        ================================================= */}

        {!isManager && (
        <div className="mb-4 grid grid-cols-1 items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:mb-6 sm:grid-cols-3 sm:p-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-black">Company</label>
            <div className="relative">
              <select value={companyId} onChange={(e) => handleCompanyChange(e.target.value)} className={selectCls}>
                <option value="">All companies</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-black">Warehouse</label>
            <div className="relative">
              <select
                value={warehouseId}
                disabled={!companyId}
                onChange={(e) => handleWarehouseChange(e.target.value)}
                className={selectCls}
              >
                <option value="">{companyId ? "All warehouses" : "Select company first"}</option>
                {warehouseOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          {stockTypeField}
        </div>
        )}

        {isManager && (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:mb-6 sm:grid-cols-3 sm:p-4">
            {stockTypeField}
          </div>
        )}

        <>
            {/* =============================================
                TOTALS
            ============================================= */}

            <div className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:grid-cols-3 sm:gap-4">
              <TotalCard
                icon={Warehouse}
                tone="purple"
                wide
                label="Current Stock"
                field="currentStock"
                items={totals?.byCategory}
                fallback={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.currentStock])), totals?.currentStock)}
              />
              <TotalCard
                icon={PackagePlus}
                tone="green"
                label="Total Inward (all-time)"
                field="totalInward"
                items={totals?.byCategory}
                fallback={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.totalInward])), totals?.totalInward)}
              />
              <TotalCard
                icon={PackageMinus}
                tone="amber"
                label="Total Outward (all-time)"
                field="totalOutward"
                items={totals?.byCategory}
                fallback={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.totalOutward])), totals?.totalOutward)}
              />
            </div>

            {/* =============================================
                TABLE
            ============================================= */}

            {status === "failed" && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => dispatch(fetchStockLedger(ledgerParams))}
                  className="mt-3 rounded-lg bg-[#185FA5] px-4 py-2 text-xs font-semibold text-white"
                >
                  Try again
                </button>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-5 sm:py-4">
                <h3 className="text-sm font-semibold text-gray-900">Items</h3>
                <p className="text-xs text-gray-500">{pagination ? `${formatNumber(pagination.total)} items` : ""}</p>
              </div>

              {loading && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">Loading stock ledger...</p>
                </div>
              )}

              {!loading && rows.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">No items found.</p>
                </div>
              )}

              {!loading && rows.length > 0 && (
                <div className="space-y-2.5 bg-gray-50 p-3 md:hidden">
                  {rows.map((row) => (
                    <LedgerCard
                      key={`m-${row.companyName}-${row.warehouseId}-${row.category}-${row.sku}-${row.stockType}`}
                      row={row}
                      onOpen={openSerials}
                    />
                  ))}
                </div>
              )}

              {!loading && rows.length > 0 && (
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-0 text-left">
                    <thead className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50">
                      <tr>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">Category</th>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">Model / SKU</th>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">Company</th>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">Warehouse</th>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">Stock type</th>
                        <th className="px-2 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-500">UOM</th>
                        <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-tight text-gray-500">Inward</th>
                        <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-tight text-gray-500">Outward</th>
                        <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-tight text-gray-500">Transfer In</th>
                        <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-tight text-gray-500">Transfer Out</th>
                        <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-tight text-gray-500">Current Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row) => (
                        <tr
                          key={`${row.companyName}-${row.warehouseId}-${row.category}-${row.sku}-${row.stockType}`}
                          onClick={() => openSerials(row)}
                          className="cursor-pointer hover:bg-blue-50/60"
                          title="Open serial numbers"
                        >
                          <td className="px-2 py-2.5 text-[11px] text-gray-700">{row.category}</td>
                          <td className="px-2 py-2.5 text-[11px] font-medium text-gray-800">{row.sku}</td>
                          <td data-label="Company" className="px-2 py-2.5 text-[11px] text-gray-700">{row.companyName || "-"}</td>
                          <td data-label="Warehouse" className="px-2 py-2.5 text-[11px] text-gray-700">{row.warehouseName || "-"}</td>
                          <td data-label="Stock type" className="px-2 py-2.5 text-[11px] font-medium text-gray-800">{row.stockType}</td>
                          <td className="px-2 py-2.5 text-[11px] text-gray-500">{row.uom}</td>
                          <td className="px-2 py-2.5 text-right text-[11px] font-semibold text-green-700">+{formatNumber(row.inward)}</td>
                          <td className="px-2 py-2.5 text-right text-[11px] font-semibold text-red-600">-{formatNumber(row.outward)}</td>
                          <td data-label="Transfer In" className="px-2 py-2.5 text-right text-[11px] font-semibold text-blue-700">{row.transferIn ? `+${formatNumber(row.transferIn)}` : "-"}</td>
                          <td data-label="Transfer Out" className="px-2 py-2.5 text-right text-[11px] font-semibold text-purple-700">{row.transferOut ? `-${formatNumber(row.transferOut)}` : "-"}</td>
                          <td className="px-2 py-2.5 text-right text-xs font-semibold tabular-nums text-gray-900">
                            {formatNumber(row.currentStock)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-3 sm:px-5">
                  <p className="text-xs text-gray-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex flex-1 justify-end gap-2">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="min-h-10 rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:px-3"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      className="min-h-10 rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:px-3"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
        </>
      </div>
    </div>
  );
}
