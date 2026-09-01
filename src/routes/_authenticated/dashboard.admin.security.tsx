import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, KeyRound, Ticket } from "lucide-react";
import { useTotpFactor } from "@/hooks/useTotpFactor";
import { useBackupCodes } from "@/hooks/useBackupCodes";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { inputCls } from "@/lib/utils";

// Role guard lives on the parent layout (dashboard.admin.tsx), same
// convention as every other admin route in this section.
export const Route = createFileRoute("/_authenticated/dashboard/admin/security")({
  component: AdminSecurity,
});

/**
 * Self-service TOTP enrollment (docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md).
 * Pure supabase.auth.mfa.* — no secret ever touches this app's own
 * database, no custom crypto. Once a verified factor exists here, the
 * server-side step-up gate (private.admin_step_up_status()) automatically
 * starts requiring it — nothing else needs to change when an admin
 * enrolls.
 */
function AdminSecurity() {
  const totp = useTotpFactor();
  const backup = useBackupCodes();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [enrolling, setEnrolling] = useState(false);
  const [pending, setPending] = useState<{
    factorId: string;
    qrCode: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [codesSavedConfirmed, setCodesSavedConfirmed] = useState(false);

  async function startEnrollment() {
    setEnrolling(true);
    setError(null);
    try {
      const result = await totp.startEnrollment();
      setPending(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pa t kapab kòmanse anwolman an");
      setEnrolling(false);
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    try {
      await totp.verifyEnrollment(pending.factorId, code);
      toast.success("Verifikasyon an de etap aktive.");
      setEnrolling(false);
      setPending(null);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kòd la pa kòrèk.");
    } finally {
      setSubmitting(false);
    }
  }

  function unenroll() {
    requestConfirm(
      "Retire verifikasyon an de etap? Aksyon sansib yo ap sèvi ak modpas/Google sèlman apre sa.",
      async () => {
        if (!totp.factorId) return;
        const { error } = await supabase.auth.mfa.unenroll({ factorId: totp.factorId });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success("Verifikasyon an de etap retire.");
        await totp.refresh();
      },
    );
  }

  async function doGenerate() {
    setGenerating(true);
    try {
      const codes = await backup.generate();
      setNewCodes(codes);
      setCodesSavedConfirmed(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pa t kapab jenere kòd sekou yo");
    } finally {
      setGenerating(false);
    }
  }

  function generateCodes() {
    if (backup.hasCodes) {
      requestConfirm(
        "Jenere nouvo kòd sekou? Tout ansyen kòd ki pa itilize yo ap vin envalid imedyatman.",
        doGenerate,
      );
    } else {
      doGenerate();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Sekirite kont</h1>
          <p className="mt-1 text-ink-soft">
            Verifikasyon an de etap (TOTP) pou aksè admin ak aksyon sansib.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-sm">
        {totp.checking ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : totp.hasVerifiedFactor ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <ShieldCheck className="h-5 w-5" />
              <span className="font-bold">Verifikasyon an de etap aktive</span>
            </div>
            <p className="text-sm text-ink-soft">
              Aksyon sansib yo (chanjman wòl, dekesman, konfigirasyon peman) mande yon kòd fre nan
              aplikasyon otantifikasyon w chak fwa — pa gen fenèt tolerans pou sa yo.
            </p>
            <Button variant="outline" onClick={unenroll}>
              Retire verifikasyon an de etap
            </Button>
          </div>
        ) : enrolling && pending ? (
          <form onSubmit={confirmEnrollment} className="space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
              <span className="font-bold">Eskane kòd QR la</span>
            </div>
            <p className="text-sm text-ink-soft">
              Sèvi ak Google Authenticator, Authy, oswa nenpòt aplikasyon TOTP pou eskane kòd la
              anba a, oswa antre kle sekrè a manyèlman.
            </p>
            {pending.qrCode && (
              <img
                src={pending.qrCode}
                alt="Kòd QR pou konfigire aplikasyon otantifikasyon"
                className="mx-auto h-48 w-48 rounded-xl border border-brand-soft/60"
              />
            )}
            <p className="break-all rounded-lg bg-brand-soft/20 p-2 text-center font-mono text-xs text-ink-soft">
              {pending.secret}
            </p>
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <KeyRound className="h-4 w-4 shrink-0" /> Antre kòd 6 chif la pou konfime.
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              placeholder="000000"
              aria-label="Kòd verifikasyon"
              aria-invalid={!!error}
              aria-describedby={error ? "totp-enroll-error" : undefined}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                if (error) setError(null);
              }}
              className={inputCls() + " text-center text-lg tracking-[0.5em]"}
            />
            {error && (
              <p id="totp-enroll-error" role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEnrolling(false);
                  setPending(null);
                  setCode("");
                }}
              >
                Anile
              </Button>
              <Button type="submit" disabled={submitting || code.length !== 6}>
                {submitting ? "Ap konfime…" : "Konfime"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
              <span className="font-bold">Verifikasyon an de etap pa aktive</span>
            </div>
            <p className="text-sm text-ink-soft">
              Kèk aksyon kritik (chanjman wòl admin, dekesman, konfigirasyon peman) mande yon kòd
              TOTP fre. San sa, yo sèvi ak modpas/Google ou jis antre ankò — yon pwoteksyon pi fèb.
            </p>
            <Button onClick={startEnrollment}>Aktive verifikasyon an de etap</Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Ticket className="h-5 w-5 text-brand-deep" />
          <h2 className="font-display text-lg font-bold text-ink">Kòd sekou</h2>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Yon dezyèm mwayen endepandan pou konfime idantite w — itil si w pa gen aksè a aplikasyon
          otantifikasyon an. Chak kòd itilizab yon sèl fwa. Kòd sekou ka debloke aksyon estanda yo
          (revizyon ranbousman, deblokaj tablo admin) men PA aksyon ki pi sansib yo (chanjman wòl,
          dekesman, konfigirasyon peman) — sa yo mande toujou yon kòd TOTP fre.
        </p>

        {backup.checking ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : (
          <div className="space-y-3">
            {backup.hasCodes ? (
              <p className="text-sm text-ink">
                <span className="font-bold">{backup.codesRemaining}</span> kòd sekou rete
                {backup.generatedAt && (
                  <span className="text-ink-soft">
                    {" "}
                    · jenere sou {new Date(backup.generatedAt).toLocaleDateString("fr-HT")}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-ink-soft">Ou poko jenere kòd sekou.</p>
            )}
            <Button
              variant={backup.hasCodes ? "outline" : "default"}
              onClick={generateCodes}
              disabled={generating}
            >
              {generating
                ? "Ap jenere…"
                : backup.hasCodes
                  ? "Rejenere kòd sekou"
                  : "Jenere kòd sekou"}
            </Button>
          </div>
        )}
      </section>

      <Dialog
        open={!!newCodes}
        onOpenChange={(open) => {
          if (!open && codesSavedConfirmed) setNewCodes(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-brand-deep" /> Kòd sekou ou yo
            </DialogTitle>
            <DialogDescription>
              N ap montre w kòd sa yo yon SÈL fwa. Sere yo yon kote ki an sekirite (jesyonè modpas,
              papye byen kache) — nou pa gen okenn fason pou montre w yo ankò.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-brand-soft/20 p-4 font-mono text-sm">
            {newCodes?.map((c) => (
              <div key={c} className="text-center text-ink">
                {c}
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={codesSavedConfirmed}
              onChange={(e) => setCodesSavedConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            Mwen anrejistre kòd sa yo yon kote ki an sekirite.
          </label>
          <DialogFooter>
            <Button disabled={!codesSavedConfirmed} onClick={() => setNewCodes(null)}>
              Fèmen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </div>
  );
}
