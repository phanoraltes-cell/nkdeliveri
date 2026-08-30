import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import { PromotionalNotificationForm } from "@/components/dashboard/admin/promotional-notification-form";
import {
  MediaUploader,
  type MediaUploaderHandle,
  ADS_MEDIA_IMAGE_BUCKET,
} from "@/components/dashboard/admin/media-uploader";
import { EMPTY_MEDIA_VALUE, type MediaUploaderValue } from "@/lib/media-value";
import { bucketFromPublicUrl, deleteStorageFiles, pathFromPublicUrl } from "@/lib/storage-upload";
import { AdMedia } from "@/components/ads/ad-media";

// Pre-split rows (created before 20260827140000_split_ads_media_bucket_by_
// size.sql, audit remediation API-001) still have media_url/thumbnail_url
// values pointing at this bucket — never dropped, still fully live for
// those rows. Used only as a fallback when a stored URL can't be parsed
// for its own bucket name (bucketFromPublicUrl handles the split-bucket
// rows by reading the bucket back out of each row's own URL).
const ADS_BUCKET_LEGACY = "ads-media";

type Placement = Database["public"]["Tables"]["sponsored_placements"]["Row"] & {
  restaurants: { name: string } | null;
};

const PLACEMENT_LABEL: Record<string, string> = {
  home_banner: "Bannyè akèy",
  search_results: "Rezilta rechèch",
  restaurant_page: "Paj restoran",
  dashboard: "Dashboard",
};

// Only these two placements actually render the ad's OWN media
// (ad-banner-section.tsx, sponsored-section.tsx) — "search_results" shows
// the boosted restaurant's own cover photo instead (restaurants.index.tsx),
// and "dashboard" is a small text-only card with no image slot at all
// (dashboard-ad-card.tsx, by design — "never a takeover"). The live-preview
// frame below only makes sense for the two that do.
const PLACEMENT_MEDIA_FRAME: Record<string, string | null> = {
  home_banner: "aspect-[16/9]",
  search_results: null,
  restaurant_page: "aspect-[23/15]", // matches sponsored-section.tsx's real 230×150 card exactly
  dashboard: null,
};

// Fields the redesigned form still has no editor for (cta_label,
// link_target, media_items — carousel/CTA redesign, out of scope for this
// pass). `description` USED to be in this passthrough list too, but it's
// now a required, directly-edited field (see the Deskripsyon textarea
// below) — passing it through unedited would defeat the point of making it
// mandatory. Any RPC call to update_sponsored_placement_secure MUST still
// echo these remaining ones back verbatim from the current row: the RPC's
// new params all carry their own DEFAULTs (for backward compat with
// pre-media callers), so omitting them on an UPDATE would silently reset an
// existing ad's values instead of leaving them untouched.
function passthroughExtraFields(p: Placement) {
  return {
    _link_target: p.link_target ?? undefined,
    _cta_label: p.cta_label ?? undefined,
    _media_items: p.media_items ?? undefined,
  };
}

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/ads")({
  component: AdminAds,
});

