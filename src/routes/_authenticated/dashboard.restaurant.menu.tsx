import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { CategoryManager } from "@/components/dashboard/restaurant/category-manager";
import { ProductGrid } from "@/components/dashboard/restaurant/product-grid";
import { ProductForm } from "@/components/dashboard/restaurant/product-form";

type MenuProduct = Database["public"]["Tables"]["products"]["Row"];

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/menu")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (
      role !== "restaurant_owner" &&
      role !== "restaurant_staff" &&
      role !== "admin" &&
      role !== "super_admin"
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantMenu,
});

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
    onSuccess: () => {
      setNewCatName("");
      toast.success("Kategori ajoute");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateCategory = useMutation({
    mutationFn: async (c: { id: string; name: string }) => {
      const cat = categories.data?.find((x) => x.id === c.id);
      const { error } = await supabase.rpc("update_menu_category_secure", {
        _category_id: c.id,
        _name: c.name,
        _sort_order: cat?.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingCat(null);
      toast.success("Kategori mizajou");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_menu_category_secure", { _category_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kategori efase");
      if (activeCat !== "all") setActiveCat("all");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_product_secure", { _product_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plat retire nan meni an");
      invalidate();
    },
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
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <CategoryManager
        categories={categories.data ?? []}
        totalProductCount={products.data?.length ?? 0}
        productCountByCategory={(categoryId) =>
          products.data?.filter((p) => p.category_id === categoryId).length ?? 0
        }
        activeCat={activeCat}
        onSelectCat={setActiveCat}
        newCatName={newCatName}
        onNewCatNameChange={setNewCatName}
        onCreateCategory={(name) => createCategory.mutate(name)}
        isCreating={createCategory.isPending}
        editingCat={editingCat}
        onEditingCatChange={setEditingCat}
        onUpdateCategory={(c) => updateCategory.mutate(c)}
        onDeleteCategory={(id) => deleteCategory.mutate(id)}
      />

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
            onClose={() => {
              setShowAddProduct(false);
              setEditingProduct(null);
            }}
            onSaved={invalidate}
          />
        )}

        <ProductGrid
          products={visibleProducts}
          onEdit={setEditingProduct}
          onDelete={(id) => deleteProduct.mutate(id)}
        />
      </section>
    </div>
  );
}
