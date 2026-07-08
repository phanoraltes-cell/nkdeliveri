import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCSV } from "@/lib/csv-export";
import { Download, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/admin/users")({
  beforeLoad: ({ context }) => {
    const role = (context as any).role;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminUsers,
});

const ROLE_LABEL: Record<string, string> = {
  customer: "Kliyan",
  restaurant_owner: "Restoran",
  restaurant_staff: "Anplwaye restoran",
  driver: "Livrè",
  admin: "Admin",
  super_admin: "Super Admin",
};

const ROLE_TONE: Record<string, string> = {
  customer: "bg-blue-50 text-blue-700",
  restaurant_owner: "bg-orange-50 text-orange-700",
  restaurant_staff: "bg-orange-50 text-orange-700",
  driver: "bg-emerald-50 text-emerald-700",
  admin: "bg-purple-50 text-purple-700",
  super_admin: "bg-purple-50 text-purple-700",
};

function AdminUsers() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const users = useQuery({
    queryKey: ["admin-all-users", search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_users_admin", {
        _search: search.trim() || undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = (users.data ?? []).filter(
    (u) => roleFilter === "all" || (u.roles ?? []).includes(roleFilter as never),
  );

  function exportUsers() {
    if (!filtered.length) return;
    downloadCSV(
      `itilizate_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Imèl", "Prenon", "Non", "Telefòn", "Wòl", "Enskri sou"],
      filtered.map((u) => [
        u.email, u.first_name ?? "", u.last_name ?? "", u.phone ?? "",
        (u.roles ?? []).map((r: string) => ROLE_LABEL[r] ?? r).join(", "),
        new Date(u.created_at).toLocaleDateString("fr-HT"),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Jere itilizatè</h1>
          <p className="mt-1 text-ink-soft">Tout kont sou platfòm nan, kèlkeswa wòl yo.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">← Admin</Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">
            Itilizatè {users.data ? `(${filtered.length})` : ""}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Chèche non, imèl, telefòn…"
                className="rounded-full border-2 border-brand-soft bg-white py-2.5 pl-8 pr-3 text-xs outline-none focus:border-brand"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand"
            >
              <option value="all">Tout wòl</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={exportUsers}
              disabled={!filtered.length}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        </div>

        {users.isLoading && <div className="text-sm text-ink-soft">Chajman…</div>}
        {users.error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            Erè pandan chajman: {(users.error as Error).message}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-soft/30 text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-3 py-2">Non</th>
                <th className="px-3 py-2">Imèl</th>
                <th className="px-3 py-2">Telefòn</th>
                <th className="px-3 py-2">Wòl</th>
                <th className="px-3 py-2">Enskri</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-brand-soft/30">
                  <td className="whitespace-nowrap px-3 py-2 font-bold">
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{u.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{u.phone ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(u.roles ?? []).length === 0 && <span className="text-xs text-ink-soft">—</span>}
                      {(u.roles ?? []).map((r: string) => (
                        <span
                          key={r}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_TONE[r] ?? "bg-ink/10 text-ink-soft"}`}
                        >
                          {ROLE_LABEL[r] ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                    {new Date(u.created_at).toLocaleDateString("fr-HT")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.isLoading && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-soft">Pa gen itilizatè ki koresponn.</div>
          )}
        </div>
      </section>
    </div>
  );
}
