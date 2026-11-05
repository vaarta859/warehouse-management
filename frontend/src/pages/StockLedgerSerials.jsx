import { useCallback, useEffect, useState } from "react";
import usePersistedState, { useResetPageOnChange } from "../features/shared/usePersistedState";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Search, X } from "lucide-react";

import apiClient from "../services/apiClient";

const formatDate = (v) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";

const inputCls =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
const th = "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-tight text-gray-600";

const STATUS_TABS = [
  { key: "", label: "All", active: "border-blue-600 bg-blue-600 text-white" },
  { key: "in", label: "In stock", active: "border-green-600 bg-green-600 text-white" },
  { key: "out", label: "Out", active: "border-red-600 bg-red-600 text-white" },
  { key: "no_inward", label: "Out without inward", active: "border-amber-500 bg-amber-500 text-white" },
];

function Badge({ tone, children }) {
  const tones = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-600",
    amber: "bg-amber-100 text-amber-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>{children}</span>;
}

// "IN" cell: the inward entry the serial came in on. Clicking it opens that entry's serial list.
function InCell({ row, onOpen }) {
  if (!row.inward) return <Badge tone="amber">No inward</Badge>;
  const isInward = row.inward.kind === "INWARD";
  return (
    <div>
      <button
        type="button"
        disabled={!isInward}
        onClick={() => onOpen(row)}
        className={`text-[11px] font-semibold ${isInward ? "text-green-700 underline-offset-2 hover:underline" : "text-blue-700"}`}
      >
        IN · {row.inward.number}
      </button>
      <p className="text-[10px] text-gray-500">
        {isInward ? "" : "Transfer · "}
        {formatDate(row.inward.at)}
      </p>
    </div>
  );
}

function OutCell({ row }) {
  if (!row.outward) return <span className="text-[11px] text-gray-400">-</span>;
  const o = row.outward;
  const label = (
    <>
      OUT · {o.number}
      {o.kind === "TRANSFER_OUT" ? " (transfer)" : ""}
    </>
  );
  return (
    <div>
      {o.kind === "OUTWARD" ? (
        <Link to={`/outward/${o.id}`} className="text-[11px] font-semibold text-red-600 underline-offset-2 hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-[11px] font-semibold text-purple-700">{label}</span>
      )}
      <p className="text-[10px] text-gray-500">{formatDate(o.at)}</p>
    </div>
  );
}

