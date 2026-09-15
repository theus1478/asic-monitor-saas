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
      <div className="sidebar-bottom"><LanguageSwitcher /><form action={signOut}><button className="logout-button" type="submit">{t("logout")}</button></form><small>v0.2</small></div>
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
