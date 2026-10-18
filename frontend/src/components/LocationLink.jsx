import { MapPin } from "lucide-react";

/** True when the text is a Google Maps link (full or short). */
export function isGoogleMapsLink(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const { hostname, pathname } = new URL(text);
    const host = hostname.replace(/^www\./, "").toLowerCase();
    if (host === "maps.app.goo.gl" || host === "g.co" || host === "goo.gl") return true;
    if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
    return /^google\.[a-z.]+$/.test(host) && pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

/**
 * Shows a location.
 * - Google Maps link -> shows clickable text "Delivery Location" (the raw URL is hidden), opens the link in a new tab
 * - anything else (address, note, plain text) -> shown as plain text, not clickable
 * - `short`: renders a smaller version of the same link (use under the form input; nothing for non-links)
 */
export default function LocationLink({ value, short = false, fallback = "-" }) {
  const text = String(value || "").trim();
  if (!text) return short ? null : fallback;
  if (!isGoogleMapsLink(text)) return short ? null : text;

  return (
    <a
      href={text}
      target="_blank"
      rel="noopener noreferrer"
      title="Open map to navigate"
      className={
        short
          ? "mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          : "inline-flex items-center gap-1 text-blue-600 underline hover:text-blue-800"
      }
    >
      <><MapPin size={short ? 12 : 14} className="shrink-0" /> Delivery Location</>
    </a>
  );
}
