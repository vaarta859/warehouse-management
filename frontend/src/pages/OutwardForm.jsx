import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Paperclip, Plus, Trash2, Loader2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "../components/CenterMessage";
import apiClient from "../services/apiClient";
import {
  createOutward,
  updateOutward,
  fetchOutwardById,
  uploadOutwardProof,
  deleteUploadedProof,
  resetOutwardCreateStatus,
  selectOutwardCreateStatus,
  selectCurrentOutward,
} from "../features/outward/outwardSlice";
import { fetchWarehouses, selectWarehouses } from "../features/warehouse/warehouseSlice";
import { getWarehousePermissions } from "../features/warehouse/warehousePermissions";
import { fetchCompanies, selectAllCompanies } from "../features/company/companySlice";
import {
  COST_STATUS_OPTIONS,
  REQUIRED_DOCUMENTS,
  isPlaceholder,
  ACCOUNT_REF_TYPES,
  MANAGER_REF_TYPES,
  ACCOUNT_DOC_PREFIX,
  isAccountRef,
  isAccountDocCategory,
  refTypeLabel,
  refTypeDocument,
  isReceivingDocCategory,
  refNumberLabel,
} from "../features/outward/outwardHelpers";
import useProducts from "../features/product/useProducts";
import useOutwardStock, { stockKey } from "../features/outward/useOutwardStock";
import ItemProductFields, { ItemProductNotice } from "../components/ItemProductFields";
import PartyNameField from "../components/PartyNameField";
import OutwardDocuments from "../components/OutwardDocuments";
import LocationLink from "../components/LocationLink";

/**
 * =========================================================
 * OUTWARD FORM  (Sales, Super admin)
 * =========================================================
 * After dispatch the Super admin's Update shows every team's part in order:
 * Sales (customer + items) -> Account (invoice reference + documents) ->
 * Warehouse manager (dispatch details, reference documents, documents, remarks).
 *
 * Sales fills the customer details (customer name, then the PI row: PI No., PI date,
 * PI amount, PI upload) and the item details, including the payment status of every item:
 *
 *   Payment status  Completed / Partially completed  -> UTR number OR a payment
 *                                                       proof (image / file) is required
 *                   Pending                          -> no payment details needed
 *
 * On submit the entry goes to the Account team. After Account approves
 * it, it goes to the warehouse manager, who fills the vehicle / dispatch
 * details. (The warehouse manager never sees PI details, payment status, UTR or approval.)
 * =========================================================
 */

const makeId = () => crypto.randomUUID();

