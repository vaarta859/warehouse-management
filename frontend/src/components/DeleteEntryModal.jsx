import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

/**
 * Confirmation popup for deleting a whole inward / outward entry.
 * Deleting removes the entry together with its items, serial numbers and every document, so it asks first.
 *
 *   <DeleteEntryModal open={show} kind="inward" number="GRN-0007" deleting={busy} onCancel={...} onConfirm={...} />
 */
export default function DeleteEntryModal({ open, kind = "inward", number, deleting = false, onCancel, onConfirm }) {
  if (!open) return null;
  const label = kind === "outward" ? "outward" : "inward";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle size={20} className="text-red-600" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Delete {label} entry?</h2>
            {number && <p className="mt-0.5 break-all text-sm font-medium text-gray-700">{number}</p>}
            <p className="mt-2 text-sm text-gray-600">
              This permanently deletes the entry together with all its items, serial numbers and uploaded documents.
              {kind === "outward"
                ? " The quantities go back into stock."
                : " The received quantities are taken out of stock."}{" "}
              This cannot be undone.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
