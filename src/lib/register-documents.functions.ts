import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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

// Uploads made with the service role have no JWT, so storage.objects.owner
// is left NULL — which would make every "owner = auth.uid()" RLS policy
// (read/update/delete on driver-documents, restaurant-assets, ...) fail for
// the user once they actually log in. Stamp ownership explicitly so those
// policies keep working.
async function stampOwner(supabaseAdmin: SupabaseClient, bucket: string, path: string, userId: string) {
  await supabaseAdmin.schema("storage" as any).from("objects").update({ owner: userId }).match({
    bucket_id: bucket,
    name: path,
  });
}

/**
 * Finalizes document/logo uploads for a restaurant/driver signup that may not
 * have an active session yet (email confirmation pending). Runs with the
 * service role so it never depends on the caller's own auth state — the only
 * gate is that the target account must still be a fresh, undocumented
 * `pending` row for the exact email that just signed up (upsert:false makes
 * this a one-shot operation per file).
 */
export const finalizeRegistrationDocuments = createServerFn({ method: "POST" })
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: userResult, error: userErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (userErr || !userResult?.user) throw new Error("Kont pa jwenn");
    if (userResult.user.email?.toLowerCase() !== data.email.toLowerCase()) {
      throw new Error("Imèl pa koresponn");
    }

    if (data.accountType === "restaurant") {
      const { data: restaurant, error: rErr } = await supabaseAdmin
        .from("restaurants")
        .select("id, status, logo_url, cover_url")
        .eq("owner_id", data.userId)
        .maybeSingle();
      if (rErr || !restaurant) throw new Error("Restoran pa jwenn");
      if (restaurant.status !== "pending") throw new Error("Kont sa a deja trete");

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
      .select("id, status, id_doc_url, license_doc_url, vehicle_photo_url")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (dErr || !driver) throw new Error("Dosye livrè pa jwenn");
    if (driver.status !== "pending") throw new Error("Kont sa a deja trete");

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
