import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Search,
  Package,
  Layers,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Save,
} from "lucide-react";
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  clearProductError,
  selectAllProducts,
  selectProductStatus,
  selectProductSaveStatus,
  selectProductError,
} from "../features/product/productSlice";

const NEW_CATEGORY = "__new__";
const EMPTY_FORM = { category: "", sku: "" };

export default function ProductManagement() {
  const dispatch = useDispatch();

  const products = useSelector(selectAllProducts);
  const status = useSelector(selectProductStatus);
  const saveStatus = useSelector(selectProductSaveStatus);
  const error = useSelector(selectProductError);

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();
  const isAdmin = user?.role === "SUPER_ADMIN";

  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("create");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // "list" = pick an existing category, "new" = type a new one
  const [categoryMode, setCategoryMode] = useState("list");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (isAdmin) dispatch(fetchProducts({ force: true })); // always fresh here
    return () => {
      dispatch(clearProductError());
    };
  }, [dispatch, isAdmin]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.category.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, search]);

  // Only admins manage products. Everyone else just uses them in the
  // inward / outward forms.
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const openCreate = () => {
    setMode("create");
    setSelected(null);
    setForm(EMPTY_FORM);
    setCategoryMode(categories.length ? "list" : "new");
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (product) => {
    setMode("edit");
    setSelected(product);
    setForm({ category: product.category, sku: product.sku });
    setCategoryMode("list");
    setFormError("");
    setShowForm(true);
  };

  const close = () => {
    if (saveStatus === "loading") return;
    setShowForm(false);
    setSelected(null);
    setFormError("");
  };

  const onCategorySelect = (value) => {
    if (value === NEW_CATEGORY) {
      setCategoryMode("new");
      setForm((f) => ({ ...f, category: "" }));
      return;
    }
    setForm((f) => ({ ...f, category: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");

    const category = form.category.trim();
    const sku = form.sku.trim();

    if (!category) return setFormError("Item category is required.");
    if (!sku) return setFormError("SKU / module name is required.");

    const result =
      mode === "create"
        ? await dispatch(createProduct({ category, sku }))
        : await dispatch(updateProduct({ id: selected.id, category, sku }));

    const rejected =
      mode === "create"
        ? createProduct.rejected.match(result)
        : updateProduct.rejected.match(result);

    if (rejected) {
      setFormError(
        result.payload ||
          (mode === "create" ? "Failed to create product" : "Failed to update product")
      );
      return;
    }

    close();
  };

  const remove = async (product) => {
    const ok = window.confirm(
      `Delete "${product.sku}" from ${product.category}?`
    );
    if (!ok) return;
    await dispatch(deleteProduct(product.id));
  };

  const saving = saveStatus === "loading";

  if (status === "loading" && products.length === 0) {
    return (
      <div className="min-h-dvh bg-[#F1EFE8] flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 size={19} className="animate-spin" /> Loading products...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F1EFE8] p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-2xl">Product Management</h1>
          
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={18} /> Add Item
        </button>
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {typeof error === "object" ? error.message : error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Stat icon={Package} label="Total items" value={products.length} />
        <Stat icon={Layers} label="Categories" value={categories.length} />
      </div>

      {/* Search */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
        <div className="relative w-full">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by category or SKU / module name..."
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            {products.length === 0
              ? "No items yet. Click “Add Item” to create the first one."
              : "No items match your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="mobile-cards w-full min-w-[520px] text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Category
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    SKU / Module name
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((product) => (
                  <tr key={product.id}>
                    <td className="px-5 py-3.5 text-sm text-gray-700">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                      {product.sku}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(product)}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          onClick={() => remove(product)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {mode === "create" ? "Add Item" : "Edit Item"}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {mode === "create"
                    ? "Choose a category and enter the SKU / module name."
                    : "Changing the category or SKU also updates it on past inward / outward entries."}
                </p>
              </div>
              <button onClick={close} className="rounded-lg p-1.5 hover:bg-gray-100">
                <X size={19} />
              </button>
            </div>

            <form onSubmit={submit}>
              <div className="p-5 space-y-4">
                {/* Category */}
                <div>
                  <span className="mb-1 block text-sm font-semibold text-black">Item category</span>

                  {categoryMode === "list" ? (
                    <select
                      value={form.category}
                      onChange={(e) => onCategorySelect(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">Select category</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                      <option value={NEW_CATEGORY}>+ Add new category</option>
                    </select>
                  ) : (
                    <div>
                      <input
                        autoFocus
                        value={form.category}
                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                        placeholder="e.g. Inverter, Cable, Panel"
                        maxLength={100}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                      />
                      {categories.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryMode("list");
                            setForm((f) => ({ ...f, category: "" }));
                          }}
                          className="mt-1.5 text-xs font-medium text-blue-700 hover:underline"
                        >
                          Choose from existing categories
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* SKU */}
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-black">SKU / Module name</span>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    placeholder="e.g. GW5000-DNS"
                    maxLength={100}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />
                </label>

                {formError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {formError}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t bg-white px-5 py-4">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {mode === "create" ? "Add Item" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
        </div>
        <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}
