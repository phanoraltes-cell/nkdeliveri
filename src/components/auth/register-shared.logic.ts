import { supabase } from "@/integrations/supabase/client";

/**
 * Pure signup/file helpers shared by every registration form
 * (customer/driver/restaurant) — split out of register-shared.tsx
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * file only exports components. No behavior change, relocation only.
 */
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
