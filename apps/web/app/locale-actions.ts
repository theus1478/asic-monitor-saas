"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, locales, type Locale } from "../i18n/config";

export async function setLocale(locale: string) {
  if (!(locales as readonly string[]).includes(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale as Locale, { maxAge: 60 * 60 * 24 * 365, path: "/" });
}
