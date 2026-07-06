/**
 * Supabase Auth returns its error messages in English with a machine-readable
 * `code` (AuthApiError). Translating the common ones to clear Kreyòl gives
 * users an actionable message instead of raw English (or Supabase's generic
 * "Invalid login credentials" for what's actually an unconfirmed email).
 */
export function translateAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case "email_not_confirmed":
      return "Ou poko konfime imèl ou. Verifye bwat imèl ou (ak spam), oswa mande yon nouvo imèl konfimasyon.";
    case "invalid_credentials":
      return "Imèl la oswa modpas la pa kòrèk.";
    case "user_already_exists":
    case "email_exists":
      return "Yon kont deja egziste ak imèl sa a. Eseye konekte oswa reyinisyalize modpas ou.";
    case "weak_password":
      return "Modpas la twò fèb. Itilize omwen 6 karaktè.";
    case "over_email_send_rate_limit":
      return "Twòp imèl mande nan yon ti tan. Tann kèk minit epi eseye ankò.";
    case "over_request_rate_limit":
      return "Twòp esè. Tann kèk minit epi eseye ankò.";
    case "user_not_found":
      return "Nou pa jwenn okenn kont ak imèl sa a.";
    case "same_password":
      return "Nouvo modpas la dwe diferan de ansyen an.";
    case "signup_disabled":
      return "Enskripsyon fèmen kounye a. Kontakte sipò.";
  }

  // Fall back to matching the raw English text for older SDK versions / edge
  // cases that don't set `code`.
  const lower = message.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return "Ou poko konfime imèl ou. Verifye bwat imèl ou (ak spam), oswa mande yon nouvo imèl konfimasyon.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Imèl la oswa modpas la pa kòrèk.";
  }
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "Yon kont deja egziste ak imèl sa a. Eseye konekte oswa reyinisyalize modpas ou.";
  }
  if (lower.includes("rate limit")) {
    return "Twòp esè nan yon ti tan. Tann kèk minit epi eseye ankò.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Pwoblèm koneksyon rezo. Verifye entènèt ou epi eseye ankò.";
  }

  return message || "Yon erè pase. Eseye ankò.";
}

/** True when the login failure is specifically an unconfirmed email — used to offer a "resend" action. */
export function isEmailNotConfirmedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "email_not_confirmed") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("email not confirmed");
}
