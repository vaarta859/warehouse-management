import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { ChevronDown, Plus, Search } from "lucide-react";

import {
  selectAllProducts,
  selectProductStatus,
} from "../features/product/productSlice";

import AddProductModal from "./AddProductModal";

const sameText = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function SearchableSelect({
  value,
  options,
  disabled,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results found",
  inputCls,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return undefined;

    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        close();
      }
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return options;

    return options.filter((o) =>
      String(o.searchText ?? o.label)
        .toLowerCase()
        .includes(q)
    );
  }, [options, query]);

  const hasQty = options.some((o) => o.qty !== undefined);

  const pick = (option) => {
    if (option.disabled) return;

    onSelect(option.value);
    close();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`${inputCls} block appearance-none bg-white pr-8 text-left disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
      >
        <span
          className={`block truncate ${
            value ? "" : "text-gray-400"
          }`}
        >
          {value || placeholder}
        </span>
      </button>

      <ChevronDown
        size={16}
        className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="relative border-b border-gray-100 p-2">
            <Search
              size={14}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();

                  const first = filtered.find((o) => !o.disabled);

                  if (first) {
                    pick(first);
                  }
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-gray-200 py-1.5 pl-7 pr-2 text-sm text-gray-700 outline-none focus:border-blue-400"
            />
          </div>

          {hasQty && filtered.length > 0 && (
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <span>Model</span>

              <span className="min-w-[3rem] text-center">
                Qty.
              </span>
            </div>
          )}

          <ul
            role="listbox"
            className="max-h-60 overflow-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">
                {emptyText}
              </li>
            )}

            {filtered.map((option) => {
              const selected = option.value === value;

              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={Boolean(option.disabled)}
                >
                  <button
                    type="button"
                    disabled={option.disabled}
                    onClick={() => pick(option)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      option.disabled
                        ? "cursor-not-allowed text-gray-300"
                        : selected
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {option.qty === undefined ? (
                      option.label
                    ) : (
                      <span className="flex items-center justify-between gap-6">
                        <span className="min-w-0 truncate">
                          {option.label}
                        </span>

                        <span
                          className={`min-w-[2.5rem] shrink-0 rounded px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${
                            option.disabled
                              ? "bg-gray-50 text-gray-300"
                              : selected
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {option.qty}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ItemProductFields({
  item,
  products,
  onChange,
  inputCls,
  labelCls,
  categoryClass = "md:col-span-3",
  skuClass = "md:col-span-5",
  canAdd = false,
  getStock,
  stockBlockReason = "",
}) {
  const stockMode = typeof getStock === "function";

  const [addMode, setAddMode] = useState(null);

  const categories = useMemo(() => {
    const list = [...new Set(products.map((p) => p.category))];

    if (
      item.category &&
      !list.some((c) => sameText(c, item.category))
    ) {
      list.push(item.category);
    }

    return list.sort((a, b) => a.localeCompare(b));
  }, [products, item.category]);

  const categoryValue =
    categories.find((c) => sameText(c, item.category)) || "";

  const skus = useMemo(() => {
    const list = products
      .filter((p) => sameText(p.category, item.category))
      .map((p) => p.sku);

    if (
      item.sku &&
      !list.some((s) => sameText(s, item.sku))
    ) {
      list.push(item.sku);
    }

    return list.sort((a, b) => a.localeCompare(b));
  }, [products, item.category, item.sku]);

  const skuValue =
    skus.find((s) => sameText(s, item.sku)) || "";

  const handleCreated = (product) => {
    onChange("category", product.category);
    onChange("sku", product.sku);
    setAddMode(null);
  };

  const addButtonCls =
    "mb-1.5 inline-flex items-center gap-0.5 text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline";

  return (
    <>
      <div className={categoryClass}>
        <div className="flex items-start justify-between">
          <label className={labelCls}>
            Category
          </label>

          {canAdd && (
            <button
              type="button"
              onClick={() => setAddMode("category")}
              className={addButtonCls}
            >
              <Plus size={12} />
              Add
            </button>
          )}
        </div>

        <SearchableSelect
          value={categoryValue}
          disabled={Boolean(stockBlockReason)}
          placeholder={
            stockBlockReason || "Select category"
          }
          searchPlaceholder="Search category..."
          emptyText="No categories found"
          inputCls={inputCls}
          options={categories.map((category) => ({
            value: category,
            label: category,
          }))}
          onSelect={(category) =>
            onChange("category", category)
          }
        />
      </div>

      <div className={skuClass}>
        <div className="flex items-start justify-between">
          <label className={labelCls}>
            SKU / Model
          </label>

          {canAdd && (
            <button
              type="button"
              disabled={!item.category}
              onClick={() => setAddMode("sku")}
              title={
                item.category
                  ? ""
                  : "Select a category first"
              }
              className={addButtonCls}
            >
              <Plus size={12} />
              Add
            </button>
          )}
        </div>

        <SearchableSelect
          value={skuValue}
          disabled={
            !item.category ||
            Boolean(stockBlockReason)
          }
          placeholder={
            item.category
              ? "Select SKU / model"
              : "Select category first"
          }
          searchPlaceholder="Search SKU / model..."
          emptyText="No models found"
          inputCls={inputCls}
          options={skus.map((sku) => {
            if (!stockMode) {
              return {
                value: sku,
                label: sku,
              };
            }

            const { available } = getStock(
              item.category,
              sku
            );

            return {
              value: sku,
              label: sku,
              qty: available,
              disabled: available <= 0,
            };
          })}
          onSelect={(sku) =>
            onChange("sku", sku)
          }
        />
      </div>

      {addMode && (
        <AddProductModal
          lockedCategory={
            addMode === "sku"
              ? categoryValue || item.category
              : ""
          }
          categories={categories}
          onClose={() => setAddMode(null)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

export function ItemProductNotice({
  isAdmin = false,
  canAdd = false,
}) {
  const products = useSelector(selectAllProducts);
  const status = useSelector(selectProductStatus);

  if (
    status !== "succeeded" ||
    products.length > 0
  ) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
      No products have been added yet.{" "}

      {canAdd ? (
        <>
          Use the Add button next to Category to
          add the first one.
        </>
      ) : isAdmin ? (
        <>
          Add them in{" "}
          <Link
            to="/products"
            className="font-semibold underline"
          >
            Product Management
          </Link>
          .
        </>
      ) : (
        "Ask an admin to add them in Product Management."
      )}
    </div>
  );
}
