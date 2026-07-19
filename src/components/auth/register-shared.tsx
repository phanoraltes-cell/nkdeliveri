import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { translateAuthError } from "@/lib/auth-errors";

export async function baseSignUp(email: string, password: string, data: Record<string, string>) {
  const { data: allowed, error: rlErr } = await supabase.rpc("check_auth_rate_limit_secure", {
    _email: email.trim(),
    _action: "sign_up",
    _max_hits: 5,
    _window_seconds: 3600,
  });
  if (rlErr) throw rlErr;
  if (!allowed) throw new Error("Too many sign-up attempts — rate limit exceeded");

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + "/dashboard",
      data,
    },
  });
  if (error) throw error;
  // signUpData.user is populated immediately even when email confirmation is
  // required and no session exists yet — never derive the id from a
  // follow-up getUser() call, which returns null without an active session.
  if (!signUpData.user) throw new Error("Kreyasyon kont lan echwe");
  return { userId: signUpData.user.id, hasSession: !!signUpData.session };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function toFileInput(file: File) {
  return { name: file.name, type: file.type, base64: await fileToBase64(file) };
}

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

export function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-brand-md ring-1 ring-brand-soft/40 sm:p-8">
      {children}
    </div>
  );
}

export function FileField({
  label,
  accept,
  onChange,
}: {
  label: string;
  accept: string;
  onChange: (f: File | null) => void;
}) {
  const [name, setName] = useState<string>("");
  return (
    <label className="flex cursor-pointer flex-col items-start gap-1 rounded-xl border-2 border-dashed border-brand-soft bg-brand-soft/20 px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/40">
      <span className="font-semibold text-ink">{label}</span>
      <span className="flex items-center gap-1 text-brand-deep">
        <Upload className="h-3.5 w-3.5" /> {name || "Chwazi yon fichye"}
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          setName(file?.name ?? "");
          onChange(file);
        }}
      />
    </label>
  );
}
