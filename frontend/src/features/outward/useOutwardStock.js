import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../../services/apiClient";

// Same rule as the server (utils/stock.js): category + SKU, case-insensitive,
// ignoring stray spaces.
export const stockKey = (category, sku) =>
  `${String(category || "").trim().toLowerCase()}::${String(sku || "").trim().toLowerCase()}`;

/**
 * What is in stock in one warehouse right now (inward minus outward, per
 * category + SKU). Used by the outward form so the SKU / model dropdown can
 * show how many are available and only allow picking what is in stock.
 *
 * `excludeOutwardId`: when EDITING an outward entry, its own quantities are
 * counted as available again for that entry.
 *
 * Returns { rows, status, reload }
 *   rows:   [{ category, sku, uom, available }]  (only items with stock > 0)
 *   status: "idle" (no warehouse yet) | "loading" | "succeeded" | "failed"
 *
 * It is fetched fresh each time the warehouse changes - stock changes with
 * every inward / outward, so it is deliberately not cached in the store.
 * The server re-checks it when the entry is saved, so this is for guidance.
 */
export default function useOutwardStock(warehouseId, excludeOutwardId) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("idle");
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (!warehouseId) {
      setRows([]);
      setStatus("idle");
      return;
    }

    const requestId = ++latestRequest.current;
    setStatus("loading");
    try {
      const { data } = await apiClient.get("/api/outward/stock", {
        params: { warehouseId, excludeOutwardId: excludeOutwardId || undefined },
      });
      if (requestId !== latestRequest.current) return; // a newer request took over
      setRows(Array.isArray(data) ? data : data.data || []);
      setStatus("succeeded");
    } catch {
      if (requestId !== latestRequest.current) return;
      setRows([]);
      setStatus("failed");
    }
  }, [warehouseId, excludeOutwardId]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, status, reload: load };
}
