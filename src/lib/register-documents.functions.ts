import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_MIME_TYPES, UPLOAD_LIMITS } from "@/lib/file-validation";

const MAX_FILE_BYTES = UPLOAD_LIMITS["driver-documents"].maxBytes; // 8MB, same cap as driver-documents/payment-proofs
const ALLOWED_TYPES = new Set<string>(DOCUMENT_MIME_TYPES);

// A legitimate call always happens within seconds of signUp(), in the same
// submit handler (see auth.register.tsx). This bounds the window during
// which the one-shot, session-less upload gate below can be used at all —
// closing most of the exposure of a userId+email pair being replayed later
// by someone other than the person who just signed up.
const MAX_ROW_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

const FileInput = z.object({
  name: z.string().max(200),
  type: z.string(),
  base64: z.string(),
});

const InputSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  accountType: z.enum(["restaurant", "driver"]),
  files: z.object({
    logo: FileInput.optional(),
    cover: FileInput.optional(),
    idDoc: FileInput.optional(),
    license: FileInput.optional(),
    vehiclePhoto: FileInput.optional(),
  }),
});

function decode(file: z.infer<typeof FileInput>) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`Tip fichye ${file.type} pa aksepte`);
  }
  const buffer = Buffer.from(file.base64, "base64");
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Fichye ${file.name} twò gwo (max 8MB)`);
  }
  return buffer;
}

// This endpoint must keep working for a signer who has no session yet
// (email confirmation pending) — see the handler doc comment — so it can't
// hard-require a Bearer token the way `requireSupabaseAuth` does. When the
// browser *does* already have a session (autoconfirm/OAuth signups,
// same-tab retries), attachSupabaseAuth (registered globally in start.ts)
// will have attached one automatically; if present, it must belong to the
// account being finalized. Absence of a token is only tolerated because the
// row-age + rate-limit + one-shot-per-field checks below bound the rest of
// the exposure.
async function verifyOptionalBearerMatchesUser(userId: string): Promise<void> {
  const authHeader = getRequest()?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return;
  const token = authHeader.slice("Bearer ".length);
  if (!token) return;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;

  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new Error("Unauthorized: Invalid token");
  }
  if (data.claims.sub !== userId) {
    throw new Error("Forbidden: token does not match the target account");
  }
}

// Uploads made with the service role have no JWT, so storage.objects.owner
// is left NULL — which would make every "owner = auth.uid()" RLS policy
// (read/update/delete on driver-documents, restaurant-assets, ...) fail for
// the user once they actually log in. Stamp ownership explicitly so those
// policies keep working.
async function stampOwner(supabaseAdmin: SupabaseClient, bucket: string, path: string, userId: string) {
  await supabaseAdmin.schema("storage").from("objects").update({ owner: userId }).match({
    bucket_id: bucket,
    name: path,
  });
}

/**
 * Finalizes document/logo uploads for a restaurant/driver signup that may not
 * have an active session yet (email confirmation pending). Runs with the
 * service role so it never depends on the caller's own auth state. Layered
 * gates, since no single one can be a hard session requirement here:
 *  1) if the caller does have a session already, it must be theirs;
 *  2) the target account must still be a fresh (< MAX_ROW_AGE), undocumented
 *     `pending` row for the exact email that just signed up;
 *  3) upsert:false makes each field a one-shot write;
 *  4) a per-account rate limit bounds retry/guessing attempts.
 */
export const finalizeRegistrationDocuments = createServerFn({ method: "POST" })
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    await verifyOptionalBearerMatchesUser(data.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: allowed, error: rlErr } = await supabaseAdmin.rpc("check_rate_limit_secure", {
      _action: "finalize_registration_docs",
      _max_hits: 5,
      _window_seconds: 1800,
      _actor_override: data.userId,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) throw new Error("Twòp tantativ. Tanpri eseye ankò nan 30 minit.");

    const { data: userResult, error: userErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (userErr || !userResult?.user) throw new Error("Kont pa jwenn");
    if (userResult.user.email?.toLowerCase() !== data.email.toLowerCase()) {
      throw new Error("Imèl pa koresponn");
    }

    if (data.accountType === "restaurant") {
      const { data: restaurant, error: rErr } = await supabaseAdmin
        .from("restaurants")
        .select("id, status, logo_url, cover_url, created_at")
        .eq("owner_id", data.userId)
        .maybeSingle();
      if (rErr || !restaurant) throw new Error("Restoran pa jwenn");
      if (restaurant.status !== "pending") throw new Error("Kont sa a deja trete");
      if (Date.now() - new Date(restaurant.created_at).getTime() > MAX_ROW_AGE_MS) {
        throw new Error("Delè finalizasyon an ekspire. Kontakte sipò.");
      }

      const updates: { logo_url?: string; cover_url?: string } = {};
      if (data.files.logo && !restaurant.logo_url) {
        const buf = decode(data.files.logo);
        const path = `${data.userId}/logo-${Date.now()}-${data.files.logo.name}`;
        const { error } = await supabaseAdmin.storage
          .from("restaurant-assets")
          .upload(path, buf, { contentType: data.files.logo.type, upsert: false });
        if (error) throw new Error(`Logo: ${error.message}`);
        await stampOwner(supabaseAdmin, "restaurant-assets", path, data.userId);
        updates.logo_url = supabaseAdmin.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
      }
      if (data.files.cover && !restaurant.cover_url) {
        const buf = decode(data.files.cover);
        const path = `${data.userId}/cover-${Date.now()}-${data.files.cover.name}`;
        const { error } = await supabaseAdmin.storage
          .from("restaurant-assets")
          .upload(path, buf, { contentType: data.files.cover.type, upsert: false });
        if (error) throw new Error(`Kouvèti: ${error.message}`);
        await stampOwner(supabaseAdmin, "restaurant-assets", path, data.userId);
        updates.cover_url = supabaseAdmin.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
      }
      if (Object.keys(updates).length) {
        const { error } = await supabaseAdmin.from("restaurants").update(updates).eq("owner_id", data.userId);
        if (error) throw new Error(error.message);
      }
      return { uploaded: Object.keys(updates) };
    }

    // driver
    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id, status, id_doc_url, license_doc_url, vehicle_photo_url, created_at")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (dErr || !driver) throw new Error("Dosye livrè pa jwenn");
    if (driver.status !== "pending") throw new Error("Kont sa a deja trete");
    if (Date.now() - new Date(driver.created_at).getTime() > MAX_ROW_AGE_MS) {
      throw new Error("Delè finalizasyon an ekspire. Kontakte sipò.");
    }

    const updates: { id_doc_url?: string; license_doc_url?: string; vehicle_photo_url?: string } = {};
    const slots: [keyof typeof data.files, "id_doc_url" | "license_doc_url" | "vehicle_photo_url", string][] = [
      ["idDoc", "id_doc_url", "id"],
      ["license", "license_doc_url", "license"],
      ["vehiclePhoto", "vehicle_photo_url", "vehicle"],
    ];
    for (const [key, column, prefix] of slots) {
      const file = data.files[key];
      if (!file || driver[column]) continue;
      const buf = decode(file);
      const path = `${data.userId}/${prefix}-${Date.now()}-${file.name}`;
      const { error } = await supabaseAdmin.storage
        .from("driver-documents")
        .upload(path, buf, { contentType: file.type, upsert: false });
      if (error) throw new Error(`${prefix}: ${error.message}`);
      await stampOwner(supabaseAdmin, "driver-documents", path, data.userId);
      // driver-documents is a private bucket — store the path (like payment-proofs),
      // not a public URL; readers must call createSignedUrl(path) to view it.
      updates[column] = path;
    }
    if (Object.keys(updates).length) {
      const { error } = await supabaseAdmin.from("drivers").update(updates).eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }
    return { uploaded: Object.keys(updates) };
  });
