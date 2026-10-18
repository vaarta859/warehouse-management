import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";

/**
 * Camera barcode engine - reads EVERY common barcode type (1D + 2D).
 *
 * Why the old reader missed dense labels (UPC-A, Code 128 ...): it looked at one downscaled frame with one
 * method. A dedicated Bluetooth scanner has a laser/imager and its own decoder, a camera does not. So this
 * engine gives the camera the best chance on every tick:
 *   1. the browser's NATIVE BarcodeDetector (Chrome / Edge / Android) on the full-resolution video frame
 *   2. ZXing with TRY_HARDER, on several views of the same frame: full frame, centre band, centre crop and
 *      rotated 90 degrees (vertical barcodes), with two different binarizers (+ inverted colours now and then)
 *   3. HD camera stream (up to 4K), continuous focus
 * and a "Photo" fallback (decodeImageFile) that decodes a picture taken with the phone's own camera app.
 */

// Product labels (inverters, panels, cables ...) carry Code 128 / 2D codes. These are tried FIRST on every frame.
const STRONG_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417,
];
// Number-only retail formats. A dense Code 128 label is often MISREAD as one of these (you then get just a
// number), so they are tried less often and only accepted when the SAME value is read several times in a row.
const WEAK_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.MAXICODE,
];
const WEAK_NAMES = new Set(["EAN_13", "EAN_8", "UPC_A", "UPC_E", "ITF", "CODABAR", "RSS_14", "RSS_EXPANDED", "MAXICODE"]);
const WEAK_CONFIRMATIONS = 3;

const makeHints = (formats) => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};
const HINTS_STRONG = makeHints(STRONG_FORMATS);
const HINTS_ALL = makeHints([...STRONG_FORMATS, ...WEAK_FORMATS]);

const zxingReader = new MultiFormatReader();

// ---------- helpers ----------

const makeCanvas = (w, h) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
};

/** Copies a region (sx, sy, sw, sh) of an image / video into a new canvas of max side `maxSide`, optionally rotated 90 deg. */
function cropToCanvas(src, sx, sy, sw, sh, { maxSide = 1800, rotate = false } = {}) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = rotate ? makeCanvas(h, w) : makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (rotate) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  }
  return canvas;
}

/** ZXing on one canvas: two binarizers, optionally also inverted. Returns text or null. */
function decodeCanvas(canvas, tryInverted = false, hints = HINTS_STRONG) {
  const source = new HTMLCanvasElementLuminanceSource(canvas);
  const variants = [() => new HybridBinarizer(source), () => new GlobalHistogramBinarizer(source)];
  if (tryInverted) {
    const inverted = source.invert();
    variants.push(() => new HybridBinarizer(inverted), () => new GlobalHistogramBinarizer(inverted));
  }
  for (const make of variants) {
    try {
      const result = zxingReader.decode(new BinaryBitmap(make()), hints);
      const text = result?.getText?.();
      if (text) return { text, format: BarcodeFormat[result.getBarcodeFormat()] || "" };
    } catch { /* NotFoundException = nothing here, try the next variant */ }
  }
  return null;
}

// Views tried on every image: [x, y, w, h as fractions of the picture, rotate]
const VIEWS = [
  { x: 0, y: 0.25, w: 1, h: 0.5, rotate: false }, // centre band (where the scan frame is)
  { x: 0, y: 0, w: 1, h: 1, rotate: false }, // whole picture
  { x: 0.1, y: 0.2, w: 0.8, h: 0.6, rotate: false }, // centre crop, larger bars
  { x: 0.2, y: 0, w: 0.6, h: 1, rotate: true }, // centre column, vertical barcode
  { x: 0, y: 0, w: 1, h: 1, rotate: true }, // whole picture, vertical barcode
];

function decodeView(src, width, height, view, opts = {}) {
  // the centre band is cheap (half the picture), so it keeps the full camera width
  const maxSide = view.h <= 0.5 && !view.rotate ? Math.max(opts.maxSide || 0, 1600) : opts.maxSide;
  const canvas = cropToCanvas(src, width * view.x, height * view.y, width * view.w, height * view.h, { rotate: view.rotate, ...opts, maxSide });
  return decodeCanvas(canvas, opts.inverted, opts.hints);
}

// ---------- native BarcodeDetector ----------

let detectorPromise = null;
function getNativeDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      if (!("BarcodeDetector" in window)) return null;
      const supported = await window.BarcodeDetector.getSupportedFormats();
      // Label formats only. Asked for EAN / UPC too, the phone's detector reads a dense Code 128 label as a made-up number.
      const wanted = ["code_128", "code_39", "code_93", "qr_code", "data_matrix", "aztec", "pdf417"].filter((f) => supported.includes(f));
      return wanted.length ? new window.BarcodeDetector({ formats: wanted }) : null;
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

