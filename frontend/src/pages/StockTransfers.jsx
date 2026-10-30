import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Search, ArrowLeftRight, Download, Eye, FileText, Upload } from "lucide-react";

import { fetchTransfers, fetchTransferById, openTransferDocument, uploadTransferDocuments } from "../features/transfer/transferApi";
import { toast } from "../components/CenterMessage";

const formatNumber = (v) => Number(v || 0).toLocaleString("en-IN");
const formatDate = (v) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";

const th = "px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500";
const inputCls =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

const openDocument = (documentId, mode) =>
  openTransferDocument(documentId, mode).catch((e) => toast.error(e.message || "Unable to open the document."));

const DOC_TYPES = ["E-way bill", "Invoice", "DC challan", "Bilty", "Other"];

// Add more documents to a transfer that already exists.
function DocumentUpload({ id, onUploaded }) {
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return toast.error("Choose a file first.");
    setBusy(true);
    try {
      await uploadTransferDocuments(id, [{ docCategory: docType, file }]);
      toast.success("Document uploaded");
      setFile(null);
      onUploaded();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
      <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${inputCls} py-1.5`}>
        {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input key={file ? file.name : "none"} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="min-w-0 max-w-[16rem] text-[11px] text-gray-600" />
      <button type="button" disabled={busy || !file} onClick={upload} className="inline-flex items-center gap-1 rounded-md bg-[#185FA5] px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        <Upload size={13} />{busy ? "Uploading..." : "Upload"}
      </button>
    </div>
  );
}

function TransferDetail({ id, canUpload }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchTransferById(id)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, reload]);

  if (error) return <p className="px-5 py-4 text-xs font-medium text-red-600">{error}</p>;
  if (!detail) return <p className="px-5 py-4 text-xs text-gray-500">Loading...</p>;

  // serial numbers grouped under their item
  const serialsOf = (item) =>
    detail.serials
      .filter((s) => s.category === item.category && s.sku === item.sku && s.stockType === item.stockType)
      .map((s) => s.serialNo);

  return (
    <div className="space-y-4 bg-gray-50 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-red-100 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">From</p>
          <p className="mt-1 text-xs font-semibold text-gray-900">{detail.fromCompanyName}</p>
          <p className="text-xs text-gray-600">{detail.fromWarehouseName}</p>
        </div>
        <div className="rounded-lg border border-green-100 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">To</p>
          <p className="mt-1 text-xs font-semibold text-gray-900">{detail.toCompanyName}</p>
          <p className="text-xs text-gray-600">{detail.toWarehouseName}</p>
        </div>
      </div>
      <p className="text-xs text-gray-600"><span className="font-semibold text-gray-800">{detail.transferNumber}</span> · {formatDate(detail.createdAt)}</p>
      {detail.remarks && <p className="text-xs text-gray-700"><span className="font-semibold">Remarks:</span> {detail.remarks}</p>}
      {detail.items.map((item) => {
        const serials = serialsOf(item);
        return (
          <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold text-gray-900">
              {item.category} · {item.sku}
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{item.stockTypeLabel}</span>
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              {formatNumber(item.quantity)} {item.uom}
              {serials.length > 0 && ` · ${serials.length} with serial no.`}
              {serials.length > 0 && item.quantity > serials.length && ` · ${item.quantity - serials.length} without`}
            </p>
            {serials.length > 0 && (
              <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {serials.map((sn) => (
                  <span key={sn} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700">{sn}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {detail.referenceDocuments?.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-1.5 text-xs font-semibold text-gray-900">Reference documents</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {detail.referenceDocuments.map((r, i) => (
              <p key={`${r.refDocType}-${i}`} className="text-xs text-gray-700">
                <span className="text-gray-500">{r.refDocType}:</span> <span className="font-medium">{r.refDocNumber}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {(detail.documents?.length > 0 || canUpload) && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-1.5 text-xs font-semibold text-gray-900">Documents</p>
          {!detail.documents?.length && <p className="text-xs text-gray-500">No documents uploaded yet.</p>}
          <div className="space-y-1.5">
            {detail.documents.map((doc) => (
              <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-xs text-gray-700">
                  <FileText size={14} className="shrink-0 text-gray-400" />
                  <span className="truncate font-medium">{doc.docCategory}</span>
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => openDocument(doc.id, "view")} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"><Eye size={13} />View</button>
                  <button type="button" onClick={() => openDocument(doc.id, "download")} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"><Download size={13} />Download</button>
                </div>
              </div>
            ))}
          </div>
          {canUpload && <DocumentUpload id={id} onUploaded={() => setReload((n) => n + 1)} />}
        </div>
      )}

      <p className="text-[11px] text-gray-500">Transferred by {detail.createdByName || "-"}</p>
    </div>
  );
}

export default function StockTransfers() {
  const user = useSelector((state) => state.auth.user);
  const canTransfer = user?.role === "ACCOUNT" || user?.role === "SUPER_ADMIN";

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo]);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      fetchTransfers({ search: search.trim() || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, pageSize: 20 })
        .then(({ rows: r, pagination: p }) => { if (alive) { setRows(r); setPagination(p); } })
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [search, dateFrom, dateTo, page]);

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <Link to="/stock-ledger" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Stock Ledger
        </Link>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Stock Transfers</h1>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Stock moved from one company to another.</p>
          </div>
          {canTransfer && (
            <Link to="/stock-ledger/transfer" className="inline-flex items-center gap-2 rounded-lg bg-[#185FA5] px-4 py-2.5 text-xs font-semibold text-white">
              <ArrowLeftRight size={15} />
              Transfer stock
            </Link>
          )}
        </div>

        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transfer no., company, warehouse, model or serial no."
              className={`${inputCls} w-full pl-9`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-600">From date</label>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-600">To date</label>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          </div>
        </div>

        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-gray-900">Transfers</h3>
            <p className="text-xs text-gray-500">{pagination ? `${formatNumber(pagination.total)} transfers` : ""}</p>
          </div>

          {loading && <p className="px-5 py-10 text-center text-sm text-gray-500">Loading transfers...</p>}
          {!loading && rows.length === 0 && <p className="px-5 py-10 text-center text-sm text-gray-500">No transfers found.</p>}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th}>Transfer no.</th>
                    <th className={th}>Date</th>
                    <th className={th}>From</th>
                    <th className={th}>To</th>
                    <th className={th}>Items</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const open = openId === row.id;
                    const first = row.items[0];
                    return (
                      <FragmentRow key={row.id} open={open} detailId={row.id} canUpload={canTransfer}>
                        <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setOpenId(open ? null : row.id)}>
                          <td className="px-4 py-3.5 text-xs font-semibold text-gray-900">{row.transferNumber}</td>
                          <td className="px-4 py-3.5 text-xs text-gray-600">{formatDate(row.createdAt)}</td>
                          <td className="px-4 py-3.5 text-xs text-gray-700">
                            <span className="font-medium">{row.fromCompanyName}</span>
                            <span className="block text-gray-500">{row.fromWarehouseName}</span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-700">
                            <span className="inline-flex items-center gap-1 font-medium"><ArrowRight size={11} className="text-gray-400" />{row.toCompanyName}</span>
                            <span className="block pl-4 text-gray-500">{row.toWarehouseName}</span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-700">
                            {first ? `${first.category} · ${first.sku}` : "-"}
                            {row.items.length > 1 && <span className="text-gray-500"> +{row.items.length - 1} more</span>}
                            {row.serialCount > 0 && <span className="block text-gray-500">{formatNumber(row.serialCount)} serial no.</span>}
                          </td>
                          <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums text-gray-900">{formatNumber(row.totalQuantity)}</td>
                          <td className="px-4 py-3.5 text-gray-400">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                        </tr>
                      </FragmentRow>
                    );
                  })}
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
    </div>
  );
}

// A table row plus (when open) a full-width detail row under it.
function FragmentRow({ open, detailId, canUpload, children }) {
  return (
    <>
      {children}
      {open && (
        <tr>
          <td colSpan={7} className="p-0">
            <TransferDetail id={detailId} canUpload={canUpload} />
          </td>
        </tr>
      )}
    </>
  );
}
