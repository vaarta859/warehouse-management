import { useEffect, useRef, useState } from "react";

// -------------------------------------------------
// Remembers a page's search / filters / page number for the browser tab, so coming back to a list
// (browser back, or opening it again from the sidebar) lands exactly where the person left it.
// Kept in localStorage so it also survives closing the tab / app; it is cleared when the person logs out.
// -------------------------------------------------
const PREFIX = "ui-state:";

/** Forgets one remembered value (e.g. "inward.page"), so the page starts from its default next time. */
export function forgetPersistedState(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // storage blocked: nothing was saved anyway
  }
}

/** Forgets every remembered page / search / filter (called on logout, so the next person starts fresh). */
export function clearPersistedUiState() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage blocked: nothing was saved anyway
  }
}

const read = (key, initial) => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    // storage blocked or value unreadable: fall back to the default
  }
  return typeof initial === "function" ? initial() : initial;
};

/** Same as useState, but the value survives leaving and returning to the page. */
export default function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => read(key, initial));

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the page still works, it just forgets
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * Runs `reset` (e.g. back to page 1) when the filters change - but not on the first render, so a page number
 * restored from storage is kept. (Compared with the previous value instead of "skip the first run", so it is
 * also safe when React runs effects twice in development.)
 */
export function useResetPageOnChange(signature, reset) {
  const previous = useRef(signature);
  useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
