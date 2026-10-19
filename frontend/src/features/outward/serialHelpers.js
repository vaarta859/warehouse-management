// Serial numbers of an outward entry (filled by the warehouse manager at dispatch).
// Only countable items (UOM "Pcs") carry serials: an item of 4 Pcs needs exactly 4 serial numbers.
// Serials belong to category + SKU (rows with the same SKU are added up), never to a row id.

export const SERIAL_UOM = "Pcs";
// AC / DC cables are measured by length, so they never carry serial numbers (even if the UOM is changed to Pcs).
export const isCableCategory = (category) => {
  const text = String(category || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return /\bcable\b/.test(text) && /\b(ac|dc)\b/.test(text);
};

// Serial no. rule of a product, set when the category / model is added:
//   REQUIRED - scan box shown, every unit needs a serial no.
//   OPTIONAL - scan box shown, scan all units of the item or none
//   NOT_REQUIRED - no scan box
export const SERIAL_MODES = [
  { value: "REQUIRED", label: "Required", hint: "Every unit must have a serial no. - the scan box shows on inward / outward." },
  { value: "NOT_REQUIRED", label: "Not required", hint: "No serial numbers for this item - no scan box." },
  { value: "OPTIONAL", label: "Optional", hint: "Scan box shows, but the manager may skip serial numbers for this item." },
];
export const serialModeLabel = (mode) => SERIAL_MODES.find((m) => m.value === mode)?.label || "Required";

/** An item with no mode (product deleted / list not loaded): cables none, everything else required (the old rule). */
export const serialModeOf = (item) =>
  SERIAL_MODES.some((m) => m.value === item?.serialMode) ? item.serialMode : isCableCategory(item?.category) ? "NOT_REQUIRED" : "REQUIRED";

/** Adds the product master's serialMode to every item (matched by category + SKU, ignoring upper / lower case). */
export function withSerialMode(items = [], products = []) {
  const modes = new Map(products.map((p) => [serialKey(p.category, p.sku), p.serialMode]));
  return items.map((item) => {
    const serialMode = modes.get(serialKey(item.category, item.sku));
    return serialMode ? { ...item, serialMode } : item;
  });
}

// Serial numbers are taken per unit, so the item must be counted in Pcs and its product must not be "Not required".
export const needsSerials = (item) =>
  serialModeOf(item) !== "NOT_REQUIRED" && String(item?.uom || "").trim().toLowerCase() === SERIAL_UOM.toLowerCase();
export const serialKey = (category, sku) => `${String(category || "").trim().toLowerCase()}||${String(sku || "").trim().toLowerCase()}`;
export const cleanSerialInput = (value) => String(value ?? "").replace(/\s+/g, "");

/** [{ key, category, sku, quantity }] - one entry per category + SKU that needs serials. */
export function buildSerialLines(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!needsSerials(item)) continue;
    const key = serialKey(item.category, item.sku);
    const line = map.get(key) || { key, category: item.category, sku: item.sku, quantity: 0, serialMode: serialModeOf(item) };
    line.quantity += Number(item.quantity) || 0;
    map.set(key, line);
  }
  return [...map.values()];
}

/** { [key]: [{ serialNo, source }] } - always exactly `quantity` slots per line, saved serials first. */
export function initialSerialValues(lines, saved = []) {
  const values = {};
  for (const line of lines) {
    const mine = saved.filter((s) => serialKey(s.category, s.sku) === line.key).slice(0, line.quantity);
    values[line.key] = Array.from({ length: line.quantity }, (_, i) => ({
      serialNo: mine[i]?.serialNo || "",
      source: mine[i]?.source || "MANUAL",
    }));
  }
  return values;
}

export const countFilled = (values, key) => (values[key] || []).filter((s) => s.serialNo.trim()).length;

