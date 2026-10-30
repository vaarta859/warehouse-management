import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
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

function TotalCard({ icon: Icon, iconClass, label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <Icon size={17} className={iconClass} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function StockLedger() {
  const dispatch = useDispatch();

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

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [stockType, setStockType] = useState(""); // "" = all stock types (New / Service / Return / Faulty / Repair)

  // Company -> warehouse. Both empty = total stock across everything the user
  // can see. These are local to this page (they don't change the navbar's warehouse).
  const [companyId, setCompanyId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

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
  useEffect(() => {
    setPage(1);
  }, [search]);

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
  useEffect(() => {
    setPage(1);
  }, [navbarWarehouse?.id]);

  const selectCls =
    "w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";


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
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      {/* =================================================
          HEADER
      ================================================= */}

      <div className="mx-auto max-w-5xl">
        <Link to="/reports" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Reports
        </Link>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Stock Ledger Summary</h1>
            <p className="mt-0.5 text-xs text-gray-500 sm:mt-1 sm:text-sm">{scopeLabel}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/stock-ledger/transfers"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Transfers
          </Link>
          {(user?.role === "ACCOUNT" || user?.role === "SUPER_ADMIN") && (
            <Link
              to="/stock-ledger/transfer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#185FA5] px-3 py-2 text-xs font-semibold text-white"
            >
              <ArrowLeftRight size={14} />
              Transfer
            </Link>
          )}
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search category or model"
              className="w-64 rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          </div>
        </div>

        {/* =================================================
            COMPANY -> WAREHOUSE
            Nothing chosen = total stock.
        ================================================= */}

        {!isManager && (
        <div className="mb-6 grid grid-cols-1 items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
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
          <div className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
            {stockTypeField}
          </div>
        )}

        <>
            {/* =============================================
                TOTALS
            ============================================= */}

            <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
              <TotalCard
                icon={Warehouse}
                iconClass="text-purple-600"
                label="Current Stock"
                value={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.currentStock])), totals?.currentStock)}
              />
              <TotalCard
                icon={PackagePlus}
                iconClass="text-green-600"
                label="Total Inward (all-time)"
                value={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.totalInward])), totals?.totalInward)}
              />
              <TotalCard
                icon={PackageMinus}
                iconClass="text-amber-600"
                label="Total Outward (all-time)"
                value={loading && !totals ? "—" : formatByUom(Object.fromEntries(Object.entries(totals?.byUom || {}).map(([u, t]) => [u, t.totalOutward])), totals?.totalOutward)}
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
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
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
                <div className="overflow-x-auto">
                  <table className="mobile-cards w-full min-w-0 text-left">
                    <thead className="bg-gray-50">
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
                        <tr key={`${row.companyName}-${row.warehouseId}-${row.category}-${row.sku}-${row.stockType}`}>
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
                <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
                  <p className="text-xs text-gray-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
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
