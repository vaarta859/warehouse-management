import { Fragment } from "react";
import { serialKey } from "../features/outward/serialHelpers";

/**
 * Item details of an outward entry (category, model, qty, UOM, serial numbers).
 * Final Qty (AC / DC cables, filled by the warehouse manager) shows in colour: green = same as booked, amber = different.
 * Used on the dispatch and receiving pages so the Super admin sees the items at every status.
 */
export default function OutwardItemsSection({ outward }) {
  const items = outward?.items || [];
  const hasFinalQty = items.some((i) => i.finalQuantity !== null && i.finalQuantity !== undefined);

  // Serial numbers listed under their item (rows with the same model share one list, split by quantity).
  const used = {};
  const serialsByRow = items.map((item) => {
    const key = serialKey(item.category, item.sku);
    const offset = used[key] || 0;
    const quantity = Number(item.quantity) || 0;
    used[key] = offset + quantity;
    return (outward?.serials || []).filter((x) => serialKey(x.category, x.sku) === key).slice(offset, offset + quantity);
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">Item details</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="px-2 py-2 sm:px-3">#</th>
              <th className="px-2 py-2 sm:px-3">Category</th>
              <th className="px-2 py-2 sm:px-3">Model</th>
              <th className="px-2 py-2 sm:px-3">Qty</th>
              <th className="px-2 py-2 sm:px-3">UOM</th>
              {hasFinalQty && <th className="px-2 py-2 text-emerald-700 sm:px-3">Final Qty</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const rowSerials = serialsByRow[index] || [];
              const hasFinal = item.finalQuantity !== null && item.finalQuantity !== undefined;
              const same = hasFinal && Number(item.finalQuantity) === Number(item.quantity);
              return (
                <Fragment key={item.id || index}>
                  <tr className={`${rowSerials.length ? "border-b-0" : "border-b"} last:border-0`}>
                    <td className="px-2 py-2 sm:px-3">{index + 1}</td>
                    <td className="break-words px-2 py-2 sm:px-3">{item.category || "-"}</td>
                    <td className="break-words px-2 py-2 font-medium sm:px-3">{item.sku || "-"}</td>
                    <td className="px-2 py-2 sm:px-3">{item.quantity || 0}</td>
                    <td className="px-2 py-2 sm:px-3">{item.uom || "-"}</td>
                    {hasFinalQty && (
                      <td className="px-2 py-2 sm:px-3">
                        {hasFinal ? (
                          <span
                            title={same ? "Same as booked quantity" : `Booked ${item.quantity}, final ${item.finalQuantity}`}
                            className={`inline-block rounded-md px-2 py-0.5 font-semibold ${same ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                          >
                            {item.finalQuantity}
                          </span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  {rowSerials.length > 0 && (
                    <tr className="border-b last:border-0">
                      <td />
                      <td colSpan={hasFinalQty ? 5 : 4} className="px-2 pb-3 sm:px-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-gray-900">SR. No -</span>
                          {rowSerials.map((x) => (
                            <span key={x.id || x.serialNo} className="rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-medium text-blue-700 sm:text-xs">{x.serialNo}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-gray-500">No items found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
