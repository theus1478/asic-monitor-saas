"use client";

import { useTranslations } from "next-intl";

export function FarmDeleteButton({ action, farmName }: { action: (formData: FormData) => void | Promise<void>; farmName: string }) {
  const t = useTranslations("farms");
  return <form action={action} onSubmit={(event) => { if (!window.confirm(t("deleteFarmConfirm", { name: farmName }))) event.preventDefault(); }}>
    <button className="icon-button danger" type="submit" aria-label={t("deleteAction", { name: farmName })} title={t("deleteFarm")}>×</button>
  </form>;
}
