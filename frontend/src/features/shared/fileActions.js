/**
 * Opens / saves a signed file URL.
 *
 * view     -> opens the file in a new tab (PDF / image viewer).
 * download -> the signed URL is created with a Content-Disposition: attachment header by the server
 *             (?download=1), so the browser SAVES the file. Works on mobile too, where a plain
 *             window.open() on a PDF only shows the viewer with no save option.
 */
export function openFileUrl(url) {
  // One new tab, once. (window.open with "noopener" always returns null, so checking its result and then
  // falling back to the same tab made the file open twice.) The page you came from stays open behind it.
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
