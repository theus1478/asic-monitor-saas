import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "../../lib/supabase/server";
import { createServiceClient } from "../../lib/supabase/service";
import { generateAndSendCode } from "../../lib/otp";
import { currentTimeMs } from "../../lib/time";
import { LanguageSwitcher } from "../language-switcher";
import { SiteLogo } from "../site-logo";
import { signOut } from "../auth/actions";
import { OtpForm } from "./otp-form";

const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

export default async function VerifyEmailPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  if (user.email_confirmed_at) redirect("/dashboard");

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("pending_email").eq("id", user.id).maybeSingle();
  const purpose = profile?.pending_email ? "email_change" as const : "email_verification" as const;
  const targetEmail = profile?.pending_email ?? user.email ?? "";

  const { data: active } = await service.from("email_verification_codes")
    .select("id, created_at, expires_at").eq("user_id", user.id).eq("purpose", purpose).is("used_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const now = currentTimeMs();
  let latestSentAt = active?.created_at ?? null;
  if (!active || new Date(active.expires_at).getTime() < now) {
    await generateAndSendCode(service, { userId: user.id, email: targetEmail, purpose });
    latestSentAt = new Date(now).toISOString();
  }
  const elapsedSeconds = latestSentAt ? Math.floor((now - new Date(latestSentAt).getTime()) / 1000) : RESEND_COOLDOWN_SECONDS;
  const initialCooldownSeconds = Math.max(0, RESEND_COOLDOWN_SECONDS - elapsedSeconds);

  const t = await getTranslations("auth");

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-top"><SiteLogo href="/" /><LanguageSwitcher /></div>
      <div className="auth-heading">
        <p className="eyebrow">{t("verifyEmailKicker")}</p>
        <h1>{t("verifyEmailTitle")}</h1>
        <p>{t("verifyEmailBody", { email: maskEmail(targetEmail) })}</p>
      </div>
      <OtpForm initialCooldownSeconds={initialCooldownSeconds} />
      {purpose === "email_verification" && <form action={signOut} style={{ textAlign: "center", marginTop: 14 }}>
        <button type="submit" style={{ background: "none", border: 0, cursor: "pointer", padding: 0, color: "var(--muted)", font: "inherit", fontSize: 13, textDecoration: "underline" }}>
          {t("changeEmailInstead")}
        </button>
      </form>}
    </section>
  </main>;
}