async function nativeDecode(src) {
  const detector = await getNativeDetector();
  if (!detector) return null;
  try {
    const codes = await detector.detect(src);
    const hit = codes?.find((c) => c.rawValue);
    return hit ? { text: hit.rawValue, format: String(hit.format || "").toUpperCase() } : null;
  } catch {
    return null;
  }
}

// ---------- live camera ----------

const CAMERA_ATTEMPTS = [
  // 1080p is sharp enough for a label barcode and light enough for the phone (2K / 4K made the phone hang)
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 } } },
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
  { video: { facingMode: "environment" } },
  { video: true },
];

/**
 * Opens the camera inside `container` and keeps decoding until stop() is called.
 * Resolves { stop, track }. Rejects with the camera error (NotAllowedError etc.).
 */
export async function startScanner({ container, onDecoded, onStatus }) {
  let stream = null;
  let lastError = null;
  for (const constraints of CAMERA_ATTEMPTS) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (err) {
      lastError = err;
      if (/NotAllowed|Permission|Security/i.test(err?.name || String(err))) break;
    }
  }
  if (!stream) throw lastError || new Error("Camera could not be opened");

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.autoplay = true;
  video.style.cssText = "width:100%;height:100%;object-fit:cover;";
  video.srcObject = stream;
  container.appendChild(video);
  await video.play().catch(() => {});

  const track = stream.getVideoTracks()[0];
  let stopped = false;
  let tick = 0;
  let timer = null;
  let candidate = { text: "", count: 0 };
  let frames = 0;
  let nativeOn = false;

  // A strong format (Code 128, QR ...) is accepted at once. A number-only retail format must be read the same
  // several times in a row, otherwise it is most likely a misread of a Code 128 label.
  const accept = (hit) => {
    if (!hit?.text) return;
    if (!WEAK_NAMES.has(hit.format)) { candidate = { text: "", count: 0 }; onDecoded(hit.text); return; }
    candidate = candidate.text === hit.text ? { text: hit.text, count: candidate.count + 1 } : { text: hit.text, count: 1 };
    if (candidate.count >= WEAK_CONFIRMATIONS) { candidate = { text: "", count: 0 }; onDecoded(hit.text); }
  };

  // Light on the phone: one decode attempt per round, the next round waits at least twice as long as the last one
  // took, so the page / video never freezes.
  const loop = async () => {
    if (stopped) return;
    const began = performance.now();
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h && video.readyState >= 2) {
        nativeOn = Boolean(await getNativeDetector());
        frames += 1;
        let hit = await nativeDecode(video);
        if (hit && WEAK_NAMES.has(hit.format)) hit = null;
        if (!hit && !stopped) {
          const view = VIEWS[tick % VIEWS.length];
          const all = tick % 4 === 3; // number-only formats only every 4th round
          hit = decodeView(video, w, h, view, { maxSide: 1100, hints: all ? HINTS_ALL : HINTS_STRONG, inverted: tick % 12 === 11 });
        }
        if (!stopped) accept(hit);
        tick += 1;
      }
    } catch { /* a bad frame is skipped */ }
    if (!stopped && onStatus && frames % 12 === 0) onStatus({ video: `${video.videoWidth}x${video.videoHeight}`, reader: nativeOn ? "built-in + ZXing" : "ZXing", frames });
    if (!stopped) timer = setTimeout(loop, Math.max(250, (performance.now() - began) * 3));
  };
  timer = setTimeout(loop, 400);

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    video.remove();
  };

  return { stop, track };
}

// ---------- photo (still picture) ----------

/**
 * Decodes a barcode from a picture file (e.g. taken with the phone's own camera app, which has autofocus
 * and full resolution). Tries the native detector, then ZXing on several views and sizes. Returns text or null.
 */
export async function decodeImageFile(file, { allowWeak = true } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const native = await nativeDecode(bitmap);
    if (native && !WEAK_NAMES.has(native.format)) return native.text;
    const { width, height } = bitmap;
    for (const maxSide of [2000, 1300]) {
      for (const view of VIEWS) {
        const hit = decodeView(bitmap, width, height, view, { maxSide, hints: HINTS_STRONG });
        if (hit) return hit.text;
      }
    }
    // nothing strong found: a number-only code is accepted from a photo (one sharp still picture is reliable)
    if (!allowWeak) return null;
    if (native) return native.text;
    for (const view of VIEWS.slice(0, 3)) {
      const hit = decodeView(bitmap, width, height, view, { maxSide: 1600, hints: HINTS_ALL, inverted: true });
      if (hit) return hit.text;
    }
    return null;
  } finally {
    bitmap.close?.();
  }
}
