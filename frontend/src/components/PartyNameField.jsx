import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

/**
 * Supplier / customer name field used on the inward and outward forms.
 *
 * A combobox: the input is always freely typable, and clicking it (or the
 * chevron) opens a dropdown of saved names (Sungrow, Saatvik, Lapp by
 * default, plus any added earlier) filtered as you type. Picking a row
 * fills the field. If what's typed isn't in the list, the dropdown's last
 * row is "+ Add '<text>'" - clicking it (or pressing Enter) saves that name
 * into the list (persisted in localStorage on this browser) and selects it.
 *
 * Props:
 *   - value / onChange: the field's current text value (same as a plain input).
 *   - storageKey: localStorage key used to persist added names.
 *   - defaultOptions: preset names shown before any are added.
 *   - inputCls, label, labelCls, placeholder: styling passed in from the form.
 */
const readStoredOptions = (storageKey, defaultOptions) => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultOptions;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultOptions;
    const merged = [...defaultOptions];
    parsed.forEach((name) => {
      if (name && !merged.some((m) => m.toLowerCase() === String(name).toLowerCase())) {
        merged.push(name);
      }
    });
    return merged;
  } catch {
    return defaultOptions;
  }
};

export default function PartyNameField({
  value,
  onChange,
  storageKey,
  defaultOptions = ["Sungrow", "Saatvik", "Lapp"],
  inputCls,
  label = "Supplier / Customer name",
  labelCls = "block text-sm font-semibold text-black mb-1.5",
  placeholder = "Select or type a name",
  // Names shared from the server (e.g. every customer added in this warehouse), shown to everyone.
  sharedOptions = [],
}) {
  const [localOptions, setOptions] = useState(() => readStoredOptions(storageKey, defaultOptions));
  const options = useMemo(() => {
    const merged = [...localOptions];
    sharedOptions.forEach((name) => {
      if (name && !merged.some((m) => m.toLowerCase() === String(name).toLowerCase())) merged.push(name);
    });
    return merged.sort((a, b) => a.localeCompare(b));
  }, [localOptions, sharedOptions]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setOptions(readStoredOptions(storageKey, defaultOptions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const persist = (next) => {
    try {
      const custom = next.filter(
        (o) => !defaultOptions.some((d) => d.toLowerCase() === o.toLowerCase())
      );
      window.localStorage.setItem(storageKey, JSON.stringify(custom));
    } catch {
      // localStorage unavailable - new names still work for this session
    }
  };

  const typed = (value || "").trim();
  const filtered = typed
    ? options.filter((o) => o.toLowerCase().includes(typed.toLowerCase()))
    : options;
  const exactMatch = options.some((o) => o.toLowerCase() === typed.toLowerCase());

  const selectOption = (name) => {
    onChange(name);
    setOpen(false);
  };

  const addTyped = () => {
    if (!typed) return;
    if (!exactMatch) {
      const next = [...localOptions, typed];
      setOptions(next);
      persist(next);
    }
    onChange(typed);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!exactMatch && typed) addTyped();
      else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef}>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`${inputCls} pr-9`}
        />
        <ChevronDown
          size={16}
          onClick={() => setOpen((o) => !o)}
          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-gray-400"
        />

        {open && (
          <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {filtered.length === 0 && !typed && (
              <div className="px-3 py-2 text-sm text-gray-400">No saved names yet</div>
            )}
            {filtered.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectOption(name)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${
                  name.toLowerCase() === typed.toLowerCase()
                    ? "bg-blue-50 font-medium text-blue-700"
                    : "text-gray-700"
                }`}
              >
                {name}
              </button>
            ))}
            {typed && !exactMatch && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={addTyped}
                className="flex w-full items-center gap-1.5 border-t border-gray-100 px-3 py-2 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                <Plus size={14} />
                Add &quot;{typed}&quot;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
