import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { translateAuthError } from "@/lib/auth-errors";

/**
 * Shared submit/loading/redirect wrapper for every registration form
 * (customer/driver/restaurant) — split out of
 * components/auth/register-shared.tsx (react-refresh/only-export-components
 * cleanup, remediation 07) so that file only exports components. No
 * behavior change, relocation only.
 */
export function useSubmit(onDone: () => void) {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  // F-04 remediation (docs/FRONTEND_GLOBAL_AUDIT.md §25) — a server-side
  // rejection (email already used, rate limit, CAPTCHA, ...) used to reach
  // the user ONLY via a toast. Exposed here too so callers can also render
  // it inline (role="alert", tied to the form via aria-describedby) for
  // anyone who'd miss a timed toast — the toast itself is kept, this adds a
  // second, persistent channel rather than replacing it.
  const [error, setError] = useState<string | null>(null);
  async function wrap(fn: () => Promise<{ hasSession: boolean }>, successMsg: string) {
    setLoading(true);
    setError(null);
    try {
      const { hasSession } = await fn();
      onDone();
      if (hasSession) {
        toast.success(successMsg);
        nav({ to: "/dashboard" });
      } else {
        toast.success(successMsg + " Tcheke imèl ou pou konfime kont ou anvan w konekte.");
        nav({ to: "/auth" });
      }
    } catch (e) {
      const message = translateAuthError(e);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }
  return { loading, error, wrap };
}
