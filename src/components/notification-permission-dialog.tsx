import { Bell, Package, MessageCircle, Bike, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const REASONS = [
  { icon: Package, text: "Konfimasyon kòmand ak livrezon" },
  { icon: Bike, text: "Lè yon livrè pran wout la pou vin jwenn ou" },
  { icon: MessageCircle, text: "Nouvo mesaj nan chat" },
  { icon: CheckCircle2, text: "Konfimasyon peman" },
];

type NotificationPermissionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * The "why" step shown BEFORE the real browser permission popup
 * (Notification.requestPermission()) ever fires — never shown on page
 * load, only from an explicit trigger (PushToggle, or a contextual
 * moment like the order tracking page). Accepting here is what calls
 * requestPermission(); declining just closes this and records a cooldown
 * (see notification-permission.ts) so the user isn't asked again soon.
 */
export function NotificationPermissionDialog({
  open,
  onOpenChange,
  onAccept,
  onDecline,
}: NotificationPermissionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-deep" /> Aktive notifikasyon
          </DialogTitle>
          <DialogDescription>
            NK Deliveri ka voye w yon notifikasyon pou bagay enpòtan yo, menm lè aplikasyon an
            fèmen:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5">
          {REASONS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-sm text-ink">
              <Icon className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>

        <p className="text-xs text-ink-soft">
          Navigatè w ap mande w yon dènye konfimasyon apre sa. Ou ka chanje lide w nenpòt lè nan
          paramèt notifikasyon yo.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onDecline}>
            Pa kounye a
          </Button>
          <Button onClick={onAccept}>Wi, aktive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
