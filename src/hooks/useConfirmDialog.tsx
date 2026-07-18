import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PendingConfirm = { message: string; onConfirm: () => void };

/**
 * Replaces the native `confirm("...") && action()` pattern with the styled
 * Dialog primitive, same synchronous call-site shape: `requestConfirm(msg, () => action())`.
 * Render `<ConfirmDialog />` once per component tree that calls this.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const requestConfirm = useCallback((message: string, onConfirm: () => void) => {
    setPending({ message, onConfirm });
  }, []);

  function handleConfirm() {
    pending?.onConfirm();
    setPending(null);
  }

  const ConfirmDialog = (
    <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending?.message}</DialogTitle>
          <DialogDescription>Aksyon sa a pa ka defèt.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>
            Anile
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Konfime
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requestConfirm, ConfirmDialog };
}
