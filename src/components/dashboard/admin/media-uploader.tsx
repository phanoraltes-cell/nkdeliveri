import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { ImageIcon, Link2, Loader2, Upload, VideoIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { validateAdMediaFile } from "@/lib/file-validation";
import { compressImageFile } from "@/lib/image-compression";
import { captureVideoPoster } from "@/lib/video-poster";
import {
  bucketFromPublicUrl,
  deleteStorageFiles,
  getStoragePublicUrl,
  pathFromPublicUrl,
  sanitizeFileName,
  uploadFileWithProgress,
} from "@/lib/storage-upload";
import { cn } from "@/lib/utils";
import { EMPTY_MEDIA_VALUE, type MediaUploaderValue } from "@/lib/media-value";

// Split from a single 'ads-media' bucket (audit remediation, API-001): the
// Storage engine only ever enforced one flat file_size_limit for the
// whole bucket, so the 5MB-for-images ceiling validateAdMediaFile()
// checks below existed purely client-side and was bypassable via a
// direct Storage API call. Two purpose-sized buckets let the engine
// itself enforce it — 5MB is only ever reachable by something the engine
// already recognizes as an image MIME type. Video posters are always a
// captured still frame (an image), so they always go to IMAGE_BUCKET
// regardless of what the main media is.
// Exported so dashboard.admin.ads.tsx (the parent form) can target the
// same buckets for its own orphan-cleanup/thumbnail-lookup logic without
// re-declaring these strings a second time.
export const ADS_MEDIA_IMAGE_BUCKET = "ads-media-images";
export const ADS_MEDIA_VIDEO_BUCKET = "ads-media-videos";
const IMAGE_BUCKET = ADS_MEDIA_IMAGE_BUCKET;
const VIDEO_BUCKET = ADS_MEDIA_VIDEO_BUCKET;
const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime";

export type MediaUploaderHandle = {
  /**
   * Call after a successful save. Transfers ownership of whatever this
   * instance uploaded to the saved DB row, so the unmount-cleanup effect
   * stops treating it as an abandoned orphan.
   */
  commit: () => void;
  /**
   * The video poster's storage path, resolved either from this session's
   * own upload or (for a pre-existing ad being edited) derived from the
   * DB-sourced `thumbnail_url` — there's no `thumbnail_path` column to
   * read it from directly. Lets Etape 4's save flow delete the old poster
   * when media on an existing ad gets replaced.
   */
  getThumbnailPath: () => string | null;
  /**
   * Raw paths this instance itself uploaded (never a DB-sourced path) —
   * for the parent's save-failure cleanup, which must delete exactly what
   * this attempt created and nothing else.
   */
  getUploadedPaths: () => UploadedRef;
};

type MediaUploaderProps = {
  value: MediaUploaderValue;
  onChange: (value: MediaUploaderValue) => void;
  disabled?: boolean;
  /** Lets the parent form disable its Save button while a file is mid-upload (double-submit guard). */
  onUploadingChange?: (uploading: boolean) => void;
};

// mediaBucket tracked alongside mediaPath (not a fixed constant anymore)
// because handleFile picks IMAGE_BUCKET or VIDEO_BUCKET per upload — every
// later delete of this same path needs to target the bucket it actually
// landed in. thumbnailPath has no matching field: a poster this instance
// uploads is always IMAGE_BUCKET (see the constants above), so nothing to
// track per-instance.
type UploadedRef = {
  mediaPath: string | null;
  mediaBucket: string | null;
  thumbnailPath: string | null;
};

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Tach 4 — natirèl dimansyon medya a, pou call sites (AdMedia) ka konstwi
// yon kontenè AK VRE rapò dimansyon lan olye yon rapò FIKS ki koupe imaj.
// Rezoud `null` (jamè rejte) sou nenpòt echèk (CORS, lyen kraze, fòma pa
// sipòte) — yon anons san dimansyon estoke tonbe tounen sou rapò default
// plasman an, pa yon eta erè.
function measureImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function measureVideoDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => resolve(null);
    video.src = url;
  });
}

