import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, Plus, Trash2, ArrowRight } from "lucide-react";

import { fetchTransferOptions, fetchTransferStock, fetchTransferSerials, createTransfer } from "../features/transfer/transferApi";
import useSerialScanner from "../components/SerialScanner";
import OutwardDocuments from "../components/OutwardDocuments";
import { SearchableSelect } from "../components/ItemProductFields";
import { toast } from "../components/CenterMessage";
import { buildSerialLines, cleanSerialInput, isCableCategory, serialKey, sortSerials } from "../features/outward/serialHelpers";

const selectCls =
  "w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-8 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";
const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-100";
const labelCls = "mb-1.5 block text-sm font-semibold text-black";

const lineKeyOf = (l) => `${l.category}||${l.sku}||${l.stockType}`.toLowerCase();
const uomOf = (line) => line?.uom || "Pcs";

// Stock types, same labels as the Stock Ledger filter.
const STOCK_TYPES = [
  { value: "Purchase - New Stock", label: "New" },
  { value: "Purchase - Service Stock", label: "Service" },
  { value: "Return of Purchase", label: "Return" },
  { value: "Service/Faulty Stock from Customer", label: "Faulty" },
  { value: "Repair-Service Stock", label: "Repair" },
];

// Reference document types of a transfer, and the row each one opens in the Documents section.
const REF_TYPES = ["E-way Bill", "Invoice", "DC Challan", "Bilty", "Other"];
const REF_TYPE_DOCUMENT = { "E-way Bill": "E-way bill", Invoice: "Invoice", "DC Challan": "DC challan", Bilty: "Bilty" };
const DEFAULT_DOCUMENT = "E-way bill"; // always shown in the Documents section
const DOCUMENT_MENU = ["E-way bill", "Invoice", "DC challan", "Bilty", "Other"];
const refNumberLabel = (type) =>
  type === "E-way Bill" ? "E-way bill no." : type === "Invoice" ? "Invoice no." : type === "DC Challan" ? "Challan no." : type === "Bilty" ? "Bilty no." : "Reference doc no.";

function Select({ label, value, onChange, disabled, placeholder, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={selectCls}>
          <option value="">{placeholder}</option>
          {children}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );
}

// Textarea + button used to add a list of serial numbers at once.
function PasteBox({ onAdd }) {
  const [text, setText] = useState("");
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="One per line, or separated by commas"
        className={`${inputCls} mt-2 text-xs`}
      />
      <button
        type="button"
        onClick={() => { if (text.trim()) { onAdd(text); setText(""); } }}
        className="mt-1.5 rounded-md bg-[#185FA5] px-3 py-1.5 text-[11px] font-semibold text-white"
      >
        Add these
      </button>
    </div>
  );
}

let rowCounter = 0;
const newRow = () => ({ id: ++rowCounter, stockType: "", category: "", sku: "", quantity: "" });
const newReference = (refDocType = "E-way Bill") => ({ id: crypto.randomUUID(), refDocType, refDocNumber: "" });
const emptySlot = () => ({ serialNo: "", source: "MANUAL" });

