import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Pencil, Trash2, Upload, X } from "lucide-react";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";

type MenuCategory = Database["public"]["Tables"]["menu_categories"]["Row"];
type MenuProduct = Database["public"]["Tables"]["products"]["Row"];

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/menu")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "restaurant_owner" && role !== "restaurant_staff" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantMenu,
});

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
  const path = `${restaurantId}/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage.from("menu-photos").upload(path, file, { upsert: false });
  if (error) throw error;
  return supabase.storage.from("menu-photos").getPublicUrl(path).data.publicUrl;
}

function RestaurantMenu() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [newCatName, setNewCatName] = useState("");
  const [editingCat, setEditingCat] = useState<{ id: string; name: string } | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MenuProduct | null>(null);

  const { data: restaurant } = useMyRestaurant(user?.id);

  const categories = useQuery({
    queryKey: ["restaurant-categories", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const products = useQuery({
    queryKey: ["restaurant-products", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .is("archived_at", null)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["restaurant-categories"] });
    qc.invalidateQueries({ queryKey: ["restaurant-products"] });
  }

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc("create_menu_category_secure", {
        _restaurant_id: restaurant!.id,
        _name: name,
        _sort_order: categories.data?.length ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { setNewCatName(""); toast.success("Kategori ajoute"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const updateCategory = useMutation({
    mutationFn: async (c: { id: string; name: string }) => {
      const cat = categories.data?.find((x) => x.id === c.id);
      const { error } = await supabase.rpc("update_menu_category_secure", {
        _category_id: c.id, _name: c.name, _sort_order: cat?.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { setEditingCat(null); toast.success("Kategori mizajou"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_menu_category_secure", { _category_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Kategori efase"); if (activeCat !== "all") setActiveCat("all"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_product_secure", { _product_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Plat retire nan meni an"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const visibleProducts = (products.data ?? []).filter(
    (p) => activeCat === "all" || p.category_id === activeCat,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Meni</h1>
          <p className="mt-1 text-ink-soft">Jere kategori ak plat ou yo.</p>
        </div>
        <Link to="/dashboard/restaurant" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Kategori</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCat("all")}
            className={`rounded-full px-3 py-2.5 text-sm font-bold ${activeCat === "all" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
          >
            Tout ({products.data?.length ?? 0})
          </button>
          {categories.data?.map((c) => (
            <div key={c.id} className="group relative">
              {editingCat?.id === c.id ? (
                <div className="flex items-center gap-1 rounded-full border-2 border-brand bg-white px-2 py-1">
                  <input
                    autoFocus
                    value={editingCat.name}
                    onChange={(e) => setEditingCat({ id: c.id, name: e.target.value })}
                    className="w-28 bg-transparent text-sm outline-none"
                  />
                  <button onClick={() => updateCategory.mutate(editingCat)} className="text-emerald-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setEditingCat(null)} className="text-ink-soft"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <button
                  onClick={() => setActiveCat(c.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-bold ${activeCat === c.id ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
                >
                  {c.name} ({products.data?.filter((p) => p.category_id === c.id).length ?? 0})
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setEditingCat({ id: c.id, name: c.name }); }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Efase kategori "${c.name}"?`)) deleteCategory.mutate(c.id); }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="Non nouvo kategori a…"
            className={inputCls() + " max-w-xs"}
          />
          <button
            disabled={!newCatName.trim() || createCategory.isPending}
            onClick={() => createCategory.mutate(newCatName.trim())}
            className="inline-flex items-center gap-1 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Ajoute
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Plat</h2>
          <button
            onClick={() => setShowAddProduct(true)}
            className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-deep"
          >
            <Plus className="h-4 w-4" /> Ajoute yon plat
          </button>
        </div>

        {(showAddProduct || editingProduct) && restaurant && (
          <ProductForm
            restaurantId={restaurant.id}
            categories={categories.data ?? []}
            product={editingProduct}
            onClose={() => { setShowAddProduct(false); setEditingProduct(null); }}
            onSaved={invalidate}
          />
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProducts.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-brand-soft/50">
              {p.image_url && (
                <img
                  src={p.image_url}
                  alt={p.name}
                  loading="lazy"
                  width={240}
                  height={128}
                  className="h-32 w-full object-cover"
                />
              )}
              <div className="p-3">
                <div className="font-bold">{p.name}</div>
                <div className="text-xs text-ink-soft">{p.description}</div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-display font-extrabold text-brand-deep">{formatHTG(Number(p.price))}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${p.available ? "bg-emerald-100 text-emerald-800" : "bg-ink/10 text-ink-soft"}`}>
                    {p.available ? "Disponib" : "Pa disponib"}
                  </span>
                </div>
                {p.stock_quantity != null && (
                  <div className={`mt-1 text-[11px] font-semibold ${p.stock_quantity === 0 ? "text-red-600" : "text-ink-soft"}`}>
                    Stock: {p.stock_quantity}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setEditingProduct(p)}
                    className="flex-1 rounded-lg border-2 border-brand-soft py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                  >
                    Modifye
                  </button>
                  <button
                    onClick={() => { if (confirm(`Retire "${p.name}" nan meni an?`)) deleteProduct.mutate(p.id); }}
                    className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {visibleProducts.length === 0 && (
          <div className="mt-4 rounded-xl bg-brand-soft/30 p-6 text-center text-sm text-ink-soft">
            Pa gen plat pou kategori sa a.
          </div>
        )}
      </section>
    </div>
  );
}

function ProductForm({
  restaurantId, categories, product, onClose, onSaved,
}: {
  restaurantId: string;
  categories: MenuCategory[];
  product: MenuProduct | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
    <div className="mt-4 rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">{product ? "Modifye plat" : "Nouvo plat"}</h3>
        <button onClick={onClose} className="text-ink-soft hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input placeholder="Non plat la" className={inputCls()} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="Pri (HTG)" type="number" min="0" step="1" className={inputCls()} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <select className={inputCls()} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
          <option value="">San kategori</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={inputCls()} value={f.dish_type} onChange={(e) => setF({ ...f, dish_type: e.target.value })}>
          {DISH_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <textarea placeholder="Deskripsyon (opsyonèl)" rows={2} className={inputCls() + " sm:col-span-2"} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input
          placeholder="Kantite stock (kite vid = ilimite)"
          type="number"
          min="0"
          step="1"
          className={inputCls()}
          value={f.stock_quantity}
          onChange={(e) => setF({ ...f, stock_quantity: e.target.value })}
        />
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-white">
          <Upload className="h-3.5 w-3.5" /> {photo?.name || "Chanje foto plat la"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />
          Disponib pou kòmande
        </label>
      </div>
      <button
        disabled={saving}
        onClick={save}
        className="mt-4 rounded-full bg-brand px-6 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
      >
        {saving ? "Ap sove…" : "Sove plat la"}
      </button>
    </div>
  );
}