function AdminAds() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Placement | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const placements = useQuery({
    queryKey: ["admin-sponsored-placements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsored_placements")
        .select("*, restaurants(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Placement[];
    },
  });

  const remove = useMutation({
    mutationFn: async (p: Placement) => {
      const { error } = await supabase.rpc("delete_sponsored_placement_secure", { _id: p.id });
      if (error) throw error;
      // Delete only AFTER the DB row is confirmed gone — same
      // DB-success-before-storage-cleanup ordering as the form's own save
      // flow. A failed file delete here is non-fatal (deleteStorageFiles
      // already logs it) and never re-creates the row.
      //
      // Two separate calls, not one shared bucket (audit remediation,
      // API-001): since the ads-media bucket split, a video ad's media
      // (ads-media-videos) and its thumbnail (always ads-media-images,
      // even for a video) can live in DIFFERENT buckets — bucketFromPublicUrl
      // reads each one back from its own stored URL rather than assuming
      // both came from the same place. Falls back to the pre-split legacy
      // bucket for rows created before the split.
      if (p.media_path) {
        const mediaUrl = p.media_url || p.image_url || null;
        void deleteStorageFiles(bucketFromPublicUrl(mediaUrl) ?? ADS_BUCKET_LEGACY, [p.media_path]);
      }
      const thumbnailPath = pathFromPublicUrl(
        bucketFromPublicUrl(p.thumbnail_url) ?? ADS_BUCKET_LEGACY,
        p.thumbnail_url,
      );
      if (thumbnailPath) {
        void deleteStorageFiles(bucketFromPublicUrl(p.thumbnail_url) ?? ADS_BUCKET_LEGACY, [
          thumbnailPath,
        ]);
      }
    },
    onSuccess: () => {
      toast.success("Anons efase");
      qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Placement) => {
      // The generator types these args as non-nullable `string` because the
      // SQL params lack a `DEFAULT NULL` marker it recognizes — Postgres
      // accepts NULL for them regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_sponsored_placement_secure", {
        _id: p.id,
        _title: p.title,
        _starts_at: p.starts_at,
        _ends_at: p.ends_at,
        _is_active: !p.is_active,
        _link_url: p.link_url as string,
        _sort_order: p.sort_order,
        // Echo every media field straight back — toggling active/inactive
        // must never touch what's actually displayed.
        _media_type: p.media_type,
        _media_url: p.media_url ?? p.image_url ?? undefined,
        _media_path: p.media_path ?? undefined,
        _thumbnail_url: p.thumbnail_url ?? undefined,
        _alt_text: p.alt_text ?? undefined,
        // `description` is required by the RPC as of this pass — the
        // button's onClick already blocks this call for any ad that
        // doesn't have one yet, so this is always non-empty by the time
        // it's reached, but stays explicit (not passthroughExtraFields())
        // since it's no longer merely "echoed", it's enforced.
        _description: p.description ?? undefined,
        // Tach 4 — echo, menm rezon ak lòt chan medya yo: toggle active/
        // inactive pa dwe janm efase dimansyon estoke yo.
        _media_width: p.media_width ?? undefined,
        _media_height: p.media_height ?? undefined,
        ...passthroughExtraFields(p),
      });
      if (error) throw error;
    },
    onSuccess: (_data, p) => {
      toast.success(p.is_active ? "Anons dezaktive" : "Anons aktive");
      qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const now = Date.now();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Piblisite</h1>
          <p className="mt-1 text-ink-soft">
            Jere anons sponsorize yo (bannyè akèy, rezilta rechèch, paj restoran, dashboard).
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <PromotionalNotificationForm />

      <Button
        onClick={() => {
          setEditing(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nouvo anons
      </Button>

      {showForm && (
        <PlacementForm
          placement={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] })}
        />
      )}

      <div className="space-y-3">
        {placements.data?.map((p) => {
          const expired = new Date(p.ends_at).getTime() < now;
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-display text-lg font-extrabold">
                    {p.title}
                    <StatusBadge tone="neutral">{PLACEMENT_LABEL[p.placement]}</StatusBadge>
                    <StatusBadge tone={p.is_active && !expired ? "good" : "neutral"}>
                      {expired ? "Ekspire" : p.is_active ? "Aktif" : "Dezaktive"}
                    </StatusBadge>
                  </div>
                  {p.restaurants?.name && (
                    <div className="text-sm text-ink-soft">Restoran: {p.restaurants.name}</div>
                  )}
                  <div className="mt-1 text-xs text-ink-soft">
                    {new Date(p.starts_at).toLocaleDateString("fr-HT")}
                    {" → "}
                    {new Date(p.ends_at).toLocaleDateString("fr-HT")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      // Description is now required by the RPC itself — an
                      // ad created before this pass may still have none.
                      // Catch that here with a clear, actionable message
                      // instead of letting the RPC's generic exception
                      // surface through a raw toast.
                      if (!p.description?.trim()) {
                        toast.error(
                          `"${p.title}" bezwen yon deskripsyon anvan — ale nan "Modifye" pou ajoute l.`,
                        );
                        return;
                      }
                      toggleActive.mutate(p);
                    }}
                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                  >
                    {p.is_active ? "Dezaktive" : "Aktive"}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(p);
                      setShowForm(true);
                    }}
                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                  >
                    Modifye
                  </button>
                  <button
                    onClick={() => requestConfirm(`Efase "${p.title}"?`, () => remove.mutate(p))}
                    aria-label={`Efase anons "${p.title}"`}
                    className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {placements.data?.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Pa gen okenn anons.
          </div>
        )}
      </div>
      {ConfirmDialog}
    </div>
  );
}