// Everything that came in on one inward entry, and for each serial where it went out.
function InwardSerialsModal({ target, onClose }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/api/reports/stock-ledger/inward/${target.grnId}`, { params: { category: target.category, sku: target.sku } })
      .then(({ data }) => !cancelled && setState({ loading: false, error: "", data }))
      .catch((e) => !cancelled && setState({ loading: false, error: e.response?.data?.message || "Failed to load serial numbers", data: null }));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const { loading, error, data } = state;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-green-200 bg-gradient-to-r from-green-100 via-emerald-50 to-white px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-green-900">Inward {data?.inward?.grnNumber || ""}</h3>
            {data && (
              <p className="mt-0.5 text-xs text-green-800/70">
                {[data.inward.inwardType, data.inward.companyName, data.inward.warehouseName, formatDate(data.inward.createdAt)].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-white/70" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && <p className="py-6 text-center text-sm text-gray-500">Loading...</p>}
          {error && <p className="py-6 text-center text-sm text-red-600">{error}</p>}
          {data && (
            <>
              <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">{data.counts.total} came in</span>
                <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">{data.counts.out} went out</span>
                <span className="rounded-full bg-green-100 px-3 py-1 text-green-700">{data.counts.inStock} in stock</span>
              </div>
              {data.data.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No serial numbers were recorded on this inward entry.</p>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50">
                    <tr>
                      <th className={th}>Serial no.</th>
                      <th className={th}>Model</th>
                      <th className={th}>Outward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.data.map((s) => (
                      <tr key={`${s.category}-${s.sku}-${s.serialNo}`}>
                        <td className="px-3 py-2 font-mono text-[11px] font-medium text-gray-900">{s.serialNo}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-600">{s.sku}</td>
                        <td className="px-3 py-2">
                          {s.outward ? (
                            <Link to={`/outward/${s.outward.id}`} className="text-[11px] font-semibold text-red-600 hover:underline">
                              OUT · {s.outward.number}
                            </Link>
                          ) : (
                            <Badge tone="green">In stock</Badge>
                          )}
                          {s.outward && <p className="text-[10px] text-gray-500">{formatDate(s.outward.at)}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link to={`/inward/${data.inward.id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#185FA5]">
                Open inward entry <ArrowRight size={13} />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StockLedgerSerials() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Scope comes from the ledger row that was clicked.
  const category = params.get("category") || "";
  const sku = params.get("sku") || "";
  const scope = {
    companyName: params.get("companyName") || undefined,
    warehouseId: params.get("warehouseId") || undefined,
    companyId: params.get("companyId") || undefined,
    stockType: params.get("stockType") || undefined,
  };
  const scopeKey = JSON.stringify(scope);
  const hasProduct = Boolean(category || sku);

  // Remembered per item, so coming back from an outward / inward lands on the same search, tab and page.
  const memoryKey = `serials:${category}|${sku}|${scopeKey}`;
  const [search, setSearch] = usePersistedState(`${memoryKey}:search`, params.get("search") || "");
  const [status, setStatus] = usePersistedState(`${memoryKey}:status`, "");
  const [page, setPage] = usePersistedState(`${memoryKey}:page`, 1);
  const [state, setState] = useState({ loading: false, error: "", rows: [], counts: null, pagination: null });
  const [inwardTarget, setInwardTarget] = useState(null);

  useResetPageOnChange(JSON.stringify([search, status, category, sku, scopeKey]), () => setPage(1));

  const load = useCallback(() => {
    // No item and nothing typed: nothing to look up yet.
    if (!hasProduct && !search.trim()) {
      setState({ loading: false, error: "", rows: [], counts: null, pagination: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    apiClient
      .get("/api/reports/stock-ledger/serials", { params: { ...scope, category: category || undefined, sku: sku || undefined, search: search.trim() || undefined, status: status || undefined, page, pageSize: 50 } })
      .then(({ data }) => !cancelled && setState({ loading: false, error: "", rows: data.data || [], counts: data.counts, pagination: data.pagination }))
      .catch((e) => !cancelled && setState({ loading: false, error: e.response?.data?.message || "Failed to load serial numbers", rows: [], counts: null, pagination: null }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sku, scopeKey, search, status, page, hasProduct]);

  // Debounced so typing a serial number doesn't fire a request per keystroke.
  useEffect(() => {
    let cancel;
    const timer = setTimeout(() => {
      cancel = load();
    }, 300);
    return () => {
      clearTimeout(timer);
      if (cancel) cancel();
    };
  }, [load]);

  const { loading, error, rows, counts, pagination } = state;
  const title = hasProduct ? [category, sku].filter(Boolean).join(" · ") : "Search serial number";
  const subtitle = [scope.companyName, scope.stockType && `${scope.stockType} stock`].filter(Boolean).join(" · ");

  const cards = counts
    ? [
        ["Serial numbers", counts.total, "border-blue-200 bg-gradient-to-br from-blue-100 via-sky-50 to-white", "text-blue-700", "text-blue-900"],
        ["In stock", counts.inStock, "border-green-200 bg-gradient-to-br from-green-100 via-emerald-50 to-white", "text-green-700", "text-green-900"],
        ["Out", counts.out, "border-red-200 bg-gradient-to-br from-red-100 via-rose-50 to-white", "text-red-700", "text-red-900"],
        ["Out without inward", counts.outWithoutInward, "border-amber-200 bg-gradient-to-br from-amber-100 via-orange-50 to-white", "text-amber-700", "text-amber-900"],
      ]
    : [];

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => navigate("/stock-ledger", { replace: true })} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Stock Ledger
        </button>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">{title}</h1>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">{subtitle || "Serial numbers - inward and outward"}</p>
          </div>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial no."
              className={`${inputCls} w-64 pl-9`}
              autoFocus={!hasProduct}
            />
          </div>
        </div>

        {counts && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cards.map(([label, value, card, labelCls, valueCls]) => (
              <div key={label} className={`rounded-xl border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${card}`}>
                <p className={`text-xs font-semibold ${labelCls}`}>{label}</p>
                <p className={`mt-1 text-2xl font-bold ${valueCls}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              onClick={() => setStatus(t.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${status === t.key ? t.active : "border-gray-300 bg-white text-gray-700"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading && <p className="px-5 py-10 text-center text-sm text-gray-500">Loading serial numbers...</p>}
          {error && <p className="px-5 py-10 text-center text-sm text-red-600">{error}</p>}
          {!loading && !error && !hasProduct && !search.trim() && (
            <p className="px-5 py-10 text-center text-sm text-gray-500">Type a serial number to search. Serials that went out without an inward entry are included.</p>
          )}
          {!loading && !error && (hasProduct || search.trim()) && rows.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-gray-500">
              {search.trim() || status ? "No matching serial numbers." : "This item has no serial numbers."}
            </p>
          )}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50">
                  <tr>
                    <th className={th}>Serial no.</th>
                    {!hasProduct && <th className={th}>Item</th>}
                    <th className={th}>Stock type</th>
                    <th className={th}>Warehouse</th>
                    <th className={th}>IN (inward)</th>
                    <th className={th}>OUT (outward)</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.key} className={r.outWithoutInward ? "bg-amber-50/60" : r.status === "IN_STOCK" ? "hover:bg-green-50/50" : "hover:bg-red-50/40"}>
                      <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-gray-900">{r.serialNo}</td>
                      {!hasProduct && (
                        <td className="px-3 py-2.5 text-[11px] text-gray-700">
                          {r.category}
                          <span className="block font-medium text-gray-800">{r.sku}</span>
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-[11px] text-gray-700">{r.stockType || "-"}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-700">{r.warehouseName || "-"}</td>
                      <td className="px-3 py-2.5">
                        <InCell row={r} onOpen={(row) => setInwardTarget({ grnId: row.inward.id, category: row.category, sku: row.sku })} />
                      </td>
                      <td className="px-3 py-2.5">
                        <OutCell row={r} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={r.status === "IN_STOCK" ? "green" : "red"}>{r.status === "IN_STOCK" ? "In stock" : "Out"}</Badge>
                          {r.outWithoutInward && <Badge tone="amber">Out without inward</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
              <p className="text-xs text-gray-500">Page {pagination.page} of {pagination.totalPages}</p>
              <div className="flex gap-2">
                <button type="button" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {inwardTarget && <InwardSerialsModal target={inwardTarget} onClose={() => setInwardTarget(null)} />}
    </div>
  );
}
