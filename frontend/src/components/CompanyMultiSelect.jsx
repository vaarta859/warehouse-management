import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * Dropdown to pick one or more companies for a user.
 *
 *  companies  - [{ id, name, code?, status? }]
 *  value      - selected company ids
 *  onChange   - (nextIds: string[]) => void
 *  lockedIds  - ids that are always selected and can't be removed
 *               (e.g. the company page the user is being created from)
 *  error      - validation message shown under the field
 *
 * The list opens in a floating panel (rendered in a portal), so it is never
 * clipped by a card or modal that has overflow hidden/scroll.
 */
export default function CompanyMultiSelect({
  companies = [],
  value = [],
  onChange,
  lockedIds = [],
  error,
  label = "Companies",
  hint = "This user can work in every company you select.",
  placeholder = "Select companies",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(null);

  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const selected = useMemo(() => new Set(value), [value]);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);

  const byId = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies]
  );

  const searchable = companies.length > 5;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.code].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [companies, query]);

  // ---------------------------------------------------
  // Position the floating panel under (or above) the field
  // ---------------------------------------------------
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 240 && rect.top > spaceBelow;
    const available = (openUp ? rect.top : spaceBelow) - 16;

    setPos({
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.max(160, Math.min(340, available)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true); // any scrolling ancestor

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // ---------------------------------------------------
  // Selection
  // ---------------------------------------------------
  const toggle = (id) => {
    if (locked.has(id)) return;
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const selectAllVisible = () => {
    const next = [...value];
    visible.forEach((c) => {
      if (!selected.has(c.id)) next.push(c.id);
    });
    onChange(next);
  };

  const clearAll = () => onChange(value.filter((id) => locked.has(id)));

  const onTriggerKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className="text-xs text-gray-400">{value.length} selected</span>
      </div>

      {/* Field */}
      <div
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={`flex min-h-[42px] w-full cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? "border-red-400" : "border-gray-300"
        }`}
      >
        <div className="flex flex-1 flex-wrap gap-1.5">
          {value.length === 0 && (
            <span className="py-1 text-gray-400">{placeholder}</span>
          )}

          {value.map((id) => {
            const company = byId.get(id);
            const isLocked = locked.has(id);

            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
              >
                <span className="truncate">{company?.name || "Company"}</span>
                {!isLocked && (
                  <button
                    type="button"
                    aria-label={`Remove ${company?.name || "company"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(id);
                    }}
                    className="rounded-full p-0.5 hover:bg-blue-100"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>

        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>

      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>
      )}

      {/* Floating list */}
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            className="z-[70] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {searchable && (
              <div className="relative border-b border-gray-200">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  placeholder="Search companies..."
                  className="w-full py-2 pl-9 pr-3 text-sm outline-none"
                />
              </div>
            )}

            {companies.length > 1 && (
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Select all{query.trim() ? " shown" : ""}
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
              {visible.map((company) => {
                const checked = selected.has(company.id);
                const isLocked = locked.has(company.id);

                return (
                  <label
                    key={company.id}
                    role="option"
                    aria-selected={checked}
                    className={`flex items-center gap-3 px-3 py-2.5 text-sm ${
                      isLocked
                        ? "cursor-not-allowed bg-gray-50"
                        : "cursor-pointer hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLocked}
                      onChange={() => toggle(company.id)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1 truncate font-medium text-gray-800">
                      {company.name}
                    </span>
                    {company.status === "Inactive" && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        Inactive
                      </span>
                    )}
                    {company.code && (
                      <span className="text-xs text-gray-400">{company.code}</span>
                    )}
                    {checked && <Check size={14} className="text-blue-600" />}
                  </label>
                );
              })}

              {visible.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-gray-500">
                  {companies.length === 0
                    ? "No companies available."
                    : "No companies match your search."}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}