function mediaFromPlacement(p: Placement | null): MediaUploaderValue {
  if (!p) return EMPTY_MEDIA_VALUE;
  const mediaUrl = p.media_url || p.image_url || null;
  return {
    mediaType: mediaUrl ? ((p.media_type as MediaUploaderValue["mediaType"]) ?? "image") : "none",
    mediaUrl,
    mediaPath: p.media_path ?? null,
    thumbnailUrl: p.thumbnail_url ?? null,
    altText: p.alt_text ?? "",
    mediaWidth: p.media_width ?? null,
    mediaHeight: p.media_height ?? null,
  };
}

function PlacementForm({
  placement,
  onClose,
  onSaved,
}: {
  placement: Placement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    placement: placement?.placement ?? "home_banner",
    restaurant_id: placement?.restaurant_id ?? "",
    title: placement?.title ?? "",
    description: placement?.description ?? "",
    link_url: placement?.link_url ?? "",
    starts_at: placement?.starts_at ? placement.starts_at.slice(0, 10) : "",
    ends_at: placement?.ends_at ? placement.ends_at.slice(0, 10) : "",
    sort_order: placement?.sort_order != null ? String(placement.sort_order) : "0",
  });
  const [media, setMedia] = useState<MediaUploaderValue>(() => mediaFromPlacement(placement));
  const [saving, setSaving] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const uploaderRef = useRef<MediaUploaderHandle>(null);
  // Snapshot of what this ad's media pointed to BEFORE this edit session —
  // used after a successful save to know what old storage object(s), if
  // any, are now safe to delete. Lazy-initialized once (same convention
  // `f` already uses above) — this form isn't remounted between edits of
  // different ads, matching this component's pre-existing behavior.
  const previousMediaRef = useRef({
    mediaPath: placement?.media_path ?? null,
    mediaBucket:
      bucketFromPublicUrl(placement?.media_url || placement?.image_url) ?? ADS_BUCKET_LEGACY,
    thumbnailPath: pathFromPublicUrl(
      bucketFromPublicUrl(placement?.thumbnail_url ?? null) ?? ADS_MEDIA_IMAGE_BUCKET,
      placement?.thumbnail_url ?? null,
    ),
  });

  const restaurants = useQuery({
    queryKey: ["approved-restaurants-for-ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("status", "approved")
        .order("name")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  /**
   * Deletes whatever THIS form session uploaded and was never committed to
   * a saved row, and resets the visible media state to match (a stale
   * preview pointing at a file that no longer exists would be worse than
   * an empty uploader). Returns whether there was anything to clean up —
   * shared by both the create- and edit-mode failure paths below.
   */
  function cleanupOrphanUpload(): boolean {
    const orphans = uploaderRef.current?.getUploadedPaths();
    if (!orphans || (!orphans.mediaPath && !orphans.thumbnailPath)) return false;
    // Two calls, not one shared bucket (audit remediation, API-001): a
    // video ad's own media (ads-media-videos) and its thumbnail (always
    // ads-media-images) can be in different buckets.
    if (orphans.mediaPath && orphans.mediaBucket) {
      void deleteStorageFiles(orphans.mediaBucket, [orphans.mediaPath]);
    }
    if (orphans.thumbnailPath) {
      void deleteStorageFiles(ADS_MEDIA_IMAGE_BUCKET, [orphans.thumbnailPath]);
    }
    uploaderRef.current?.commit();
    setMedia((m) => ({ ...EMPTY_MEDIA_VALUE, altText: m.altText }));
    return true;
  }

  async function save() {
    // Double-submit guard: a second click while either a save or an
    // upload is already in flight is a no-op, not a second request.
    if (saving || mediaUploading) return;
    if (!f.title.trim()) return toast.error("Tit anons lan obligatwa");
    if (!f.description.trim()) return toast.error("Deskripsyon anons lan obligatwa");
    if (!f.starts_at || !f.ends_at) return toast.error("Chwazi dat kòmansman ak dat fen");
    const startsAt = new Date(f.starts_at).toISOString();
    const endsAt = new Date(f.ends_at + "T23:59:59").toISOString();
    if (new Date(endsAt) <= new Date(startsAt))
      return toast.error("Dat fen dwe apre dat kòmansman");

    setSaving(true);
    try {
      if (placement) {
        const { error } = await supabase.rpc("update_sponsored_placement_secure", {
          _id: placement.id,
          _title: f.title.trim(),
          _description: f.description.trim(),
          _starts_at: startsAt,
          _ends_at: endsAt,
          _is_active: placement.is_active,
          _link_url: f.link_url || undefined,
          _sort_order: Number(f.sort_order) || 0,
          _media_type: media.mediaType,
          _media_url: media.mediaUrl ?? undefined,
          _media_path: media.mediaPath ?? undefined,
          _thumbnail_url: media.thumbnailUrl ?? undefined,
          _alt_text: media.altText || undefined,
          _media_width: media.mediaWidth ?? undefined,
          _media_height: media.mediaHeight ?? undefined,
          ...passthroughExtraFields(placement),
        });
        if (error) {
          // Storage-safety rule: never delete old production media just
          // because a save failed — only whatever THIS attempt uploaded.
          cleanupOrphanUpload();
          throw error;
        }
        // DB save confirmed successful — only now is it safe to (a) stop
        // treating this session's upload as an orphan and (b) delete
        // whatever the edit actually replaced. Read the new thumbnail
        // path BEFORE commit() clears the tracking ref.
        const newThumbnailPath = uploaderRef.current?.getThumbnailPath() ?? null;
        uploaderRef.current?.commit();
        const prev = previousMediaRef.current;
        // Best-effort, two calls not one shared bucket (audit remediation,
        // API-001 — see cleanupOrphanUpload's own comment): deleteStorageFiles
        // already logs its own failures and never throws — a cleanup
        // failure must not invalidate an ad that's already saved and
        // displaying correctly.
        if (prev.mediaPath && prev.mediaPath !== media.mediaPath) {
          void deleteStorageFiles(prev.mediaBucket, [prev.mediaPath]);
        }
        if (prev.thumbnailPath && prev.thumbnailPath !== newThumbnailPath) {
          void deleteStorageFiles(ADS_MEDIA_IMAGE_BUCKET, [prev.thumbnailPath]);
        }
        toast.success("Anons mizajou");
      } else {
        const { error } = await supabase.rpc("create_sponsored_placement_secure", {
          _placement: f.placement,
          _title: f.title.trim(),
          _description: f.description.trim(),
          _starts_at: startsAt,
          _ends_at: endsAt,
          _restaurant_id: f.restaurant_id || undefined,
          _link_url: f.link_url || undefined,
          _sort_order: Number(f.sort_order) || 0,
          _media_type: media.mediaType,
          _media_url: media.mediaUrl ?? undefined,
          _media_path: media.mediaPath ?? undefined,
          _thumbnail_url: media.thumbnailUrl ?? undefined,
          _alt_text: media.altText || undefined,
          _media_width: media.mediaWidth ?? undefined,
          _media_height: media.mediaHeight ?? undefined,
        });
        if (error) {
          cleanupOrphanUpload();
          throw error;
        }
        uploaderRef.current?.commit();
        toast.success("Anons kreye");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan anrejistreman an");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">{placement ? "Modifye anons" : "Nouvo anons"}</h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Anplasman"
          className={inputCls()}
          value={f.placement}
          disabled={!!placement}
          onChange={(e) => setF({ ...f, placement: e.target.value })}
        >
          {Object.entries(PLACEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Restoran (opsyonèl)"
          className={inputCls()}
          value={f.restaurant_id}
          disabled={!!placement}
          onChange={(e) => setF({ ...f, restaurant_id: e.target.value })}
        >
          <option value="">Okenn restoran (anons jeneral)</option>
          {restaurants.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Tit anons lan"
          aria-label="Tit anons lan"
          className={inputCls() + " sm:col-span-2"}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Deskripsyon <span className="text-red-600">*</span>
          </span>
          <textarea
            placeholder="Yon ti tèks ki dekri anons lan"
            aria-label="Deskripsyon anons lan"
            required
            rows={2}
            className={inputCls() + " resize-y"}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </label>
        <input
          placeholder="Lyen destinasyon (opsyonèl)"
          aria-label="Lyen destinasyon (opsyonèl)"
          className={inputCls() + " sm:col-span-2"}
          value={f.link_url}
          onChange={(e) => setF({ ...f, link_url: e.target.value })}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Kòmanse</span>
          <input
            type="date"
            className={inputCls()}
            value={f.starts_at}
            onChange={(e) => setF({ ...f, starts_at: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Fini</span>
          <input
            type="date"
            className={inputCls()}
            value={f.ends_at}
            onChange={(e) => setF({ ...f, ends_at: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Priyorite (0 = premye)
          </span>
          <input
            type="number"
            className={inputCls()}
            value={f.sort_order}
            onChange={(e) => setF({ ...f, sort_order: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-2 block text-xs font-bold uppercase text-ink-soft">
          Medya anons lan
        </span>
        <MediaUploader
          ref={uploaderRef}
          value={media}
          onChange={setMedia}
          disabled={saving}
          onUploadingChange={setMediaUploading}
        />
      </div>

      {PLACEMENT_MEDIA_FRAME[f.placement] ? (
        <div className="mt-4">
          <span className="mb-2 block text-xs font-bold uppercase text-ink-soft">
            Apèsi nan kad "{PLACEMENT_LABEL[f.placement]}" la
          </span>
          {/* Tach 4 — menm afichaj EGZAK AdMedia ap itilize sou sit la:
              object-contain (jamè koupe) nan yon kontenè ki swiv VRE rapò
              dimansyon imaj/videyo a (media.mediaWidth/mediaHeight,
              mezire otomatikman anwo pa MediaUploader) — tonbe tounen sou
              kad fiks plasman an sèlman si dimansyon yo pa ko mezire. */}
          <div
            className={
              media.mediaWidth && media.mediaHeight
                ? "overflow-hidden rounded-2xl bg-ink/5"
                : `overflow-hidden rounded-2xl bg-ink/5 ${PLACEMENT_MEDIA_FRAME[f.placement]}`
            }
            style={
              media.mediaWidth && media.mediaHeight
                ? { aspectRatio: `${media.mediaWidth} / ${media.mediaHeight}` }
                : undefined
            }
          >
            <AdMedia
              ad={{
                media_type: media.mediaType,
                media_url: media.mediaUrl,
                thumbnail_url: media.thumbnailUrl,
                alt_text: media.altText,
                title: f.title || "Apèsi anons",
              }}
              icon={Megaphone}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-soft">
          Medya anons lan pa afiche pou "{PLACEMENT_LABEL[f.placement]}" — anplasman sa a montre lòt
          kontni (foto restoran an, oswa yon ti kat san imaj).
        </p>
      )}

      <Button
        className="mt-4"
        disabled={saving || mediaUploading}
        isLoading={saving}
        onClick={save}
      >
        Sove anons
      </Button>
    </div>
  );
}
