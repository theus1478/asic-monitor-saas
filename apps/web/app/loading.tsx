import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("common");
  return <div className="page-loading" aria-label={t("loadingPage")}><div className="loading-logo">⌁</div><div><span /><span /><span /></div></div>;
}
