import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";
import { Button } from "@/components/ui/button";

/**
 * NKD-022 — mandatory re-acceptance gate. Mounted once around every
 * /dashboard/* route (_authenticated/route.tsx), same "wrap the whole
 * layout" placement as AdminIdleLock uses for /dashboard/admin/*.
 *
 * Why this exists: every registration form already required checking a
 * "terms" checkbox before NKD-022, but that fact was never recorded
 * anywhere (Etap 1 finding) — new signups are now stamped directly by
 * handle_new_user() from signup metadata (20260818140000_nkd022_terms_
 * acceptance.sql §2), so a brand-new account never sees this gate at all.
 * It exists purely for the accounts that predate that migration: their
 * profiles.terms_accepted_at is NULL (owner-confirmed: not backfilled —
 * see the migration's own header), so the very first authenticated page
 * load after this ships blocks them here until they explicitly accept.
 * The same check (terms_version !== CURRENT_TERMS_VERSION, not just
 * "accepted or not") means a future content revision that bumps
 * CURRENT_TERMS_VERSION (src/lib/legal.ts) re-prompts every account
 * automatically, with no other code change.
 *
 * Deliberately NOT a checkbox-then-submit form: the actual click here IS
 * the acceptance event (matches the registration forms' own "checking a
 * box authorizes signup" pattern), no separate step to forget.
 */
export function TermsAcceptanceGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"checking" | "blocked" | "clear">("checking");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      setStatus("checking");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("terms_accepted_at, terms_version")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("[TermsAcceptanceGate] profiles fetch failed", error);
        // Fail OPEN, not closed: an outage here must never lock every
        // signed-in user out of a dashboard they were already inside —
        // the worst case is a re-prompt next successful load, not a
        // hard-down app. (Unlike AdminIdleLock's step-up check, which
        // fails closed because it's a security boundary — this is a
        // compliance record, not an authorization gate.)
        setStatus("clear");
        return;
      }
      const accepted = !!data?.terms_accepted_at && data.terms_version === CURRENT_TERMS_VERSION;
      setStatus(accepted ? "clear" : "blocked");
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function accept() {
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("accept_terms_secure", {
        _version: CURRENT_TERMS_VERSION,
      });
      if (error) throw error;
      setStatus("clear");
    } catch (e) {
      console.error("[TermsAcceptanceGate] accept_terms_secure failed", e);
      toast.error("Nou pa t kapab anrejistre akseptasyon an. Eseye ankò.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") return null; // avoid a gate flash while the very first check is in flight
  if (status === "clear") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-6 w-6 text-brand-deep" />
          <h1 className="font-display text-lg font-extrabold text-ink">
            Kondisyon Itilizasyon mete ajou
          </h1>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Nou mete ajou Kondisyon Itilizasyon ak Politik Konfidansyalite platfòm NK Deliveri a. Li
          yo epi aksepte pou w ka kontinye itilize kont ou.
        </p>
        <div className="mb-5 flex flex-col gap-2 text-sm">
          <Link
            to="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-brand-deep underline"
          >
            Li Kondisyon Itilizasyon
          </Link>
          <Link
            to="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-brand-deep underline"
          >
            Li Politik Konfidansyalite
          </Link>
        </div>
        <Button type="button" onClick={accept} disabled={submitting} className="w-full">
          {submitting ? "Ap anrejistre…" : "Mwen li epi mwen aksepte"}
        </Button>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-bold text-ink-soft hover:underline"
        >
          <LogOut className="h-3.5 w-3.5" /> Oswa dekonekte
        </button>
      </div>
    </div>
  );
}
