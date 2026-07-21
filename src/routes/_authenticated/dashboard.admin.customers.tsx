import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";
import { sendNewsletterBroadcast } from "@/lib/send-newsletter.functions";
import { toast } from "sonner";
import { useState } from "react";
import { Download, Search, Send, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 500;

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/customers")({
  component: AdminCustomers,
});

function AdminCustomers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [exporting, setExporting] = useState(false);
  const sendBroadcast = useServerFn(sendNewsletterBroadcast);

  const customers = useQuery({
    queryKey: ["admin-customers", search, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_customers_admin", {
        _search: search.trim() || undefined,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const totalCustomers = customers.data?.[0]?.total_count ?? 0;

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  const subscribers = useQuery({
    queryKey: ["admin-newsletter-subscribers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select("email, subscribed_at, unsubscribed_at, source")
        .order("subscribed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const activeSubs = subscribers.data?.filter((s) => !s.unsubscribed_at) ?? [];

  const broadcast = useMutation({
    mutationFn: async () => {
      if (!subject.trim() || !body.trim()) throw new Error("Ranpli sijè ak kontni mesaj la");
      const res = await sendBroadcast({ data: { subject, html: body.replace(/\n/g, "<br>") } });
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Voye: ${res.sent}/${res.total} · Echwe: ${res.failed}`);
      setSubject("");
      setBody("");
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  async function exportCustomers() {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("get_customers_admin", {
        _search: search.trim() || undefined,
        _limit: EXPORT_LIMIT,
        _offset: 0,
      });
      if (error) throw error;
      const rows = data ?? [];
      if (!rows.length) return;
      if ((rows[0]?.total_count ?? 0) > EXPORT_LIMIT) {
        toast.warning(`Sèlman premye ${EXPORT_LIMIT} kliyan yo enkli nan ekspò a.`);
      }
      downloadCSV(
        `kliyan_${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "Imèl",
          "Prenon",
          "Non",
          "Telefòn",
          "Adrès",
          "Enskri sou",
          "Kòmand total",
          "Total achte (HTG)",
        ],
        rows.map((c) => [
          c.email,
          c.first_name ?? "",
          c.last_name ?? "",
          c.phone ?? "",
          c.address ?? "",
          new Date(c.created_at).toLocaleDateString("fr-HT"),
          c.total_orders,
          Number(c.total_spent),
        ]),
      );
      toast.success("CSV telechaje");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan ekspòtasyon an");
    } finally {
      setExporting(false);
    }
  }

  function exportSubscribers() {
    if (!subscribers.data?.length) return;
    downloadCSV(
      `abone-newsletter_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Imèl", "Enskri sou", "Dezabone sou", "Sous"],
      subscribers.data.map((s) => [
        s.email,
        new Date(s.subscribed_at).toLocaleDateString("fr-HT"),
        s.unsubscribed_at ? new Date(s.unsubscribed_at).toLocaleDateString("fr-HT") : "",
        s.source,
      ]),
    );
    toast.success("CSV telechaje");
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Kliyan &amp; Newsletter</h1>
          <p className="mt-1 text-ink-soft">
            Swiv kliyan yo, ekspòte done, voye enfòmasyon bay abone yo.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">
            Kliyan {customers.data ? `(${totalCustomers})` : ""}
          </h2>
          <div className="flex items-center gap-2">
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
            <button
              onClick={exportCustomers}
              disabled={!customers.data?.length || exporting}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {exporting ? "…" : "CSV"}
            </button>
          </div>
        </div>

        {customers.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-soft/30 text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-3 py-2">Non</th>
                <th className="px-3 py-2">Imèl</th>
                <th className="px-3 py-2">Telefòn</th>
                <th className="px-3 py-2">Enskri</th>
                <th className="px-3 py-2 text-right">Kòmand</th>
                <th className="px-3 py-2 text-right">Total achte</th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.map((c) => (
                <tr key={c.id} className="border-t border-brand-soft/30">
                  <td className="whitespace-nowrap px-3 py-2 font-bold">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{c.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{c.phone ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                    {new Date(c.created_at).toLocaleDateString("fr-HT")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{c.total_orders}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-brand-deep">
                    {formatHTG(Number(c.total_spent))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!customers.isLoading && customers.data?.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-soft">Pa gen kliyan ki koresponn.</div>
          )}
        </div>
        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCustomers}
          onPageChange={setPage}
          className="mt-4"
        />
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">
            Abone Newsletter {activeSubs.length ? `(${activeSubs.length} aktif)` : ""}
          </h2>
          <button
            onClick={exportSubscribers}
            disabled={!subscribers.data?.length}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>

        {subscribers.isLoading && <Skeleton className="h-12 w-full rounded-xl" />}
        <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-xl border border-brand-soft/40">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-brand-soft/30 text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-3 py-2">Imèl</th>
                <th className="px-3 py-2">Enskri sou</th>
                <th className="px-3 py-2">Estati</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.data?.map((s) => (
                <tr key={s.email} className="border-t border-brand-soft/30">
                  <td className="px-3 py-2 text-xs">{s.email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                    {new Date(s.subscribed_at).toLocaleDateString("fr-HT")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={s.unsubscribed_at ? "neutral" : "good"}>
                      {s.unsubscribed_at ? "Dezabone" : "Aktif"}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!subscribers.isLoading && subscribers.data?.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-soft">Pa gen abone ankò.</div>
          )}
        </div>

        <div className="mt-5 border-t border-brand-soft/40 pt-4">
          <h3 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold">
            <Mail className="h-4 w-4" /> Voye imèl an mas bay {activeSubs.length} abone aktif
          </h3>
          <div className="space-y-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Sijè imèl la"
              aria-label="Sijè imèl la"
              className={inputClsCompact()}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Kontni mesaj la…"
              aria-label="Kontni mesaj la…"
              rows={5}
              className={inputClsCompact()}
            />
            <Button
              disabled={broadcast.isPending || !activeSubs.length}
              onClick={() => broadcast.mutate()}
            >
              <Send className="h-4 w-4" />{" "}
              {broadcast.isPending ? "Ap voye…" : "Voye bay tout abone yo"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
