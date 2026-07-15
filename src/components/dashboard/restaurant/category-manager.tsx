import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";

type MenuCategory = Database["public"]["Tables"]["menu_categories"]["Row"];

type EditingCategory = { id: string; name: string };

type CategoryManagerProps = {
  categories: MenuCategory[];
  totalProductCount: number;
  productCountByCategory: (categoryId: string) => number;
  activeCat: string;
  onSelectCat: (id: string) => void;
  newCatName: string;
  onNewCatNameChange: (value: string) => void;
  onCreateCategory: (name: string) => void;
  isCreating: boolean;
  editingCat: EditingCategory | null;
  onEditingCatChange: (c: EditingCategory | null) => void;
  onUpdateCategory: (c: EditingCategory) => void;
  onDeleteCategory: (id: string) => void;
};

/** Restaurant menu's category filter/manage bar: select, inline rename, delete, and create. */
export function CategoryManager({
  categories,
  totalProductCount,
  productCountByCategory,
  activeCat,
  onSelectCat,
  newCatName,
  onNewCatNameChange,
  onCreateCategory,
  isCreating,
  editingCat,
  onEditingCatChange,
  onUpdateCategory,
  onDeleteCategory,
}: CategoryManagerProps) {
  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-bold">Kategori</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onSelectCat("all")}
          className={`rounded-full px-3 py-2.5 text-sm font-bold ${activeCat === "all" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
        >
          Tout ({totalProductCount})
        </button>
        {categories.map((c) => (
          <div key={c.id} className="group relative">
            {editingCat?.id === c.id ? (
              <div className="flex items-center gap-1 rounded-full border-2 border-brand bg-white px-2 py-1">
                <input
                  autoFocus
                  value={editingCat.name}
                  onChange={(e) => onEditingCatChange({ id: c.id, name: e.target.value })}
                  className="w-28 bg-transparent text-sm outline-none"
                />
                <button onClick={() => onUpdateCategory(editingCat)} className="text-emerald-600">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onEditingCatChange(null)} className="text-ink-soft">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => onSelectCat(c.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-bold ${activeCat === c.id ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
              >
                {c.name} ({productCountByCategory(c.id)})
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditingCatChange({ id: c.id, name: c.name });
                  }}
                  className="opacity-60 hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Efase kategori "${c.name}"?`)) onDeleteCategory(c.id);
                  }}
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
          onChange={(e) => onNewCatNameChange(e.target.value)}
          placeholder="Non nouvo kategori a…"
          className={inputCls() + " max-w-xs"}
        />
        <button
          disabled={!newCatName.trim() || isCreating}
          onClick={() => onCreateCategory(newCatName.trim())}
          className="inline-flex items-center gap-1 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Ajoute
        </button>
      </div>
    </section>
  );
}
