/**
 * Opens / saves a signed file URL.
 *
 * view     -> opens the file in a new tab (PDF / image viewer).
 * download -> the signed URL is created with a Content-Disposition: attachment header by the server
 *             (?download=1), so the browser SAVES the file. Works on mobile too, where a plain
 *             window.open() on a PDF only shows the viewer with no save option.
 */
export function openFileUrl(url) {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  // Mobile browsers can block a popup opened after an async request - fall back to the same tab.
  if (!win) window.location.assign(url);
}

export function saveFileUrl(url, fileName) {
  const a = document.createElement("a");
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const handleSignedUrl = (url, mode = "download") => (mode === "view" ? openFileUrl(url) : saveFileUrl(url));
