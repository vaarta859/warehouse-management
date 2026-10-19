import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { Loader2, Plus, X } from "lucide-react";
import SerialModePicker from "./SerialModePicker";
import {
  createProduct,
  selectProductSaveStatus,
} from "../features/product/productSlice";

/**
 * Small dialog used on the inward form to add a product (category + SKU / model)
 * that is missing from the dropdowns. Admins and warehouse managers can use it.
 *
 * The product is saved to the same product list that the Product Management
 * page shows, so it appears there straight away and in every dropdown.
 *
 * NOTE: this intentionally does NOT use a <form> element. The inward form is
 * one big <form>, and React lets submit events bubble out of a portal - a nested
 * <form> here would end up saving the whole GRN. Plain buttons + an Enter key
 * handler avoid that.
 *
 * Props:
 *   - lockedCategory: when set (the "Add" next to SKU), the category is fixed
 *     to the one already chosen on the item row and only the SKU is typed.
 *   - onClose():      close without saving.
 *   - onCreated(product): called with the saved product ({ category, sku, ... }).
 */
export default function AddProductModal({
  lockedCategory = "",
  categories = [],
  onClose,
  onCreated,
}) {
  const dispatch = useDispatch();
  const saving = useSelector(selectProductSaveStatus) === "loading";

  const [category, setCategory] = useState(lockedCategory);
  const [sku, setSku] = useState("");
  const [serialMode, setSerialMode] = useState("REQUIRED");
  const [error, setError] = useState("");
  const firstInput = useRef(null);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (saving) return;
    setError("");

    const cleanCategory = category.trim();
    const cleanSku = sku.trim();

    if (!cleanCategory) return setError("Item category is required.");
    if (!cleanSku) return setError("SKU / model is required.");

    const result = await dispatch(
      createProduct({
        category: cleanCategory,
        sku: cleanSku,
        // Adding only a model to a chosen category: it follows the category's serial rule.
        ...(lockedCategory ? {} : { serialMode }),
      })
    );

    if (createProduct.rejected.match(result)) {
      setError(result.payload || "Failed to add product");
      return;
    }

    const product = result.payload?.product || {
      category: cleanCategory,
      sku: cleanSku,
      ...(lockedCategory ? {} : { serialMode }),
    };

    onCreated(product);
  };

  const onEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    save();
  };

  const inputCls =
    "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Add category / SKU
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              It will be added to the product list and selected for this item.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 hover:bg-gray-100"
          >
            <X size={19} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-black">
              Item category
            </span>
            <input
              ref={lockedCategory ? undefined : firstInput}
              list="add-product-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={onEnter}
              disabled={Boolean(lockedCategory)}
              placeholder="Pick an existing one or type a new category"
              maxLength={100}
              className={inputCls}
            />
            {!lockedCategory && (
              <datalist id="add-product-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-black">
              SKU / Model
            </span>
            <input
              ref={lockedCategory ? firstInput : undefined}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              onKeyDown={onEnter}
              placeholder="e.g. GW5000-DNS"
              maxLength={100}
              className={inputCls}
            />
          </label>

          {/* Serial no. is a category setting: not asked when only a model is added to an existing category. */}
          {!lockedCategory && (
            <SerialModePicker value={serialMode} onChange={setSerialMode} disabled={saving} />
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Plus size={15} />
            )}
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
