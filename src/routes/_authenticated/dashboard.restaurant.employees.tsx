import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Users, UserPlus, Trash2 } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { EMPLOYEE_ROLES, EMPLOYEE_ROLE_LABEL, type EmployeeRole } from "@/lib/employee-roles";
import { sendEmployeeEventPush } from "@/lib/send-employee-push.functions";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { inputCls } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/employees")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "restaurant_owner" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantEmployees,
});

function RestaurantEmployees() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: restaurant } = useMyRestaurant(user?.id);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<EmployeeRole>("staff");
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const employees = useQuery({
    queryKey: ["restaurant-employees", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_restaurant_employees_secure", {
        _restaurant_id: restaurant!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sendEmployeePush = useServerFn(sendEmployeeEventPush);

  const add = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id) throw new Error("Restoran pa jwenn");
      if (!email.trim()) throw new Error("Antre yon imèl");
      const { data: row, error } = await supabase.rpc("add_restaurant_employee_secure", {
        _restaurant_id: restaurant.id,
        _email: email.trim(),
        _role: inviteRole,
      });
      if (error) throw error;
      try {
        await sendEmployeePush({ data: { employeeId: row.id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Anplwaye ajoute");
      setEmail("");
      setInviteRole("staff");
      qc.invalidateQueries({ queryKey: ["restaurant-employees"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("remove_restaurant_employee_secure", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anplwaye retire");
      qc.invalidateQueries({ queryKey: ["restaurant-employees"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: EmployeeRole }) => {
      const { error } = await supabase.rpc("update_restaurant_employee_role_secure", {
        _id: id,
        _role: role,
      });
      if (error) throw error;
      try {
        await sendEmployeePush({ data: { employeeId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Wòl aktyalize");
      qc.invalidateQueries({ queryKey: ["restaurant-employees"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Anplwaye</h1>
          <p className="mt-1 text-ink-soft">Manm ekip ki ka jere Kòmand ak Meni restoran an.</p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
        <h2 className="font-display text-lg font-bold">Ajoute yon anplwaye</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Moun sa a dwe gen tan gen yon kont NK Deliveri deja (menm si se yon kont kliyan).
          Manadjè/Responsab ka jere meni ak pwomosyon; Kizinye/Preparatè/Kesye jere kòmand sèlman.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="imèl@egzanp.com"
            aria-label="Imèl anplwaye a"
            className={`min-w-0 flex-1 ${inputCls()}`}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as EmployeeRole)}
            aria-label="Wòl anplwaye a"
            className={inputCls()}
          >
            {EMPLOYEE_ROLES.map((r) => (
              <option key={r} value={r}>
                {EMPLOYEE_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            disabled={add.isPending}
            onClick={() => add.mutate()}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> {add.isPending ? "Ap ajoute…" : "Ajoute"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
          <Users className="h-5 w-5 text-brand-deep" /> Ekip la ({employees.data?.length ?? 0})
        </h2>
        {employees.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        )}
        {!employees.isLoading && employees.data?.length === 0 && (
          <div className="rounded-xl border border-dashed border-brand-soft/60 p-4 text-center text-sm text-ink-soft">
            Ou poko gen okenn anplwaye.
          </div>
        )}
        <ul className="space-y-2">
          {employees.data?.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-soft/50 p-3"
            >
              <div>
                <div className="font-bold text-ink">
                  {`${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || "Anplwaye"}
                </div>
                <div className="text-xs text-ink-soft">{e.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={e.role}
                  disabled={changeRole.isPending}
                  onChange={(ev) =>
                    changeRole.mutate({ id: e.id, role: ev.target.value as EmployeeRole })
                  }
                  aria-label={`Wòl pou ${e.email}`}
                  className="rounded-lg border-2 border-brand-soft bg-white px-2.5 py-2 text-xs font-semibold outline-none transition-[border-color,box-shadow] focus:border-brand focus:shadow-brand-xs disabled:opacity-50"
                >
                  {EMPLOYEE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {EMPLOYEE_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => requestConfirm(`Retire ${e.email}?`, () => remove.mutate(e.id))}
                  disabled={remove.isPending}
                  aria-label="Retire"
                  title="Retire"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 transition hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {ConfirmDialog}
    </div>
  );
}
