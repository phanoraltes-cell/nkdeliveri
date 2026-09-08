import { useState } from "react";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { assertValidUploadFile } from "@/lib/file-validation";

type MenuCategory = Database["public"]["Tables"]["menu_categories"]["Row"];
type MenuProduct = Database["public"]["Tables"]["products"]["Row"];

const DISH_TYPES = [
  { key: "diri_sos", label: "Diri ak Sòs" },
  { key: "griyo", label: "Griyo" },
  { key: "fritay", label: "Fritay" },
  { key: "soup", label: "Soup" },
  { key: "pwason", label: "Pwason" },
  { key: "sandwich", label: "Sandwich" },
  { key: "pizza", label: "Pizza" },
  { key: "bwason", label: "Bwason" },
  { key: "lot", label: "Lòt" },
];

async function uploadDishPhoto(restaurantId: string, file: File) {
  assertValidUploadFile(file, "menu-photos");
  const path = `${restaurantId}/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage
    .from("menu-photos")
    .upload(path, file, { upsert: false });
  if (error) throw error;
  return supabase.storage.from("menu-photos").getPublicUrl(path).data.publicUrl;
}

type ProductFormProps = {
  restaurantId: string;
  categories: MenuCategory[];
  product: MenuProduct | null;
  onClose: () => void;
  onSaved: () => void;
};

/** Restaurant menu's add/edit product form: fields, photo upload, and the create/update RPC calls. */
export function ProductForm({
  restaurantId,
  categories,
  product,
  onClose,
  onSaved,
}: ProductFormProps) {
  const [f, setF] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: product?.price ? String(product.price) : "",
    category_id: product?.category_id ?? "",
    dish_type: product?.dish_type ?? "lot",
    available: product?.available ?? true,
    // Empty string = unlimited/not tracked (stored as NULL), matching the
    // existing convention for optional fields in this form.
    stock_quantity: product?.stock_quantity != null ? String(product.stock_quantity) : "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.name.trim()) return toast.error("Non plat la obligatwa");
    const price = Number(f.price);
    if (!Number.isFinite(price) || price < 0) return toast.error("Pri a envalid");
    let stockQuantity: number | null = null;
    if (f.stock_quantity.trim() !== "") {
      stockQuantity = Number(f.stock_quantity);
      if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        return toast.error("Kantite stock la envalid");
      }
    }
    setSaving(true);
    try {
      let imageUrl = product?.image_url ?? null;
      if (photo) imageUrl = await uploadDishPhoto(restaurantId, photo);

      // The generator types these args as non-nullable because the SQL
      // params lack a `DEFAULT NULL` marker it recognizes — Postgres accepts
      // NULL for these columns regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      if (product) {
        const { error } = await supabase.rpc("update_product_secure", {
          _product_id: product.id,
          _name: f.name.trim(),
          _description: (f.description || null) as string,
          _price: price,
          _image_url: imageUrl as string,
          _dish_type: f.dish_type,
          _category_id: (f.category_id || null) as string,
          _available: f.available,
          _stock_quantity: stockQuantity ?? undefined,
        });
        if (error) throw error;
        toast.success("Plat mizajou");
      } else {
        const { error } = await supabase.rpc("create_product_secure", {
          _restaurant_id: restaurantId,
          _category_id: (f.category_id || null) as string,
          _name: f.name.trim(),
          _description: (f.description || null) as string,
          _price: price,
          _stock_quantity: stockQuantity ?? undefined,
          _image_url: imageUrl as string,
          _dish_type: f.dish_type,
        });
        if (error) throw error;
        toast.success("Plat ajoute");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4 shadow-brand-xs">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">{product ? "Modifye plat" : "Nouvo plat"}</h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Non plat la"
          aria-label="Non plat la"
          className={inputCls()}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <input
          placeholder="Pri (HTG)"
          aria-label="Pri (HTG)"
          type="number"
          min="0"
          step="1"
          className={inputCls()}
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <select
          aria-label="Kategori"
          className={inputCls()}
          value={f.category_id}
          onChange={(e) => setF({ ...f, category_id: e.target.value })}
        >
          <option value="">San kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Tip plat"
          className={inputCls()}
          value={f.dish_type}
          onChange={(e) => setF({ ...f, dish_type: e.target.value })}
        >
          {DISH_TYPES.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Deskripsyon (opsyonèl)"
          aria-label="Deskripsyon (opsyonèl)"
          rows={2}
          className={inputCls() + " sm:col-span-2"}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
        <input
          placeholder="Kantite stock (kite vid = ilimite)"
          aria-label="Kantite stock (kite vid = ilimite)"
          type="number"
          min="0"
          step="1"
          className={inputCls()}
          value={f.stock_quantity}
          onChange={(e) => setF({ ...f, stock_quantity: e.target.value })}
        />
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-white">
          <Upload className="h-3.5 w-3.5" /> {photo?.name || "Chanje foto plat la"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.available}
            onChange={(e) => setF({ ...f, available: e.target.checked })}
          />
          Disponib pou kòmande
        </label>
      </div>
      <button
        disabled={saving}
        onClick={save}
        className="mt-4 rounded-full bg-brand-deep px-6 py-2 text-sm font-bold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep-hover hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
      >
        {saving ? "Ap sove…" : "Sove plat la"}
      </button>
    </div>
  );
}
