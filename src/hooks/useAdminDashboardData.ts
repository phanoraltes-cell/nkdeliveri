import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";

/**
 * Every data source the admin dashboard's overview page reads or writes —
 * extracted verbatim from dashboard.admin.index.tsx (same query keys, same
 * realtime channel, same mutation behavior) so that route file can stay
 * focused on filter state and rendering instead of also owning six queries,
 * two mutations, and a realtime subscription.
 */
export function useAdminDashboardData() {
  const qc = useQueryClient();

  const onlineDrivers = useQuery({
    queryKey: ["admin-online-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, first_name, last_name, current_lat, current_lng, status")
        .eq("status", "online");
      if (error) throw error;
      return data;
    },
  });

  // Was a 15s poll — every other live-updating section of this dashboard
  // already uses Realtime (see useLiveOrders), so this follows the same
  // pattern: refetch only when a driver's row actually changes (going
  // online/offline, or their position updating).
  useEffect(() => {
    const channel = supabase
      .channel("admin-online-drivers")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-online-drivers"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const approvedRestaurants = useQuery({
    queryKey: ["admin-map-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, lat, lng, address")
        .eq("status", "approved");
      if (error) throw error;
      return data;
    },
  });

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [users, restos, drivers, pendingR, pendingD] = await Promise.all([
        supabase.from("profiles").select("id", { head: true, count: "exact" }),
        supabase.from("restaurants").select("id", { head: true, count: "exact" }),
        supabase.from("drivers").select("id", { head: true, count: "exact" }),
        supabase
          .from("restaurants")
          .select("id", { head: true, count: "exact" })
          .eq("status", "pending"),
        supabase
          .from("drivers")
          .select("id", { head: true, count: "exact" })
          .eq("status", "pending"),
      ]);
      return {
        users: users.count ?? 0,
        restaurants: restos.count ?? 0,
        drivers: drivers.count ?? 0,
        pendingRestaurants: pendingR.count ?? 0,
        pendingDrivers: pendingD.count ?? 0,
      };
    },
  });

  const weeklyRevenue = useWeeklySeries(
    ["admin-weekly-revenue"],
    async (since) => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, total")
        .gte("created_at", since.toISOString())
        .neq("status", "cancelled")
        .neq("status", "refunded");
      if (error) throw error;
      return data ?? [];
    },
    (o) => ({ date: o.created_at, value: Number(o.total) }),
  );

  const pendingRestaurants = useQuery({
    queryKey: ["pending-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, cuisine, phone, address, description, logo_url, cover_url, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingDrivers = useQuery({
    queryKey: ["pending-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select(
          "id, first_name, last_name, phone, address, vehicle_type, license_plate, id_doc_url, license_doc_url, vehicle_photo_url, created_at",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateResto = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "pending_contract" | "approved" | "rejected" | "suspended";
    }) => {
      const { error } = await supabase.rpc("update_restaurant_status_secure", {
        _restaurant_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { status }) => {
      qc.invalidateQueries({ queryKey: ["pending-restaurants"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      // Tach 7 — yon "apwouve" pa fini ankò: restoran an ap tann pwopriyetè
      // a siyen kontra a anvan li vin reyèlman 'approved'.
      toast.success(
        status === "pending_contract"
          ? "Aplikasyon apwouve — kontra a ap tann siyati pwopriyetè a"
          : "Estati restoran aktyalize",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const updateDriver = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected" | "suspended";
    }) => {
      const { error } = await supabase.rpc("update_driver_status_secure", {
        _driver_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Estati livrè aktyalize");
    },
    onError: (e) => toast.error(e.message),
  });

  // Ekstansyon Tach 7 (de tip kontra) — RPC SEPARE de updateDriver anwo a
  // espre: sa a chanje DE chan an menm tan (status + account_status), yon
  // sèl aksyon atomik pou "apwouve yon aplikasyon an atant". updateDriver
  // (jeneral) rete itilize pou reyaktive/sispann yon livrè ki DEJA
  // apwouve/siyen — li pa ta dwe janm re-deklannche yon egzijans siyati
  // kontra pou yon moun ki deja aktif.
  const approveDriverPendingContract = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_driver_pending_contract_secure", {
        _driver_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Aplikasyon apwouve — kontra a ap tann siyati livrè a");
    },
    onError: (e) => toast.error(e.message),
  });

  return {
    onlineDrivers,
    approvedRestaurants,
    stats,
    weeklyRevenue,
    pendingRestaurants,
    pendingDrivers,
    updateResto,
    updateDriver,
    approveDriverPendingContract,
  };
}
