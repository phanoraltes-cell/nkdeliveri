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
  async function wrap(fn: () => Promise<{ hasSession: boolean }>, successMsg: string) {
    setLoading(true);
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
      toast.error(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  }
  return { loading, wrap };
}
