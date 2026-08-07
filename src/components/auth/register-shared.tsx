import { useEffect, useState } from "react";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Refonte Frontend Premium, Phase 5 (P5) — immediate thumbnail preview
  // after picking a file, per the audit's own recommendation for this
  // exact component ("le plus coûteux en support"). Revokes the previous
  // object URL whenever a new file is picked or the component unmounts —
  // createObjectURL otherwise leaks the blob for the life of the page.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleChange(file: File | null) {
    setName(file?.name ?? "");
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    });
    onChange(file);
  }

  return (
    <label className="flex cursor-pointer flex-col items-start gap-1 rounded-xl border-2 border-dashed border-brand-soft bg-brand-soft/20 px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/40">
      <span className="font-semibold text-ink">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        ) : (
          <Upload className="h-3.5 w-3.5 shrink-0 text-brand-deep" aria-hidden="true" />
        )}
        <span className="truncate text-brand-deep">{name || "Chwazi yon fichye"}</span>
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
