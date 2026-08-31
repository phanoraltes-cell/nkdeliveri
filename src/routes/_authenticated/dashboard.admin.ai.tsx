import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Copy, RefreshCw, Send, Megaphone, ListChecks, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { useAdminAiStream } from "@/hooks/useAdminAiStream";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used
// to repeat the same check locally, which was redundant with it. Wòl la
// verifye YON DEZYÈM FWA sou sèvè a nan api.admin.ai.ts (jamè fè konfyans
// a gad kliyan an sèlman — se li ki jere kritè aksèptasyon #1's dezyèm
// mwatye: "si mwen rele wout API a dirèkteman, li refize m").
export const Route = createFileRoute("/_authenticated/dashboard/admin/ai")({
  component: AdminAi,
});

type Tab = "summary" | "message" | "ad" | "priorities";

function copyToClipboard(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Kopye!"))
    .catch(() => toast.error("Pa ka kopye — kopye l alamen."));
}

function AdminAi() {
  const [tab, setTab] = useState<Tab>("summary");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold text-ink">
            <Sparkles className="h-7 w-7 text-brand-deep" /> Asistan AI
          </h1>
          <p className="mt-1 text-ink-soft">
            Rezime, mesaj, piblisite ak priyorite — AI a pwopoze, ou deside. Anyen pa
            anrejistre/pibliye otomatikman.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip selected={tab === "summary"} onClick={() => setTab("summary")}>
          <BarChart3 className="h-3.5 w-3.5" /> Rezime trafik
        </Chip>
        <Chip selected={tab === "message"} onClick={() => setTab("message")}>
          <Send className="h-3.5 w-3.5" /> Redije mesaj
        </Chip>
        <Chip selected={tab === "ad"} onClick={() => setTab("ad")}>
          <Megaphone className="h-3.5 w-3.5" /> Redije piblisite
        </Chip>
        <Chip selected={tab === "priorities"} onClick={() => setTab("priorities")}>
          <ListChecks className="h-3.5 w-3.5" /> Priyorite jodi a
        </Chip>
      </div>

      {tab === "summary" && <SummaryPanel />}
      {tab === "message" && <MessagePanel />}
      {tab === "ad" && <AdPanel />}
      {tab === "priorities" && <PrioritiesPanel />}

      <UsageThisMonth />
    </div>
  );
}

/** Kat pataje (rezime/priyorite) — tèks streaming + erè, menm prezantasyon toupatou. */
function StreamOutput({
  text,
  streaming,
  error,
}: {
  text: string;
  streaming: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
        {error}
      </div>
    );
  }
  if (!text && !streaming) return null;
  return (
    <div className="whitespace-pre-wrap rounded-xl bg-cream p-4 text-sm text-ink">
      {text}
      {streaming && <span className="animate-pulse">▍</span>}
    </div>
  );
}

const PERIOD_LABEL: Record<string, string> = { today: "Jodi a", "7d": "7 jou", "30d": "30 jou" };

function SummaryPanel() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("today");
  const { text, streaming, error, meta, run } = useAdminAiStream();

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">Rezime trafik ak aktivite</h2>
      <p className="mb-3 text-xs text-ink-soft">
        Chif yo soti dirèkteman nan baz done a — ou ka verifye yo nan lòt paj dashboard yo.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["today", "7d", "30d"] as const).map((p) => (
          <Chip key={p} selected={period === p} onClick={() => setPeriod(p)}>
            {PERIOD_LABEL[p]}
          </Chip>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={streaming}
          isLoading={streaming}
          onClick={() => run({ feature: "summary", period, regenerate: false })}
        >
          Jenere
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={streaming}
          onClick={() => run({ feature: "summary", period, regenerate: true })}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Rejenere
        </Button>
      </div>
      <StreamOutput text={text} streaming={streaming} error={error} />
      {meta?.generatedAt && (
        <p className="mt-2 text-xs text-ink-soft">
          {meta.cached ? "Rezime deja jenere jodi a" : "Fenk jenere"} —{" "}
          {new Date(meta.generatedAt).toLocaleString("fr-HT")}
        </p>
      )}
    </section>
  );
}

