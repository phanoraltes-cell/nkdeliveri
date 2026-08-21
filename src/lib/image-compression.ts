// Piblisite refonte — client-side image compression before upload.
// Canvas API only (no new dependency, matching this project's dependency-
// conscious posture — same reasoning as reusing the existing UI kit instead
// of pulling in a component library for one form).
export async function compressImageFile(
  file: File,
  { maxWidth = 1600, quality = 0.82 }: { maxWidth?: number; quality?: number } = {},
): Promise<File> {
  // Animated GIF: drawing to canvas flattens it to a single frame, which
  // would silently destroy the animation the admin picked it for — pass
  // through untouched instead.
  if (file.type === "image/gif") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Format the browser can't decode client-side (rare AVIF variants on
    // older engines) — upload the original; server-side validation still
    // guards type/size.
    return file;
  }

  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob || blob.size === 0) return file;

    // Browsers that can't encode WebP silently fall back to PNG — if that
    // happened AND the result isn't even smaller, keep the original rather
    // than uploading a bigger, differently-typed file for no benefit.
    const wasResized = scale < 1;
    if (!wasResized && blob.type !== "image/webp" && blob.size >= file.size) return file;

    const ext = blob.type === "image/webp" ? "webp" : blob.type.split("/")[1] || "jpg";
    const baseName = file.name.replace(/\.[^./]+$/, "");
    return new File([blob], `${baseName}.${ext}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
