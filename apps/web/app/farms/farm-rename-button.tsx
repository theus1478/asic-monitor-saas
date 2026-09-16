"use client";

import { useTranslations } from "next-intl";

export function FarmRenameButton({ action, farmName }: { action: (name: string) => void | Promise<void>; farmName: string }) {
  const t = useTranslations("farms");
  const rename = () => {
    const next = window.prompt(t("renameFarmPrompt"), farmName);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === farmName) return;
    action(trimmed);
  };
  return <button className="icon-button" type="button" aria-label={t("renameAction", { name: farmName })} title={t("renameFarm")} onClick={rename}>✎</button>;
}
