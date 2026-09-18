import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "../../lib/supabase/server";
import { signOut } from "../auth/actions";
import { LanguageSwitcher } from "../language-switcher";
import { SiteLogo } from "../site-logo";
import { changePassword } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function ChangePasswordPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const forced = user.user_metadata?.force_password_change === true;
  const params = await searchParams;
  const t = await getTranslations("auth");

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-top"><SiteLogo href="/" /><LanguageSwitcher /></div>
      <div className="auth-heading">
        <p className="eyebrow">{t("changePasswordKicker")}</p>
        <h1>{t("changePasswordTitle")}</h1>
        <p>{forced ? t("changePasswordForced") : t("changePasswordBody")}</p>
      </div>
      {params.error && <div className="form-message error">{params.error}</div>}
      <form action={changePassword} className="auth-form" autoComplete="off">
        <label>{t("newPassword")}<input name="password" type="password" minLength={8} required autoComplete="new-password" placeholder={t("passwordPlaceholder")} /></label>
        <label>{t("confirmPassword")}<input name="confirm" type="password" minLength={8} required autoComplete="new-password" placeholder={t("passwordPlaceholder")} /></label>
        <button className="button auth-submit" type="submit">{t("savePassword")}</button>
      </form>
      <form action={signOut} style={{ textAlign: "center", marginTop: 14 }}>
        <button type="submit" style={{ background: "none", border: 0, cursor: "pointer", padding: 0, color: "var(--muted)", font: "inherit", fontSize: 13, textDecoration: "underline" }}>{t("cancelAndSignOut")}</button>
      </form>
    </section>
  </main>;
}
