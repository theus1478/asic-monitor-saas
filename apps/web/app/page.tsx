import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "./language-switcher";
import { SiteLogo } from "./site-logo";

export default async function Home() {
  const t = await getTranslations("landing");
  const c = await getTranslations("common");
  return <main className="shell">
    <nav className="nav">
      <SiteLogo href="/" />
      <div className="nav-actions">
        <LanguageSwitcher />
        <div className="hero-actions">
          <Link className="button secondary" href="/sign-in">{t("signIn")}</Link>
          <Link className="button" href="/sign-in?mode=signup">{t("signUp")}</Link>
        </div>
      </div>
    </nav>
    <section className="hero"><div className="hero-glow" />
      <p className="eyebrow">{c("cloudPlatform")}</p>
      <h1>{t("heroTitle")}</h1>
      <p>{t("heroBody")}</p>
      <div className="hero-actions">
        <Link className="button" href="/sign-in?mode=signup">{t("startNow")}</Link>
        <Link className="button secondary" href="/farms">{t("downloadCollector")}</Link>
      </div>
    </section>
    <section className="grid">
      <article className="card"><div className="muted">{t("featureCollectionTitle")}</div><div className="metric">{t("featureCollectionValue")}</div><p className="muted">{t("featureCollectionBody")}</p></article>
      <article className="card"><div className="muted">{t("featureAccessTitle")}</div><div className="metric">{t("featureAccessValue")}</div><p className="muted">{t("featureAccessBody")}</p></article>
      <article className="card"><div className="muted">{t("featureLicenseTitle")}</div><div className="metric">{t("featureLicenseValue")}</div><p className="muted">{t("featureLicenseBody")}</p></article>
      <article className="card"><div className="muted">{t("featureCompatTitle")}</div><div className="metric">{t("featureCompatValue")}</div><p className="muted">{t("featureCompatBody")}</p></article>
    </section>
    <section className="landing-section">
      <h2>{t("howItWorksTitle")}</h2>
      <p>{t("howItWorksBody")}</p>
      <ol className="steps">
        <li><b>01</b>{t("step1")}</li>
        <li><b>02</b>{t("step2")}</li>
        <li><b>03</b>{t("step3")}</li>
        <li><b>04</b>{t("step4")}</li>
      </ol>
    </section>
    <footer className="footer">
      <SiteLogo href="/" compact />
    </footer>
  </main>;
}