export default function StockTransferForm() {
  const navigate = useNavigate();

  const [options, setOptions] = useState(null);
  const [optionsError, setOptionsError] = useState("");

  const [fromCompanyId, setFromCompanyId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toCompanyId, setToCompanyId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [remarks, setRemarks] = useState("");

  const [stock, setStock] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [serialCache, setSerialCache] = useState({}); // "category||sku" -> { [stockType]: [serialNo] }, loaded when a model is picked
  const [serialsLoading, setSerialsLoading] = useState({});
  const [rows, setRows] = useState([newRow()]);
  const [serialValues, setSerialValues] = useState({}); // serial key -> [{ serialNo, source }], one slot per unit
  const [references, setReferences] = useState([newReference()]);
  const [stagedDocs, setStagedDocs] = useState([]); // files picked in the Documents section, sent with the transfer

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetchTransferOptions()
      .then((data) => alive && setOptions(data))
      .catch((e) => alive && setOptionsError(e.message));
    return () => { alive = false; };
  }, []);

  // ---- dropdown choices ----
  const warehousesOf = (list, companyId) => (companyId ? (list || []).filter((w) => w.companyIds.includes(companyId)) : []);
  const fromWarehouses = useMemo(() => warehousesOf(options?.fromWarehouses, fromCompanyId), [options, fromCompanyId]);
  const toWarehouses = useMemo(() => warehousesOf(options?.toWarehouses, toCompanyId), [options, toCompanyId]);

  // Someone with a single choice does not have to pick it.
  useEffect(() => {
    if (!options) return;
    if (!fromCompanyId && options.fromCompanies.length === 1) setFromCompanyId(options.fromCompanies[0].id);
  }, [options, fromCompanyId]);
  useEffect(() => {
    if (fromCompanyId && !fromWarehouseId && fromWarehouses.length === 1) setFromWarehouseId(fromWarehouses[0].id);
  }, [fromCompanyId, fromWarehouseId, fromWarehouses]);

  // ---- stock of the sending company in the sending warehouse ----
  useEffect(() => {
    setRows([newRow()]);
    setSerialValues({});
    setSerialCache({});
    setStock([]);
    setStockError("");
    if (!fromCompanyId || !fromWarehouseId) return undefined;
    let alive = true;
    setStockLoading(true);
    fetchTransferStock({ companyId: fromCompanyId, warehouseId: fromWarehouseId })
      .then((data) => alive && setStock(data))
      .catch((e) => alive && setStockError(e.message))
      .finally(() => alive && setStockLoading(false));
    return () => { alive = false; };
  }, [fromCompanyId, fromWarehouseId]);

  // Stock lines get their serial numbers once those are loaded for the model.
  const modelKeyOf = (category, sku) => `${category}||${sku}`.toLowerCase();
  const stockByKey = useMemo(
    () => new Map(stock.map((l) => [lineKeyOf(l), { ...l, serialNos: serialCache[modelKeyOf(l.category, l.sku)]?.[l.stockType] || l.serialNos || [] }])),
    [stock, serialCache]
  );

  // Load the serial numbers of a model as soon as it is picked (one small request, not the whole warehouse).
  const loadSerials = (category, sku, onLoaded) => {
    const key = modelKeyOf(category, sku);
    if (!category || !sku || serialsLoading[key]) return;
    if (serialCache[key]) { onLoaded?.(serialCache[key]); return; }
    setSerialsLoading((p) => ({ ...p, [key]: true }));
    fetchTransferSerials({ companyId: fromCompanyId, warehouseId: fromWarehouseId, category, sku })
      .then((data) => { setSerialCache((p) => ({ ...p, [key]: data })); onLoaded?.(data); })
      .catch((e) => toast.error(e.message))
      .finally(() => setSerialsLoading((p) => ({ ...p, [key]: false })));
  };

  const handleFromCompany = (id) => { setFromCompanyId(id); setFromWarehouseId(""); };
  const handleToCompany = (id) => { setToCompanyId(id); setToWarehouseId(""); };

  const updateRow = (id, patch) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((list) => (list.length > 1 ? list.filter((r) => r.id !== id) : [newRow()]));
  // stock type -> category -> model -> quantity: changing one step clears the steps after it
  const pickType = (id, stockType) => updateRow(id, { stockType, category: "", sku: "", quantity: "" });
  const pickCategory = (id, category) => updateRow(id, { category, sku: "", quantity: "" });
  // A model that has serial numbers starts at 1 unit so its serial no. dropdown shows straight away.
  const pickModel = (id, sku) => {
    const row = rows.find((r) => r.id === id);
    updateRow(id, { sku, quantity: "" });
    if (!row) return;
    // Once the serial numbers are in, a model that has them starts at 1 unit so the serial dropdown shows.
    loadSerials(row.category, sku, (data) => {
      if ((data[row.stockType] || []).length) setRows((list) => list.map((r) => (r.id === id && !r.quantity ? { ...r, quantity: "1" } : r)));
    });
  };

  const typeCount = (type) => stock.filter((l) => l.stockType === type).length;
  const categoriesOf = (stockType) => [...new Set(stock.filter((l) => l.stockType === stockType).map((l) => l.category))];
  const modelsOf = (stockType, category) => stock.filter((l) => l.stockType === stockType && l.category === category);

  // ---- numbers per row ----
  const rowInfo = (row) => {
    const line = row.category && row.sku ? stockByKey.get(lineKeyOf({ category: row.category, sku: row.sku, stockType: row.stockType })) : null;
    if (!line) return null;
    const hasSerials = line.serialNos.length > 0;
    // Countable items (Pcs, not cables) can carry serial numbers even when none were recorded at inward.
    const takesSerials = hasSerials || (String(line.uom || "Pcs").trim().toLowerCase() === "pcs" && !isCableCategory(line.category));
    const plainMax = Math.max(line.available - line.serialNos.length, 0); // units in stock that have no serial no.
    const quantity = Number(row.quantity) || 0;
    // Units that have no serial no. in stock can go without one; every other unit needs its serial no.
    const serialsNeeded = hasSerials ? Math.max(quantity - plainMax, 0) : 0;
    return { line, hasSerials, takesSerials, plainMax, quantity, serialsNeeded };
  };

  // ---- serial numbers: select from stock, type, camera scan, Bluetooth / Wi-Fi / USB scanner ----
  // One scanner "item" per form row (a row-unique category keeps two rows of the same model, e.g. New and Service, apart).
  const serialItems = rows.map((row) => {
    const info = rowInfo(row);
    const key = `r${row.id}`;
    if (!info?.takesSerials || info.quantity <= 0) return { category: key, sku: row.sku, quantity: 0, uom: "", serialMode: "NOT_REQUIRED" };
    return { category: key, sku: info.line.sku, quantity: info.quantity, uom: "Pcs", serialMode: info.hasSerials ? "REQUIRED" : "OPTIONAL" };
  });
  const serialLines = useMemo(() => buildSerialLines(serialItems), [JSON.stringify(serialItems)]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyOfRow = (row) => serialKey(`r${row.id}`, rowInfo(row)?.line.sku || row.sku);

  // Serial numbers each row may use = the serial numbers really in that stock.
  const stockSerials = {};
  rows.forEach((row) => {
    const info = rowInfo(row);
    if (info?.hasSerials) stockSerials[keyOfRow(row)] = sortSerials(info.line.serialNos);
  });

  // Exactly one slot per unit; what is already entered stays when the quantity changes.
  const lineSignature = serialLines.map((l) => `${l.key}:${l.quantity}`).join("|");
  useEffect(() => {
    setSerialValues((prev) => {
      const next = {};
      serialLines.forEach((l) => {
        const kept = (prev[l.key] || []).filter((x) => cleanSerialInput(x.serialNo));
        next[l.key] = Array.from({ length: l.quantity }, (_, i) => kept[i] || emptySlot());
      });
      return next;
    });
  }, [lineSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Serial numbers can be picked from stock, or typed / scanned when the unit was never recorded at inward (the server
  // refuses one that has already left).
  const handleSerialChange = (next) => setSerialValues(next);
  const serial = useSerialScanner({ items: serialItems, lines: serialLines, values: serialValues, onChange: handleSerialChange, suggestions: stockSerials });

  const filledOf = (row) => (serialValues[keyOfRow(row)] || []).filter((x) => cleanSerialInput(x.serialNo));
  const usedSerials = new Set(Object.values(serialValues).flat().map((x) => cleanSerialInput(x.serialNo).toLowerCase()).filter(Boolean));

  // Puts serial numbers into the row's empty places; the quantity grows when there are more than places.
  const addSerialsToRow = (row, list) => {
    const info = rowInfo(row);
    if (!info) return 0;
    const key = keyOfRow(row);
    const kept = filledOf(row);
    const merged = [...kept, ...list.map((serialNo) => ({ serialNo, source: "MANUAL" }))].slice(0, info.line.available);
    const quantity = Math.max(info.quantity, merged.length);
    setSerialValues((prev) => ({ ...prev, [key]: Array.from({ length: quantity }, (_, i) => merged[i] || emptySlot()) }));
    if (quantity !== info.quantity) updateRow(row.id, { quantity: String(quantity) });
    return merged.length - kept.length;
  };

  const fillFromStock = (row) => {
    const info = rowInfo(row);
    const free = sortSerials(info.line.serialNos).filter((sn) => !usedSerials.has(sn.toLowerCase()));
    const room = info.quantity - filledOf(row).length;
    if (room <= 0) return toast.info("Every unit of this item already has a serial no.");
    addSerialsToRow(row, free.slice(0, room));
  };
  const clearSerials = (row) => setSerialValues((prev) => ({ ...prev, [keyOfRow(row)]: Array.from({ length: rowInfo(row)?.quantity || 0 }, emptySlot) }));
  const pasteSerials = (row, text) => {
    const info = rowInfo(row);
    const inStock = new Map(info.line.serialNos.map((sn) => [sn.toLowerCase(), sn]));
    const mine = new Set(filledOf(row).map((x) => x.serialNo.toLowerCase()));
    const found = [];
    let missing = 0;
    text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).forEach((w) => {
      const real = inStock.get(w.toLowerCase()) || cleanSerialInput(w);
      if (!real) { missing += 1; return; }
      if (mine.has(real.toLowerCase()) || found.includes(real) || usedSerials.has(real.toLowerCase())) return;
      found.push(real);
    });
    const added = found.length ? addSerialsToRow(row, found) : 0;
    toast[missing ? "warn" : "success"](`${added} serial no. added${missing ? `, ${missing} not found in this stock` : ""}`);
  };

  const totalUnits = rows.reduce((sum, r) => sum + (rowInfo(r)?.quantity || 0), 0);

  // ---- reference documents + documents ----
  const updateReference = (id, patch) => setReferences((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeReference = (id) => setReferences((list) => (list.length > 1 ? list.filter((r) => r.id !== id) : [newReference()]));
  // The Documents section always has the e-way bill row, plus one row for each reference type that is chosen.
  const documentRows = useMemo(() => {
    const labels = [DEFAULT_DOCUMENT];
    references.forEach((r) => {
      const label = REF_TYPE_DOCUMENT[r.refDocType];
      if (label && !labels.includes(label)) labels.push(label);
    });
    return labels;
  }, [references]);

  const validate = () => {
    if (!fromCompanyId || !fromWarehouseId) return "Select the company and warehouse you are sending from";
    if (!toCompanyId || !toWarehouseId) return "Select the company and warehouse you are sending to";
    if (fromCompanyId === toCompanyId && fromWarehouseId === toWarehouseId) return "Sending and receiving company + warehouse cannot be the same";
    const started = rows.filter((r) => r.stockType || r.category || r.sku || r.quantity);
    if (!started.length) return "Add at least one item (select the stock type, category, model and quantity)";
    for (const [i, row] of started.entries()) {
      const info = rowInfo(row);
      if (!row.stockType) return `Item ${i + 1}: select the stock type`;
      if (!row.category) return `Item ${i + 1}: select the category`;
      if (!row.sku || !info) return `Item ${i + 1}: select the model`;
      const name = info.line.sku;
      const qty = Number(row.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return `${name}: enter the quantity (a whole number above 0)`;
      if (qty > info.line.available) return `${name}: only ${info.line.available} ${uomOf(info.line)} available`;
      if (info.hasSerials && filledOf(row).length < info.serialsNeeded) {
        return `${name}: ${info.serialsNeeded} serial number${info.serialsNeeded === 1 ? "" : "s"} needed, ${filledOf(row).length} added`;
      }
    }
    if (references.some((r) => r.refDocNumber.trim() && !r.refDocType)) return "Select the reference document type";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError("");
    setSubmitting(true);
    try {
      await createTransfer(
        {
          fromCompanyId, fromWarehouseId, toCompanyId, toWarehouseId,
          remarks: remarks.trim() || undefined,
          items: rows.filter((r) => r.sku && rowInfo(r)).map((r) => {
            const { line, quantity, hasSerials } = rowInfo(r);
            return {
              category: line.category, sku: line.sku, stockType: line.stockType, quantity,
              serialNos: filledOf(r).map((x) => x.serialNo),
            };
          }),
          referenceDocuments: references
            .filter((r) => r.refDocNumber.trim())
            .map((r) => ({ refDocType: r.refDocType, refDocNumber: r.refDocNumber.trim() })),
        },
        stagedDocs.map((d) => ({ docCategory: d.docCategory, file: d.file }))
      );
      navigate("/stock-ledger/transfers", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------
  if (optionsError) {
    return (
      <div className="min-h-dvh bg-[#F1EFE8] p-6">
        <p className="text-sm font-medium text-red-600">{optionsError}</p>
      </div>
    );
  }

  const usedKeys = new Set(rows.map((r) => r.lineKey).filter(Boolean));

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
        <Link to="/stock-ledger" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to Stock Ledger
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Transfer Stock</h1>
        <p className="mb-6 mt-0.5 text-xs text-gray-500 sm:text-sm">Move stock from one company to another company.</p>

        {!options && <p className="text-sm text-gray-500">Loading...</p>}

        {options && !options.canTransfer && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">You are not allowed to transfer stock.</p>
        )}

        {options?.canTransfer && (
          <>
            {/* =============== TRANSFER DETAILS =============== */}
            <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold text-gray-900">Transfer details</h2>

              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
                <div className="space-y-3 rounded-lg border border-red-100 bg-red-50/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-700">From</p>
                  <Select label="Company" value={fromCompanyId} onChange={handleFromCompany} placeholder="Select company">
                    {options.fromCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Select label="Warehouse" value={fromWarehouseId} onChange={setFromWarehouseId} disabled={!fromCompanyId} placeholder={fromCompanyId ? "Select warehouse" : "Select company first"}>
                    {fromWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</option>)}
                  </Select>
                </div>

                <div className="hidden self-center md:block"><ArrowRight size={20} className="text-gray-400" /></div>

                <div className="space-y-3 rounded-lg border border-green-100 bg-green-50/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-700">To</p>
                  <Select label="Company" value={toCompanyId} onChange={handleToCompany} placeholder="Select company">
                    {options.toCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Select label="Warehouse" value={toWarehouseId} onChange={setToWarehouseId} disabled={!toCompanyId} placeholder={toCompanyId ? "Select warehouse" : "Select company first"}>
                    {toWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</option>)}
                  </Select>
                </div>
              </div>

              <div className="mt-4">
                <label className={labelCls}>Remarks (optional)</label>
                <input value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} placeholder="Reason for the transfer" className={inputCls} />
              </div>
            </section>

            {/* =============== ITEM DETAILS =============== */}
            <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Item details</h2>
              <p className="mb-4 text-xs text-gray-500">
                Choose the stock type, category and model, then enter the quantity. If the item has serial numbers, select them from stock, scan them or type them.
              </p>

              {(!fromCompanyId || !fromWarehouseId) && (
                <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">Select the company and warehouse you are sending from to see its stock.</p>
              )}
              {stockLoading && <p className="text-xs text-gray-500">Loading stock...</p>}
              {stockError && <p className="text-xs font-medium text-red-600">{stockError}</p>}
              {fromCompanyId && fromWarehouseId && !stockLoading && !stockError && stock.length === 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">This company has no stock in this warehouse.</p>
              )}

              {stock.length > 0 && (
                <div className="space-y-4">
                  {rows.map((row, index) => {
                    const info = rowInfo(row);
                    const filled = filledOf(row).length;
                    return (
                      <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-600">Item {index + 1}</p>
                          <button type="button" onClick={() => removeRow(row.id)} className="text-gray-400 hover:text-red-600" aria-label="Remove item">
                            <Trash2 size={15} />
                          </button>
                        </div>

                        {/* stock type - category - model - quantity */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Select label="Stock type" value={row.stockType} onChange={(v) => pickType(row.id, v)} placeholder="Select stock type">
                            {STOCK_TYPES.map((t) => (
                              <option key={t.value} value={t.value} disabled={typeCount(t.value) === 0}>
                                {t.label}{typeCount(t.value) === 0 ? " (no stock)" : ""}
                              </option>
                            ))}
                          </Select>

                          <Select label="Category" value={row.category} onChange={(v) => pickCategory(row.id, v)} disabled={!row.stockType} placeholder={row.stockType ? "Select category" : "Select stock type first"}>
                            {categoriesOf(row.stockType).map((c) => <option key={c} value={c}>{c}</option>)}
                          </Select>

                          <div>
                            <label className={labelCls}>Model</label>
                            <SearchableSelect
                              value={row.sku}
                              disabled={!row.category}
                              placeholder={row.category ? "Select model" : "Select category first"}
                              searchPlaceholder="Search model..."
                              emptyText="No models found"
                              inputCls={selectCls}
                              options={modelsOf(row.stockType, row.category).map((l) => ({
                                value: l.sku,
                                label: l.sku,
                                qty: l.available,
                                disabled: rows.some((r) => r.id !== row.id && r.stockType === l.stockType && r.category === l.category && r.sku === l.sku),
                              }))}
                              onSelect={(v) => pickModel(row.id, v)}
                            />
                          </div>

                          <div>
                            <label className={labelCls}>Quantity</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                max={info?.line.available}
                                step="1"
                                value={row.quantity}
                                disabled={!info}
                                placeholder={info ? `Max ${info.line.available}` : "Select model first"}
                                onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                                className={inputCls}
                              />
                              {info && <span className="shrink-0 text-xs text-gray-500">{uomOf(info.line)}</span>}
                            </div>
                          </div>
                        </div>

                        {/* serial numbers: only when this stock has serial numbers */}
                        {info?.takesSerials && info.quantity > 0 && (
                          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-gray-700">
                                Serial numbers: {filled} of {info.quantity} added{serialsLoading[modelKeyOf(row.category, row.sku)] ? <span className="font-normal text-gray-500"> (loading serial numbers...)</span> : !info.hasSerials && <span className="font-normal text-gray-500"> (optional)</span>}
                                {info.plainMax > 0 && (
                                  <span className="ml-1 font-normal text-gray-500">
                                    ({info.plainMax} unit{info.plainMax === 1 ? "" : "s"} in stock without serial no. can go without one)
                                  </span>
                                )}
                              </p>
                              <div className="flex gap-2">
                                {info.hasSerials && (
                                  <button type="button" onClick={() => fillFromStock(row)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700">
                                    Fill from stock
                                  </button>
                                )}
                                <button type="button" onClick={() => clearSerials(row)} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700">
                                  Clear
                                </button>
                              </div>
                            </div>

                            {serial.inputCell(serialItems[index], index, true)}
                            <table className="w-full"><tbody>{serial.listRow(serialItems[index], index, 1)}</tbody></table>

                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] font-medium text-blue-700">Paste a list of serial numbers</summary>
                              <PasteBox onAdd={(text) => pasteSerials(row, text)} />
                            </details>
                          </div>
                        )}

                        {info && info.quantity > 0 && (
                          <p className="mt-2 text-xs font-medium text-gray-700">
                            Sending {info.quantity} {uomOf(info.line)}
                            {info.takesSerials ? ` (${filled} with serial no.)` : ""}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setRows((list) => [...list, newRow()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus size={14} />
                    Add another item
                  </button>
                </div>
              )}
              {serial.camera}
            </section>

            {/* =============== REFERENCE DOCUMENTS =============== */}
            <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Reference documents</h2>
                  <p className="mt-0.5 text-xs text-gray-500">E-way bill, invoice, DC challan, bilty or other document numbers for this transfer.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReferences((list) => [...list, newReference(REF_TYPES.find((t) => !list.some((r) => r.refDocType === t)) || "Other")])}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  <Plus size={13} />Add reference
                </button>
              </div>

              <div className="space-y-3">
                {references.map((r, index) => (
                  <div key={r.id} className="rounded-lg border border-gray-100 bg-gray-50/40 p-3">
                    {references.length > 1 && (
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-600">Reference document {index + 1}</span>
                        <button type="button" onClick={() => removeReference(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelCls}>Reference doc type</label>
                        <div className="relative">
                          <select value={r.refDocType} onChange={(e) => updateReference(r.id, { refDocType: e.target.value })} className={selectCls}>
                            {REF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>{refNumberLabel(r.refDocType)}</label>
                        <input
                          value={r.refDocNumber}
                          maxLength={80}
                          onChange={(e) => updateReference(r.id, { refDocNumber: e.target.value })}
                          placeholder="Enter document number"
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* =============== DOCUMENTS (upload) =============== */}
            <div className="mb-5">
              <OutwardDocuments
                title="Documents"
                subtitle="E-way bill is the default document. Each reference type chosen above gets its own row. All documents are optional."
                canManage
                deferred
                stagedFiles={stagedDocs}
                onStagedChange={setStagedDocs}
                requiredDocuments={[]}
                optionalDocuments={documentRows}
                addMenuTypes={DOCUMENT_MENU}
                showSummary={false}
              />
            </div>

            {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">{totalUnits > 0 ? `${totalUnits} unit${totalUnits === 1 ? "" : "s"} will be transferred` : ""}</p>
              <div className="flex gap-2">
                <Link to="/stock-ledger" className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700">Cancel</Link>
                <button
                  type="submit"
                  disabled={submitting || stock.length === 0}
                  className="rounded-lg bg-[#185FA5] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Transferring..." : "Transfer stock"}
                </button>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
