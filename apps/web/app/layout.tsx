import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASIC Monitor Cloud",
  description: "Monitoramento de fazendas ASIC em nuvem.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
