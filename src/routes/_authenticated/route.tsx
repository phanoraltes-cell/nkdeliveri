import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase.rpc("get_primary_role", { _user_id: data.user.id });
    return { user: data.user, role: (role as string | null) ?? "customer" };
  },
  component: () => <Outlet />,
});