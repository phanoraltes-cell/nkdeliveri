import { ShieldCheck } from "lucide-react";
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
  hasPassword: boolean;
  password: string;
  setPassword: (v: string) => void;
  submitting: boolean;
  error: string | null;
  confirmPassword: () => void;
  continueWithOAuth: () => void;
};

/** Render once per component tree that calls useReauth() — same shape as ConfirmDialog. */
export function ReauthDialog({ state }: { state: ReauthDialogState }) {
  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-deep" /> Konfime idantite w
          </DialogTitle>
          <DialogDescription>
            Aksyon sa a sansib — nou bezwen konfime se toujou ou anvan.
          </DialogDescription>
        </DialogHeader>

        {state.hasPassword ? (
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
      </DialogContent>
    </Dialog>
  );
}
