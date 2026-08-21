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
};

export const EMPTY_MEDIA_VALUE: MediaUploaderValue = {
  mediaType: "none",
  mediaUrl: null,
  mediaPath: null,
  thumbnailUrl: null,
  altText: "",
};
