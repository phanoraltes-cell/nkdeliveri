import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, User } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MobileDrawer } from "@/components/dashboard/drawer/mobile-drawer";
import { PROFILE_LINK_BY_ROLE } from "@/components/dashboard/sidebar/nav-items";
import type { User as SupabaseUser } from "@supabase/supabase-js";

type DashboardHeaderProps = {
  role: string;
  user: SupabaseUser | null | undefined;
  onSignOut: () => void;
};

export function DashboardHeader({ role, user, onSignOut }: DashboardHeaderProps) {
  const qc = useQueryClient();
  const unreadQueryKey = ["notif-unread", user?.id] as const;

  const { data: unread = 0 } = useQuery({
    queryKey: unreadQueryKey,
    enabled: !!user,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Was a 30s poll (constant DB load on every dashboard tab, every user, all
  // the time) — every other live-updating piece of this app already uses
  // Realtime (see useLiveOrders), so this badge follows the same pattern:
  // refetch only when this user's own notifications actually change.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif-unread-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: unreadQueryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const { data: avatarUrl } = useQuery({
    queryKey: ["header-avatar", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.avatar_url ?? null;
    },
  });

  const profileLink = PROFILE_LINK_BY_ROLE[role];
  const avatarNode = avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-full border border-brand-soft object-cover"
    />
  ) : (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
      <User className="h-4 w-4" aria-hidden="true" />
    </div>
  );

  return (
    <header className="sticky top-0 z-40 flex min-h-16 items-center gap-2 border-b border-brand-soft/50 bg-white pt-[var(--sat)] pb-2 pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] shadow-sm sm:gap-3 sm:pl-[max(1.25rem,var(--sal))] sm:pr-[max(1.25rem,var(--sar))]">
      <MobileDrawer role={role} onSignOut={onSignOut} />

      <Link to="/" className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
        <img
          src="/nk-logo.png"
          alt="NK"
          width={36}
          height={36}
          className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9"
        />
        <span className="truncate font-display text-base font-extrabold text-ink sm:text-lg">
          NK <span className="text-brand">Deliveri</span>
        </span>
      </Link>

      <span className="hidden shrink-0 truncate rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-deep sm:ml-2 sm:inline-block">
        {role.replace("_", " ")}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <Link
          to="/notifications"
          className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-soft bg-white text-brand-deep hover:bg-brand-soft/40"
          aria-label="Notifikasyon"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        {profileLink ? (
          <Link to={profileLink} aria-label="Pwofil mwen" className="shrink-0">
            {avatarNode}
          </Link>
        ) : (
          avatarNode
        )}
        <span className="hidden text-sm text-ink-soft lg:inline">{user?.email}</span>
      </div>
    </header>
  );
}