export const MediaUploader = forwardRef<MediaUploaderHandle, MediaUploaderProps>(
  function MediaUploader({ value, onChange, disabled, onUploadingChange }, ref) {
    const [uploading, setUploading] = useState(false);
    const [phase, setPhase] = useState<"file" | "poster" | null>(null);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    // Synchronous re-entrancy guard: `uploading` is React state, so there's
    // a brief window between calling setUploading(true) and the re-render
    // that hides the dropzone where a second, near-simultaneous file pick
    // (e.g. a rapid double drop) could still call handleFile again before
    // the UI reflects the first one. This ref is checked/set synchronously
    // at call time, so a second call is always rejected immediately,
    // regardless of render timing — the "select A, quickly select B"
    // scenario can never produce two in-flight uploads for one instance.
    const busyRef = useRef(false);
    // Only ever holds paths THIS component instance uploaded — never a
    // path that arrived via `value` from an existing DB row. That's what
    // makes it safe to auto-delete on replace/unmount without risking a
    // pre-existing ad's live media.
    const uploadedRef = useRef<UploadedRef>({
      mediaPath: null,
      mediaBucket: null,
      thumbnailPath: null,
    });
    // Tach 4 — dènye URL tape nan tab "Lyen imaj" a, gade pou handleLinkBlur
    // ka verifye li poko demode anvan li ekri yon mezi ki fèt an reta.
    const linkUrlRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      commit() {
        uploadedRef.current = { mediaPath: null, mediaBucket: null, thumbnailPath: null };
      },
      getThumbnailPath() {
        if (uploadedRef.current.thumbnailPath) return uploadedRef.current.thumbnailPath;
        // Pre-existing (DB-sourced) thumbnail — derive its bucket from the
        // URL itself (works for both legacy 'ads-media' rows and rows
        // created after the bucket split) rather than assuming a fixed one.
        return pathFromPublicUrl(
          bucketFromPublicUrl(value.thumbnailUrl) ?? IMAGE_BUCKET,
          value.thumbnailUrl,
        );
      },
      getUploadedPaths() {
        return { ...uploadedRef.current };
      },
    }));

    useEffect(() => {
      onUploadingChange?.(uploading);
    }, [uploading, onUploadingChange]);

    // Orphan cleanup: if this instance uploaded a file and unmounts
    // without the parent ever calling commit() (admin closed the form
    // without saving), delete it so it doesn't sit in the bucket forever.
    useEffect(() => {
      return () => {
        abortRef.current?.abort();
        const { mediaPath, mediaBucket, thumbnailPath } = uploadedRef.current;
        if (mediaPath && mediaBucket) void deleteStorageFiles(mediaBucket, [mediaPath]);
        // A thumbnail this instance uploaded is always IMAGE_BUCKET (see
        // handleFile) — never depends on mediaBucket, which is the VIDEO
        // bucket whenever a thumbnail exists at all.
        if (thumbnailPath) void deleteStorageFiles(IMAGE_BUCKET, [thumbnailPath]);
      };
    }, []);

    const handleFile = useCallback(
      async (file: File) => {
        if (busyRef.current) return;

        const validationError = validateAdMediaFile(file);
        if (validationError) {
          setError(validationError);
          setPendingFile(null);
          return;
        }

        busyRef.current = true;
        const isVideo = file.type.startsWith("video/");
        setError(null);
        setPendingFile(file);
        setUploading(true);
        setPhase("file");
        setProgress(0);

        const previousUpload = uploadedRef.current;
        const controller = new AbortController();
        abortRef.current = controller;

        const mediaBucket = isVideo ? VIDEO_BUCKET : IMAGE_BUCKET;

        try {
          const uploadFile = isVideo ? file : await compressImageFile(file);
          const mediaPath = `ads/${randomId()}-${sanitizeFileName(uploadFile.name)}`;
          await uploadFileWithProgress(mediaBucket, mediaPath, uploadFile, {
            onProgress: setProgress,
            signal: controller.signal,
          });
          const mediaUrl = getStoragePublicUrl(mediaBucket, mediaPath);

          let thumbnailUrl: string | null = null;
          let thumbnailPath: string | null = null;
          if (isVideo) {
            setPhase("poster");
            const poster = await captureVideoPoster(file);
            if (poster && !controller.signal.aborted) {
              thumbnailPath = `ads/${randomId()}-${sanitizeFileName(poster.name)}`;
              try {
                await uploadFileWithProgress(IMAGE_BUCKET, thumbnailPath, poster, {
                  signal: controller.signal,
                });
                thumbnailUrl = getStoragePublicUrl(IMAGE_BUCKET, thumbnailPath);
              } catch {
                // Poster is a nice-to-have (renderer falls back to a play
                // icon over black without one) — a failure here must not
                // fail the whole upload.
                thumbnailPath = null;
              }
            }
          }

          // Safe: `previousUpload` only ever holds paths this component
          // itself uploaded (see uploadedRef comment above).
          if (previousUpload.mediaPath && previousUpload.mediaBucket) {
            void deleteStorageFiles(previousUpload.mediaBucket, [previousUpload.mediaPath]);
          }
          if (previousUpload.thumbnailPath) {
            void deleteStorageFiles(IMAGE_BUCKET, [previousUpload.thumbnailPath]);
          }
          uploadedRef.current = { mediaPath, mediaBucket, thumbnailPath };

          // Mezire sou `uploadFile` (apre konpresyon pou yon imaj), pa sou
          // `file` orijinal la — dimansyon yo dwe matche EGZAKTEMAN sa ki
          // reyèlman telechaje/sèvi, pa fichye orijinal la si konpresyon an
          // te redimansyone l.
          const objectUrl = URL.createObjectURL(uploadFile);
          const dims = isVideo
            ? await measureVideoDimensions(objectUrl)
            : await measureImageDimensions(objectUrl);
          URL.revokeObjectURL(objectUrl);

          onChange({
            mediaType: isVideo ? "video" : "image",
            mediaUrl,
            mediaPath,
            thumbnailUrl,
            altText: value.altText,
            mediaWidth: dims?.width ?? null,
            mediaHeight: dims?.height ?? null,
          });
          setPendingFile(null);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            // User-initiated cancel — not an error state.
          } else {
            setError(err instanceof Error ? err.message : "Erè pandan telechajman an.");
          }
        } finally {
          busyRef.current = false;
          setUploading(false);
          setPhase(null);
          abortRef.current = null;
        }
      },
      [onChange, value.altText],
    );

    function handleCancel() {
      abortRef.current?.abort();
    }

    function handleRetry() {
      if (pendingFile) void handleFile(pendingFile);
    }

    async function handleRemove() {
      const { mediaPath, mediaBucket, thumbnailPath } = uploadedRef.current;
      if (mediaPath && mediaBucket) await deleteStorageFiles(mediaBucket, [mediaPath]);
      if (thumbnailPath) await deleteStorageFiles(IMAGE_BUCKET, [thumbnailPath]);
      if (mediaPath || thumbnailPath) {
        uploadedRef.current = { mediaPath: null, mediaBucket: null, thumbnailPath: null };
      }
      setError(null);
      setPendingFile(null);
      onChange({ ...EMPTY_MEDIA_VALUE, altText: value.altText });
    }

    // Tach 4 — lyen ekstèn (tab "Lyen imaj"): mezire sou `blur` (pa sou
    // chak touch), pou pa lanse yon chaje imaj pou chak lèt kliyan tape.
    // `linkUrlRef` gade dènye URL tape a — si admin an chanje/efase l
    // pandan mezi a ap fèt, rezilta a jete olye ekri sou yon lòt valè.
    function handleLinkBlur() {
      const url = linkUrlRef.current;
      if (!url || value.mediaType !== "image" || value.mediaPath || value.mediaWidth != null)
        return;
      void measureImageDimensions(url).then((dims) => {
        if (!dims || linkUrlRef.current !== url || value.mediaUrl !== url) return;
        onChange({ ...value, mediaWidth: dims.width, mediaHeight: dims.height });
      });
    }

    function handleDrop(e: DragEvent<HTMLDivElement>) {
      e.preventDefault();
      setDragActive(false);
      if (disabled || uploading) return;
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    }

    function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
      if (disabled || uploading) return;
      const file = Array.from(e.clipboardData.items)
        .find((item) => item.kind === "file")
        ?.getAsFile();
      if (file) void handleFile(file);
    }

    const hasMedia = value.mediaType !== "none" && !!value.mediaUrl;

    return (
      <div className="space-y-3">
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">
              <Upload className="h-3.5 w-3.5" /> Telechaje fichye
            </TabsTrigger>
            <TabsTrigger value="link">
              <Link2 className="h-3.5 w-3.5" /> Lyen imaj
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload">
            {!hasMedia && !uploading && (
              <div
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                onClick={() => !disabled && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (!disabled && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!disabled) setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onPaste={handlePaste}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  dragActive ? "border-brand bg-brand-soft/30" : "border-brand-soft bg-white",
                  disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-brand",
                )}
              >
                <Upload className="h-6 w-6 text-brand-deep" />
                <p className="text-sm font-bold text-ink">
                  Glise-depoze, klike, oswa kole (Ctrl+V) yon imaj/videyo
                </p>
                <p className="text-xs text-ink-soft">
                  Imaj: jpg, png, webp, gif, avif (max 5MB) · Videyo: mp4, webm, mov (max 50MB)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleFile(file);
                  }}
                />
              </div>
            )}

            {uploading && (
              <div className="space-y-3 rounded-2xl border-2 border-brand-soft bg-white p-6">
                <div className="flex items-center gap-2 text-sm font-bold text-ink">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-deep" />
                  {phase === "poster"
                    ? "Ap kreye foto minyati videyo a…"
                    : `Ap telechaje… ${progress}%`}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-brand-soft/50">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-150"
                    style={{ width: `${phase === "poster" ? 100 : progress}%` }}
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                  <X className="h-3.5 w-3.5" /> Anile
                </Button>
              </div>
            )}

            {!uploading && hasMedia && (
              <div className="space-y-3 rounded-2xl border-2 border-brand-soft bg-white p-3">
                <div className="relative overflow-hidden rounded-xl bg-ink/5">
                  {value.mediaType === "video" ? (
                    <video
                      src={value.mediaUrl ?? undefined}
                      poster={value.thumbnailUrl ?? undefined}
                      controls
                      muted
                      playsInline
                      className="max-h-64 w-full object-contain"
                    />
                  ) : (
                    <img
                      src={value.mediaUrl ?? undefined}
                      alt={value.altText || "Apèsi medya anons"}
                      className="max-h-64 w-full object-contain"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-ink-soft">
                    {value.mediaType === "video" ? (
                      <VideoIcon className="h-3.5 w-3.5" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    {value.mediaType === "video" ? "Videyo" : "Imaj"}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void handleRemove()}
                  >
                    <X className="h-3.5 w-3.5" /> Retire
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{error}</span>
                {pendingFile && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="font-bold underline underline-offset-2 hover:text-red-800"
                  >
                    Eseye ankò
                  </button>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="link">
            <input
              type="url"
              placeholder="https://…"
              aria-label="Lyen imaj ekstèn"
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
              value={value.mediaType === "image" && !value.mediaPath ? (value.mediaUrl ?? "") : ""}
              disabled={disabled}
              onChange={(e) => {
                const url = e.target.value.trim();
                linkUrlRef.current = url || null;
                // Switching to a typed link abandons any file this
                // instance uploaded (e.g. the admin uploaded, then changed
                // their mind and pasted an external URL instead) — clean
                // it up now rather than leaving it an orphan forever
                // (commit() would otherwise just stop tracking it without
                // ever deleting it).
                const { mediaPath, mediaBucket, thumbnailPath } = uploadedRef.current;
                if (mediaPath && mediaBucket) void deleteStorageFiles(mediaBucket, [mediaPath]);
                if (thumbnailPath) void deleteStorageFiles(IMAGE_BUCKET, [thumbnailPath]);
                if (mediaPath || thumbnailPath) {
                  uploadedRef.current = { mediaPath: null, mediaBucket: null, thumbnailPath: null };
                }
                onChange({
                  mediaType: url ? "image" : "none",
                  mediaUrl: url || null,
                  mediaPath: null,
                  thumbnailUrl: null,
                  altText: value.altText,
                  mediaWidth: null,
                  mediaHeight: null,
                });
              }}
              onBlur={handleLinkBlur}
            />
            <p className="mt-1 text-xs text-ink-soft">
              Itilize sa a si imaj la deja ann liy yon lòt kote (pa jere nan resif nou).
            </p>
          </TabsContent>
        </Tabs>

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Tèks altènatif (aksesibilite)
          </span>
          <input
            type="text"
            placeholder="Deskripsyon kout imaj/videyo a"
            className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
            value={value.altText}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, altText: e.target.value })}
          />
        </label>
      </div>
    );
  },
);
