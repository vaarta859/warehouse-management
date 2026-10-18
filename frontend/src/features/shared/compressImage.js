// Shrinks phone-camera photos before upload so saving is fast on slow networks.
// PDFs, tiny images and anything that fails to compress are returned untouched.
const MAX_SIDE = 1600;
const QUALITY = 0.72;
const SKIP_BELOW = 400 * 1024;

export async function compressImage(file) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < SKIP_BELOW) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
