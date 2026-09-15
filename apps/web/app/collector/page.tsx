import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Shell } from "../components";

export default async function CollectorPage() {
  const t = await getTranslations("collector");
  return <Shell><PageHeader title={t("title")} description={t("description")} action={<a className="button download-button" href="/downloads/ASICMonitorAgent.exe" download>⇣ {t("downloadWindows")}</a>} />
    <section className="collector-hero card"><div><p className="eyebrow">{t("heroEyebrow")}</p><h2>{t("heroTitle")}</h2><p>{t("heroBody")}</p><div className="collector-meta"><span>{t("metaWindows")}</span><span>{t("metaLocalLogin")}</span><span>{t("metaNetworkScan")}</span><span>{t("metaUpdateInterval")}</span></div></div><div className="collector-glyph">⇣</div></section>
    <section className="steps-grid"><article className="card"><b>01</b><h3>{t("step1Title")}</h3><p>{t("step1Body")}</p></article><article className="card"><b>02</b><h3>{t("step2Title")}</h3><p>{t("step2Body")}</p></article><article className="card"><b>03</b><h3>{t("step3Title")}</h3><p>{t("step3Body")}</p></article><article className="card"><b>04</b><h3>{t("step4Title")}</h3><p>{t("step4Body")}</p></article></section>
    <section className="card collector-help"><div><h2>{t("readyTitle")}</h2><p className="muted">{t("readyBody")}</p></div><Link href="/farms" className="button secondary">{t("chooseFarm")}</Link></section>
  </Shell>;
}
