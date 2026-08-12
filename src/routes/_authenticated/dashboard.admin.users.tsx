import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { downloadCSV } from "@/lib/csv-export";
import { suspendUserAccount, reactivateUserAccount } from "@/lib/manage-user.functions";
import { toast } from "sonner";
import { Download, Search, X, Ban, RotateCcw } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 500;

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/users")({
  component: AdminUsers,
});

type AppRole = Database["public"]["Enums"]["app_role"];

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

const ASSIGNABLE_ROLES: AppRole[] = [
  "customer",
  "restaurant_owner",
  "driver",
  "admin",
  "super_admin",
];

function AdminUsers() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [addRoleFor, setAddRoleFor] = useState<Record<string, AppRole>>({});
  const [exporting, setExporting] = useState(false);
  const suspendFn = useServerFn(suspendUserAccount);
  const reactivateFn = useServerFn(reactivateUserAccount);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const { withReauth, invalidateStepUp, dialogState } = useReauth();

  const users = useQuery({
    queryKey: ["admin-all-users", search, roleFilter, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_users_admin", {
        _search: search.trim() || undefined,
        _role: roleFilter === "all" ? undefined : (roleFilter as AppRole),
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = users.data ?? [];
  const totalCount = filtered[0]?.total_count ?? 0;

  function goToPage(p: number) {
    setPage(Math.max(1, p));
  }

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function updateRoleFilter(v: string) {
    setRoleFilter(v);
    setPage(1);
  }

  async function exportUsers() {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("get_all_users_admin", {
        _search: search.trim() || undefined,
        _role: roleFilter === "all" ? undefined : (roleFilter as AppRole),
        _limit: EXPORT_LIMIT,
        _offset: 0,
      });
      if (error) throw error;
      const rows = data ?? [];
      if (!rows.length) return;
      if ((rows[0]?.total_count ?? 0) > EXPORT_LIMIT) {
        toast.warning(`Sèlman premye ${EXPORT_LIMIT} itilizatè yo enkli nan ekspò a.`);
      }
      downloadCSV(
        `itilizate_${new Date().toISOString().slice(0, 10)}.csv`,
        ["Imèl", "Prenon", "Non", "Telefòn", "Wòl", "Enskri sou"],
        rows.map((u) => [
          u.email,
          u.first_name ?? "",
          u.last_name ?? "",
          u.phone ?? "",
          (u.roles ?? []).map((r: string) => ROLE_LABEL[r] ?? r).join(", "),
          new Date(u.created_at).toLocaleDateString("fr-HT"),
        ]),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan ekspòtasyon an");
    } finally {
      setExporting(false);
    }
  }

  // Modifying admin/super_admin privileges — STRICT tier (fresh MFA
  // required, no password/OAuth fallback substitute; see
  // docs/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md). On a STEP_UP_REQUIRED*
  // rejection, invalidate the locally-cached verification so the very
  // next click re-prompts instead of failing the same way silently.
  const addRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc("add_user_role_secure", {
        _user_id: userId,
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wòl ajoute");
      qc.invalidateQueries({ queryKey: ["admin-all-users"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error("Verifikasyon sekirite ekspire — klike ankò pou re-verifye.");
        return;
      }
      toast.error(e.message);
    },
  });

  const removeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.rpc("remove_user_role_secure", {
        _user_id: userId,
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wòl retire");
      qc.invalidateQueries({ queryKey: ["admin-all-users"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error("Verifikasyon sekirite ekspire — klike ankò pou re-verifye.");
        return;
      }
      toast.error(e.message);
    },
  });

  const suspend = useMutation({
    mutationFn: async (userId: string) => {
      await suspendFn({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("Kont sispann");
      qc.invalidateQueries({ queryKey: ["admin-all-users"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const reactivate = useMutation({
    mutationFn: async (userId: string) => {
      await reactivateFn({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("Kont reyaktive");
      qc.invalidateQueries({ queryKey: ["admin-all-users"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Jere itilizatè</h1>
          <p className="mt-1 text-ink-soft">Tout kont sou platfòm nan, kèlkeswa wòl yo.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">
            Itilizatè {users.data ? `(${totalCount})` : ""}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
              <input
                value={search}
                onChange={(e) => updateSearch(e.target.value)}
                placeholder="Chèche non, imèl, telefòn…"
                aria-label="Chèche non, imèl, telefòn…"
                className="rounded-full border-2 border-brand-soft bg-white py-2.5 pl-8 pr-3 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => updateRoleFilter(e.target.value)}
              aria-label="Filtre pa wòl"
              className="rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <option value="all">Tout wòl</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              onClick={exportUsers}
              disabled={!filtered.length || exporting}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {exporting ? "…" : "CSV"}
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
                <th className="px-3 py-2">Aksyon</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isSelf = u.id === user?.id;
                const isBanned = !!u.banned_until && new Date(u.banned_until) > new Date();
                const pendingRoleToAdd = addRoleFor[u.id] ?? "customer";
                return (
                  <tr key={u.id} className="border-t border-brand-soft/30 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-bold">
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                      {isSelf && (
                        <span className="ml-1 text-[10px] font-normal text-ink-soft">(ou)</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{u.email}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{u.phone ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {(u.roles ?? []).length === 0 && (
                          <span className="text-xs text-ink-soft">—</span>
                        )}
                        {(u.roles ?? []).map((r: string) => (
                          <span
                            key={r}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_TONE[r] ?? "bg-ink/10 text-ink-soft"}`}
                          >
                            {ROLE_LABEL[r] ?? r}
                            <button
                              onClick={() =>
                                requestConfirm(
                                  `Retire wòl ${ROLE_LABEL[r] ?? r} nan men ${u.email}?`,
                                  () =>
                                    withReauth(
                                      () => removeRole.mutate({ userId: u.id, role: r as AppRole }),
                                      "strict",
                                    ),
                                )
                              }
                              disabled={removeRole.isPending}
                              aria-label={`Retire wòl ${ROLE_LABEL[r] ?? r}`}
                              className="hover:text-red-700 disabled:opacity-50"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <select
                          value={pendingRoleToAdd}
                          onChange={(e) =>
                            setAddRoleFor((s) => ({ ...s, [u.id]: e.target.value as AppRole }))
                          }
                          aria-label={`Nouvo wòl pou ${u.email}`}
                          className="rounded-md border border-brand-soft bg-white px-1.5 py-1 text-[10px]"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() =>
                            withReauth(
                              () => addRole.mutate({ userId: u.id, role: pendingRoleToAdd }),
                              "strict",
                            )
                          }
                          disabled={addRole.isPending}
                          className="rounded-md bg-brand-soft/60 px-2 py-1 text-[10px] font-bold text-brand-deep hover:bg-brand hover:text-white disabled:opacity-50"
                        >
                          + Ajoute
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                      {new Date(u.created_at).toLocaleDateString("fr-HT")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {isBanned ? (
                        <button
                          onClick={() => reactivate.mutate(u.id)}
                          disabled={reactivate.isPending}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" /> Reyaktive
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            requestConfirm(`Sispann kont ${u.email}?`, () => suspend.mutate(u.id))
                          }
                          disabled={suspend.isPending || isSelf}
                          title={isSelf ? "Ou pa ka sispann pwòp kont ou" : undefined}
                          className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          <Ban className="h-3 w-3" /> Sispann
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!users.isLoading && filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-soft">
              Pa gen itilizatè ki koresponn.
            </div>
          )}
        </div>
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          onPageChange={goToPage}
          className="mt-4"
        />
      </section>
      {ConfirmDialog}
      <ReauthDialog state={dialogState} />
    </div>
  );
}
