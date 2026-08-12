import { ShieldCheck, KeyRound } from "lucide-react";
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
  mode: "totp" | "password" | "oauth";
  hasPassword: boolean;
  hasVerifiedFactor: boolean;
  checkingFactor: boolean;
  password: string;
  setPassword: (v: string) => void;
  totpCode: string;
  setTotpCode: (v: string) => void;
  submitting: boolean;
  error: string | null;
  confirmTotp: () => void;
  confirmPassword: () => void;
  continueWithOAuth: () => void;
  switchToFallback: () => void;
  switchToTotp: () => void;
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
              value={state.totpCode}
              onChange={(e) => state.setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputCls() + " text-center text-lg tracking-[0.5em]"}
            />
            {state.error && <p className="text-sm text-red-600">{state.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
                Anile
              </Button>
              <Button type="submit" disabled={state.submitting || state.totpCode.length !== 6}>
                {state.submitting ? "Ap verifye…" : "Konfime"}
              </Button>
            </DialogFooter>
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
              value={state.password}
              onChange={(e) => state.setPassword(e.target.value)}
              className={inputCls()}
            />
            {state.error && <p className="text-sm text-red-600">{state.error}</p>}
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

        {!state.checkingFactor && !state.hasVerifiedFactor && (
          <p className="text-center text-[11px] text-ink-soft">
            Ou pa gen verifikasyon an de etap (TOTP) aktive.{" "}
            <a
              href="/dashboard/admin/security"
              className="font-bold text-brand-deep underline underline-offset-2"
            >
              Aktive li
            </a>{" "}
            pou yon pwoteksyon pi fò — obligatwa pou sèten aksyon kritik.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
