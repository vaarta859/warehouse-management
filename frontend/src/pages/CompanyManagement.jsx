import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Search,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Warehouse,
  Users,
  X,
  Loader2,
  Save,
  MapPin,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import {
  fetchCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  selectAllCompanies,
  selectCompanyStatus,
  selectCompanySaveStatus,
  selectCompanyError,
} from "../features/company/companySlice";

const PINCODE_REGEX = /^\d{6}$/;
const EMPTY_COMPANY = { name: "", locality: "", city: "", state: "", pincode: "", status: "Active" };

export default function CompanyManagement() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const companies = useSelector(selectAllCompanies);
  const status = useSelector(selectCompanyStatus);
  const saveStatus = useSelector(selectCompanySaveStatus);
  const error = useSelector(selectCompanyError);

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("create");
  const [selected, setSelected] = useState(null);
  const [company, setCompany] = useState(EMPTY_COMPANY);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    dispatch(fetchCompanies());
  }, [dispatch]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((item) =>
      [item.name, item.code, item.locality, item.city, item.state, item.pincode]
        .some((value) => String(value || "").toLowerCase().includes(q))
    );
  }, [companies, search]);

  const openCreate = () => {
    setMode("create");
    setSelected(null);
    setCompany(EMPTY_COMPANY);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (item) => {
    setMode("edit");
    setSelected(item);
    setCompany({
      name: item.name || "",
      locality: item.locality || "",
      city: item.city || "",
      state: item.state || "",
      pincode: item.pincode || "",
      status: item.status || "Active",
    });
    setFormError("");
    setShowForm(true);
  };

  const close = () => {
    if (saveStatus === "loading") return;
    setShowForm(false);
    setSelected(null);
    setFormError("");
  };

  const setCompanyField = (field, value) => setCompany((p) => ({ ...p, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!company.name.trim()) return setFormError("Company name is required.");
    if (!company.city.trim()) return setFormError("City is required.");
    if (!company.state.trim()) return setFormError("State is required.");
    if (!PINCODE_REGEX.test(company.pincode.trim())) return setFormError("Enter a valid 6-digit pincode.");


    const result = mode === "create"
      ? await dispatch(createCompany({
          name: company.name.trim(),
          locality: company.locality.trim() || undefined,
          city: company.city.trim(),
          state: company.state.trim(),
          pincode: company.pincode.trim(),
        }))
      : await dispatch(updateCompany({
          id: selected.id,
          name: company.name.trim(),
          locality: company.locality.trim(),
          city: company.city.trim(),
          state: company.state.trim(),
          pincode: company.pincode.trim(),
          status: company.status,
        }));

    if (mode === "create" && createCompany.rejected.match(result)) {
      setFormError(result.payload || "Failed to create company");
      return;
    }
    if (mode === "edit" && updateCompany.rejected.match(result)) {
      setFormError(result.payload || "Failed to update company");
      return;
    }

    // Company activation/deactivation must not modify WarehouseAccess grants.
    // Existing user permissions remain stored and become effective again
    // automatically when the company and warehouse operations are Active.

    close();
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    const result = await dispatch(deleteCompany(item.id));
    if (deleteCompany.rejected.match(result) && result.payload?.status === 409) {
      const force = window.confirm(`${result.payload.message}\n\nClick OK to force delete and unlink this company's users and warehouses.`);
      if (force) await dispatch(deleteCompany({ id: item.id, force: true }));
    }
  };

  if (status === "loading" && companies.length === 0) {
    return <Loading text="Loading companies..." />;
  }

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Companies</h1>
          <p className="text-xs text-gray-500 mt-0.5 sm:text-sm sm:mt-1">Manage companies and their warehouses.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
          <Plus size={18} /> Add Company
        </button>
      </div>

      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{typeof error === "object" ? error.message : error}</div>}

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5 sm:mb-6">
        <Stat icon={Building2} label="Total companies" value={companies.length} />
        <Stat icon={ShieldCheck} label="Active companies" value={companies.filter((x) => x.status === "Active").length} />
        <Stat icon={ShieldOff} label="Inactive companies" value={companies.filter((x) => x.status === "Inactive").length} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
        <div className="relative w-full">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, code, city..." className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((item) => {
          const warehouseCount = item._count?.warehouses ?? 0;
          const userCount = item._count?.users ?? 0;
          return (
            <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-3.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex gap-2.5 min-w-0">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><Building2 size={16} /></div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 text-sm truncate">{item.name}</h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">{item.code}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${item.status === "Active" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{item.status}</span>
              </div>

              <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1">
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">{[item.locality, item.city, item.state].filter(Boolean).join(", ") || "-"} {item.pincode ? `• ${item.pincode}` : ""}</span>
              </p>

              <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                <button onClick={() => navigate(`/warehousemanagement?companyId=${item.id}&companyName=${encodeURIComponent(item.name || "")}`)} className="rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 truncate"><Warehouse size={12} className="inline mr-1" />{warehouseCount}</button>
                <button onClick={() => navigate(`/allusers?companyId=${item.id}&companyName=${encodeURIComponent(item.name || "")}`)} className="rounded-lg bg-green-50 px-2 py-1.5 text-[11px] font-medium text-green-700 hover:bg-green-100 truncate"><Users size={12} className="inline mr-1" />{userCount}</button>
              </div>

              <div className="flex justify-end gap-1.5 mt-2.5 pt-2.5 border-t border-gray-100">
                <button onClick={() => openEdit(item)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"><Pencil size={12} /> Edit</button>
                <button onClick={() => remove(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-sm text-gray-500">No companies found.</div>}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-4" onClick={close}>
          <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div><h2 className="text-lg font-semibold text-gray-900">{mode === "create" ? "Add Company" : "Edit Company"}</h2><p className="text-xs text-gray-500 mt-0.5">Company code is generated by the server and cannot be changed.</p></div>
              <button onClick={close} className="rounded-lg p-1.5 hover:bg-gray-100"><X size={19} /></button>
            </div>
            <form onSubmit={submit}>
              <div className="p-5 space-y-4">
                <SectionTitle>Company details</SectionTitle>
                <Field label="Company name" value={company.name} onChange={(v) => setCompanyField("name", v)} required />
                <Field label="Locality / Area" value={company.locality} onChange={(v) => setCompanyField("locality", v)} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="City" value={company.city} onChange={(v) => setCompanyField("city", v)} required /><Field label="State" value={company.state} onChange={(v) => setCompanyField("state", v)} required /></div>
                <Field label="Pincode" value={company.pincode} onChange={(v) => setCompanyField("pincode", v.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" />
                {mode === "edit" && <Field label="Status" type="select" value={company.status} onChange={(v) => setCompanyField("status", v)} options={["Active", "Inactive"]} />}

                {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
              </div>
              <div className="flex justify-end gap-2 border-t bg-white px-5 py-4 sticky bottom-0">
                <button type="button" onClick={close} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200">Cancel</button>
                <button disabled={saveStatus === "loading"} type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">{saveStatus === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{mode === "create" ? "Create Company" : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Loading({ text }) { return <div className="min-h-dvh bg-[#F1EFE8] flex items-center justify-center"><div className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={19} className="animate-spin" /> {text}</div></div>; }
function Stat({ icon: Icon, label, value }) { return <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-5"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[11px] leading-tight text-gray-500 sm:text-sm">{label}</p><p className="text-xl font-semibold text-gray-900 mt-1 sm:text-2xl">{value}</p></div><div className="hidden h-10 w-10 shrink-0 rounded-lg bg-blue-50 text-blue-600 items-center justify-center sm:flex"><Icon size={20} /></div></div></div>; }
function SectionTitle({ children }) { return <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</p>; }
function Field({ label, value, onChange, type = "text", required = false, disabled = false, inputMode, options = [] }) { return <label className="block"><span className="mb-1 block text-sm font-semibold text-black">{label}</span>{type === "select" ? <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">{options.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled} inputMode={inputMode} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500" />}</label>; }