import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";

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
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
      <h2 className="font-display text-lg font-bold">Kategori</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onSelectCat("all")}
          className={`rounded-full px-3 py-2.5 text-sm font-bold transition ${activeCat === "all" ? "bg-brand-deep text-white shadow-brand-xs" : "bg-brand-soft/60 text-brand-deep hover:bg-brand-soft"}`}
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
                  aria-label="Non kategori a"
                  className="w-28 rounded bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                />
                <button
                  onClick={() => onUpdateCategory(editingCat)}
                  aria-label="Konfime chanjman non kategori a"
                  className="text-emerald-600"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onEditingCatChange(null)}
                  aria-label="Anile chanjman"
                  className="text-ink-soft"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              // A native <button> can't contain other interactive elements
              // (invalid HTML), which is why the edit/delete actions used to
              // be <span role="button"> — but a span has no native keyboard
              // support, so those were unreachable by keyboard. Using a div
              // for the outer clickable chip (with its own tabIndex/onKeyDown)
              // lets the edit/delete actions be real, keyboard-operable
              // <button>s instead.
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelectCat(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectCat(c.id);
                  }
                }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-bold ${activeCat === c.id ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
              >
                {c.name} ({productCountByCategory(c.id)})
                <button
                  type="button"
                  aria-label={`Modifye kategori "${c.name}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditingCatChange({ id: c.id, name: c.name });
                  }}
                  className="opacity-60 hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Efase kategori "${c.name}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    requestConfirm(`Efase kategori "${c.name}"?`, () => onDeleteCategory(c.id));
                  }}
                  className="opacity-60 hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={newCatName}
          onChange={(e) => onNewCatNameChange(e.target.value)}
          placeholder="Non nouvo kategori a…"
          aria-label="Non nouvo kategori a…"
          className={inputCls() + " max-w-xs"}
        />
        <Button
          className="rounded-xl"
          disabled={!newCatName.trim() || isCreating}
          onClick={() => onCreateCategory(newCatName.trim())}
        >
          <Plus className="h-4 w-4" /> Ajoute
        </Button>
      </div>
      {ConfirmDialog}
    </section>
  );
}