const MESSAGE_TYPES = [
  { value: "customer_notification", label: "Notifikasyon pou kliyan" },
  { value: "restaurant_message", label: "Mesaj pou restoran" },
  { value: "report_reply", label: "Repons a yon siyalman" },
  { value: "site_announcement", label: "Anons sou sit la" },
] as const;

function MessagePanel() {
  const [messageType, setMessageType] =
    useState<(typeof MESSAGE_TYPES)[number]["value"]>("customer_notification");
  const [language, setLanguage] = useState<"kreyol" | "franse">("kreyol");
  const [tone, setTone] = useState<"formal" | "amikal" | "dirèk">("amikal");
  const [length, setLength] = useState<"kout" | "mwayen">("kout");
  const [context, setContext] = useState("");
  const { text, streaming, error, run } = useAdminAiStream();

  const versions = text
    .split(/\n?---\n?/)
    .map((v) => v.trim())
    .filter(Boolean);

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Redije yon mesaj</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={messageType}
          onChange={(e) => setMessageType(e.target.value as typeof messageType)}
          className={inputClsCompact()}
          aria-label="Tip mesaj"
        >
          {MESSAGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as typeof language)}
          className={inputClsCompact()}
          aria-label="Lang"
        >
          <option value="kreyol">Kreyòl</option>
          <option value="franse">Fransè</option>
        </select>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value as typeof tone)}
          className={inputClsCompact()}
          aria-label="Ton"
        >
          <option value="formal">Fòmèl</option>
          <option value="amikal">Amikal</option>
          <option value="dirèk">Dirèk</option>
        </select>
        <select
          value={length}
          onChange={(e) => setLength(e.target.value as typeof length)}
          className={inputClsCompact()}
          aria-label="Longè"
        >
          <option value="kout">Kout</option>
          <option value="mwayen">Mwayen</option>
        </select>
      </div>
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Detay pou mesaj la (egzanp: kòmand #1042 an reta poutèt move tan)…"
        rows={3}
        className={`${inputClsCompact()} mt-3`}
      />
      <Button
        className="mt-3"
        disabled={streaming || !context.trim()}
        isLoading={streaming}
        onClick={() =>
          run({ feature: "message", input: { messageType, language, tone, length, context } })
        }
      >
        <Sparkles className="h-4 w-4" /> Jenere vèsyon yo
      </Button>

      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {versions.length > 0 && (
        <div className="mt-4 space-y-2">
          {versions.map((v, i) => (
            <div key={i} className="rounded-xl bg-cream p-3">
              <p className="whitespace-pre-wrap text-sm text-ink">{v}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => copyToClipboard(v)}
              >
                <Copy className="h-3.5 w-3.5" /> Kopye
              </Button>
            </div>
          ))}
          {streaming && <span className="text-xs text-ink-soft">Ap ekri…</span>}
        </div>
      )}
    </section>
  );
}

type AdProposal = { title: string; description: string; cta: string };

