import { useEffect, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * Numbers for the KPI cards of a list page. They ignore the search / type / status / date filters, so the cards
 * stay the same while the list below is being searched.
 *
 * Calls `<url>/summary`, which answers with a handful of counts. (This hook used to download the 100 newest FULL
 * entries - items, documents, references - on every visit just to count them, which made both list pages slow.)
 * Counts are kept per warehouse for a minute, so moving between pages doesn't re-ask.
 */
const CACHE_MS = 60 * 1000;
const cache = new Map(); // key -> { at, data }

export default function useSummaryEntries(url, warehouseId, skip = false, extraParams = {}) {
  const [state, setState] = useState({ data: null, ready: false });
  const extraKey = JSON.stringify(extraParams);

  useEffect(() => {
    if (skip) return undefined;
    const key = `${url}|${warehouseId || ""}|${extraKey}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setState({ data: hit.data, ready: true });
      return undefined;
    }
    let cancelled = false;
    apiClient
      .get(`${url}/summary`, { params: { ...(warehouseId ? { warehouseId } : {}), ...JSON.parse(extraKey) } })
      .then(({ data }) => {
        const payload = data?.data || data || {};
        cache.set(key, { at: Date.now(), data: payload });
        if (!cancelled) setState({ data: payload, ready: true });
      })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, ready: true })); });
    return () => { cancelled = true; };
  }, [url, warehouseId, skip, extraKey]);

  return state;
}

// Call after something is saved so the next visit shows fresh numbers.
export const clearSummaryCache = () => cache.clear();