/** Rows to send to the server (blank slots left out). */
export function serialPayload(lines, values) {
  const rows = [];
  for (const line of lines) {
    for (const s of values[line.key] || []) {
      const serialNo = cleanSerialInput(s.serialNo);
      if (serialNo) rows.push({ category: line.category, sku: line.sku, serialNo, source: s.source || "MANUAL" });
    }
  }
  return rows;
}

/** Error message, or null when every Pcs unit has its own serial number. */
export function serialProblem(lines, values) {
  const seen = new Set();
  for (const line of lines) {
    const slots = values[line.key] || [];
    const filled = slots.filter((s) => cleanSerialInput(s.serialNo));
    for (const s of filled) {
      const k = cleanSerialInput(s.serialNo).toLowerCase();
      if (seen.has(k)) return `Serial number "${cleanSerialInput(s.serialNo)}" is entered more than once`;
      seen.add(k);
    }
    if (line.serialMode === "OPTIONAL" && filled.length === 0) continue; // optional item: no serials is fine
    if (filled.length !== line.quantity) {
      const hint = line.serialMode === "OPTIONAL" ? " Enter all of them, or leave this item's serial numbers blank." : "";
      return `${line.sku}: ${line.quantity} serial number${line.quantity === 1 ? "" : "s"} needed, ${filled.length} entered.${hint}`;
    }
  }
  return null;
}

/**
 * Inward entries: serial numbers are optional per item, but all-or-nothing - either every Pcs unit of an item
 * has one, or the item has none yet. Error message, or null when everything fits.
 */
export function inwardSerialProblem(lines, values) {
  const seen = new Set();
  for (const line of lines) {
    const filled = (values[line.key] || []).filter((s) => cleanSerialInput(s.serialNo));
    for (const s of filled) {
      const k = cleanSerialInput(s.serialNo).toLowerCase();
      if (seen.has(k)) return `Serial number "${cleanSerialInput(s.serialNo)}" is entered more than once`;
      seen.add(k);
    }
    if (filled.length !== 0 && filled.length !== line.quantity) {
      return `${line.sku}: ${line.quantity} serial number${line.quantity === 1 ? "" : "s"} needed, ${filled.length} entered. Enter all of them, or leave this item's serial numbers blank.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Ordering + scan clean-up
// ---------------------------------------------------------------------------------------------------------

const serialCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Natural, increasing order: I2690100002 before I2690100010, and "A2" before "A10". */
export const compareSerials = (a, b) => serialCollator.compare(String(a), String(b));
export const sortSerials = (list = []) => [...list].sort(compareSerials);

/**
 * A product label barcode often holds "MODEL SERIAL" (e.g. "SG33CX-P2-V124 I2690100041"), not just the serial.
 * Returns the serial no. to store:
 *   1) a serial that is in stock for this item (whole text, one of its words, or contained in the text), else
 *   2) the text without the item's own model/SKU in front of it, else
 *   3) the text as scanned (spaces removed).
 */
export function resolveScannedSerial(raw, { sku = "", stock = null } = {}) {
  const text = String(raw ?? "").trim();
  const cleaned = cleanSerialInput(text);
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();

  if (stock?.length) {
    const byLower = new Map(stock.map((s) => [cleanSerialInput(s).toLowerCase(), s]));
    if (byLower.has(lower)) return byLower.get(lower);
    for (const word of text.split(/\s+/)) {
      const hit = byLower.get(word.toLowerCase());
      if (hit) return hit;
    }
    // longest in-stock serial found inside the text (min. 5 characters so short codes never match by accident)
    const inside = [...byLower.keys()].filter((k) => k.length >= 5 && lower.includes(k)).sort((a, b) => b.length - a.length)[0];
    if (inside) return byLower.get(inside);
  }

  const skuClean = cleanSerialInput(sku).toLowerCase();
  if (skuClean && lower.startsWith(skuClean) && lower.length > skuClean.length) {
    const rest = cleaned.slice(skuClean.length).replace(/^[-_/:|,;]+/, "");
    if (rest) return rest;
  }
  return cleaned;
}
