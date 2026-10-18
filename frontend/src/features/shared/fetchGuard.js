import { isAnyOf } from "@reduxjs/toolkit";
import { loginUser, logout, sessionExpired } from "../auth/authSlice";
import { clearSummaryCache } from "./useSummaryEntries";

// =====================================================
// LOAD ONCE, RELOAD ONLY WHEN SOMETHING CHANGES
// =====================================================
//
// A list is downloaded the first time a screen needs it and then reused.
// It is downloaded again only when:
//   - something was saved / changed (create, edit, approve, upload, delete...)
//   - the screen asks for different data (another search, page, warehouse...)
//   - a person presses Refresh / Try again (pass { force: true })
//   - someone logs in or out (so one user never sees another user's data)
//   - the copy is older than CACHE_TTL_MS (safety net for changes made by
//     OTHER people)
// =====================================================

export const CACHE_TTL_MS = 5 * 60 * 1000;

// Fields every cached slice keeps in its state.
export const initialCache = {
  cacheKey: null,
  cacheLoadedAt: 0,
  cacheLoadedVersion: 0,
  dataVersion: 0,
};

export const cacheKey = (arg) => {
  const { force, ...rest } = arg || {};
  return JSON.stringify(rest);
};

export const markPending = (state, arg) => {
  state.cacheKey = cacheKey(arg);
  // Remember which data version this download started at: if something is
  // saved while it is on its way, the result is treated as already stale.
  state.cacheLoadedVersion = state.dataVersion;
  state.cacheLoadedAt = 0;
};

export const markLoaded = (state) => {
  state.cacheLoadedAt = Date.now();
};

export const markFailed = (state) => {
  state.cacheKey = null;
  state.cacheLoadedAt = 0;
};

export const bumpVersion = (state) => {
  state.dataVersion += 1;
  // KPI card numbers are cached for a minute - anything saved makes them stale.
  clearSummaryCache();
};

// Used as the `condition` of a fetch thunk: returning false skips the request.
export const makeFetchGuard = (sliceKey, isLoading) => (arg, { getState }) => {
  if (arg?.force) return true;
  const slice = getState()[sliceKey];
  if (slice.cacheKey !== cacheKey(arg)) return true;
  if (slice.cacheLoadedVersion !== slice.dataVersion) return true;
  if (isLoading(slice)) return false;
  return Date.now() - slice.cacheLoadedAt >= CACHE_TTL_MS;
};

// Any of these means the signed-in user may have changed.
export const sessionChanged = isAnyOf(loginUser.fulfilled, logout, sessionExpired);
