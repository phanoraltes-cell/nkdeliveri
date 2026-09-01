import { ShieldCheck, KeyRound, Ticket } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/utils";

type ReauthDialogState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  mode: "totp" | "backup" | "password" | "oauth";
  hasPassword: boolean;
  hasVerifiedFactor: boolean;
  hasBackupCodes: boolean;
  checkingFactor: boolean;
  password: string;
  setPassword: (v: string) => void;
  totpCode: string;
  setTotpCode: (v: string) => void;
  backupCode: string;
  setBackupCode: (v: string) => void;
  submitting: boolean;
  error: string | null;
  confirmTotp: () => void;
  confirmBackup: () => void;
  confirmPassword: () => void;
  continueWithOAuth: () => void;
  switchToFallback: () => void;
  switchToTotp: () => void;
  switchToBackup: () => void;
};

/** Render once per component tree that calls useReauth() — same shape as ConfirmDialog. */
export function ReauthDialog({ state }: { state: ReauthDialogState }) {
  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-deep" /> Verifikasyon sekirite
          </DialogTitle>
          <DialogDescription>
            Aksyon sa a sansib — nou bezwen konfime se toujou ou anvan.
          </DialogDescription>
        </DialogHeader>

        {state.checkingFactor ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : state.mode === "totp" && state.hasVerifiedFactor ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              state.confirmTotp();
            }}
            className="space-y-3"
          >
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <KeyRound className="h-4 w-4 shrink-0" /> Antre kòd 6 chif aplikasyon otantifikasyon
              ou an montre kounye a.
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              placeholder="000000"
              aria-label="Kòd verifikasyon"
              aria-invalid={!!state.error}
              aria-describedby={state.error ? "reauth-error" : undefined}
              value={state.totpCode}
              onChange={(e) => state.setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputCls() + " text-center text-lg tracking-[0.5em]"}
            />
            {state.error && (
              <p id="reauth-error" role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
                Anile
              </Button>
              <Button type="submit" disabled={state.submitting || state.totpCode.length !== 6}>
                {state.submitting ? "Ap verifye…" : "Konfime"}
              </Button>
            </DialogFooter>
            {state.hasBackupCodes && (
              <button
                type="button"
                onClick={state.switchToBackup}
                className="w-full text-center text-xs font-bold text-brand-deep hover:underline"
              >
                Sèvi ak yon kòd sekou pito
              </button>
            )}
          </form>
        ) : state.mode === "backup" && state.hasBackupCodes ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              state.confirmBackup();
            }}
            className="space-y-3"
          >
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Ticket className="h-4 w-4 shrink-0" /> Antre youn nan kòd sekou ou yo.
            </p>
            <input
              type="text"
              autoFocus
              required
              placeholder="XXXXX-XXXXX"
              aria-label="Kòd sekou"
              aria-invalid={!!state.error}
              aria-describedby={state.error ? "reauth-error" : undefined}
              value={state.backupCode}
              onChange={(e) => state.setBackupCode(e.target.value)}
              className={inputCls() + " text-center font-mono uppercase tracking-wider"}
            />
            {state.error && (
              <p id="reauth-error" role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
                Anile
              </Button>
              <Button type="submit" disabled={state.submitting || !state.backupCode.trim()}>
                {state.submitting ? "Ap verifye…" : "Konfime"}
              </Button>
            </DialogFooter>
            {state.hasVerifiedFactor && (
              <button
                type="button"
                onClick={state.switchToTotp}
                className="w-full text-center text-xs font-bold text-brand-deep hover:underline"
              >
                Sèvi ak kòd otantifikasyon pito
              </button>
            )}
          </form>
        ) : state.mode === "password" && state.hasPassword ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              state.confirmPassword();
            }}
            className="space-y-3"
          >
            <input
              type="password"
              autoFocus
              required
              placeholder="Modpas ou"
              aria-label="Modpas ou"
              aria-invalid={!!state.error}
              aria-describedby={state.error ? "reauth-error" : undefined}
              value={state.password}
              onChange={(e) => state.setPassword(e.target.value)}
              className={inputCls()}
            />
            {state.error && (
              <p id="reauth-error" role="alert" className="text-sm text-red-600">
                {state.error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
                Anile
              </Button>
              <Button type="submit" disabled={state.submitting || !state.password}>
                {state.submitting ? "Ap verifye…" : "Konfime"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              Kont ou konekte ak Google — n ap voye w tounen sou Google yon ti moman pou konfime,
              epi ou ap retounen isit la. Klike aksyon an ankò yon fwa ou tounen.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
                Anile
              </Button>
              <Button type="button" onClick={state.continueWithOAuth}>
                Kontinye ak Google
              </Button>
            </DialogFooter>
          </>
        )}

        {!state.checkingFactor && !state.hasVerifiedFactor && !state.hasBackupCodes && (
          <p className="text-center text-[11px] text-ink-soft">
            Ou pa gen verifikasyon an de etap (TOTP) ni kòd sekou aktive.{" "}
            <a
              href="/dashboard/admin/security"
              className="font-bold text-brand-deep underline underline-offset-2"
            >
              Aktive youn
            </a>{" "}
            pou yon pwoteksyon pi fò — obligatwa pou sèten aksyon kritik.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
