import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASIC Monitor Cloud",
  description: "Monitoramento de fazendas ASIC em nuvem.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}><body>{children}</body></html>;
}
