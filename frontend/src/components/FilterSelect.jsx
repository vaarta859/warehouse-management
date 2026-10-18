import { ChevronDown } from "lucide-react";

/** Simple drop-down used for the list filters (All types / All status). options: [{ value, label }] */
export default function FilterSelect({ value, onChange, options, ariaLabel }) {
  return (
    <div className="relative min-w-0">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="filter-select w-full min-w-0 appearance-none truncate rounded-lg border border-gray-300 bg-white py-1.5 pl-2 pr-6 text-[11px] font-medium text-gray-700 outline-none transition focus:border-gray-400 sm:w-auto sm:py-2 sm:pl-3 sm:pr-8 sm:text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" />
    </div>
  );
}
