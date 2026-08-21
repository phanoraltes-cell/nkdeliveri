// Piblisite refonte — captures a poster frame from an uploaded video file
// client-side (Canvas API), so a carousel/renderer always has an image to
// show before the video itself has buffered enough to paint a frame.
export function captureVideoPoster(file: File, atSeconds = 1): Promise<File | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (result: File | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    // Some browsers never fire loadedmetadata/seeked for malformed or
    // unsupported video files — don't let the caller hang forever waiting
    // for a poster that will never come.
    const timeout = setTimeout(() => finish(null), 8000);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(atSeconds, Math.max(0, duration - 0.1));
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (canvas.width === 0 || canvas.height === 0) {
          clearTimeout(timeout);
          finish(null);
          return;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          clearTimeout(timeout);
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timeout);
            if (!blob) {
              finish(null);
              return;
            }
            const baseName = file.name.replace(/\.[^./]+$/, "");
            finish(new File([blob], `${baseName}-poster.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.85,
        );
      } catch {
        clearTimeout(timeout);
        finish(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timeout);
      finish(null);
    };

    video.src = objectUrl;
    video.load();
  });
}
