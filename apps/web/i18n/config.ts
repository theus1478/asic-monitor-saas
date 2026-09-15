export const locales = ["en", "es", "ru", "pl", "pt-BR"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeLabels: Record<Locale, string> = {
  en: "EN",
  es: "ES",
  ru: "RU",
  pl: "PL",
  "pt-BR": "PT",
};