function AdPanel() {
  const [announcing, setAnnouncing] = useState("");
  const [target, setTarget] = useState<"tout_moun" | "nouvo_kliyan" | "yon_zon">("tout_moun");
  const [targetDetail, setTargetDetail] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AdProposal[]>([]);
  const navigate = Route.useNavigate();

  async function generate() {
    setLoading(true);
    setError(null);
    setProposals([]);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          feature: "ad",
          input: {
            announcing,
            target,
            targetDetail: targetDetail || undefined,
            date: date || undefined,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Erè sèvè (${res.status})`);
      setProposals(body.proposals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erè enkoni");
    } finally {
      setLoading(false);
    }
  }

  function applyProposal(p: AdProposal) {
    // Fòm piblisite a (dashboard.admin.ads.tsx) pa gen chan pou tèks bouton
    // an (`cta`) — sèlman tit/deskripsyon pase. `cta` a rete vizib/kopyab
    // sou kat la, jis li pa oto-ranpli.
    navigate({
      to: "/dashboard/admin/ads",
      search: { aiTitle: p.title, aiDescription: p.description },
    });
  }

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Redije yon piblisite</h2>
      <div className="grid gap-3">
        <textarea
          value={announcing}
          onChange={(e) => setAnnouncing(e.target.value)}
          placeholder="Sa piblisite a ap anonse (egzanp: 20% rabè nan Restoran Bon Gou, jiska dimanch)…"
          rows={2}
          className={inputClsCompact()}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as typeof target)}
            className={inputClsCompact()}
            aria-label="Sib"
          >
            <option value="tout_moun">Tout moun</option>
            <option value="nouvo_kliyan">Nouvo kliyan</option>
            <option value="yon_zon">Yon zòn</option>
          </select>
          <input
            value={targetDetail}
            onChange={(e) => setTargetDetail(e.target.value)}
            placeholder="Detay sib (opsyonèl)"
            className={inputClsCompact()}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClsCompact()}
          />
        </div>
      </div>
      <Button
        className="mt-3"
        disabled={loading || !announcing.trim()}
        isLoading={loading}
        onClick={generate}
      >
        <Sparkles className="h-4 w-4" /> Jenere 3 pwopozisyon
      </Button>

      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {proposals.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {proposals.map((p, i) => (
            <div
              key={i}
              className="flex flex-col rounded-xl border border-brand-soft/50 bg-cream p-3"
            >
              <h3 className="font-display text-sm font-extrabold text-ink">{p.title}</h3>
              <p className="mt-1 flex-1 text-xs text-ink-soft">{p.description}</p>
              <span className="mt-2 inline-block w-fit rounded-full bg-brand px-3 py-1 text-xs font-bold text-white">
                {p.cta}
              </span>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(`${p.title}\n${p.description}\n${p.cta}`)}
                >
                  <Copy className="h-3.5 w-3.5" /> Kopye
                </Button>
                <Button size="sm" onClick={() => applyProposal(p)}>
                  Itilize sa a
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PrioritiesPanel() {
  const { text, streaming, error, run } = useAdminAiStream();

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Priyorite jodi a</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={streaming}
          isLoading={streaming}
          onClick={() => run({ feature: "priorities" })}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Chèche priyorite yo
        </Button>
      </div>
      <StreamOutput text={text} streaming={streaming} error={error} />
      {!text && !streaming && !error && (
        <p className="text-sm text-ink-soft">
          Klike "Chèche priyorite yo" pou wè yon lis klase pa ijans.
        </p>
      )}
    </section>
  );
}

function UsageThisMonth() {
  const usage = useQuery({
    queryKey: ["admin-ai-usage-month"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select("feature, input_tokens, output_tokens, status")
        .gte("created_at", since.toISOString());
      if (error) throw error;
      return data;
    },
  });

  const totalIn = usage.data?.reduce((s, r) => s + r.input_tokens, 0) ?? 0;
  const totalOut = usage.data?.reduce((s, r) => s + r.output_tokens, 0) ?? 0;
  const callCount = usage.data?.length ?? 0;
  const errorCount = usage.data?.filter((r) => r.status === "error").length ?? 0;

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
        Konsomasyon mwa sa a
      </h2>
      <div className="flex flex-wrap gap-4 text-sm text-ink">
        <span>
          <b>{callCount}</b> apèl
        </span>
        <span>
          <b>{totalIn.toLocaleString("fr-HT")}</b> token antre
        </span>
        <span>
          <b>{totalOut.toLocaleString("fr-HT")}</b> token sòti
        </span>
        {errorCount > 0 && <span className="text-red-700">{errorCount} echwe</span>}
      </div>
    </section>
  );
}
