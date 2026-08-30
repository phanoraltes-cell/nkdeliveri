// Split out of media-uploader.tsx: that file exports only the <MediaUploader/>
// component (react-refresh/only-export-components requires it), so the
// shared value shape/default used by both the component and its future
// caller (Etape 4's admin form) lives here instead.
export type MediaUploaderValue = {
  mediaType: "image" | "video" | "none";
  mediaUrl: string | null;
  mediaPath: string | null;
  thumbnailUrl: string | null;
  altText: string;
  /**
   * Tach 4 — natirèl dimansyon (pixel) medya a, mezire otomatikman pa
   * MediaUploader (fichye telechaje OSWA lyen ekstèn). Sèvi pou konstwi yon
   * kontenè AK VRE rapò dimansyon imaj/videyo a (jamè koupe), olye yon
   * rapò FIKS ki ta koupe nenpòt imaj ki pa gen egzakteman menm rapò a. Null
   * si mezi a echwe (rechèch CORS, fichye envalid) — call sites tonbe tounen
   * sou yon rapò default nan ka sa a, pa yon erè.
   */
  mediaWidth: number | null;
  mediaHeight: number | null;
};

export const EMPTY_MEDIA_VALUE: MediaUploaderValue = {
  mediaType: "none",
  mediaUrl: null,
  mediaPath: null,
  thumbnailUrl: null,
  altText: "",
  mediaWidth: null,
  mediaHeight: null,
};
