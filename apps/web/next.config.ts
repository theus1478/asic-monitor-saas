import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Necessário pro Dockerfile de self-host (apps/web/Dockerfile) - gera só
  // os arquivos/dependências realmente usados em .next/standalone, em vez
  // de copiar o node_modules inteiro pra imagem final.
  output: "standalone",
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default withNextIntl(nextConfig);
