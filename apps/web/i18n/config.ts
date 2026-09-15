export const locales = ["pt-BR", "en", "es", "ru", "pl"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt-BR";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeLabels: Record<Locale, string> = {
  "pt-BR": "Português",
  en: "English",
  es: "Español",
  ru: "Русский",
  pl: "Polski",
};
