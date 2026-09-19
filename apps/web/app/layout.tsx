import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import "./mobile.css";
import { StackTables } from "./stack-tables";

export const metadata: Metadata = {
  title: "ASIC Monitor Cloud",
  description: "Monitoramento de fazendas ASIC em nuvem.",
  icons: { icon: "/favicon.svg?brand=2" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Android/Chrome: o teclado encolhe a área da página (folhas e formulários ficam acima dele, em vez de ficarem escondidos)
  interactiveWidget: "resizes-content",
  themeColor: "#090c11",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <StackTables />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
