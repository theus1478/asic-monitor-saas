"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "./locale-actions";
import { localeLabels, locales } from "../i18n/config";

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <select
      className={`language-switcher${className ? ` ${className}` : ""}`}
      value={locale}
      disabled={pending}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Idioma / Language"
    >
      {locales.map((code) => (
        <option key={code} value={code}>{localeLabels[code]}</option>
      ))}
    </select>
  );
}