// AC / DC cables are sold by length: picking one of those categories shows Meters in the UOM dropdown
// (it can still be changed afterwards, and goes back to Pcs when another category is picked).
const isCableCategory = (category) => {
  const text = String(category || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return /\bcable\b/.test(text) && /\b(ac|dc)\b/.test(text);
};
const getDateTimeLocal = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return getDateTimeLocal();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const newItem = () => ({
  id: makeId(),
  serverId: undefined,
  category: "",
  companyName: "",
  sku: "",
  quantity: "",
  uom: "Pcs",
  paymentStatus: "PENDING",
  utrNumber: "",
  approvedBy: "", // shown while the payment is Pending / Partially completed
  proof: null, // a file uploaded now: { fileKey, fileName, fileType }
  keepProof: false, // editing: the proof saved earlier is still attached
  savedProofName: "",
});

// Account's references are Invoice / Other (Accounts); the warehouse manager's are Delivery Challan / Return Note / Other.
const newAccountRef = () => ({ id: makeId(), refDocType: "Invoice", refDocNumber: "", ewayBillNumber: "" });
const newManagerRef = () => ({ id: makeId(), refDocType: "Bilty", refDocNumber: "", ewayBillNumber: "" });
// "E-way Bill" is an Account reference type again, so nothing needs to be kept aside any more.
const isLegacyEwayRef = () => false;

const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export default function OutwardForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const warehouses = useSelector(selectWarehouses);
  const companies = useSelector(selectAllCompanies);
  const createStatus = useSelector(selectOutwardCreateStatus);
  const products = useProducts();

  const user = (() => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } })();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [outwardDateTime, setOutwardDateTime] = useState(() => getDateTimeLocal());
  const [outwardType, setOutwardType] = useState("Sale - Stock Out");
  const [customerName, setCustomerName] = useState("");
  // PI (proforma invoice) row, right after the customer name.
  const [piNumber, setPiNumber] = useState("");
  const [piDate, setPiDate] = useState("");
  const [piAmount, setPiAmount] = useState("");
  const [piFile, setPiFile] = useState(null); // a file uploaded now: { fileKey, fileName, fileType }
  const [keepPiFile, setKeepPiFile] = useState(false); // editing: the PI file saved earlier is still attached
  const [savedPiFileName, setSavedPiFileName] = useState("");
  const [piUploading, setPiUploading] = useState(false);
  const piFileRef = useRef(piFile);
  piFileRef.current = piFile;
  // Ship to / Bill to details, after the PI row.
  const [shipToContactPerson, setShipToContactPerson] = useState("");
  const [shipToContactNo, setShipToContactNo] = useState("");
  const [shipToLocation, setShipToLocation] = useState("");
  const [billToContactPerson, setBillToContactPerson] = useState("");
  const [billToContactNo, setBillToContactNo] = useState("");
  const [billToEmail, setBillToEmail] = useState("");
  // Sales' note for the warehouse team (shown to the warehouse manager on the dispatch screens).
  const [salesDispatchRemarks, setSalesDispatchRemarks] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [pickedWarehouseId, setPickedWarehouseId] = useState("");
  const [entryWarehouse, setEntryWarehouse] = useState(null); // edit mode: the entry's own warehouse
  const [items, setItems] = useState([newItem()]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Edit mode: what this entry already held when it was opened (see availableFor).
  const [originalItems, setOriginalItems] = useState([]);
  const [rejection, setRejection] = useState(null); // { by, remarks } when Account sent it back
  const [holdNote, setHoldNote] = useState(null); // { by, remarks } when Account put it on hold
  const [proofUploadingId, setProofUploadingId] = useState(null);
  // Payment status / Approve By / UTR / proof are entered once for the whole outward and applied to every item on save.
  const [payment, setPayment] = useState({ paymentStatus: "PENDING", utrNumber: "", approvedBy: "", proof: null, keepProof: false, savedProofName: "" });
  const paymentRef = useRef(payment);
  paymentRef.current = payment;
  // A new entry gets its id up front, so a payment proof is uploaded straight into
  // min/<warehouse code>/<outward id>/ and nothing is saved anywhere else.
  const newEntryId = useRef(crypto.randomUUID());
  const outwardId = editId || newEntryId.current;
  const [loadingEntry, setLoadingEntry] = useState(isEdit);
  // Workflow status of the entry being edited (approved entries can still be edited before dispatch).
  const [entryStatus, setEntryStatus] = useState(null);
  const alreadyApproved = isEdit && ["PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING", "READY_FOR_DISPATCH"].includes(entryStatus);

  // Before dispatch the form only holds the sales information (customer, PI details, items, payment status); after
  // approving again the dispatch details are filled on the dispatch page. Once an entry is
  // dispatched, the super admin gets the whole form: sales + dispatch details + documents.
  const currentOutward = useSelector(selectCurrentOutward);
  const showDispatchSection = isEdit && isSuperAdmin && ["DISPATCHED", "DELIVERED"].includes(entryStatus);
  const [dispatchMode, setDispatchMode] = useState("By Road");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  // Transportation details are frozen once Account has uploaded its documents (the server refuses changes too).
  const [transportLocked, setTransportLocked] = useState(false);
  const [dispatchRemarks, setDispatchRemarks] = useState("");
  const [accountRefs, setAccountRefs] = useState([newAccountRef()]);
  const [managerRefs, setManagerRefs] = useState([newManagerRef()]);
  const [legacyRefs, setLegacyRefs] = useState([]);
  const updateAccountRef = (rid, field, value) => setAccountRefs((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addAccountRef = () => setAccountRefs((p) => [...p, newAccountRef()]);
  const removeAccountRef = (rid) => setAccountRefs((p) => (p.length === 1 ? [newAccountRef()] : p.filter((r) => r.id !== rid)));
  const updateManagerRef = (rid, field, value) => setManagerRefs((p) => p.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
  const addManagerRef = () => setManagerRefs((p) => [...p, newManagerRef()]);
  const removeManagerRef = (rid) => setManagerRefs((p) => (p.length === 1 ? [newManagerRef()] : p.filter((r) => r.id !== rid)));

  const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-gray-400";
  const labelCls = "block text-sm font-semibold text-black mb-1.5";

  // ---- Companies / warehouses this user can pick from ----------------------
  useEffect(() => {
    if (isSuperAdmin) dispatch(fetchCompanies());
    dispatch(fetchWarehouses({}));
  }, [dispatch, isSuperAdmin]);

  const companyOptions = useMemo(() => {
    if (isSuperAdmin) return companies.filter((c) => c.status !== "Inactive");
    const seen = new Map();
    warehouses.forEach((w) => {
      if (w.company?.id && w.company?.name && !seen.has(w.company.id)) {
        seen.set(w.company.id, { id: w.company.id, name: w.company.name, status: w.company.status });
      }
    });
    return Array.from(seen.values()).filter((c) => c.status !== "Inactive");
  }, [companies, warehouses, isSuperAdmin]);

  const companyWarehouses = useMemo(() => {
    if (!selectedCompanyId) return [];
    return warehouses.filter((w) => (w.companyId || w.company?.id) === selectedCompanyId);
  }, [warehouses, selectedCompanyId]);

  // Only one choice? Pick it for them.
  useEffect(() => {
    if (isEdit || selectedCompanyId || companyOptions.length !== 1) return;
    setSelectedCompanyId(companyOptions[0].id);
  }, [isEdit, selectedCompanyId, companyOptions]);

  useEffect(() => {
    if (isEdit || pickedWarehouseId || companyWarehouses.length !== 1) return;
    setPickedWarehouseId(companyWarehouses[0].id);
  }, [isEdit, pickedWarehouseId, companyWarehouses]);

  const selectedWarehouse = isEdit
    ? entryWarehouse
    : companyWarehouses.find((w) => w.id === pickedWarehouseId) || null;
  const warehouseId = selectedWarehouse?.id || "";

  // Every customer added for this company (by anyone) shows in the Customer Name dropdown.
  const [sharedCustomers, setSharedCustomers] = useState([]);
  useEffect(() => {
    if (!warehouseId) { setSharedCustomers([]); return undefined; }
    let cancelled = false;
    apiClient
      .get("/api/outward/customers", { params: { warehouseId } })
      .then(({ data }) => { if (!cancelled) setSharedCustomers((data?.data || []).map((c) => c.name).filter(Boolean)); })
      .catch(() => { if (!cancelled) setSharedCustomers([]); });
    return () => { cancelled = true; };
  }, [warehouseId]);

  // "+ Add" saves the customer on the server for the whole company, so it is in the dropdown for every user, every time.
  const saveCustomer = (name) => {
    setSharedCustomers((prev) => (prev.some((c) => c.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]));
    if (!warehouseId) return;
    apiClient.post("/api/outward/customers", { warehouseId, name }).catch((err) => {
      toast.error(err.response?.data?.message || "Customer could not be saved for other users.");
    });
  };

  // New entry: a proof was saved under the previously selected warehouse's folder, so drop it
  // when the warehouse changes and let the user attach it again.
  useEffect(() => {
    if (isEdit) return;
    itemsRef.current.forEach((i) => { if (i.proof?.fileKey) dispatch(deleteUploadedProof({ fileKey: i.proof.fileKey })); });
    setItems((prev) => (prev.some((i) => i.proof) ? prev.map((i) => (i.proof ? { ...i, proof: null } : i)) : prev));
    if (paymentRef.current.proof?.fileKey) dispatch(deleteUploadedProof({ fileKey: paymentRef.current.proof.fileKey }));
    setPayment((p) => (p.proof ? { ...p, proof: null } : p));
    if (piFileRef.current?.fileKey) dispatch(deleteUploadedProof({ fileKey: piFileRef.current.fileKey }));
    setPiFile(null);
  }, [warehouseId, isEdit, dispatch]);
  const companyName =
    selectedWarehouse?.company?.name || companyOptions.find((c) => c.id === selectedCompanyId)?.name || "";

  // ---- Load the entry when editing ----------------------------------------
  useEffect(() => {
    if (!editId) return;
    dispatch(fetchOutwardById(editId)).then((result) => {
      if (!fetchOutwardById.fulfilled.match(result)) {
        toast.error(result.payload || "Unable to load outward entry.");
        navigate("/outward");
        return;
      }
      const x = result.payload;
      // Editable until the transportation details are sent AND Account has uploaded documents (x.editLocked, from the server).
      if (!isSuperAdmin && (x.editLocked || !["PENDING_APPROVAL", "REJECTED", "ON_HOLD", "PENDING_DISPATCH", "TRANSPORT_PENDING", "DOCS_PENDING"].includes(x.workflowStatus))) {
        toast.error(x.editLockReason || "This entry can no longer be edited.");
        navigate(`/outward/${editId}`, { replace: true });
        return;
      }
      if (x.warehouse) {
        setEntryWarehouse(x.warehouse);
        setSelectedCompanyId(x.warehouse.companyId || x.warehouse.company?.id || "");
        setPickedWarehouseId(x.warehouse.id);
      }
      setOutwardDateTime(getDateTimeLocal(x.refDocDate || x.createdAt));
      setOutwardType(/^return/i.test(x.outwardType || "") ? "Replacement" : x.outwardType || "Sale - Stock Out");
      setCustomerName(x.customerName || "");
      setPiNumber(x.piNumber || "");
      setPiDate(x.piDate ? String(x.piDate).slice(0, 10) : "");
      setPiAmount(x.piAmount === null || x.piAmount === undefined ? "" : String(x.piAmount));
      setShipToContactPerson(x.shipToContactPerson || "");
      setShipToContactNo(x.shipToContactNo || "");
      setShipToLocation(x.shipToLocation || "");
      setBillToContactPerson(x.billToContactPerson || "");
      setBillToContactNo(x.billToContactNo || "");
      setBillToEmail(x.billToEmail || "");
      setSalesDispatchRemarks(x.dispatchRemarks || "");
      setKeepPiFile(Boolean(x.hasPiFile));
      setSavedPiFileName(x.piFileName || "");
      setItems(
        (x.items || []).map((i) => ({
          ...newItem(),
          serverId: i.id,
          category: i.category || "",
          companyName: i.companyName || "",
          sku: i.sku || "",
          quantity: String(i.quantity ?? ""),
          uom: i.uom || "Pcs",
          paymentStatus: i.paymentStatus || "PENDING",
          utrNumber: i.utrNumber || "",
          approvedBy: i.approvedBy || "",
          keepProof: Boolean(i.hasProof),
          savedProofName: i.proofFileName || "",
        }))
      );
      setOriginalItems(x.items || []);
      {
        const first = (x.items || [])[0];
        if (first) {
          setPayment({
            paymentStatus: first.paymentStatus || "PENDING",
            utrNumber: first.utrNumber || "",
            approvedBy: first.approvedBy || "",
            proof: null,
            keepProof: Boolean(first.hasProof),
            savedProofName: first.proofFileName || "",
          });
        }
      }
      setEntryStatus(x.workflowStatus || null);
      setTransportLocked(Boolean(x.transportLocked));
      // Prefill what the warehouse already filled (vehicle, mode, reference documents, remarks).
      if (x.dispatchMode && !isPlaceholder(x.dispatchMode)) setDispatchMode(x.dispatchMode);
      setVehicleNumber(x.vehicleNumber || "");
      setDriverName(x.driverName || "");
      setDriverContact(x.driverContact || "");
      setDispatchRemarks(x.remarks || "");
      const savedRefs = Array.isArray(x.referenceDocuments) ? x.referenceDocuments : [];
      const toRow = (base, r) => ({
        ...base,
        refDocType: r.refDocType || base.refDocType,
        refDocNumber: isPlaceholder(r.refDocNumber) ? "" : r.refDocNumber,
        ewayBillNumber: r.ewayBillNumber || "", // older entries: kept as saved
      });
      const savedAccount = savedRefs.filter((r) => isAccountRef(r) && !isLegacyEwayRef(r));
      const savedManager = savedRefs.filter((r) => !isAccountRef(r));
      if (savedAccount.length) setAccountRefs(savedAccount.map((r) => toRow(newAccountRef(), r)));
      if (savedManager.length) setManagerRefs(savedManager.map((r) => toRow(newManagerRef(), r)));
      setLegacyRefs(savedRefs.filter(isLegacyEwayRef).map((r) => ({
        refDocType: r.refDocType,
        refDocNumber: String(r.refDocNumber || "").trim() || String(r.ewayBillNumber || "").trim(),
        ewayBillNumber: r.ewayBillNumber ? String(r.ewayBillNumber).trim() : undefined,
      })));
      if (x.workflowStatus === "REJECTED") {
        setRejection({ by: x.approvedByName, remarks: x.approvalRemarks });
      }
      if (x.workflowStatus === "ON_HOLD") {
        setHoldNote({ by: x.approvedByName, remarks: x.approvalRemarks });
      }
      setLoadingEntry(false);
    });
  }, [dispatch, editId, navigate, isSuperAdmin]);

  // ---- Stock in the selected warehouse -------------------------------------
  // Editing: this entry's own quantities count as available again (server-side).
  const { rows: stockRows, status: stockStatus, reload: reloadStock } = useOutwardStock(warehouseId, editId);
  const stockByKey = useMemo(() => new Map(stockRows.map((r) => [stockKey(r.category, r.sku), r])), [stockRows]);
  const originalQtyByKey = useMemo(() => {
    const totals = new Map();
    for (const i of originalItems) {
      const key = stockKey(i.category, i.sku);
      totals.set(key, (totals.get(key) || 0) + (Number(i.quantity) || 0));
    }
    return totals;
  }, [originalItems]);

  // How many of this model ONE item row can still take: what the warehouse has,
  // minus what the OTHER rows on this form already take (so two rows of the same
  // model can't add up to more than the stock). An entry being edited may keep
  // the quantity it already reserved, even if stock has dropped since.
  const availableFor = (itemId, category, sku) => {
    const key = stockKey(category, sku);
    const row = stockByKey.get(key);
    const base = Math.max(row?.available || 0, originalQtyByKey.get(key) || 0);
    const takenByOthers = items.reduce(
      (sum, i) => (i.id !== itemId && stockKey(i.category, i.sku) === key ? sum + (Number(i.quantity) || 0) : sum),
      0
    );
    return { available: Math.max(base - takenByOthers, 0), uom: row?.uom || "" };
  };

  const stockBlockReason = !warehouseId
    ? "Select warehouse first"
    : stockStatus === "failed"
      ? "Couldn't load stock"
      : stockStatus !== "succeeded"
        ? "Loading stock..."
        : "";

  const permissions = getWarehousePermissions(user, selectedWarehouse || warehouseId);
  const operationBlocked =
    !selectedWarehouse || selectedWarehouse.company?.status === "Inactive" || selectedWarehouse.Outward !== "Active";

  // ---- Items ---------------------------------------------------------------
  const updateItem = (id, field, value) => setItems((p) => p.map((i) => {
    if (i.id !== id) return i;
    // Picking a different category / SKU means a different product, so the
    // (hidden) company carried over from an older entry no longer applies.
    // The quantity is cleared too: it was typed against the previous model's stock limit.
    if (field === "category") {
      const uom = isCableCategory(value) ? "Meters" : isCableCategory(i.category) ? "Pcs" : i.uom;
      return { ...i, category: value, sku: "", companyName: "", quantity: "", uom };
    }
    if (field === "sku") return { ...i, sku: value, companyName: "", quantity: "" };
    return { ...i, [field]: value };
  }));
  const patchItem = (id, patch) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addItem = () => setItems((p) => [...p, newItem()]);
  const removeItem = (id) => {
    if (itemsRef.current.length === 1) return;
    // Removing an item row also deletes a proof that was uploaded for it but never saved.
    const fileKey = itemsRef.current.find((i) => i.id === id)?.proof?.fileKey;
    if (fileKey) dispatch(deleteUploadedProof({ fileKey }));
    setItems((p) => p.filter((i) => i.id !== id));
  };

  const handleProofPick = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File size must be less than 10 MB.");
    if (!PROOF_TYPES.includes(file.type)) return toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");

    if (!warehouseId) return toast.error("Please select a warehouse before attaching a payment proof.");

    const previousKey = paymentRef.current.proof?.fileKey;
    setProofUploadingId("payment");
    const result = await dispatch(uploadOutwardProof({ file, warehouseId, outwardId }));
    setProofUploadingId(null);
    if (uploadOutwardProof.fulfilled.match(result)) {
      setPayment((p) => ({ ...p, proof: result.payload, keepProof: false }));
      // The file it replaces was never saved, so it is deleted from storage right away.
      if (previousKey) dispatch(deleteUploadedProof({ fileKey: previousKey }));
    } else {
      toast.error(result.payload || "Failed to upload the file.");
    }
  };
  const removeProof = () => {
    // A file uploaded in this session (not saved yet) is deleted from storage now; a saved proof is
    // deleted by the server when the entry is saved without it.
    const fileKey = paymentRef.current.proof?.fileKey;
    if (fileKey) dispatch(deleteUploadedProof({ fileKey }));
    setPayment((p) => ({ ...p, proof: null, keepProof: false, savedProofName: "" }));
  };

  const handlePiPick = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File size must be less than 10 MB.");
    if (!PROOF_TYPES.includes(file.type)) return toast.error("Only PDF, JPG, PNG and WEBP files are allowed.");
    if (!warehouseId) return toast.error("Please select a warehouse before attaching the PI file.");

    const previousKey = piFileRef.current?.fileKey;
    setPiUploading(true);
    const result = await dispatch(uploadOutwardProof({ file, warehouseId, outwardId }));
    setPiUploading(false);
    if (uploadOutwardProof.fulfilled.match(result)) {
      setPiFile(result.payload);
      setKeepPiFile(false);
      // The file it replaces was never saved, so it is deleted from storage right away.
      if (previousKey) dispatch(deleteUploadedProof({ fileKey: previousKey }));
    } else {
      toast.error(result.payload || "Failed to upload the file.");
    }
  };

  const removePiFile = () => {
    if (piFileRef.current?.fileKey) dispatch(deleteUploadedProof({ fileKey: piFileRef.current.fileKey }));
    setPiFile(null);
    setKeepPiFile(false);
    setSavedPiFileName("");
  };

  const hasPiFile = Boolean(piFile) || keepPiFile;
  const piFileName = piFile?.fileName || savedPiFileName || "PI file";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCompanyId) return toast.error("Please select a company.");
    if (!warehouseId) return toast.error("Please select a warehouse.");
    if (operationBlocked || !permissions.canOutward) return toast.error("Outward is not available for this warehouse.");
    if (!customerName.trim()) return toast.error("Please enter customer name.");
    if (!companyName.trim()) return toast.error("Company name is missing.");
    if (piAmount !== "" && (!Number.isFinite(Number(piAmount)) || Number(piAmount) < 0)) return toast.error("Please enter a valid PI amount.");

    if (!shipToContactPerson.trim()) return toast.error("Please enter Ship to contact person.");
    if (!billToContactPerson.trim()) return toast.error("Please enter Bill to contact person.");
    if (!shipToContactNo.trim()) return toast.error("Please enter Ship to contact no.");
    if (!billToContactNo.trim()) return toast.error("Please enter Bill to contact no.");
    if (billToEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billToEmail.trim())) return toast.error("Please enter a valid Bill to email address.");
    for (const [label, value] of [["Ship to contact no.", shipToContactNo], ["Bill to contact no.", billToContactNo]]) {
      if (value.trim() && !/^\d{10}$/.test(value.trim())) return toast.error(`${label} must be exactly 10 digits.`);
    }
    if (driverContact.trim() && !/^\d{10}$/.test(driverContact.trim())) return toast.error("Driver contact must be exactly 10 digits.");

    for (const [index, item] of items.entries()) {
      const label = `Item ${index + 1}`;
      if (!item.category) return toast.error(`${label}: please select a category.`);
      if (!item.sku.trim()) return toast.error(`${label}: please select SKU / model.`);
      if (Number(item.quantity) <= 0) return toast.error(`${label}: please enter a valid quantity.`);
      if (!item.uom) return toast.error(`${label}: please select UOM.`);
    }

    // Payment details are shared by all items.
    if (!payment.paymentStatus) return toast.error("Please select the payment status.");
    if (payment.paymentStatus !== "COMPLETED" && !payment.approvedBy.trim()) return toast.error("Please enter Approve By.");
    if (payment.paymentStatus !== "PENDING" && payment.utrNumber.trim() && !/^\d{12}$/.test(payment.utrNumber.trim())) return toast.error("UTR number must be exactly 12 digits.");
    if (payment.paymentStatus !== "PENDING" && !payment.utrNumber.trim() && !payment.proof) {
      // A proof saved earlier only covers items that already had one.
      const savedCovers = payment.keepProof && items.every((i) => originalItems.some((o) => o.id === i.serverId && o.hasProof));
      if (!savedCovers) return toast.error("Enter the UTR number or attach a payment proof (image / file).");
    }

    // Can't dispatch more than is in stock. (The server checks again when saving.)
    if (stockStatus !== "succeeded") return toast.error("Available stock hasn't loaded yet. Please wait a moment (or reload the page) and try again.");
    for (const item of items) {
      const { available, uom } = availableFor(item.id, item.category, item.sku);
      if (Number(item.quantity) > available) {
        return toast.error(
          available <= 0
            ? `"${item.sku}" is out of stock in this warehouse.`
            : `Not enough stock for "${item.sku}": only ${available}${uom ? ` ${uom}` : ""} available for this item.`
        );
      }
    }

    const payload = {
      ...(isEdit ? {} : { id: outwardId }),
      warehouseId,
      companyId: selectedCompanyId,
      outwardType,
      outwardDateTime,
      customerName: customerName.trim(),
      companyName: companyName.trim(),
      piNumber: piNumber.trim() || undefined,
      piDate: piDate || undefined,
      piAmount: piAmount === "" ? undefined : Number(piAmount),
      piFileKey: piFile?.fileKey,
      piFileName: piFile?.fileName,
      piFileType: piFile?.fileType,
      keepPiFile: !piFile && keepPiFile,
      shipToContactPerson: shipToContactPerson.trim() || undefined,
      shipToContactNo: shipToContactNo.trim() || undefined,
      shipToLocation: shipToLocation.trim() || undefined,
      billToContactPerson: billToContactPerson.trim() || undefined,
      billToContactNo: billToContactNo.trim() || undefined,
      billToEmail: billToEmail.trim() || undefined,
      dispatchRemarks: salesDispatchRemarks.trim() || undefined,
      items: items.map((i) => {
        const paid = payment.paymentStatus !== "PENDING";
        return {
          serverId: i.serverId,
          category: i.category,
          companyName: i.companyName?.trim() || undefined,
          sku: i.sku.trim(),
          quantity: Number(i.quantity),
          uom: i.uom,
          paymentStatus: payment.paymentStatus,
          utrNumber: paid ? payment.utrNumber.trim() || undefined : undefined,
          approvedBy: payment.paymentStatus !== "COMPLETED" ? payment.approvedBy.trim() || undefined : undefined,
          proofFileKey: paid ? payment.proof?.fileKey : undefined,
          proofFileName: paid ? payment.proof?.fileName : undefined,
          proofFileType: paid ? payment.proof?.fileType : undefined,
          keepProof: paid && !payment.proof && payment.keepProof,
        };
      }),
    };

    if (showDispatchSection) {
      const toPayload = (r) => ({
        refDocType: r.refDocType,
        refDocNumber: r.refDocNumber.trim(),
        ewayBillNumber: r.ewayBillNumber?.trim() || undefined,
      });
      const refs = [
        ...accountRefs.filter((r) => r.refDocNumber.trim()).map(toPayload),
        ...managerRefs.filter((r) => r.refDocNumber.trim()).map(toPayload),
        ...legacyRefs,
      ];
      if (["DISPATCHED", "DELIVERED"].includes(entryStatus)) {
        if (!refs.length) return toast.error("Please enter at least one reference document number.");
        if (!dispatchMode && !transportLocked) return toast.error("Please select the dispatch mode.");
      }
      payload.dispatch = {
        dispatchMode,
        vehicleNumber: vehicleNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        driverContact: driverContact.trim() || undefined,
        remarks: dispatchRemarks.trim() || undefined,
        referenceDocuments: refs,
      };
    }

    const result = isEdit
      ? await dispatch(updateOutward({ id: editId, payload }))
      : await dispatch(createOutward(payload));
    const failed = isEdit ? updateOutward.rejected.match(result) : createOutward.rejected.match(result);
    if (failed) return toast.error(result.payload?.message || "Failed to save outward entry.");

    toast.success(result.payload?.message || "Outward entry submitted for account approval.");
    dispatch(resetOutwardCreateStatus());
    // replace (not push) so a successful save doesn't leave the form in browser history.
    const savedStatus = result.payload?.data?.workflowStatus;
    // Super admin + an approved entry waiting for dispatch goes straight to the dispatch form.
    const target = isEdit ? (isSuperAdmin && ["PENDING_DISPATCH", "TRANSPORT_PENDING"].includes(savedStatus) ? `/outward/${editId}/dispatch` : `/outward/${editId}`) : "/outward";
    navigate(target, { replace: true });
  };

  const saving = createStatus === "loading";

  if (loadingEntry) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading outward entry...
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800"><ArrowLeft size={22} /></button>
          <div>
            <h1 className="text-base font-semibold text-gray-900 md:text-lg">{isEdit ? "Edit outward entry" : "New outward entry"}</h1>
            <p className="text-xs text-gray-400">
              {isEdit
                ? "Update the details and send them for approval again"
                : "Fill the customer and item details. It goes to the Account team for approval."}
            </p>
          </div>
        </div>

        {alreadyApproved && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            This entry is approved and waiting for dispatch. Saving any change sends it back to the Account team for approval, and the warehouse will not see it until it is approved again.
          </div>
        )}
        {holdNote && (
          <div className="mb-5 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
            <p className="font-semibold">On hold by Account{holdNote.by ? ` (${holdNote.by})` : ""}</p>
            {holdNote.remarks && <p className="mt-1">Reason: {holdNote.remarks}</p>}
            <p className="mt-1 text-xs text-purple-700">Update the details below and save to send it for approval again.</p>
          </div>
        )}
        {rejection && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">Rejected by Account{rejection.by ? ` (${rejection.by})` : ""}</p>
            {rejection.remarks && <p className="mt-1">Reason: {rejection.remarks}</p>}
            <p className="mt-1 text-xs text-red-600">Fix the details below and save to send it for approval again.</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Company & Warehouse</h2>
            {isEdit ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div><label className={labelCls}>Company</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{companyName || "-"}</div></div>
                <div><label className={labelCls}>Warehouse</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">{selectedWarehouse?.name || "-"}</div></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelCls}>Company</label>
                  <div className="relative">
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => { setSelectedCompanyId(e.target.value); setPickedWarehouseId(""); }}
                      className={`${inputCls} appearance-none bg-white`}
                    >
                      <option value="">Select company</option>
                      {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Warehouse</label>
                  <div className="relative">
                    <select
                      value={pickedWarehouseId}
                      disabled={!selectedCompanyId}
                      onChange={(e) => setPickedWarehouseId(e.target.value)}
                      className={`${inputCls} appearance-none bg-white disabled:bg-gray-100 disabled:text-gray-400`}
                    >
                      <option value="">{selectedCompanyId ? "Select warehouse" : "Select company first"}</option>
                      {companyWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
              </div>
            )}
            {selectedWarehouse && operationBlocked && (
              <p className="mt-3 text-xs text-red-600">Outward is disabled for this warehouse or its company.</p>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Customer details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div><label className={labelCls}>Outward date and time</label><input type="datetime-local" value={outwardDateTime} onChange={(e) => setOutwardDateTime(e.target.value)} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Outward type</label>
                <div className="relative">
                  <select value={outwardType} onChange={(e) => setOutwardType(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option>Sale - Stock Out</option><option>Service - Stock Out</option><option>Replacement</option><option>Damage / Scrap Out</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                </div>
              </div>
            </div>
            <div className="mt-4">
              <PartyNameField value={customerName} onChange={setCustomerName} sharedOptions={sharedCustomers} onAddOption={saveCustomer} storageKey="outward-customer-names" label="Customer Name" labelCls={labelCls} inputCls={inputCls} placeholder="Enter customer name" addLabel="+ Add new customer" />
            </div>

            {/* PI row: PI No., PI date, PI amount, PI upload */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <label className={labelCls}>PI No.</label>
                <input value={piNumber} onChange={(e) => setPiNumber(e.target.value)} placeholder="Enter PI number" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PI date</label>
                <input type="date" value={piDate} onChange={(e) => setPiDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PI amount (inclusive GST)</label>
                <input type="number" min="0" step="0.01" value={piAmount} onChange={(e) => setPiAmount(e.target.value)} placeholder="0.00" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PI upload</label>
                {hasPiFile ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                    <span className="flex min-w-0 items-center gap-2"><Paperclip size={15} className="shrink-0" /><span className="truncate">{piFileName}</span></span>
                    <button type="button" onClick={removePiFile} title="Remove" className="shrink-0 text-green-700 hover:text-red-600"><X size={16} /></button>
                  </div>
                ) : (
                  <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-white px-3 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 ${piUploading ? "pointer-events-none opacity-60" : ""}`}>
                    {piUploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                    {piUploading ? "Uploading..." : "Attach file"}
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={piUploading} onChange={(e) => { handlePiPick(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>

            {/* Ship to details */}
            <h3 className="mt-6 mb-3 border-t border-gray-100 pt-5 text-sm font-semibold text-gray-900">Ship to details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div><label className={labelCls}>Contact person <span className="text-red-500">*</span></label><input required value={shipToContactPerson} onChange={(e) => setShipToContactPerson(e.target.value)} placeholder="Enter contact person" className={inputCls} /></div>
              <div><label className={labelCls}>Contact no. <span className="text-red-500">*</span></label><input required type="tel" inputMode="numeric" maxLength={10} value={shipToContactNo} onChange={(e) => setShipToContactNo(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter contact number" className={inputCls} /></div>
              <div><label className={labelCls}>Location</label><input value={shipToLocation} onChange={(e) => setShipToLocation(e.target.value)} placeholder="Enter location or paste Google Maps link" className={inputCls} /><LocationLink value={shipToLocation} short /></div>
            </div>

            {/* Bill to details */}
            <h3 className="mt-6 mb-3 border-t border-gray-100 pt-5 text-sm font-semibold text-gray-900">Bill to details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              <div><label className={labelCls}>Contact person <span className="text-red-500">*</span></label><input required value={billToContactPerson} onChange={(e) => setBillToContactPerson(e.target.value)} placeholder="Enter contact person" className={inputCls} /></div>
              <div><label className={labelCls}>Contact no. <span className="text-red-500">*</span></label><input required type="tel" inputMode="numeric" maxLength={10} value={billToContactNo} onChange={(e) => setBillToContactNo(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter contact number" className={inputCls} /></div>
              <div><label className={labelCls}>Email</label><input type="email" value={billToEmail} onChange={(e) => setBillToEmail(e.target.value)} placeholder="Enter email" className={inputCls} /></div>
            </div>

            {/* Dispatch remarks - Sales' instructions for the warehouse */}
            <h3 className="mt-6 mb-3 border-t border-gray-100 pt-5 text-sm font-semibold text-gray-900">Dispatch remarks</h3>
            <div>
              <label className={labelCls}>Dispatch Remarks</label>
              <textarea rows={3} maxLength={1000} value={salesDispatchRemarks} onChange={(e) => setSalesDispatchRemarks(e.target.value)} placeholder="Packing / delivery instructions or any note for the warehouse team" className={`${inputCls} resize-none`} />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Item details</h2>
              <button type="button" onClick={addItem} className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700"><Plus size={14} />Add item</button>
            </div>
            <ItemProductNotice isAdmin={isSuperAdmin} />
            {warehouseId && stockStatus === "failed" ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <span>Couldn't load the available stock for this warehouse.</span>
                <button type="button" onClick={reloadStock} className="font-semibold underline">Retry</button>
              </div>
            ) : (
              <p className="mb-3 text-xs text-gray-500">Only models that are in stock in the selected warehouse can be sent out, and the quantity can't be more than what is available.</p>
            )}

            <div className="space-y-4">
              {items.map((item, index) => {
                const stockInfo = item.sku ? availableFor(item.id, item.category, item.sku) : null;
                const overLimit = stockInfo && Number(item.quantity) > stockInfo.available;

                return (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-black">Item {index + 1}</span>
                      {items.length > 1 && <button type="button" onClick={() => removeItem(item.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Delete item</button>}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
                      <ItemProductFields item={item} products={products} onChange={(field, value) => updateItem(item.id, field, value)} inputCls={inputCls} labelCls={labelCls} categoryClass="md:col-span-3" skuClass="md:col-span-5" getStock={(category, sku) => availableFor(item.id, category, sku)} stockBlockReason={stockBlockReason} />
                      <div className="md:col-span-2">
                        <label className={labelCls}>Quantity</label>
                        <input
                          type="number"
                          min="1"
                          max={stockInfo ? stockInfo.available : undefined}
                          value={item.quantity}
                          onChange={(e) => {
                            let value = e.target.value;
                            // Never let the quantity go above what is available.
                            if (stockInfo && value !== "" && Number(value) > stockInfo.available) value = String(stockInfo.available);
                            updateItem(item.id, "quantity", value);
                          }}
                          placeholder="0"
                          className={`${inputCls} ${overLimit ? "border-red-400" : ""}`}
                        />
                        {stockInfo && stockStatus === "succeeded" && (
                          <p className={`mt-1 text-[11px] ${overLimit || stockInfo.available <= 0 ? "text-red-600" : "text-gray-400"}`}>
                            {stockInfo.available <= 0 ? "Out of stock" : overLimit ? `Only ${stockInfo.available} available` : `Max ${stockInfo.available}${stockInfo.uom ? ` ${stockInfo.uom}` : ""}`}
                          </p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelCls}>UOM</label>
                        <select value={item.uom} onChange={(e) => updateItem(item.id, "uom", e.target.value)} className={`${inputCls} appearance-none`}>
                          <option>Pcs</option><option>Meters</option><option>Bundles</option>
                        </select>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Payment side - entered once for all items; never shown to the warehouse manager. */}
            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/40 p-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Payment status</label>
                  <div className="relative">
                    <select value={payment.paymentStatus} onChange={(e) => setPayment((p) => ({ ...p, paymentStatus: e.target.value }))} className={`${inputCls} appearance-none`}>
                      {COST_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  </div>
                </div>
                {payment.paymentStatus !== "COMPLETED" && (
                  <div>
                    <label className={labelCls}>Approve By</label>
                    <input value={payment.approvedBy} onChange={(e) => setPayment((p) => ({ ...p, approvedBy: e.target.value }))} placeholder="Enter approver name" className={inputCls} />
                  </div>
                )}
              </div>

              {payment.paymentStatus !== "PENDING" && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>UTR number</label>
                    <input inputMode="numeric" maxLength={12} value={payment.utrNumber} onChange={(e) => setPayment((p) => ({ ...p, utrNumber: e.target.value.replace(/\D/g, "").slice(0, 12) }))} placeholder="Enter 12-digit UTR number" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Payment proof (image / file)</label>
                    {Boolean(payment.proof) || payment.keepProof ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
                        <span className="flex min-w-0 items-center gap-2"><Paperclip size={15} className="shrink-0" /><span className="truncate">{payment.proof?.fileName || payment.savedProofName || "Payment proof"}</span></span>
                        <button type="button" onClick={removeProof} title="Remove" className="shrink-0 text-green-700 hover:text-red-600"><X size={16} /></button>
                      </div>
                    ) : (
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-blue-300 bg-white px-3 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-50 ${proofUploadingId === "payment" ? "pointer-events-none opacity-60" : ""}`}>
                        {proofUploadingId === "payment" ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
                        {proofUploadingId === "payment" ? "Uploading..." : "Attach file"}
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={proofUploadingId === "payment"} onChange={(e) => { handleProofPick(e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 sm:col-span-2">
                    {payment.paymentStatus === "COMPLETED" ? "Completed" : "Partially completed"} needs the UTR number or a payment proof (either one is enough). This applies to all items.
                  </p>
                </div>
              )}
            </div>
          </section>

          {showDispatchSection && (
            <>
              {/* ACCOUNT part - invoice reference + invoice / other account documents, right after the items. */}
              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Reference documents (Account)</h2>
                    <p className="mt-0.5 text-xs text-gray-500">Invoice and other references added by the account team</p>
                  </div>
                  <button type="button" onClick={addAccountRef} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={13} />Add document</button>
                </div>
                <div className="space-y-4">
                  {accountRefs.map((r, index) => (
                    <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                      {accountRefs.length > 1 && (
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-black">Reference document {index + 1}</span>
                          <button type="button" onClick={() => removeAccountRef(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className={labelCls}>Reference doc type</label>
                          <div className="relative">
                            <select value={r.refDocType} onChange={(e) => updateAccountRef(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                              {ACCOUNT_REF_TYPES.map((t) => <option key={t} value={t}>{refTypeLabel(t)}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          </div>
                        </div>
                        <div><label className={labelCls}>{refNumberLabel(r.refDocType)}</label><input value={r.refDocNumber} onChange={(e) => updateAccountRef(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <OutwardDocuments
                outwardId={editId}
                documents={(currentOutward?.documents || []).filter((d) => isAccountDocCategory(d.docCategory))}
                canManage
                requiredDocuments={[]}
                optionalDocuments={[...new Set(accountRefs.map((r) => refTypeDocument(r.refDocType)).filter(Boolean))]}
                addMenuTypes={["Invoice", "E-way bill", "DC challan", "Other"]}
                otherPrefix={ACCOUNT_DOC_PREFIX}
                showSummary={false}
                title="Documents (Account)"
                subtitle="One row for each reference document above. Uploading is optional."
              />

              {/* WAREHOUSE MANAGER part - dispatch details, delivery challan / return note references, dispatch documents. */}
              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Dispatch details</h2>
                {transportLocked && (
                  <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Vehicle / driver / transporter details are locked: the account team has already uploaded its documents.</p>
                )}
                <fieldset disabled={transportLocked} className="grid min-w-0 grid-cols-1 gap-4 border-0 p-0 md:grid-cols-3">
                  <div>
                    <label className={labelCls}>Dispatch mode</label>
                    <div className="relative">
                      <select value={dispatchMode} onChange={(e) => setDispatchMode(e.target.value)} className={`${inputCls} appearance-none`}>
                        <option>By Road</option><option>Courier</option><option>Customer Pickup</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    </div>
                  </div>
                  <div><label className={labelCls}>Vehicle / AWB number</label><input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="If applicable" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver name</label><input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Enter driver name" className={inputCls} /></div>
                  <div><label className={labelCls}>Driver contact</label><input type="tel" inputMode="numeric" maxLength={10} value={driverContact} onChange={(e) => setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Enter driver contact no." className={inputCls} /></div>
                </fieldset>

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">Reference documents</span>
                  <button type="button" onClick={addManagerRef} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"><Plus size={13} />Add document</button>
                </div>
                <div className="mt-2 space-y-4">
                  {managerRefs.map((r, index) => (
                    <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                      {managerRefs.length > 1 && (
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-black">Reference document {index + 1}</span>
                          <button type="button" onClick={() => removeManagerRef(r.id)} className="flex items-center gap-1 text-xs text-red-500"><Trash2 size={13} />Remove</button>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className={labelCls}>Reference doc type</label>
                          <div className="relative">
                            <select value={r.refDocType} onChange={(e) => updateManagerRef(r.id, "refDocType", e.target.value)} className={`${inputCls} appearance-none`}>
                              {MANAGER_REF_TYPES.map((t) => <option key={t}>{t}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          </div>
                        </div>
                        <div><label className={labelCls}>Reference doc no.</label><input value={r.refDocNumber} onChange={(e) => updateManagerRef(r.id, "refDocNumber", e.target.value)} placeholder="Enter document number" className={inputCls} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <OutwardDocuments
                outwardId={editId}
                documents={(currentOutward?.documents || []).filter((d) => !isAccountDocCategory(d.docCategory) && !isReceivingDocCategory(d.docCategory))}
                canManage
                requiredDocuments={[]}
                showSummary={false}
                optionalDocuments={[...new Set(managerRefs.map((r) => refTypeDocument(r.refDocType)).filter(Boolean))]}
                addMenuTypes={[...REQUIRED_DOCUMENTS, "Bilty", "Return note", "Other"]}
                title="Dispatch documents"
              />

              <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
                <label className={labelCls}>Dispatch remarks</label>
                <textarea rows={3} value={dispatchRemarks} onChange={(e) => setDispatchRemarks(e.target.value)} placeholder="Package condition, dispatch notes, etc." className={`${inputCls} resize-none`} />
              </section>
            </>
          )}

          <button type="submit" disabled={saving || proofUploadingId !== null || piUploading} className="w-full rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
            {saving ? "Saving..." : isEdit ? "Save and send for approval" : "Submit for approval"}
          </button>
        </form>
      </div>
    </div>
  );
}
