import { SERIAL_MODES } from "../features/outward/serialHelpers";

/**
 * "Serial no." choice shown when a category / model is added or edited:
 *   Required      - scan box on inward / outward, every unit needs a serial no.
 *   Not required  - no scan box
 *   Optional      - scan box shown, the manager may scan all units or skip
 *
 * Plain buttons (no <form> / radio inputs) so it is safe inside the big inward form's portal.
 */
export default function SerialModePicker({ value, onChange, disabled = false }) {
  const current = SERIAL_MODES.find((m) => m.value === value) || SERIAL_MODES[0];

  return (
    <div>
      <span className="mb-1 block text-sm font-semibold text-black">Serial no.</span>
      <div role="radiogroup" aria-label="Serial no." className="grid grid-cols-3 gap-2">
        {SERIAL_MODES.map((mode) => {
          const active = mode.value === current.value;
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                active
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-gray-500">{current.hint}</p>
    </div>
  );
}
