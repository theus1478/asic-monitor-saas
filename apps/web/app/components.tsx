import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOut } from "./auth/actions";
import { isPlatformAdmin } from "../lib/org-data";
import { LanguageSwitcher } from "./language-switcher";
import { SidebarNav } from "./sidebar-nav";
import { SiteLogo } from "./site-logo";

export async function Shell({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const [showAdminShortcut, t] = await Promise.all([!admin && isPlatformAdmin(), getTranslations("nav")]);
  return <div className="app-shell">
    <aside className="sidebar">
      <SiteLogo />
      <p className="workspace">{admin ? t("workspaceAdmin") : t("workspaceClient")}</p>
      <SidebarNav admin={admin} />
      <div className="sidebar-bottom"><LanguageSwitcher /><Link href="/change-password" className="text-link" style={{ fontSize: 12 }}>{t("changePassword")}</Link><form action={signOut}><button className="logout-button" type="submit">{t("logout")}</button></form><small>v0.2</small></div>
      {/* Só aparece no celular/tablet estreito: idioma, senha e sair (a barra lateral inteira some nessa largura). */}
      <details className="mobile-account">
        <summary aria-label={t("account")}><span aria-hidden="true">☰</span></summary>
        <div className="mobile-account-panel">
          {showAdminShortcut && <Link href="/admin" className="mobile-account-item">⚙ {t("adminShortcut")}</Link>}
          <LanguageSwitcher />
          <Link href="/change-password" className="mobile-account-item">{t("changePassword")}</Link>
          <form action={signOut}><button className="mobile-account-item mobile-account-logout" type="submit">{t("logout")}</button></form>
        </div>
      </details>
    </aside>
    <main className="main">
      {showAdminShortcut && <Link href="/admin" className="admin-shortcut">⚙ {t("adminShortcut")}</Link>}
      {children}
    </main>
  </div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="page-kicker">ASIC MONITOR CLOUD</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
