import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { signIn, signUp } from "../auth/actions";
import { LanguageSwitcher } from "../language-switcher";
import { SiteLogo } from "../site-logo";
import { TurnstileWidget } from "../turnstile-widget";

type Props = { searchParams: Promise<{ mode?: string; error?: string; message?: string; next?: string; ref?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const isSignUp = params.mode === "signup";
  const t = await getTranslations("auth");
  const c = await getTranslations("common");
  const cookieStore = await cookies();
  const referralCode = (params.ref || cookieStore.get("ref_code")?.value || "").toUpperCase().slice(0, 16);

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-top"><SiteLogo href="/" /><LanguageSwitcher /></div>
      <div className="auth-heading"><p className="eyebrow">{c("cloudPlatform")}</p><h1>{isSignUp ? t("signUpTitle") : t("signInTitle")}</h1><p>{isSignUp ? t("signUpSubtitle") : t("signInSubtitle")}</p></div>
      {params.error && <div className="form-message error">{params.error}</div>}
      {params.message && <div className="form-message success">{params.message}</div>}
      <form action={isSignUp ? signUp : signIn} className="auth-form" autoComplete={isSignUp ? "off" : "on"}>
        {isSignUp && <label>{t("fullName")}<input name="fullName" autoComplete="off" required placeholder={t("fullNamePlaceholder")} /></label>}
        <label>{t("email")}<input name="email" type={isSignUp ? "text" : "email"} inputMode="email" autoComplete={isSignUp ? "off" : "email"} required placeholder={t("emailPlaceholder")} /></label>
        <label>{t("password")}<input name="password" type="password" minLength={8} autoComplete={isSignUp ? "new-password" : "current-password"} required placeholder={t("passwordPlaceholder")} /></label>
        {isSignUp && <label>{t("referralCode")}<input name="referralCode" autoComplete="off" defaultValue={referralCode} placeholder={t("referralCodePlaceholder")} maxLength={16} style={{ textTransform: "uppercase" }} /></label>}
        {!isSignUp && <input type="hidden" name="next" value={params.next ?? "/dashboard"} />}
        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <TurnstileWidget siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />}
        <button className="button auth-submit" type="submit">{isSignUp ? t("createAccount") : t("signInButton")}</button>
      </form>
      <p className="auth-switch">{isSignUp ? t("alreadyHaveAccount") : t("noAccountYet")} <Link href={isSignUp ? "/sign-in" : "/sign-in?mode=signup"}>{isSignUp ? t("signInButton") : t("createAccount")}</Link></p>
    </section>
  </main>;
}
